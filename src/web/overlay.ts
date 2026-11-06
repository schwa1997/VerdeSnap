import {
  Check, Circle, Download, Grid3x3, Languages, MoveUpRight, Pencil, Pin, ScanText, Smile, Square, Type, Undo2, X,
  createElement, type IconNode,
} from "lucide";
import type { SnapApi } from "../preload";
import { COLORS, EMOJIS, SIZES, boxFrom, paint, pixelate, scaleOf, type Box, type Mark, type Pt, type TextBlock } from "./draw";
import { readText } from "./ocr";
import { strings, type Strings } from "./strings";

// One of these runs per screen. It shows the frozen screen, lets me drag an area, then turns that
// area into the editor in place: mark it up, read it, translate it, then copy / save / pin.

type Tool = "rect" | "ellipse" | "arrow" | "pen" | "mosaic" | "text" | "emoji";
type Target = "zh" | "en" | "es";

const snap = (window as unknown as { snap: SnapApi }).snap;
const TARGETS: { id: Target; label: string }[] = [
  { id: "zh", label: "中文" },
  { id: "en", label: "English" },
  { id: "es", label: "Español" },
];
const TARGET_KEY = "verdesnap-target";

const screenCanvas = document.getElementById("screen") as HTMLCanvasElement;
const view = document.getElementById("view") as HTMLCanvasElement;
const hint = document.getElementById("hint")!;
const bar = document.getElementById("bar")!;
const panel = document.getElementById("panel")!;

let t: Strings = strings.en;
let scale = 1;
let aiReady = false;
let frame: HTMLCanvasElement;

let stage: "select" | "edit" = "select";
let locked = false;
let dragFrom: Pt | null = null;
let box: Box | null = null;

let base: HTMLCanvasElement | null = null;
let mosaic: HTMLCanvasElement | null = null;
let tool: Tool | null = null;
let color = COLORS[0];
let size = SIZES[1];
let emoji = EMOJIS[0];
let marks: Mark[] = [];
let draft: Mark | null = null;
let markFrom: Pt | null = null;
let typing: { at: Pt; el: HTMLTextAreaElement } | null = null;
let blocks: TextBlock[] | null = null;
let busy: "reading" | "translating" | null = null;
let onImage = false;
let aiError = false;
let ocrError = false;
let target: Target = "zh";

try {
  const saved = localStorage.getItem(TARGET_KEY);
  if (TARGETS.some((l) => l.id === saved)) target = saved as Target;
} catch {}

/** Make an element: h("button", { class: "x", onclick }, "text", child). */
function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...kids: (Node | string)[]) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") el.className = String(v);
    else if (k === "style") Object.assign(el.style, v);
    else (el as unknown as Record<string, unknown>)[k] = v;
  }
  el.append(...kids);
  return el;
}

const pointIn = (e: PointerEvent, c: HTMLCanvasElement): Pt => {
  const r = c.getBoundingClientRect();
  return { x: ((e.clientX - r.left) * c.width) / r.width, y: ((e.clientY - r.top) * c.height) / r.height };
};

function drawScreen() {
  const c = screenCanvas;
  const ctx = c.getContext("2d")!;
  ctx.drawImage(frame, 0, 0);
  ctx.fillStyle = "rgba(11,19,14,0.5)";
  ctx.fillRect(0, 0, c.width, c.height);
  if (!box) return;
  ctx.drawImage(frame, box.x, box.y, box.w, box.h, box.x, box.y, box.w, box.h);
  ctx.strokeStyle = "#8DBF5A";
  ctx.lineWidth = 2 * scale;
  ctx.strokeRect(box.x, box.y, box.w, box.h);
  ctx.font = `600 ${12 * scale}px "Segoe UI", sans-serif`;
  const label = `${Math.round(box.w)} × ${Math.round(box.h)}`;
  const y = box.y > 24 * scale ? box.y - 22 * scale : box.y + 4 * scale;
  ctx.fillStyle = "#1f6b45";
  ctx.fillRect(box.x, y, ctx.measureText(label).width + 12 * scale, 18 * scale);
  ctx.fillStyle = "#fff";
  ctx.textBaseline = "top";
  ctx.fillText(label, box.x + 6 * scale, y + 3 * scale);
}

function beginEdit(area: Box) {
  box = { x: Math.round(area.x), y: Math.round(area.y), w: Math.round(area.w), h: Math.round(area.h) };
  base = document.createElement("canvas");
  base.width = box.w;
  base.height = box.h;
  base.getContext("2d")!.drawImage(frame, box.x, box.y, box.w, box.h, 0, 0, box.w, box.h);
  stage = "edit";
  hint.hidden = true;
  screenCanvas.classList.add("done");
  Object.assign(view.style, {
    left: `${box.x / scale}px`, top: `${box.y / scale}px`, width: `${box.w / scale}px`, height: `${box.h / scale}px`,
  });
  view.hidden = false;
  bar.hidden = false;
  drawScreen();
  paintView();
  drawBar();
}

/** Right-click while editing: throw this area away and pick again. */
function backToSelect() {
  stage = "select";
  base = mosaic = null;
  box = draft = markFrom = blocks = null;
  marks = [];
  tool = null;
  onImage = aiError = ocrError = false;
  typing?.el.remove();
  typing = null;
  view.hidden = bar.hidden = panel.hidden = true;
  hint.hidden = false;
  screenCanvas.classList.remove("done");
  drawScreen();
}

function paintView() {
  if (!base) return;
  const source = base;
  paint(view, source, marks, {
    draft,
    blocks: onImage && blocks ? blocks : undefined,
    mosaic: () => (mosaic ??= pixelate(source, Math.round(12 * scaleOf(source)))),
  });
}

const png = () =>
  new Promise<Uint8Array>((res) =>
    view.toBlob((b) => b!.arrayBuffer().then((buf) => res(new Uint8Array(buf))), "image/png"));

const finish = () => {
  commitText();
  paintView();
};
const copy = async () => { finish(); await snap.copy(await png()); };
const save = async () => { finish(); await snap.save(await png()); };
const pin = async () => { finish(); await snap.pin(await png(), view.width, view.height); };
const undo = () => {
  marks = marks.slice(0, -1);
  paintView();
  drawBar();
};

async function read() {
  if (blocks) return blocks;
  busy = "reading";
  ocrError = false;
  drawPanel();
  drawBar();
  try {
    blocks = await readText(base!);
    return blocks;
  } catch (err) {
    console.error(err);
    ocrError = true;
    return null;
  } finally {
    busy = null;
    drawPanel();
    drawBar();
  }
}

async function translate(to: Target = target) {
  target = to;
  try {
    localStorage.setItem(TARGET_KEY, to);
  } catch {}
  const found = await read();
  if (!found?.length) return;
  busy = "translating";
  aiError = false;
  drawPanel();
  drawBar();
  const translations = await snap.translate(found.map((b) => b.text), to).catch(() => null);
  busy = null;
  if (translations) {
    blocks = found.map((b, i) => ({ ...b, translated: translations[i] }));
    onImage = true;
    paintView();
  } else aiError = true;
  drawPanel();
  drawBar();
}

function commitText() {
  if (!typing) return;
  const { at, el } = typing;
  typing = null;
  el.remove();
  if (el.value.trim()) marks = [...marks, { kind: "text", at, text: el.value, color, size }];
  paintView();
  drawBar();
}

function startTyping(at: Pt) {
  commitText();
  const r = view.getBoundingClientRect();
  const ratio = r.width / view.width;
  const el = h("textarea", {
    id: "typing",
    rows: 1,
    placeholder: t.textPlaceholder,
    style: {
      left: `${r.left + at.x * ratio}px`,
      top: `${r.top + at.y * ratio}px`,
      color,
      fontSize: `${(size * 3 + 10) * scaleOf(base!) * ratio}px`,
    },
    onkeydown: (e: KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); commitText(); }
      if (e.key === "Escape") { typing = null; el.remove(); }
    },
    onblur: commitText,
  });
  document.body.append(el);
  typing = { at, el };
  setTimeout(() => el.focus());
}

function iconButton(icon: IconNode, label: string, onclick: () => void, cls = "", disabled = false) {
  return h("button", { class: `icon ${cls}`, title: label, ariaLabel: label, disabled, onclick }, createElement(icon));
}

function drawBar() {
  const pick = (id: Tool, icon: IconNode, label: string) =>
    iconButton(icon, label, () => { commitText(); tool = tool === id ? null : id; view.classList.toggle("drawing", !!tool); drawBar(); }, tool === id ? "on" : "");
  const sep = () => h("span", { class: "sep" });
  const row = h("div", { class: "row" },
    pick("rect", Square, t.rect), pick("ellipse", Circle, t.ellipse), pick("emoji", Smile, t.emoji),
    pick("arrow", MoveUpRight, t.arrow), pick("pen", Pencil, t.pen), pick("mosaic", Grid3x3, t.mosaic), pick("text", Type, t.text),
    sep(),
    iconButton(Languages, aiReady ? t.translate : t.aiError, () => void translate(), onImage ? "on" : "", !aiReady || !!busy),
    iconButton(ScanText, t.ocr, () => void read(), blocks && !onImage ? "on" : "", !!busy),
    sep(),
    iconButton(Undo2, t.undo, undo, "", !marks.length),
    iconButton(Download, t.save, () => void save()),
    iconButton(Pin, t.pin, () => void pin()),
    iconButton(X, t.close, () => void snap.close(), "close"),
    iconButton(Check, t.copy, () => void copy(), "done"),
  );
  bar.replaceChildren(row);

  const sizes = () => SIZES.map((s) =>
    h("button", { class: `size ${size === s ? "on" : ""}`, ariaLabel: `size ${s}`, onclick: () => { size = s; drawBar(); } },
      h("span", { style: { width: `${s + 2}px`, height: `${s + 2}px` } })));
  if (tool === "emoji")
    bar.append(h("div", { class: "row options" }, ...EMOJIS.map((em) =>
      h("button", { class: `char ${emoji === em ? "on" : ""}`, onclick: () => { emoji = em; drawBar(); } }, em))));
  else if (tool === "mosaic") bar.append(h("div", { class: "row options" }, ...sizes()));
  else if (tool)
    bar.append(h("div", { class: "row options" }, ...sizes(), ...COLORS.map((c) =>
      h("button", { class: `swatch ${color === c ? "on" : ""}`, ariaLabel: c, style: { background: c }, onclick: () => { color = c; drawBar(); } }))));
  place();
}

function section(text: string, title?: string) {
  const parts: (Node | string)[] = [];
  if (title) parts.push(h("h2", {}, title));
  parts.push(h("p", { class: "said" }, text));
  parts.push(h("button", { class: "link", onclick: (e: MouseEvent) => {
    void snap.copyText(text);
    (e.currentTarget as HTMLElement).textContent = t.copied;
  } }, t.copyText));
  return parts;
}

function drawPanel() {
  panel.hidden = !blocks && !busy && !ocrError;
  const kids: Node[] = [];
  if (busy) kids.push(h("p", { class: "busy" }, t[busy]));
  if (ocrError) kids.push(h("p", { class: "error" }, t.ocrError));
  if (blocks) {
    const all = blocks.map((b) => b.text).join("\n");
    if (!all) kids.push(h("p", { class: "none" }, t.noText));
    else {
      kids.push(h("div", { class: "block" }, ...section(all, t.foundText)));
      const done = blocks.some((b) => b.translated);
      const langs = h("div", { class: "langs" }, ...TARGETS.map((l) =>
        h("button", { class: `lang ${done && target === l.id ? "on" : ""}`, disabled: !!busy || !aiReady, onclick: () => void translate(l.id) }, l.label)));
      const block = h("div", { class: "block" }, h("h2", {}, t.translation), langs);
      if (aiError || !aiReady) block.append(h("p", { class: "error" }, t.aiError));
      if (done) {
        block.append(...section(blocks.map((b) => b.translated ?? "").join("\n")));
        block.append(h("label", { class: "check" },
          h("input", { type: "checkbox", checked: onImage, onchange: (e: Event) => {
            onImage = (e.target as HTMLInputElement).checked;
            paintView();
            drawBar();
          } }),
          t.showOnImage));
      }
      kids.push(block);
    }
  }
  panel.replaceChildren(...kids);
  place();
}

/** Keep the toolbar and panel beside the area, on screen, and off each other. */
function place() {
  if (!box) return;
  const gap = 8;
  const W = innerWidth, H = innerHeight;
  const a = { l: box.x / scale, t: box.y / scale, r: (box.x + box.w) / scale, b: (box.y + box.h) / scale };
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(v, Math.max(lo, hi)));

  const bw = bar.offsetWidth, bh = bar.offsetHeight;
  const below = a.b + gap + bh <= H - gap;
  const above = a.t - gap - bh >= gap;
  const barTop = below ? a.b + gap : above ? a.t - gap - bh : a.b - bh - gap;
  bar.style.left = `${clamp(a.r - bw, gap, W - bw - gap)}px`;
  bar.style.top = `${clamp(barTop, gap, H - bh - gap)}px`;

  if (panel.hidden) return;
  const pw = panel.offsetWidth, ph = panel.offsetHeight;
  const right = a.r + gap + pw <= W - gap;
  const left = a.l - gap - pw >= gap;
  panel.style.left = `${right ? a.r + gap : left ? a.l - gap - pw : W - pw - gap}px`;
  let top = clamp(a.t, gap, H - ph - gap);
  if (!right && !left && !below && !above) top = gap;
  panel.style.top = `${top}px`;
}

function listenSelect() {
  screenCanvas.addEventListener("pointerdown", (e) => {
    if (stage !== "select" || locked || e.button !== 0) return;
    screenCanvas.setPointerCapture(e.pointerId);
    dragFrom = pointIn(e, screenCanvas);
    box = null;
    void snap.claim();
  });
  screenCanvas.addEventListener("pointermove", (e) => {
    if (!dragFrom) return;
    box = boxFrom(dragFrom, pointIn(e, screenCanvas));
    drawScreen();
  });
  screenCanvas.addEventListener("pointerup", () => {
    if (!dragFrom) return;
    dragFrom = null;
    if (box && box.w > 4 && box.h > 4) beginEdit(box);
    else {
      box = null;
      drawScreen();
    }
  });
  window.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    if (stage === "edit") {
      if (!(e.target as HTMLElement).closest("#bar, #panel")) backToSelect();
    } else void snap.close();
  });
}

function listenDraw() {
  view.addEventListener("pointerdown", (e) => {
    if (!tool || e.button !== 0) return;
    const p = pointIn(e, view);
    if (tool === "text") {
      e.preventDefault();
      startTyping(p);
      return;
    }
    if (tool === "emoji") {
      marks = [...marks, { kind: "emoji", at: p, char: emoji, size }];
      paintView();
      drawBar();
      return;
    }
    view.setPointerCapture(e.pointerId);
    markFrom = p;
    if (tool === "pen") draft = { kind: "pen", points: [p], color, size };
    if (tool === "mosaic") draft = { kind: "mosaic", points: [p], size };
    paintView();
  });
  view.addEventListener("pointermove", (e) => {
    if (!markFrom || !tool) return;
    const p = pointIn(e, view);
    if (tool === "rect" || tool === "ellipse") draft = { kind: tool, box: boxFrom(markFrom, p), color, size };
    else if (tool === "arrow") draft = { kind: "arrow", from: markFrom, to: p, color, size };
    else if (draft && "points" in draft) draft = { ...draft, points: [...draft.points, p] };
    paintView();
  });
  const up = () => {
    markFrom = null;
    if (!draft) return;
    const big =
      "box" in draft ? draft.box.w > 3 && draft.box.h > 3
      : draft.kind === "arrow" ? Math.hypot(draft.to.x - draft.from.x, draft.to.y - draft.from.y) > 6
      : true;
    if (big) marks = [...marks, draft];
    draft = null;
    paintView();
    drawBar();
  };
  view.addEventListener("pointerup", up);
  view.addEventListener("pointercancel", up);
  view.addEventListener("dblclick", () => {
    if (!tool) void copy();
  });
}

function listenKeys() {
  window.addEventListener("keydown", (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (e.key === "Escape") void snap.close();
    else if (stage === "select") {
      if (e.key === "Enter" && !locked) {
        void snap.claim();
        beginEdit({ x: 0, y: 0, w: frame.width, h: frame.height });
      }
    } else if (e.key === "Enter") void copy();
    else if (mod && e.key.toLowerCase() === "z") { e.preventDefault(); undo(); }
    else if (mod && e.key.toLowerCase() === "s") { e.preventDefault(); void save(); }
    else if (mod && e.key.toLowerCase() === "c" && !window.getSelection()?.toString()) { e.preventDefault(); void copy(); }
  });
}

async function start() {
  const shot = await snap.shot();
  if (!shot) return;
  t = strings[shot.lang];
  scale = shot.scale;
  aiReady = shot.aiReady;
  const bmp = await createImageBitmap(new Blob([shot.png as BlobPart], { type: "image/png" }));
  frame = document.createElement("canvas");
  frame.width = screenCanvas.width = bmp.width;
  frame.height = screenCanvas.height = bmp.height;
  frame.getContext("2d")!.drawImage(bmp, 0, 0);
  bmp.close();
  hint.textContent = t.selectHint;
  hint.hidden = false;
  drawScreen();
}

snap.onLocked(() => {
  locked = true;
  hint.hidden = true;
});
listenSelect();
listenDraw();
listenKeys();
void start();
