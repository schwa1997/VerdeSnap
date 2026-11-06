import { createWorker, type Worker } from "tesseract.js";
import type { TextBlock } from "./draw";

// Reading text out of a snap with Tesseract (中文 + English + Español). Everything it needs ships
// with the app, so this works offline.

const TESS = "app://snap/tess";
let worker: Promise<Worker> | null = null;

function getWorker() {
  worker ??= createWorker(["chi_sim", "eng", "spa"], 1, {
    workerPath: `${TESS}/worker.min.js`,
    corePath: `${TESS}/core`,
    langPath: `${TESS}/lang`,
    workerBlobURL: false,
    gzip: false,
    cacheMethod: "none",
  });
  return worker;
}

const CJK = "　-鿿＀-￯";

/** Tesseract puts spaces between Chinese characters; take them out. */
function tidy(text: string): string {
  return text
    .replace(new RegExp(`([${CJK}])\\s+(?=[${CJK}])`, "g"), "$1")
    .replace(/\s*\n\s*/g, " ")
    .trim();
}

export async function readText(image: HTMLCanvasElement): Promise<TextBlock[]> {
  const w = await getWorker();
  const { data } = await w.recognize(image, {}, { blocks: true });
  const blocks: TextBlock[] = [];
  // Line by line, like WeChat: Tesseract's paragraphs often swallow a whole app window.
  for (const block of data.blocks ?? [])
    for (const p of block.paragraphs)
      for (const line of p.lines) {
        const text = tidy(line.text);
        if (!text || line.confidence < 45) continue;
        const { x0, y0, x1, y1 } = line.bbox;
        blocks.push({ box: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, text });
      }
  return blocks;
}
