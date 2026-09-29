/**
 * `createIslandState` — a `$state`-backed lifecycle observer for the
 * `use:island` action. It exposes `{ status, error, handle }` plus the
 * action's lifecycle callbacks, so consumers who want to observe a mount
 * without writing their own `onReady`/`onError` handlers can spread it
 * straight into the action's parameter:
 *
 * ```svelte
 * <script>
 *   const charts = createIslandState();
 * </script>
 *
 * <div use:island={{ client, app: 'charts', props: { width: 520 }, ...charts }} />
 * {#if charts.status === 'ready'}pid {charts.handle?.pid}{/if}
 * {#if charts.status === 'error'}{charts.error}{/if}
 * ```
 *
 * Spreading copies the getter VALUES (status/error/handle land as inert
 * data the action ignores) and the four callback functions — the live reads
 * stay on the state object itself (`charts.status`), which is what the
 * template binds. To compose your own callbacks, write them after the
 * spread (`{ ...charts, onReady: mine }`) and call `charts` fields
 * manually — or skip the spread and wire the four callbacks yourself.
 *
 * Rune note: this is a `.svelte.ts` module — `$state` here is compiled by
 * vite-plugin-svelte (or svelte-package), the same mechanism the sibling
 * `@atolljs/svelte` package uses.
 */
import type { IslandHandle } from '@atolljs/islands';
import type { IslandActionOptions } from './index';

/** The island lifecycle, coarse-grained: idle → mounting → ready | error → destroyed. */
export type IslandStatus = 'idle' | 'mounting' | 'ready' | 'error' | 'destroyed';

export interface IslandState
  extends Pick<IslandActionOptions, 'onMount' | 'onReady' | 'onError' | 'onDestroy'> {
  /** Lifecycle phase — `ready` once `onReady` fired with the handle. */
  readonly status: IslandStatus;
  /** The last mount/update error reported through `onError`, if any. */
  readonly error: unknown;
  /** The mounted `IslandHandle` once ready, `null` before/after teardown. */
  readonly handle: IslandHandle | null;
}

/**
 * Reactive lifecycle state for one `use:island` mount. Only `$state` is
 * used — no `$effect` — so the helper is safe to create at component init
 * or inside a test without an effect root.
 */
export function createIslandState(): IslandState {
  let status = $state<IslandStatus>('idle');
  let error = $state<unknown>(undefined);
  let handle = $state<IslandHandle | null>(null);

  return {
    get status() {
      return status;
    },
    get error() {
      return error;
    },
    get handle() {
      return handle;
    },
    onMount: () => {
      status = 'mounting';
    },
    onReady: (h: IslandHandle) => {
      handle = h;
      error = undefined;
      status = 'ready';
    },
    onError: (err: unknown) => {
      error = err;
      status = 'error';
    },
    onDestroy: () => {
      handle = null;
      status = 'destroyed';
    },
  };
}
