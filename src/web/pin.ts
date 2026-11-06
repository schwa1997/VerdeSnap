import type { SnapApi } from "../preload";

// A pinned snap: always on top, drag it anywhere, hover for the × (or press Esc) to let it go.
const snap = (window as unknown as { snap: SnapApi }).snap;

snap.pinImage().then((png) => {
  if (!png) return;
  (document.getElementById("pic") as HTMLImageElement).src = URL.createObjectURL(new Blob([png as BlobPart], { type: "image/png" }));
});
document.getElementById("unpin")!.addEventListener("click", () => snap.pinClose());
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") snap.pinClose();
});
