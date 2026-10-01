// `.vue` SFC shim for plain `tsc --noEmit` — the example only needs the
// module to resolve; the worker bundle compiles the real component.
declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent<Record<string, never>, Record<string, never>, unknown>;
  export default component;
}
