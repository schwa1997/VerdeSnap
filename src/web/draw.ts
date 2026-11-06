// Marks drawn on top of a snap, and how the finished picture is painted.
// Everything is kept in image pixels, so it can be redrawn at any display size.

export type Pt = { x: number; y: number };
export type Box = { x: number; y: number; w: number; h: number };

export type Mark =
  | { kind: "rect" | "ellipse"; box: Box; color: string; size: number }
  | { kind: "arrow"; from: Pt; to: Pt; color: string; size: number }
  | { kind: "pen"; points: Pt[]; color: string; size: number }
  | { kind: "mosaic"; points: Pt[]; size: number }
  | { kind: "text"; at: Pt; text: string; color: string; size: number }
  | { kind: "emoji"; at: Pt; char: string; size: number };

/** A block of text found by OCR, with its translation once we have one. */
export type TextBlock = { box: Box; text: string; translated?: string };

export const COLORS = ["#e5484d", "#f5a524", "#2f7d4a", "#3b82f6", "#ff8fc8", "#ffffff"];
export const SIZES = [3, 6, 10];
export const EMOJIS = ["✧", "❤️", "👍", "⭐", "😂", "🥹", "✅", "❌", "👉", "🌿"];

/** Turn two corners into a box with a positive width and height. */
export function boxFrom(a: Pt, b: Pt): Box {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
}

/** A blocky copy of the picture, used to paint the mosaic brush. */
export function pixelate(base: HTMLCanvasElement, block: number): HTMLCanvasElement {
  const small = document.createElement("canvas");
  small.width = Math.max(1, Math.ceil(base.width / block));
  small.height = Math.max(1, Math.ceil(base.height / block));
  small.getContext("2d")!.drawImage(base, 0, 0, small.width, small.height);
  const big = document.createElement("canvas");
  big.width = base.width;
  big.height = base.height;
  const ctx = big.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(small, 0, 0, big.width, big.height);
  return big;
}

/** How thick a mark looks: sizes are picked for a ~1000 px wide picture and scale with it. */
export const scaleOf = (base: HTMLCanvasElement) => Math.max(1, Math.max(base.width, base.height) / 1000);

function stroke(ctx: CanvasRenderingContext2D, points: Pt[]) {
  ctx.beginPath();
  points.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  if (points.length === 1) ctx.lineTo(points[0].x + 0.1, points[0].y);
  ctx.stroke();
}

function drawMark(ctx: CanvasRenderingContext2D, m: Mark, k: number, mosaic: () => HTMLCanvasElement) {
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (m.kind === "mosaic") {
    // Paint the brush stroke into a mask, then keep only the blocky picture inside it.
    const mask = document.createElement("canvas");
    mask.width = ctx.canvas.width;
    mask.height = ctx.canvas.height;
    const mc = mask.getContext("2d")!;
    mc.lineCap = "round";
    mc.lineJoin = "round";
    mc.lineWidth = m.size * 4 * k;
    stroke(mc, m.points);
    mc.globalCompositeOperation = "source-in";
    mc.drawImage(mosaic(), 0, 0);
    ctx.drawImage(mask, 0, 0);
  } else if (m.kind === "emoji") {
    ctx.font = `${m.size * 8 * k}px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(m.char, m.at.x, m.at.y);
  } else if (m.kind === "text") {
    ctx.fillStyle = m.color;
    ctx.font = `600 ${(m.size * 3 + 10) * k}px Geist, "Microsoft YaHei", sans-serif`;
    ctx.textBaseline = "top";
    m.text.split("\n").forEach((line, i) => ctx.fillText(line, m.at.x, m.at.y + i * (m.size * 3 + 14) * k));
  } else {
    ctx.strokeStyle = m.color;
    ctx.lineWidth = m.size * k;
    if (m.kind === "rect") ctx.strokeRect(m.box.x, m.box.y, m.box.w, m.box.h);
    else if (m.kind === "ellipse") {
      ctx.beginPath();
      ctx.ellipse(m.box.x + m.box.w / 2, m.box.y + m.box.h / 2, m.box.w / 2, m.box.h / 2, 0, 0, Math.PI * 2);
      ctx.stroke();
    } else if (m.kind === "pen") stroke(ctx, m.points);
    else if (m.kind === "arrow") {
      const { from, to } = m;
      const ang = Math.atan2(to.y - from.y, to.x - from.x);
      const head = Math.max(14 * k, m.size * 4 * k);
      stroke(ctx, [from, { x: to.x - Math.cos(ang) * head * 0.6, y: to.y - Math.sin(ang) * head * 0.6 }]);
      ctx.fillStyle = m.color;
      ctx.beginPath();
      ctx.moveTo(to.x, to.y);
      ctx.lineTo(to.x - head * Math.cos(ang - 0.45), to.y - head * Math.sin(ang - 0.45));
      ctx.lineTo(to.x - head * Math.cos(ang + 0.45), to.y - head * Math.sin(ang + 0.45));
      ctx.closePath();
      ctx.fill();
    }
  }
  ctx.restore();
}

/** Wrap `text` into lines no wider than `width` (word by word, or char by char for 中文). */
function wrap(ctx: CanvasRenderingContext2D, text: string, width: number): string[] {
  const tokens = text.match(/[　-鿿＀-￯]|[^\s　-鿿＀-￯]+|\s+/g) ?? [];
  const lines: string[] = [];
  let line = "";
  for (const tok of tokens) {
    const next = line + tok;
    if (line && ctx.measureText(next.trimEnd()).width > width) {
      lines.push(line.trimEnd());
      line = tok.trimStart();
    } else line = next;
  }
  if (line.trim()) lines.push(line.trimEnd());
  return lines;
}

/** Cover each OCR block with a paper patch holding its translation, like WeChat's translate view. */
function drawTranslations(ctx: CanvasRenderingContext2D, blocks: TextBlock[], k: number) {
  for (const b of blocks) {
    if (!b.translated) continue;
    const pad = 3 * k;
    const box = { x: b.box.x - pad, y: b.box.y - pad, w: b.box.w + pad * 2, h: b.box.h + pad * 2 };
    ctx.save();
    ctx.fillStyle = "rgba(246,250,239,0.96)";
    ctx.beginPath();
    ctx.roundRect(box.x, box.y, box.w, box.h, 4 * k);
    ctx.fill();
    ctx.fillStyle = "#24342b";
    ctx.textBaseline = "top";
    // Shrink the font until the translation fits the box (but never below a readable size).
    let size = Math.min(box.h * 0.8, 28 * k);
    let lines: string[] = [];
    for (; size > 9 * k; size *= 0.9) {
      ctx.font = `500 ${size}px Geist, "Microsoft YaHei", sans-serif`;
      lines = wrap(ctx, b.translated, box.w - pad * 2);
      if (lines.length * size * 1.2 <= box.h) break;
    }
    const top = box.y + Math.max(0, (box.h - lines.length * size * 1.2) / 2);
    lines.forEach((l, i) => ctx.fillText(l, box.x + pad, top + i * size * 1.2 + size * 0.1));
    ctx.restore();
  }
}

/** Paint the snap, its marks, an unfinished mark and (optionally) the translation patches. */
export function paint(
  canvas: HTMLCanvasElement,
  base: HTMLCanvasElement,
  marks: Mark[],
  opts: { draft?: Mark | null; blocks?: TextBlock[]; mosaic: () => HTMLCanvasElement },
) {
  if (canvas.width !== base.width) canvas.width = base.width;
  if (canvas.height !== base.height) canvas.height = base.height;
  const ctx = canvas.getContext("2d")!;
  const k = scaleOf(base);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(base, 0, 0);
  if (opts.blocks) drawTranslations(ctx, opts.blocks, k);
  for (const m of marks) drawMark(ctx, m, k, opts.mosaic);
  if (opts.draft) drawMark(ctx, opts.draft, k, opts.mosaic);
}
