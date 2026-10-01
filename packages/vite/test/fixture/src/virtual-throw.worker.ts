// `virtual:throws` makes pluginContainer.resolveId throw — the bridge must
// swallow it and let esbuild's own resolution produce the error.
import { X } from 'virtual:throws';

export const OUT = X;
