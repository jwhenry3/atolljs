// Exercises the vite-load fallback namespace: `virtual:atoll-fixture` is a
// plugin-owned id (no fs path) resolved through the plugin container, and its
// code reaches back through `/@id/` (nul-encoded virtual id) and `/@fs/`
// dev-URL specifiers — the shapes framework plugins emit in dev.
import { MSG } from 'virtual:atoll-fixture';

export const OUT = MSG;
