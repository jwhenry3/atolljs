// `virtual:boom` resolves but its load hook returns null — the bundle fails
// with a real error (not the SFC-fallback marker), so the middleware 500s.
import { X } from 'virtual:boom';

export const OUT = X;
