// Bare specifier that vite's alias resolves to an SFC — the esbuild bridge
// must detect NEEDS_VITE on the *resolved* path and bail to vite's pipeline.
import 'widget-sfc';

export const OUT = 'sfc-alias';
