import { VALUE } from './dep';

// A worker that spawns its own worker — the nested literal must be
// rewritten onto ?worker_file so the dev middleware bundles it too.
const sub = new Worker(new URL('./sub.worker.ts', import.meta.url), { type: 'module' });
sub.onmessage = (e) => self.postMessage(['from-sub', e.data, VALUE]);
