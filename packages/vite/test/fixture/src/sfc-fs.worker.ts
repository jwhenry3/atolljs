// A plugin-owned virtual module whose code imports an /@fs/ URL pointing at
// an SFC — the fallback must fire from the dev-URL branch too.
import 'virtual:sfc-link';

export const OUT = 'sfc-fs';
