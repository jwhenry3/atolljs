/**
 * `reactive:node` emission for the dashboard's reactivity graph. The SDK's
 * reactivity is shallow, and the node kinds map onto it directly:
 *
 * - **source**: a shared-memory field, id `mem:<path>`, owner 'shared'.
 *   The same id on every thread, so a worker-side writer and a main-thread
 *   watcher meet at one node. Two contracts with the same field path
 *   share the node (ids carry no contract identity across threads).
 * - **bridge**: a version-counter watcher (`Atomics.waitAsync`, or the
 *   50ms poll fallback): the only thing that crosses threads.
 * - **derived**: a `watch`/`observe` selector slice.
 * - **effect**: a `watch` callback, or an `observe` observable's
 *   subscriber fan-out (label carries the subscriber count).
 *
 * Non-source ids are per-thread counters ('b3', 'e7'); the dashboard
 * qualifies them by the event's thread/worker stamp. Everything here is
 * a no-op returning null while devtools is off.
 */
import { devtoolsEnabled, emitDevtools, registerDevtoolsCommand } from './devtools';

export type ReactiveKind = 'source' | 'derived' | 'effect' | 'bridge';

interface NodeInfo {
  id: string;
  kind: ReactiveKind;
  label?: string;
  deps?: string[];
  owner?: string;
}

const OWNER =
  typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope ? 'worker' : 'main';

let seq = 0;
const live = new Map<string, NodeInfo>();
let commandRegistered = false;

const emit = (node: NodeInfo, disposed?: boolean): void => {
  emitDevtools({ type: 'reactive:node', ...node, ...(disposed ? { disposed: true } : {}) });
};

const ensureCommand = (): void => {
  if (commandRegistered) return;
  commandRegistered = true;
  // Snapshot for dashboards that joined after the creation events scrolled
  // out of the replay tail. This thread's nodes only (commands run on the
  // main thread; worker nodes arrive through the event stream).
  registerDevtoolsCommand('reactive.nodes', () => [...live.values()]);
};

/** The source node for a shared-memory field — emitted once per thread. */
export const graphSource = (path: string | undefined): string | null => {
  if (!devtoolsEnabled() || path === undefined) return null;
  ensureCommand();
  const id = `mem:${path}`;
  if (!live.has(id)) {
    const node: NodeInfo = { id, kind: 'source', label: path, owner: 'shared' };
    live.set(id, node);
    emit(node);
  }
  return id;
};

/** Create a node; returns its id, or null while devtools is off. */
export const graphNode = (kind: ReactiveKind, label: string, deps: (string | null)[]): string | null => {
  if (!devtoolsEnabled()) return null;
  ensureCommand();
  const id = `${kind[0]}${++seq}`;
  const node: NodeInfo = { id, kind, label, deps: deps.filter((d): d is string => d !== null), owner: OWNER };
  live.set(id, node);
  emit(node);
  return id;
};

/** Re-emit a node with a new label (same id — the dashboard replaces it). */
export const relabelNode = (id: string | null, label: string): void => {
  const node = id === null ? undefined : live.get(id);
  if (!node || node.label === label || !devtoolsEnabled()) return;
  node.label = label;
  emit(node);
};

/** Mark nodes disposed (null ids are skipped). */
export const disposeNodes = (...ids: (string | null)[]): void => {
  for (const id of ids) {
    const node = id === null ? undefined : live.get(id);
    if (!node) continue;
    live.delete(id!);
    if (devtoolsEnabled()) emit(node, true);
  }
};
