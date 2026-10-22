// While files are dragged over the window from Finder: the window they would
// land in is outlined, a caret shows where an image's link would go, and a
// label says what dropping does.

let box: HTMLElement | null = null;
let label: HTMLElement;
let caret: HTMLElement;

export interface Caret {
  left: number;
  top: number;
  height: number;
}

export function showDropHint(area: DOMRect, text: string, at: Caret | null) {
  if (!box) {
    box = document.createElement("div");
    box.className = "drop-hint";
    label = box.appendChild(document.createElement("div"));
    label.className = "drop-hint-label";
    caret = document.createElement("div");
    caret.className = "drop-caret";
    document.body.append(box, caret);
  }
  Object.assign(box.style, { left: `${area.left}px`, top: `${area.top}px`, width: `${area.width}px`, height: `${area.height}px`, display: "" });
  label.textContent = text;
  if (at) Object.assign(caret.style, { left: `${at.left}px`, top: `${at.top}px`, height: `${at.height}px`, display: "" });
  else caret.style.display = "none";
}

export function hideDropHint() {
  if (!box) return;
  box.style.display = "none";
  caret.style.display = "none";
}
