# VerdeSnap ✧

My screenshot tool for Windows: snip, mark up, read the text, translate it with my local AI.

- **Alt+A** (same as WeChat), or click the tray icon: drag an area, and the toolbar appears next to it
- **Enter** or double-click copies · **Ctrl+S** saves · **Esc** cancels · right-click picks again
- If another app holds Alt+A it uses **Ctrl+Alt+A** and keeps trying for Alt+A every 15 s
- http://localhost:6789 shows it's running and can start a snap (only from this computer)
- Starts with Windows; turn that off in the tray menu

## Translating

Everything except translating works straight after installing. To translate, point it at any OpenAI-compatible
API by creating `%APPDATA%\VerdeSnapi.env`:

```
SNAP_AI_URL=http://your-server/v1
SNAP_AI_MODEL=your-model
```

## Setup

Copy `.env.example` to `.env` and fill in `SNAP_AI_URL` and `SNAP_AI_MODEL`. This is only for running from source.

```
npm install
node node_modules/electron/install.js   # npm may block Electron's own download
npm start        # run from source
npm run dist     # build the installer into release/
npm run icon     # redraw assets/icon.png from assets/icon.svg
```

If `npm start` runs as plain Node from inside an editor's agent shell, clear `ELECTRON_RUN_AS_NODE`.
