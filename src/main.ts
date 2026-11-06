import {
  app, BrowserWindow, ClipboardItem, Menu, Notification, Tray, clipboard, desktopCapturer, dialog, globalShortcut,
  ipcMain, nativeImage, net, protocol, screen, type Display, type IpcMainInvokeEvent,
} from "electron";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { startServer } from "./server";
import { translate, type AiConfig } from "./translate";

// VerdeSnap lives in the tray. Alt+A (same as WeChat) freezes every screen, I drag an area, and
// the toolbar appears right there. Nothing here needs the craft site to be running.

const HOTKEY = "Alt+A";
const FALLBACK = "Ctrl+Alt+A";
const WEB = path.join(__dirname, "web");

protocol.registerSchemesAsPrivileged([
  { scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

if (!app.requestSingleInstanceLock()) app.quit();
app.setAppUserModelId("com.verde.snap");

type Overlay = { win: BrowserWindow; png: Buffer; scale: number };
const overlays = new Map<number, Overlay>();
const pins = new Map<number, Buffer>();
let capturing = false;
let tray: Tray | null = null;
let hotkey: string | null = null;
let retry: NodeJS.Timeout | null = null;

const lang = () => (app.getLocale().startsWith("es") ? "es" : "en");

/** The AI settings: only SNAP_AI_URL and SNAP_AI_MODEL, from .env next to the app. */
function aiConfig(): AiConfig | null {
  const file = app.isPackaged ? path.join(process.resourcesPath, "ai.env") : path.join(app.getAppPath(), ".env");
  if (!existsSync(file)) return null;
  const env = Object.fromEntries(
    readFileSync(file, "utf8").split(/\r?\n/).flatMap((line) => {
      const i = line.indexOf("=");
      return i > 0 ? [[line.slice(0, i).trim(), line.slice(i + 1).trim().replace(/^["']|["']$/g, "")]] : [];
    }),
  );
  return env.SNAP_AI_URL ? { url: env.SNAP_AI_URL, model: env.SNAP_AI_MODEL } : null;
}

const fullSize = (d: Display) => ({
  width: Math.round(d.size.width * d.scaleFactor),
  height: Math.round(d.size.height * d.scaleFactor),
});

/** One picture per screen, each at that screen's real pixel size. */
async function grabScreens(displays: Display[]) {
  const shots = new Map<number, Electron.NativeImage>();
  const sizes = new Map(displays.map((d) => [JSON.stringify(fullSize(d)), fullSize(d)]));
  for (const size of sizes.values()) {
    const sources = await desktopCapturer.getSources({ types: ["screen"], thumbnailSize: size });
    displays.forEach((d, i) => {
      const s = fullSize(d);
      if (s.width !== size.width || s.height !== size.height) return;
      const source = sources.find((x) => x.display_id === String(d.id)) ?? sources[i];
      if (source) shots.set(d.id, source.thumbnail);
    });
  }
  return shots;
}

async function snap() {
  if (capturing) return;
  capturing = true;
  try {
    const displays = screen.getAllDisplays();
    const shots = await grabScreens(displays);
    const under = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    for (const d of displays) {
      const shot = shots.get(d.id);
      if (shot) openOverlay(d, shot, d.id === under.id);
    }
    if (!overlays.size) capturing = false;
  } catch (err) {
    console.error(err);
    closeOverlays();
  }
}

function openOverlay(d: Display, shot: Electron.NativeImage, focus: boolean) {
  const win = new BrowserWindow({
    ...d.bounds,
    show: false,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    enableLargerThanScreen: true,
    backgroundColor: "#0b130e",
    webPreferences: { preload: path.join(__dirname, "preload.js"), sandbox: true, contextIsolation: true },
  });
  win.setAlwaysOnTop(true, "screen-saver");
  win.setBounds(d.bounds); // twice on purpose: the first one can land at the wrong size across mixed-DPI screens
  const id = win.webContents.id;
  overlays.set(id, { win, png: shot.toPNG(), scale: d.scaleFactor });
  win.once("ready-to-show", () => {
    win.show();
    if (focus) win.focus();
  });
  // A dead overlay would leave a frozen full-screen window on top of everything.
  win.webContents.on("render-process-gone", (_e, details) => {
    console.error("overlay gone:", details.reason);
    closeOverlays();
  });
  win.on("closed", () => {
    overlays.delete(id);
    if (!overlays.size) capturing = false;
  });
  win.loadURL("app://snap/overlay.html");
}

function closeOverlays() {
  for (const { win } of overlays.values()) if (!win.isDestroyed()) win.close();
  if (!overlays.size) capturing = false;
}

function openPin(png: Buffer, width: number, height: number) {
  const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  const k = Math.min(1, (area.width * 0.8) / width, (area.height * 0.8) / height);
  const win = new BrowserWindow({
    x: area.x + Math.round((area.width - width * k) / 2),
    y: area.y + Math.round((area.height - height * k) / 2),
    width: Math.max(80, Math.round(width * k)),
    height: Math.max(60, Math.round(height * k)),
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    title: "VerdeSnap ✧",
    backgroundColor: "#0b130e",
    webPreferences: { preload: path.join(__dirname, "preload.js"), sandbox: true, contextIsolation: true },
  });
  win.setAspectRatio(width / height);
  const id = win.webContents.id;
  pins.set(id, png);
  win.on("closed", () => pins.delete(id));
  win.loadURL("app://snap/pin.html");
}

const stamp = () => {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
};

const overlayOf = (e: IpcMainInvokeEvent) => overlays.get(e.sender.id);

function listen() {
  ipcMain.handle("shot", (e) => {
    const o = overlayOf(e);
    return o ? { png: new Uint8Array(o.png), scale: o.scale, lang: lang(), aiReady: !!aiConfig() } : null;
  });
  ipcMain.handle("claim", (e) => {
    for (const [id, o] of overlays) if (id !== e.sender.id) o.win.webContents.send("locked");
  });
  ipcMain.handle("close", closeOverlays);
  ipcMain.handle("copy", async (_e, png: Uint8Array) => {
    const image = new Blob([Buffer.from(png)], { type: "image/png" });
    await clipboard.write([new ClipboardItem({ "image/png": image })]);
    closeOverlays();
  });
  ipcMain.handle("copy-text", (_e, text: string) => clipboard.writeText(text));
  ipcMain.handle("save", async (e, png: Uint8Array) => {
    const win = overlayOf(e)?.win;
    if (!win) return;
    const options = {
      defaultPath: path.join(app.getPath("pictures"), `verdesnap-${stamp()}.png`),
      filters: [{ name: "PNG", extensions: ["png"] }],
    };
    const { canceled, filePath } = await dialog.showSaveDialog(win, options);
    if (canceled || !filePath) return;
    writeFileSync(filePath, Buffer.from(png));
    closeOverlays();
  });
  ipcMain.handle("pin", (e, png: Uint8Array, width: number, height: number) => {
    const scale = overlayOf(e)?.scale ?? 1;
    openPin(Buffer.from(png), width / scale, height / scale);
    closeOverlays();
  });
  ipcMain.handle("pin-image", (e) => {
    const png = pins.get(e.sender.id);
    return png ? new Uint8Array(png) : null;
  });
  ipcMain.handle("pin-close", (e) => BrowserWindow.fromWebContents(e.sender)?.close());
  ipcMain.handle("translate", (_e, texts: string[], target: string) => {
    const config = aiConfig();
    return config ? translate(config, texts, target) : null;
  });
}

function serveApp() {
  protocol.handle("app", (request) => {
    const file = path.normalize(path.join(WEB, decodeURIComponent(new URL(request.url).pathname)));
    if (!file.startsWith(WEB + path.sep)) return new Response("not found", { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });
}

/** Start with Windows from the first run on; after that the tray checkbox decides. */
function startWithWindows() {
  if (!app.isPackaged) return;
  const marker = path.join(app.getPath("userData"), "autostart-set");
  if (existsSync(marker)) return;
  app.setLoginItemSettings({ openAtLogin: true });
  writeFileSync(marker, "");
}

function updateTray() {
  if (!tray) return;
  const hint = hotkey ?? "tray click";
  tray.setToolTip(`VerdeSnap ✧ ${hint}`);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: `Snap (${hint})`, click: snap },
    { type: "separator" },
    ...(app.isPackaged ? [{
      label: "Start with Windows",
      type: "checkbox" as const,
      checked: app.getLoginItemSettings().openAtLogin,
      click: (item: Electron.MenuItem) => app.setLoginItemSettings({ openAtLogin: item.checked }),
    }] : []),
    { label: "Quit", click: () => app.quit() },
  ]));
}

/** Alt+A, and if WeChat is holding it: Ctrl+Alt+A for now, trying for Alt+A again until it's free. */
function bindHotkey() {
  if (globalShortcut.register(HOTKEY, snap)) {
    if (hotkey === FALLBACK) globalShortcut.unregister(FALLBACK);
    hotkey = HOTKEY;
    if (retry) clearInterval(retry);
    retry = null;
    updateTray();
    return;
  }
  if (!hotkey && globalShortcut.register(FALLBACK, snap)) {
    hotkey = FALLBACK;
    updateTray();
    new Notification({
      title: "VerdeSnap ✧",
      body: `Another app (WeChat?) is using ${HOTKEY}. Using ${FALLBACK} until it's free.`,
    }).show();
  }
  retry ??= setInterval(bindHotkey, 15_000);
}

app.on("second-instance", snap);
app.on("window-all-closed", () => {}); // stay in the tray
app.on("will-quit", () => globalShortcut.unregisterAll());

app.whenReady().then(() => {
  serveApp();
  listen();
  startWithWindows();
  tray = new Tray(nativeImage.createFromPath(path.join(__dirname, "icon.png")).resize({ width: 32, height: 32 }));
  tray.on("click", snap);
  updateTray();
  bindHotkey();
  startServer(snap, () => hotkey);
  console.log(`VerdeSnap ready: ${hotkey ?? "no hotkey"}`);
  if (process.argv.includes("--snap-now")) snap();
});
