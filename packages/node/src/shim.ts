// Import this FIRST in a Node worker entry, before workerBootstrap.
// node:worker_threads has no `self` global — the SDK's worker bootstrap
// expects a DOM-style `self` carrying onmessage/postMessage, so we bind the
// worker's parent MessagePort as `self` before the bootstrap module
// evaluates. ESM/CJS import order guarantees this runs first.
import { isMainThread, parentPort } from 'node:worker_threads';

// Guarded so an accidental main-thread import is a no-op (parentPort is null).
if (!isMainThread && parentPort) {
  (globalThis as { self?: unknown }).self = parentPort;
}
