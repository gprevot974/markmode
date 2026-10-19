// What src/main.ts exposes on the window, as code passed to page.evaluate() sees it.
declare global {
  const app: any;
  const commands: any;
  const backend: any;
}

export {};
