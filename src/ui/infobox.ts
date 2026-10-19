// The which-key popup in the bottom-right corner, as in Helix.

import type { Info } from "../helix/commands.ts";

export function renderInfobox(info: Info | null) {
  const box = document.getElementById("infobox")!;
  if (!info) {
    box.hidden = true;
    return;
  }
  const title = document.createElement("div");
  title.className = "info-title";
  title.textContent = info.title;
  const grid = document.createElement("div");
  grid.className = "info-rows";
  for (const [keys, desc] of info.rows) {
    const k = document.createElement("span");
    k.className = "info-keys";
    k.textContent = keys;
    const d = document.createElement("span");
    d.textContent = desc;
    grid.append(k, d);
  }
  box.replaceChildren(title, grid);
  box.hidden = false;
}
