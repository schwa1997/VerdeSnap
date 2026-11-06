// Renders assets/icon.svg to assets/icon.png. Run it if the icon changes: npm run icon
const { app, BrowserWindow } = require("electron");
const { readFileSync, writeFileSync } = require("node:fs");

const SIZE = Number(process.argv.at(-1)) || 512;
const OUT = process.argv.find((a) => a.endsWith(".png")) ?? "assets/icon.png";

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false });
  await win.loadURL("about:blank");
  const svg = readFileSync("assets/icon.svg").toString("base64");
  const png = await win.webContents.executeJavaScript(`new Promise((done) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = c.height = ${SIZE};
      c.getContext("2d").drawImage(img, 0, 0, ${SIZE}, ${SIZE});
      done(c.toDataURL("image/png"));
    };
    img.src = "data:image/svg+xml;base64,${svg}";
  })`);
  writeFileSync(OUT, Buffer.from(png.split(",")[1], "base64"));
  app.quit();
});
