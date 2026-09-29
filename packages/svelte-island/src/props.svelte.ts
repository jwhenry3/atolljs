/**
 * `createPropsBox` — a `$state`-backed props record for `svelteIslandApp`.
 *
 * Svelte 5's `mount(Component, { props })` does not watch the props object
 * after mount — `$.prop` getters read `$$props[key]` lazily, so handing the
 * component a `$state` proxy makes every prop read a tracked read. The
 * handle's `update(next)` then mutates the box and `flushSync()` produces
 * only the ops the changed reads touch — a fine-grained patch instead of
 * the dispose+clear+re-mount fallback.
 */
export interface PropsBox {
  /** The live props record — pass it to `mount` as `options.props`. */
  readonly props: Record<string, unknown>;
  /** Replace the prop set: writes changed/new keys, deletes removed ones. */
  update(next: Record<string, unknown>): void;
}

export function createPropsBox(initial: Record<string, unknown>): PropsBox {
  const props = $state<Record<string, unknown>>({ ...initial });
  return {
    props,
    update(next: Record<string, unknown>): void {
      for (const key of Object.keys(props)) {
        if (!(key in next)) delete props[key];
      }
      Object.assign(props, next);
    },
  };
}
