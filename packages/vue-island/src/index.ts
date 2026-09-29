/**
 * `@jwhenry123/mesh-vue-island` — the Vue shell surface for
 * `@jwhenry123/mesh-worker-dom` islands: a worker-hosted React (or
 * imperative proxy-DOM) tree mounted as an ordinary element in a
 * main-thread Vue app. Plain `.ts` — no SFC compiler needed.
 *
 * ```ts
 * import { MeshIsland, useIsland } from '@jwhenry123/mesh-vue-island';
 * import { connectIslandWorker } from '@jwhenry123/mesh-worker-dom';
 *
 * const client = connectIslandWorker({
 *   worker: () => new Worker(new URL('./render.worker.ts', import.meta.url), { type: 'module' }),
 * });
 *
 * // component form:
 * h(MeshIsland, { client, app: 'charts', props: { width: 520 }, onEvent: (n, p) => ... })
 *
 * // composable form (inside setup):
 * const { host, handle, status, error } = useIsland({ client, app: 'charts', props });
 * // template: <div ref="host" />  — or render fn: h('div', { ref: host })
 * ```
 *
 * Semantics (mirroring the React binding):
 * - Mounting is async — the container div renders immediately, the worker
 *   spawns and replays its first op batch once `host` is populated.
 * - `props` is reactive (accepts a plain object, a `ref`, a getter, or a
 *   `reactive()` object): changes call `handle.updateProps()`, deduped by
 *   JSON-serialized identity — the same bytes produce the same render, so a
 *   re-run with equal props costs no worker round-trip.
 * - `onEvent`/`onActivity`/`onReady`/`onError` are read through the options
 *   object at call time — pass wrappers that read reactive props (as
 *   `MeshIsland` does) and fresh closures never remount the worker.
 * - `client`/`worker`/`app`/`slots` are MOUNT-STABLE — read once when the
 *   host element lands. Swap them via `key`/`v-if`, not mid-life.
 * - If `host` returns to null (v-if, unmount) the island is destroyed; a
 *   later non-null host remounts it. Scope disposal (component unmount or
 *   `effectScope.stop()`) destroys the island too — the worker terminates
 *   unless the client is shared (the realm unmounts and the worker dies
 *   with the last island to leave).
 */
import {
  defineComponent,
  getCurrentScope,
  h,
  onScopeDispose,
  ref,
  shallowRef,
  toValue,
  watch,
} from 'vue';
import type { MaybeRefOrGetter, PropType, Ref, ShallowRef } from 'vue';
import {
  connectIslandWorker,
  islandAppNameOf,
  mountIsland,
} from '@jwhenry123/mesh-worker-dom';
import type {
  IslandAppLike,
  IslandClient,
  IslandHandle,
  IslandWorkerOptions,
} from '@jwhenry123/mesh-worker-dom';

// Re-export the handle type consumers need to name.
export type { IslandHandle };

/** Lifecycle state of a `useIsland` mount. */
export type IslandStatus = 'mounting' | 'ready' | 'error';

export interface UseIslandOptions {
  /**
   * How to reach the worker — a pre-connected `IslandClient` (shared
   * clients mount several realms into one worker) or a bundler-detectable
   * factory `() => new Worker(new URL('./x.worker.ts', import.meta.url),
   * { type: 'module' })`. Exactly one is required. Mount-stable.
   */
  client?: IslandClient;
  worker?: (() => Worker) | URL;
  /** Extra pool options for the `worker` path (concurrency, taskTimeout…). */
  workerOptions?: IslandWorkerOptions;
  /**
   * Which app to mount — the `apps` registry key ('charts') or an
   * `islandApp`-stamped reference. Optional against a `defineRealmWorker`
   * (1:1) worker — its single app mounts regardless. Mount-stable.
   */
  app?: string | IslandAppLike;
  /**
   * Root props, serialized to the worker. Reactive — a `ref`, a getter, or
   * a `reactive()` object — so mutations route through `updateProps`.
   */
  props?: MaybeRefOrGetter<Record<string, unknown> | undefined>;
  /** Island → shell channel: every `emit` op lands here. */
  onEvent?: (name: string, payload: unknown) => void;
  /** Fired after each applied op batch — stats hooks. */
  onActivity?: () => void;
  /**
   * Transclusion slots — a worker `<div data-mesh-slot="name">` hands its
   * real element to `slots[name](el)` (and `null` on removal) so the shell
   * can mount main-thread content inside the worker-owned anchor.
   */
  slots?: Record<string, (el: HTMLElement | null) => void>;
  /** The mounted handle (pid, updateProps, flush, setMode…) once ready. */
  onReady?: (island: IslandHandle) => void;
  /** Mount/update errors surface here instead of an unhandled rejection. */
  onError?: (err: unknown) => void;
}

export interface UseIslandReturn {
  /** Bind to the container element: `<div ref="host">` or `h('div', { ref: host })`. */
  host: Ref<HTMLElement | null>;
  /** The mounted island handle — null until `status === 'ready'`. */
  handle: ShallowRef<IslandHandle | null>;
  /** 'mounting' until the first op batch lands, then 'ready' (or 'error'). */
  status: Ref<IslandStatus>;
  /** The mount/update failure when `status === 'error'`. */
  error: ShallowRef<unknown>;
}

/** Wire-serialized props identity — the dedupe key for updateProps. */
const propsJson = (options: UseIslandOptions): string =>
  JSON.stringify(toValue(options.props) ?? {});

export function useIsland(options: UseIslandOptions): UseIslandReturn {
  const host = ref<HTMLElement | null>(null);
  const handle = shallowRef<IslandHandle | null>(null);
  const status = ref<IslandStatus>('mounting');
  const error = shallowRef<unknown>(undefined);

  let island: IslandHandle | null = null;
  /**
   * Generation counter — bumped on every host change and on scope disposal.
   * An async mount that resolves under a stale generation destroys its
   * handle immediately instead of attaching a zombie island.
   */
  let generation = 0;

  const report = (err: unknown): void => {
    error.value = err;
    status.value = 'error';
    if (options.onError !== undefined) options.onError(err);
    else console.error('[mesh-vue-island] mount failed:', err);
  };

  const mount = async (el: HTMLElement, gen: number): Promise<void> => {
    const app =
      options.app === undefined
        ? 'main'
        : typeof options.app === 'string'
          ? options.app
          : islandAppNameOf(options.app);
    if (app === undefined) {
      report(
        new Error(
          'useIsland could not resolve an app name — pass the registry key or stamp the app with islandApp(name, app)',
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
      report(new Error('useIsland requires either `client` or `worker`'));
      return;
    }

    const mountedJson = propsJson(options);
    try {
      const mounted = await mountIsland({
        client,
        el,
        app,
        props: JSON.parse(mountedJson) as Record<string, unknown>,
        // Read through `options` so callers passing fresh closures (or
        // wrappers over reactive props) never force a remount.
        onEvent: (name, payload) => options.onEvent?.(name, payload),
        onActivity: () => options.onActivity?.(),
        slots: options.slots,
      });
      if (gen !== generation) {
        mounted.destroy();
        return;
      }
      island = mounted;
      handle.value = mounted;
      status.value = 'ready';
      // Props may have moved while the mount round-trip was in flight —
      // the props watcher skips a null handle, so reconcile here.
      const latestJson = propsJson(options);
      if (latestJson !== mountedJson) {
        void mounted.updateProps(JSON.parse(latestJson) as Record<string, unknown>);
      }
      options.onReady?.(mounted);
    } catch (err) {
      if (gen === generation) report(err);
    }
  };

  // Mount on first non-null host; destroy + remount if the element is
  // swapped out (v-if re-attach) — the worker tree lives inside `el`, so a
  // detached element means a dead island. flush: 'post' waits for the DOM
  // patch that assigned the ref.
  watch(
    host,
    (el) => {
      const gen = ++generation;
      island?.destroy();
      island = null;
      handle.value = null;
      if (el === null) return;
      status.value = 'mounting';
      error.value = undefined;
      void mount(el, gen);
    },
    { flush: 'post', immediate: true },
  );

  // props → updateProps. JSON.stringify in the getter touches every
  // property of a reactive props object, giving deep tracking without
  // `deep: true` — and the serialized form is the honest equality (props
  // cross the wire serialized anyway).
  watch(
    () => propsJson(options),
    (nextJson) => {
      const mounted = island;
      if (mounted === null) return; // mount picks up the latest props itself
      mounted
        .updateProps(JSON.parse(nextJson) as Record<string, unknown>)
        .catch((err: unknown) => {
          if (options.onError !== undefined) options.onError(err);
          else console.error('[mesh-vue-island] updateProps failed:', err);
        });
    },
  );

  if (getCurrentScope() !== undefined) {
    onScopeDispose(() => {
      generation++;
      island?.destroy();
      island = null;
      handle.value = null;
    });
  }

  return { host, handle, status, error };
}

/* ── <MeshIsland/> ───────────────────────────────────────────────────────── */

export interface MeshIslandProps {
  /** Pre-connected client (shared across islands mounts realms into one worker). */
  client?: IslandClient;
  /** Worker factory — alternative to `client` for the 1:1 case. */
  worker?: (() => Worker) | URL;
  /** Extra pool options for the `worker` path. */
  workerOptions?: IslandWorkerOptions;
  /** Registry name or islandApp-stamped reference — see UseIslandOptions.app. */
  app?: string | IslandAppLike;
  /** Root props — may be a `reactive()` object; changes call updateProps. */
  props?: Record<string, unknown>;
  /**
   * Worker-DOM transclusion slots — `Record<name, (el | null) => void>`.
   * (These are worker-dom slot anchors, NOT Vue slots: the callback receives
   * the real element the worker anchored so shell code can mount content
   * inside it. Vue's own `slots` render API is untouched.)
   */
  slots?: Record<string, (el: HTMLElement | null) => void>;
  /** Island → shell channel: every `emit` op lands here. */
  onEvent?: (name: string, payload: unknown) => void;
  /** Fired after each applied op batch. */
  onActivity?: () => void;
  /** The mounted handle (pid, updateProps, flush, setMode…) once ready. */
  onReady?: (island: IslandHandle) => void;
  /** Mount/update errors surface here instead of an unhandled rejection. */
  onError?: (err: unknown) => void;
}

/**
 * `<MeshIsland/>` — renders `<div class="mesh-island">` hosting one worker
 * island. `defineComponent` + `h()` so it works in the runtime-only Vue
 * build (no SFC compiler). `client`/`worker`/`app`/`slots` are mount-stable
 * — swap via `key`; `props` and the `on*` callbacks are read reactively.
 */
export const MeshIsland = defineComponent({
  name: 'MeshIsland',
  props: {
    // `skipCheck` on the exotic-valued props: an IslandClient is a task
    // proxy — Vue's dev-time validator stringifies failed prop values, and
    // reading `.toString` off the proxy would dispatch phantom worker
    // tasks. Runtime type checks add nothing here; TS is the contract.
    client: {
      type: Object as PropType<IslandClient>,
      required: false,
      default: undefined,
      skipCheck: true,
    },
    worker: {
      type: [Function, Object] as PropType<(() => Worker) | URL>,
      required: false,
      default: undefined,
      skipCheck: true,
    },
    workerOptions: {
      type: Object as PropType<IslandWorkerOptions>,
      required: false,
      default: undefined,
      skipCheck: true,
    },
    app: {
      type: [String, Function, Object] as PropType<string | IslandAppLike>,
      required: false,
      default: undefined,
      skipCheck: true,
    },
    props: {
      type: Object as PropType<Record<string, unknown>>,
      required: false,
      default: undefined,
    },
    slots: {
      type: Object as PropType<Record<string, (el: HTMLElement | null) => void>>,
      required: false,
      default: undefined,
    },
    onEvent: {
      type: Function as PropType<(name: string, payload: unknown) => void>,
      required: false,
      default: undefined,
    },
    onActivity: { type: Function as PropType<() => void>, required: false, default: undefined },
    onReady: {
      type: Function as PropType<(island: IslandHandle) => void>,
      required: false,
      default: undefined,
    },
    onError: {
      type: Function as PropType<(err: unknown) => void>,
      required: false,
      default: undefined,
    },
  },
  setup(props, { expose }) {
    // The props object Vue hands setup() is reactive — getters/wrappers
    // below keep `props` and the on* callbacks live without remounting.
    const island = useIsland({
      client: props.client,
      worker: props.worker,
      workerOptions: props.workerOptions,
      app: props.app,
      props: () => props.props,
      slots: props.slots,
      onEvent: (name, payload) => props.onEvent?.(name, payload),
      onActivity: () => props.onActivity?.(),
      onReady: (islandHandle) => props.onReady?.(islandHandle),
      onError: (err) => props.onError?.(err),
    });
    expose({ handle: island.handle, status: island.status, error: island.error });
    return () => h('div', { class: 'mesh-island', ref: island.host });
  },
});

export default MeshIsland;
