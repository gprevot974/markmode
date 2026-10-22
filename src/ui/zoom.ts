// Zoom: Cmd-= and Cmd-- make the text bigger or smaller, Cmd-0 resets it.
// The column widens with the text, so a zoomed-in page fills more of the
// window. The statusline and prompt keep their size. The level is kept for the
// next start; index.html applies it before the first paint.

const KEY = "markmode.zoom";
const STEPS = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3];
const MIN = STEPS[0];
const MAX = STEPS[STEPS.length - 1];

let level = 1;

export function initZoom() {
  try {
    const stored = Number(localStorage.getItem(KEY));
    if (stored >= MIN && stored <= MAX) level = stored;
  } catch {
    // Starts at 100%, then.
  }
  apply();
}

export const zoomLevel = () => level;

/** Sets the zoom (1 is 100%), within 50% to 300%. */
export function setZoom(z: number) {
  level = Math.min(MAX, Math.max(MIN, Math.round(z * 100) / 100));
  apply();
  try {
    if (level === 1) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, String(level));
  } catch {
    // Not kept for the next start.
  }
}

/** One step bigger or smaller, as browsers step: 90%, 100%, 110%, 125%... */
export function zoomStep(dir: 1 | -1) {
  const next = dir > 0 ? STEPS.find((s) => s > level + 0.001) : [...STEPS].reverse().find((s) => s < level - 0.001);
  setZoom(next ?? level);
}

function apply() {
  document.documentElement.style.setProperty("--zoom", String(level));
}
