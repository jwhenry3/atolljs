/**
 * `@atolljs/svelte-island` — the Svelte shell surface for
 * `@atolljs/islands` islands: a worker-hosted React (or
 * imperative proxy-DOM) tree mounted into an ordinary element via a
 * Svelte action.
 *
 * ```svelte
 * <script>
 *   import { island, createIslandState } from '@atolljs/svelte-island';
 *   import { connectIslandWorker } from '@atolljs/islands';
 *
 *   const client = connectIslandWorker({
 *     worker: () => new Worker(new URL('./render.worker.ts', import.meta.url), { type: 'module' }),
 *   });
 *   const echo = createIslandState();
 * </script>
 *
 * <div use:island={{ client, app: 'echo', props: { text: 'hi' }, ...echo }} />
 * {#if echo.status === 'ready'}mounted as {echo.handle?.pid}{/if}
 * ```
 *
 * Semantics (mirroring `@atolljs/react-island`'s `<Island/>`):
 * - Mounting is async — the action attaches immediately, spawns the worker
 *   and replays the first op batch in the background; `onReady` fires with
 *   the `IslandHandle` once the mount handshake resolves.
 * - `update(next)` is Svelte's parameter-change hook: `props` changes call
 *   `handle.updateProps`, deduped by JSON-serialized identity (props cross
 *   the wire serialized anyway — equal bytes would be a wasted round-trip).
 *   Updates arriving before the mount resolves are coalesced and flushed
 *   once the handle lands.
 * - `onEvent`/`onActivity`/`slots`/`onReady`/`onError` are read through a
 *   latest-options ref — passing fresh closures never remounts the worker.
 * - `app`/`worker`/`client`/`workerOptions` are MOUNT-STABLE — the action
 *   does not remount when they change on `update`. Remount by wrapping the
 *   node in `{#key ...}` (the Svelte equivalent of React's `key`).
 * - `destroy()` destroys the island; the worker terminates unless the
 *   client is SHARED (several islands mounted into one client — the instance
 *   unmounts and the worker dies with the last island to leave).
 */
import {
  connectIslandWorker,
  contractWorkerOf,
  islandAppNameOf,
  mountIsland,
} from '@atolljs/islands';
import type {
  IslandAppLike,
  IslandClient,
  IslandContract,
  IslandContractEventHandler,
  IslandContractProps,
  IslandHandle,
  IslandWorkerOptions,
} from '@atolljs/islands';
import type { Action } from 'svelte/action';

// Re-export the contract types consumers need without a second import.
export type { IslandAppLike, IslandClient, IslandHandle };

export { createIslandState } from './state.svelte';
export type { IslandState, IslandStatus } from './state.svelte';

/**
 * The parameter of `use:island` — the `mountIsland` options (minus `el`,
 * which the action supplies) plus the worker-connection shorthand and the
 * lifecycle callbacks Svelte actions can't otherwise express.
 */
export interface IslandActionOptions {
  /**
   * Which app to mount — the `apps` registry key ('echo'), or the app
   * itself (an `islandApp(name, …)`-stamped component/`{ imperative }`
   * def — resolved via `islandAppNameOf`). Optional against a
   * `defineMonoWorker` (1:1) worker — its single app mounts regardless.
   */
  app?: IslandAppLike | string;
  /**
   * How to reach the worker — either a bundler-detectable factory
   * `() => new Worker(new URL('./x.worker.ts', import.meta.url), { type: 'module' })`
   * (or its URL) or a pre-connected `IslandClient`. Exactly one is required.
   */
  worker?: (() => Worker) | URL;
  client?: IslandClient;
  /** Extra pool options — concurrency, taskTimeout, respawn… (poolSize stays 1). */
  workerOptions?: IslandWorkerOptions & { doorbell?: boolean };
  /** Initial + updated root props — serialized to the worker. */
  props?: Record<string, unknown>;
  /** Island → shell channel: every `emit` op lands here. */
  onEvent?: (name: string, payload: unknown) => void;
  /** Fired after each applied op batch — stats hooks. */
  onActivity?: () => void;
  /**
   * Transclusion slots — a worker `<div data-atoll-slot="name">` hands its
   * real element to `slots[name](el)` for shell-owned content (called again
   * with `null` on teardown). Read through `latest`, so `update` can swap
   * the map without remounting.
   */
  slots?: Record<string, (el: HTMLElement | null) => void>;
  /** Fired synchronously when the action attaches (before the mount resolves). */
  onMount?: () => void;
  /** The mounted handle (pid, updateProps, flush, setMode…) once ready. */
  onReady?: (island: IslandHandle) => void;
  /** Mount/update errors surface here instead of an unhandled rejection. */
  onError?: (err: unknown) => void;
  /** Fired when Svelte destroys the action — before the island tears down. */
  onDestroy?: () => void;
}

/**
 * `IslandActionOptions` narrowed to a `defineIslandContract` — `props` and
 * `onEvent` type off the contract's schemas, `app` accepts the contract
 * itself (resolves to `contract.app`). The cross-framework surface for
 * generated `XIsland.svelte` wrappers and hand-rolled actions:
 *
 * ```svelte
 * <div use:island={{ app: checkoutContract, props: { label: 'alpha' },
 *                    onEvent: (n, p) => ... }} />
 * ```
 */
export type IslandContractOptions<C extends IslandContract> = Omit<
  IslandActionOptions,
  'app' | 'props' | 'onEvent'
> & {
  app?: C;
  props?: IslandContractProps<C>;
  onEvent?: IslandContractEventHandler<C>;
};

/**
 * The Svelte action for worker islands: `<div use:island={{ client, app, props }} />`.
 *
 * On attach it calls `mountIsland({ …options, el: node })`; on `update` it
 * calls `handle.updateProps(opts.props ?? {})`; on `destroy` it calls
 * `handle.destroy()`. `client`/`worker`/`app` are fixed at mount — use a
 * `{#key}` block to swap them.
 */
export const island: Action<HTMLElement, IslandActionOptions> = (node, options) => {
  // Latest-parameter ref — mount callbacks and op handlers read through it,
  // so update() can swap closures/props without remounting the worker.
  let latest = options;
  let handle: IslandHandle | null = null;
  let destroyed = false;
  // Wire-serialized props identity — equal bytes produce the same render,
  // so repeat updates with equal props cost no round-trip.
  let lastProps = JSON.stringify(options.props ?? {});
  // Props written by update() while the mount is still in flight —
  // coalesced (last write wins) and flushed once the handle lands.
  let pendingProps: Record<string, unknown> | null = null;

  const report = (err: unknown): void => {
    if (latest.onError !== undefined) latest.onError(err);
    else console.error('[use:island] error:', err);
  };

  // Empty action when the configuration is unusable — update/destroy still
  // track `latest` so a late fix-up via update() at least reports sanely.
  const noopAction = {
    update(next: IslandActionOptions) {
      latest = next;
    },
    destroy() {
      destroyed = true;
      latest.onDestroy?.();
    },
  };

  // A contract `app` can carry its own worker factory — the contract
  // module is then the whole connection, call sites pass no worker.
  const worker = options.worker ?? contractWorkerOf(options.app);
  const client =
    options.client ??
    (worker !== undefined
      ? connectIslandWorker({ worker, ...options.workerOptions })
      : undefined);
  if (client === undefined) {
    report(new Error('use:island requires either `worker` or `client`'));
    return noopAction;
  }

  const appName =
    options.app === undefined
      ? undefined // mountIsland defaults to 'main' — instance workers resolve their single app
      : typeof options.app === 'string'
        ? options.app
        : islandAppNameOf(options.app);
  if (options.app !== undefined && appName === undefined) {
    report(
      new Error(
        'use:island could not resolve an app name — pass the registry key or stamp the app with islandApp(name, app)',
      ),
    );
    return noopAction;
  }

  latest.onMount?.();

  // The driver reads slots[name] lazily per op — a proxy forwards to the
  // latest map so update() can swap slot callbacks without remounting.
  const slotProxy = new Proxy({} as Record<string, (el: HTMLElement | null) => void>, {
    get: (_t, name: string) => (el: HTMLElement | null) => latest.slots?.[name]?.(el),
  });

  void (async () => {
    try {
      const mounted = await mountIsland({
        client,
        el: node,
        ...(appName !== undefined ? { app: appName } : {}),
        props: latest.props ?? {},
        onEvent: (name, payload) => latest.onEvent?.(name, payload),
        onActivity: () => latest.onActivity?.(),
        slots: slotProxy,
      });
      if (destroyed) {
        mounted.destroy();
        return;
      }
      handle = mounted;
      latest.onReady?.(mounted);
      // Props that changed while the mount was in flight — the mount used
      // the attach-time snapshot, so catch the instance up now.
      if (pendingProps !== null) {
        const props = pendingProps;
        pendingProps = null;
        mounted.updateProps(props).catch(report);
      }
    } catch (err) {
      if (!destroyed) report(err);
    }
  })();

  return {
    update(next: IslandActionOptions) {
      latest = next;
      const json = JSON.stringify(next.props ?? {});
      if (json === lastProps) return;
      lastProps = json;
      if (handle === null) {
        pendingProps = next.props ?? {};
        return;
      }
      handle.updateProps(next.props ?? {}).catch(report);
    },
    destroy() {
      destroyed = true;
      latest.onDestroy?.();
      handle?.destroy();
      handle = null;
    },
  };
};

export default island;
