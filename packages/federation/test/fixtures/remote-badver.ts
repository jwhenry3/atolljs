/** A remote requiring a version range the host's shared dep can't satisfy. */
import type { ProxyDocument } from '@atolljs/islands/worker';

export const requires = { greeting: '^2' };

export default {
  imperative: (doc: ProxyDocument): void => {
    doc.body.append(doc.createElement('div'));
  },
};
