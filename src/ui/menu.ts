// A small menu at the cursor (spelling suggestions): j/k or arrows to move,
// Enter or an item's key to choose, Esc to close.

export interface MenuItem {
  /** Chooses the item directly. */
  key: string;
  label: string;
  action(): void | Promise<void>;
}

export function openMenu(items: MenuItem[], at: { left: number; top: number }, refocus: () => void) {
  const menu = document.createElement("div");
  menu.id = "menu";
  menu.tabIndex = -1;
  let selected = 0;

  const render = () => {
    menu.replaceChildren(
      ...items.map((item, i) => {
        const row = document.createElement("div");
        row.className = i === selected ? "menu-item selected" : "menu-item";
        const key = document.createElement("span");
        key.className = "menu-key";
        key.textContent = item.key;
        row.append(key, item.label);
        row.onmousedown = (e) => {
          e.preventDefault();
          choose(i);
        };
        return row;
      }),
    );
  };

  const close = () => {
    menu.onblur = null;
    menu.remove();
    refocus();
  };
  const choose = (i: number) => {
    close();
    void items[i].action();
  };

  menu.onblur = close;
  menu.onkeydown = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const key = (e.ctrlKey ? "C-" : "") + e.key;
    const direct = items.findIndex((item) => item.key === e.key);
    if (key === "Escape" || key === "C-c") close();
    else if (key === "Enter") choose(selected);
    else if (["j", "ArrowDown", "C-n", "Tab"].includes(key)) selected = (selected + 1) % items.length;
    else if (["k", "ArrowUp", "C-p"].includes(key)) selected = (selected - 1 + items.length) % items.length;
    else if (direct >= 0 && !e.ctrlKey) choose(direct);
    if (menu.isConnected) render();
  };

  render();
  document.body.appendChild(menu);
  // Below the word, kept inside the window.
  const { width, height } = menu.getBoundingClientRect();
  const top = at.top + height + 4 > innerHeight ? at.top - height - 28 : at.top + 4;
  menu.style.left = `${Math.max(4, Math.min(at.left, innerWidth - width - 4))}px`;
  menu.style.top = `${Math.max(4, top)}px`;
  menu.focus();
}
