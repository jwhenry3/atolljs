/** A remote requiring a dep the host never provides — mount must reject. */
import type { ProxyDocument } from '@atolljs/islands/worker';

export const requires = { missing: '^2' };

export default {
  imperative: (doc: ProxyDocument): void => {
    doc.body.append(doc.createElement('div'));
  },
};
