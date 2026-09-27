// Compiled by vite-plugin-svelte — plain JS so the svelte module compiler
// parses it regardless of vitest's TS transform ordering.
export function inRoot(fn) {
  let out;
  const destroy = $effect.root(() => {
    out = fn();
  });
  return { value: out, destroy };
}
