// `.vue` SFC shim for plain `tsc --noEmit` — vue-tsc would give real prop
// inference, but the example only needs the module to resolve.
declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent<Record<string, never>, Record<string, never>, unknown>;
  export default component;
}
