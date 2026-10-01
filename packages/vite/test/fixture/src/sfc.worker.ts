// Worker entry whose graph contains an SFC — esbuild can't bundle it, so
// the plugin must hand the request back to vite's per-module pipeline.
import Widget from './Widget.vue';

export const WIDGET = Widget;
