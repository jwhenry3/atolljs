// Compiled by vite-plugin-svelte — .svelte.js rune modules work in plain JS,
// which the svelte compiler parses (its TS support depends on the vite
// pipeline order that isn't guaranteed under vitest).
export function inRoot(fn) {
  let out;
  const destroy = $effect.root(() => {
    out = fn();
  });
  return { value: out, destroy };
}
