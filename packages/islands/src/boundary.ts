/**
 * Island error boundaries — a configurable safety net around every
 * breakable point in a mount's lifecycle:
 *
 *   mountIsland({
 *     worker, el, app,
 *     boundary: {
 *       loading: () => spinnerEl,                       // render fn per state
 *       error: ({ error, retry }) => errorEl,           // …incl. the retry hook
 *       retry: 3,                                       // auto-remount policy
 *       onError: (err, phase) => report(err, phase),    // telemetry hook
 *     },
 *   })
 *
 * Breakable points covered:
 * - MOUNT: worker entry fails to load, mountTimeout, contract prop
 *   rejection, federation `loadApp` failures (bad remote URL, unsatisfied
 *   `requires`) — the mount handshake rejects, the boundary renders the
 *   error state instead of propagating an unhandled rejection.
 * - RUNTIME: the worker crashes mid-life. The client's onWorkerEvent
 *   'error' transition detects it (in-flight tasks already rejected as
 *   WorkerCrashedError), the stale driver tears down, and the boundary
 *   enters the error state — `retry()`/auto-retry remounts into the
 *   respawned worker.
 *
 * Render functions are framework-free: they return `Node | string` (or an
 * array), applied to the island's container element. Loading replaces the
 * container's contents; the error state replaces them by default —
 * `domOnError: 'preserve'` appends the fallback over the stale last frame
 * instead (crash-overlay style).
 *
 * The returned handle is an IslandHandle plus `state`/`error`/`retry()` —
 * it resolves after the FIRST attempt settles (mounted or error state),
 * so callers never see an unhandled rejection, and a later retry() can
 * still produce a working island under the same handle.
 */
import { connectIslandWorker, mountIsland } from './island';
import type {
  ConnectIslandWorkerConfig,
  IslandClient,
  IslandHandle,
  Mode,
  MountIslandOptions,
} from './island';

/** What a boundary render fn may return — applied via el.replaceChildren/append. */
export type BoundaryContent = Node | string | Array<Node | string> | null | undefined;

/** Where the failure happened — 'mount' (handshake), 'runtime' (worker crash). */
export type IslandBoundaryPhase = 'mount' | 'runtime';

export interface IslandBoundaryContext {
  /** The mount's app key. */
  app: string;
  /** The island's container element — the boundary's render target. */
  el: HTMLElement;
  /** 1-based mount attempt counter — increments across retries. */
  attempt: number;
}

export interface IslandBoundaryErrorContext extends IslandBoundaryContext {
  /** The caught failure (mount rejection, crash error). */
  error: unknown;
  phase: IslandBoundaryPhase;
  /** Manual remount — wire it to a retry button in the error render. */
  retry(): void;
}

export interface IslandBoundary {
  /** Rendered while the first mount attempt is in flight. */
  loading?(ctx: IslandBoundaryContext): BoundaryContent;
  /** Rendered when the island fails — mount rejection or runtime crash. */
  error?(ctx: IslandBoundaryErrorContext): BoundaryContent;
  /** Fires on every boundary-entering failure — logging/telemetry. */
  onError?(error: unknown, phase: IslandBoundaryPhase): void;
  /**
   * Auto-remount policy: a number is the max retry count (delay grows
   * ~250ms per attempt, capped at 2s); a function maps (attempt, error)
   * to a delay in ms, `false`/`undefined` to stop. Omit for no auto-retry.
   */
  retry?: number | ((attempt: number, error: unknown) => number | false | undefined | void);
  /**
   * What the error state does to the container: 'clear' (default) replaces
   * its contents with the fallback; 'preserve' appends the fallback over
   * the stale last frame on runtime crashes (mount failures always clear —
   * there is no frame to preserve).
   */
  domOnError?: 'clear' | 'preserve';
}

export type IslandBoundaryState = 'loading' | 'mounted' | 'error';

/**
 * The boundary-aware handle: a normal IslandHandle when mounted, safe
 * no-ops while failed (updateProps stashes into the next attempt's props),
 * plus the boundary's own state.
 */
export interface IslandBoundaryHandle extends IslandHandle {
  readonly state: IslandBoundaryState;
  /** The error that put the boundary in 'error' state (undefined otherwise). */
  readonly error: unknown;
  /** Remount now — same as ctx.retry() handed to the error render fn. */
  retry(): void;
}

export async function mountIslandWithBoundary(
  opts: MountIslandOptions & { boundary: IslandBoundary },
): Promise<IslandBoundaryHandle> {
  const {
    boundary,
    el: target,
    client: givenClient,
    worker,
    app: givenApp,
    props: givenProps,
    mode: initialMode,
    ...mountOpts
  } = opts;
  // The boundary owns the client when the caller used the `worker`
  // shorthand — it needs the lifecycle subscription (and clientMounts
  // accounting keeps last-island-destroy → terminate semantics identical).
  const client: IslandClient =
    givenClient ??
    connectIslandWorker({
      name: givenApp,
      ...mountOpts,
      worker,
      doorbell: initialMode !== 'poll',
    } as ConnectIslandWorkerConfig);
  const app = givenApp ?? 'main';
  // mountIsland only routes here for REAL mount targets — proxy elements
  // take the nested path before the boundary check.
  const el = target as HTMLElement;

  let state: IslandBoundaryState = 'loading';
  let lastError: unknown;
  let current: IslandHandle | null = null;
  let attempt = 0;
  let destroyed = false;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  /** Latest props — updateProps while failed stashes here for the remount. */
  let pendingProps = givenProps;
  let pendingMode: Mode | undefined = initialMode;

  const setContent = (content: BoundaryContent, how: 'replace' | 'append'): void => {
    if (content === null || content === undefined) {
      if (how === 'replace') el.replaceChildren();
      return;
    }
    const parts = (Array.isArray(content) ? content : [content]).filter(
      (p): p is Node | string => p !== null && p !== undefined,
    );
    if (how === 'replace') el.replaceChildren(...parts);
    else el.append(...parts);
  };

  const scheduleRetry = (error: unknown): void => {
    const policy = boundary.retry;
    if (policy === undefined || retryTimer !== null) return;
    const delay =
      typeof policy === 'number'
        ? attempt <= policy
          ? Math.min(250 * attempt, 2000)
          : false
        : policy(attempt, error);
    if (delay === false || delay === undefined || typeof delay !== 'number') return;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      void tryMount();
    }, Math.max(0, delay));
  };

  const fail = (error: unknown, phase: IslandBoundaryPhase): void => {
    if (destroyed) return;
    state = 'error';
    lastError = error;
    boundary.onError?.(error, phase);
    const content = boundary.error?.({
      app,
      el,
      attempt,
      error,
      phase,
      retry: manualRetry,
    });
    // Runtime 'preserve' paints over the stale frame; everything else
    // replaces (mount failures never produced a frame worth keeping).
    if (boundary.domOnError === 'preserve' && phase === 'runtime') {
      setContent(content, 'append');
    } else {
      setContent(content, 'replace');
    }
    scheduleRetry(error);
  };

  const tryMount = async (): Promise<void> => {
    if (destroyed) return;
    attempt++;
    // The worker's mount batch assumes an empty container — stale frames,
    // loading content, and error fallbacks all clear before it replays.
    el.replaceChildren();
    try {
      const handle = await mountIsland({
        ...mountOpts,
        client,
        el,
        app: givenApp,
        props: pendingProps,
        mode: pendingMode,
      } as MountIslandOptions);
      if (destroyed) {
        handle.destroy();
        return;
      }
      current = handle;
      state = 'mounted';
    } catch (err) {
      fail(err, 'mount');
    }
  };

  const manualRetry = (): void => {
    if (destroyed) return;
    if (retryTimer !== null) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
    void tryMount();
  };

  // Worker-death detection: the client's lifecycle events fire on the
  // runner's 'error' transition — every instance on this client just died.
  // Shared clients notify each island's boundary individually.
  const offLifecycle = client.onWorkerEvent?.((event) => {
    if (destroyed || state === 'error' || event.type !== 'error') return;
    const stale = current;
    current = null;
    // Tear the dead driver down — stops doorbell/poll/RO timers and
    // releases instance state (its unmount task rejects, which destroy
    // already swallows; a last-island terminate races the runner's own
    // respawn harmlessly).
    stale?.destroy();
    fail(
      new Error(
        `[island ${app}] worker crashed` + (event.message !== undefined ? `: ${event.message}` : ''),
      ),
      'runtime',
    );
  });

  const handle: IslandBoundaryHandle = {
    get app() {
      return current?.app ?? app;
    },
    get pid() {
      return current?.pid ?? 'unmounted';
    },
    get instance() {
      return current?.instance ?? `${app}@?`;
    },
    get mode() {
      return current?.mode ?? pendingMode ?? 'push';
    },
    get opsApplied() {
      return current?.opsApplied ?? 0;
    },
    get flushCalls() {
      return current?.flushCalls ?? 0;
    },
    get state() {
      return state;
    },
    get error() {
      return lastError;
    },
    retry: manualRetry,
    setMode: (mode) => {
      pendingMode = mode;
      current?.setMode(mode);
    },
    updateProps: async (next) => {
      pendingProps = next;
      await current?.updateProps(next);
    },
    flush: async () => {
      await current?.flush();
    },
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      if (retryTimer !== null) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
      offLifecycle?.();
      current?.destroy();
      current = null;
    },
  };

  setContent(boundary.loading?.({ app, el, attempt: 1 }), 'replace');
  await tryMount();
  return handle;
}
