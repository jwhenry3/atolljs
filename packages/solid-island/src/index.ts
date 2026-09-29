/**
 * `@jwhenry123/mesh-solid-island` — the Solid shell surface for
 * `@jwhenry123/mesh-islands` islands: a worker-hosted React (or
 * imperative proxy-DOM) tree mounted as an ordinary element in a
 * main-thread Solid app.
 *
 * ```tsx
 * import { createIsland } from '@jwhenry123/mesh-solid-island';
 * import { ChartsApp } from './worker/apps'; // the islandApp-stamped component
 *
 * const renderWorker = () =>
 *   new Worker(new URL('./render.worker.ts', import.meta.url), { type: 'module' });
 *
 * function Shell() {
 *   const island = createIsland({
 *     worker: renderWorker,
 *     app: ChartsApp,                     // or the registry name string 'charts'
 *     props: () => ({ width: 520 }),      // accessor — updates reach the worker
 *     onEvent: (name, payload) => console.log(name, payload),
 *   });
 *   return <div ref={island.ref} />;
 * }
 * ```
 *
 * Semantics (mirrors @jwhenry123/mesh-react-island):
 * - Mounting is async — `ref` mounts the island as soon as Solid assigns the
 *   container element; `status[0]()` moves 'mounting' → 'ready' | 'error'.
 * - `props` changes call `island.updateProps` — deduped by JSON-serialized
 *   identity, so re-tracking an equal props object costs no round-trip (props
 *   cross the wire serialized anyway, making that the honest equality).
 *   `props` may be a plain value, an accessor `() => props`, or a reactive
 *   getter on the options object — the watch effect tracks whatever it reads.
 * - `onEvent`/`onActivity`/`onReady`/`onError` are read through `options` at
 *   call time — passing fresh closures never remounts the worker. `slots`
 *   hand back the real elements the worker marked `data-mesh-slot="name"`;
 *   render Solid content into them with `render(() => ..., el)` from
 *   'solid-js/web' (not pulled in here so the shell surface stays renderer-only).
 * - `app`/`worker`/`client` are MOUNT-STABLE — swap them via a keyed remount
 *   (`<Show keyed>`/control-flow remount), not by passing a new value mid-life.
 * - Owner cleanup destroys the island; the worker terminates unless the client
 *   is SHARED (several islands on one client mount mounts into one worker —
 *   the instance unmounts and the worker dies with the last island to leave).
 */
import {
  createEffect,
  createSignal,
  onCleanup,
  untrack,
  type Accessor,
  type Signal,
} from 'solid-js';
import {
  connectIslandWorker,
  islandAppNameOf,
  mountIsland,
} from '@jwhenry123/mesh-islands';
import type {
  IslandAppLike,
  IslandAppProps,
  IslandClient,
  IslandHandle,
  IslandWorkerOptions,
} from '@jwhenry123/mesh-islands';

// Re-export the app-contract types the API is generic over, so consumers can
// name them without a second package import.
export type { IslandAppLike, IslandAppProps, IslandClient, IslandHandle };

/** What `app` accepts: the registry name, or a component/def to resolve. */
export type IslandAppRef<A> = A | string;

/** A reactive-read-friendly option: the value itself or an accessor for it. */
export type MaybeAccessor<T> = T | Accessor<T>;

export type IslandStatus = 'mounting' | 'ready' | 'error';

export interface CreateIslandOptions<A = string> {
  /**
   * Which app to mount — the `apps` registry key ('charts') or the app
   * itself (a component, an `islandApp(...)`-stamped def, `{ imperative }`).
   * A reference infers `props` from its own signature. Optional against a
   * `defineMonoWorker` (1:1) worker — its single app mounts regardless.
   */
  app?: IslandAppRef<A>;
  /**
   * How to reach the worker — either a bundler-detectable factory
   * `() => new Worker(new URL('./x.worker.ts', import.meta.url), { type: 'module' })`
   * (the common case) or a pre-connected `IslandClient`. Exactly one is required.
   */
  worker?: (() => Worker) | URL;
  client?: IslandClient;
  /** Extra pool options — concurrency, taskTimeout, respawn… (poolSize stays 1). */
  workerOptions?: IslandWorkerOptions;
  /**
   * Initial + updated root props — serialized to the worker. Pass an
   * accessor (`props: () => ({ … })`) or define `props` as a reactive getter
   * on the options object to push updates reactively; a plain object mounts
   * statically (later pushes still possible via the returned `updateProps`).
   */
  props?: MaybeAccessor<IslandAppProps<A>>;
  /** Island → shell channel: every `emit` op lands here. */
  onEvent?: (name: string, payload: unknown) => void;
  /** Fired after each applied op batch — stats hooks. */
  onActivity?: () => void;
  /**
   * Transclusion slots — a worker `<div data-mesh-slot="name">` hands its
   * real element to `slots[name]` (and `null` on teardown). The element
   * stays worker-owned; mount main-thread content inside it with
   * `render(() => <Widget/>, el)` from 'solid-js/web'.
   */
  slots?: Record<string, (el: HTMLElement | null) => void>;
  /** The mounted handle (pid, updateProps, flush, setMode…) once ready. */
  onReady?: (island: IslandHandle) => void;
  /** Mount/update errors surface here instead of an unhandled rejection. */
  onError?: (err: unknown) => void;
}

export interface CreateIslandResult {
  /**
   * Solid callback ref — `<div ref={island.ref} />`. Assigning the element
   * mounts the island; rebinding to a DIFFERENT element remounts into it.
   * (Solid never calls refs with `null` — teardown hangs off the owner's
   * `onCleanup`, not the ref.)
   */
  ref: (el: HTMLElement) => void;
  /** The mounted IslandHandle — `undefined` until the mount resolves. */
  handle: Accessor<IslandHandle | undefined>;
  /** `[get, set]` — 'mounting' → 'ready' | 'error'. */
  status: Signal<IslandStatus>;
  /** The last mount/update error, if any (`onError` fires too). */
  error: Accessor<unknown>;
  /**
   * Imperative props push — same wire path as a reactive `options.props`
   * change. Called before the island is ready, the props fold into the
   * mount instead of dropping.
   */
  updateProps: (props: Record<string, unknown>) => Promise<void>;
}

/**
 * The composable — wire `ref` to a container element and Solid's owner
 * tree owns the island's lifecycle:
 *
 * ```tsx
 * const island = createIsland({ worker, app: 'charts', props: () => ({ width: w() }) });
 * return <div ref={island.ref} />;
 * ```
 *
 * Must be called inside a reactive owner (a component body or `createRoot`) —
 * the props-watch effect and destroy-on-dispose semantics hang off it.
 */
export function createIsland<A = string>(
  options: CreateIslandOptions<A>,
): CreateIslandResult {
  const status: Signal<IslandStatus> = createSignal<IslandStatus>('mounting');
  const setStatus = status[1];
  const [error, setError] = createSignal<unknown>();
  const [handle, setHandle] = createSignal<IslandHandle>();

  let island: IslandHandle | undefined;
  let element: HTMLElement | undefined;
  /** Owner disposed — a mount resolving after this point self-destructs. */
  let disposed = false;
  /** Serialized props handed to mountIsland — the catch-up baseline. */
  let mountedJson: string | undefined;
  /** Newest serialized props the reactive layer asked for (dedupe cursor). */
  let sentJson: string | undefined;
  /** updateProps() before the island was ready — folded in around mount. */
  let pendingProps: Record<string, unknown> | undefined;

  const report = (err: unknown): void => {
    setError(() => err);
    if (options.onError !== undefined) options.onError(err);
    else console.error('[createIsland]', err);
  };
  const fail = (err: unknown): void => {
    setStatus('error');
    report(err);
  };

  // `options.props` may be a plain value, an accessor, or a reactive getter
  // on the options object (JSX component props compile to getters) — reading
  // it inside the watch effect below tracks whichever form the caller used.
  // A function-typed props VALUE can't be told apart from an accessor, but
  // props cross the wire serialized either way (functions never survive the
  // boundary), so functions-as-accessors is the honest reading.
  const resolveProps = (): Record<string, unknown> => {
    const p = options.props;
    const v = typeof p === 'function' ? (p as Accessor<unknown>)() : p;
    return (v ?? {}) as Record<string, unknown>;
  };

  // props → updateProps, deduped by wire-serialized identity (the same bytes
  // produce the same render — a repeat send is a wasted round-trip).
  createEffect(() => {
    const props = resolveProps(); // tracked read — see resolveProps above
    const json = JSON.stringify(props);
    untrack(() => {
      if (json === sentJson) return;
      sentJson = json;
      // `island` is undefined while the mount is in flight — the post-mount
      // catch-up re-reads props against `mountedJson`, so nothing is lost.
      island?.updateProps(props).catch(report);
    });
  });

  async function mount(el: HTMLElement): Promise<void> {
    // `app`/`worker`/`client` are read once, untracked — mount-stable like
    // the React binding; swap them by remounting (keyed control flow).
    const appName = options.app === undefined ? 'main' : islandAppNameOf(options.app);
    if (appName === undefined) {
      fail(
        new Error(
          'createIsland could not resolve an app name — pass the registry key or stamp the app with islandApp(name, app)',
        ),
      );
      return;
    }
    const client =
      options.client ??
      (options.worker !== undefined
        ? connectIslandWorker({ worker: options.worker, ...options.workerOptions })
        : undefined);
    if (client === undefined) {
      fail(new Error('createIsland requires either `worker` or `client`'));
      return;
    }

    setStatus('mounting');
    const initialProps = pendingProps ?? resolveProps();
    pendingProps = undefined;
    mountedJson = JSON.stringify(initialProps);
    sentJson = mountedJson;

    let h: IslandHandle;
    try {
      h = await mountIsland({
        client,
        el,
        app: appName,
        props: initialProps,
        // Read through `options` at call time — fresh closures each render
        // never force a remount.
        onEvent: (name, payload) => options.onEvent?.(name, payload),
        onActivity: () => options.onActivity?.(),
        slots: options.slots,
      });
    } catch (err) {
      if (!disposed) fail(err);
      return;
    }
    if (disposed) {
      h.destroy();
      return;
    }
    island = h;
    setHandle(() => h);

    // Catch-up — props moved (or updateProps ran) while the mount was in
    // flight. Compared against what mountIsland actually received, not the
    // dedupe cursor: a dropped in-flight send still lands here.
    const latest = pendingProps ?? resolveProps();
    pendingProps = undefined;
    if (JSON.stringify(latest) !== mountedJson) {
      sentJson = JSON.stringify(latest);
      try {
        await h.updateProps(latest);
      } catch (err) {
        report(err);
      }
    }
    // The owner may have been disposed mid-await — its cleanup already ran
    // destroy(), so leave the handle alone (IslandHandle.destroy is NOT
    // idempotent — a second call would corrupt the shared-client refcount).
    if (disposed) return;
    setStatus('ready');
    options.onReady?.(h);
  }

  const ref = (el: HTMLElement): void => {
    if (el === element) return;
    // Rebinding to a different element remounts — release the old instance (and
    // its worker, when the client isn't shared) before the fresh mount.
    if (island !== undefined) {
      island.destroy();
      island = undefined;
      setHandle(() => undefined);
    }
    element = el;
    void mount(el);
  };

  onCleanup(() => {
    disposed = true;
    island?.destroy();
    island = undefined;
    element = undefined;
    setHandle(() => undefined);
  });

  const updateProps = (props: Record<string, unknown>): Promise<void> => {
    sentJson = JSON.stringify(props);
    if (island === undefined) {
      // Pre-mount (ref not bound or mount in flight) — folded into the
      // initial props or the post-mount catch-up, never dropped.
      pendingProps = props;
      return Promise.resolve();
    }
    return island.updateProps(props).catch((err: unknown) => report(err));
  };

  return { ref, handle, status, error, updateProps };
}

export interface IslandProps<A = string> extends CreateIslandOptions<A> {
  /**
   * Document the container div is created in — defaults to the ambient
   * `document`. Only needed in exotic embeddings (in-process worker tests
   * where a proxy document claims the global while a instance is active).
   */
  document?: Document;
}

/**
 * The no-JSX component form — `Island(options)` returns a real `<div>` the
 * island mounts into, usable as a Solid component (`<Island …/>`, where
 * `props`/callbacks stay reactive through Solid's props getters) or called
 * directly for the element. No container attributes/children — for those,
 * prefer `<div ref={island.ref} class="…" />` with `createIsland` directly.
 */
export function Island<A = string>(options: IslandProps<A>): HTMLElement {
  const island = createIsland(options);
  const el = (options.document ?? document).createElement('div');
  island.ref(el);
  return el;
}

export default Island;
