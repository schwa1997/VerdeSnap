import { createServer } from "node:http";

// A tiny door into the running app, on this computer only: open http://localhost:6789 to see it's
// alive and start a snap from there, or POST /snap from a script.

export const PORT = 6789;

const page = (hotkey: string) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>VerdeSnap</title>
<style>
  body { margin: 0; min-height: 100vh; display: grid; place-content: center; gap: 12px; text-align: center;
    font: 15px "Segoe UI", "Microsoft YaHei", sans-serif; color: #1f6b45; background: #f6faef; }
  h1 { margin: 0; font-size: 26px; }
  button { padding: 9px 20px; border: 0; border-radius: 999px; background: #2f7d4a; color: #fff; font: inherit; cursor: pointer; }
  @media (prefers-color-scheme: dark) { body { background: #0b130e; color: #b5e48c; } }
</style></head>
<body><h1>VerdeSnap ✧</h1><p>running · ${hotkey}</p>
<form method="post" action="/snap"><button>Snap</button></form></body></html>`;

/** Only this machine's own pages may talk to it: a random website can't start a snap. */
function trusted(host = "", origin?: string) {
  const own = [`localhost:${PORT}`, `127.0.0.1:${PORT}`];
  return own.includes(host) && (!origin || own.some((o) => origin === `http://${o}`));
}

export function startServer(onSnap: () => void, hotkey: () => string | null) {
  const server = createServer((req, res) => {
    if (!trusted(req.headers.host, req.headers.origin)) return void res.writeHead(403).end();
    if (req.method === "GET" && req.url === "/") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return void res.end(page(hotkey() ?? "no hotkey"));
    }
    if (req.method === "POST" && req.url === "/snap") {
      onSnap();
      return void res.writeHead(303, { Location: "/" }).end();
    }
    res.writeHead(404).end();
  });
  server.on("error", (err) => console.error(`port ${PORT}:`, err.message));
  server.listen(PORT, "127.0.0.1");
}
