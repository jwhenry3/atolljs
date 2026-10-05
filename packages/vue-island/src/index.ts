/**
 * `@atolljs/vue-island` — the Vue shell surface for
 * `@atolljs/islands` islands: a worker-hosted React (or
 * imperative proxy-DOM) tree mounted as an ordinary element in a
 * main-thread Vue app. Plain `.ts` — no SFC compiler needed.
 *
 * ```ts
 * import { AtollIsland, useIsland } from '@atolljs/vue-island';
 * import { connectIslandWorker } from '@atolljs/islands';
 *
 * const client = connectIslandWorker({
 *   worker: () => new Worker(new URL('./render.worker.ts', import.meta.url), { type: 'module' }),
 * });
 *
 * // component form:
 * h(AtollIsland, { client, app: 'charts', props: { width: 520 }, onEvent: (n, p) => ... })
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
 *   `AtollIsland` does) and fresh closures never remount the worker.
 * - `client`/`worker`/`app`/`slots` are MOUNT-STABLE — read once when the
 *   host element lands. Swap them via `key`/`v-if`, not mid-life.
 * - If `host` returns to null (v-if, unmount) the island is destroyed; a
 *   later non-null host remounts it. Scope disposal (component unmount or
 *   `effectScope.stop()`) destroys the island too — the worker terminates
 *   unless the client is shared (the instance unmounts and the worker dies
 *   with the last island to leave).
 */
import {
  defineAsyncComponent,
  defineComponent,
  getCurrentScope,
  h,
  onScopeDispose,
  ref,
  shallowRef,
  toValue,
  watch,
} from 'vue';
import type { Component, MaybeRefOrGetter, PropType, Ref, ShallowRef } from 'vue';
import {
  connectIslandWorker,
  contractWorkerOf,
  islandAppNameOf,
  mountIsland,
} from '@atolljs/islands';
import type {
  IslandAppLike,
  IslandAppProps,
  IslandClient,
  IslandContract,
  IslandContractEventHandler,
  IslandHandle,
  IslandWorkerOptions,
  Mode,
} from '@atolljs/islands';

// Re-export the handle type consumers need to name.
export type { IslandHandle };

/** Lifecycle state of a `useIsland` mount. */
export type IslandStatus = 'idle' | 'mounting' | 'ready' | 'error' | 'destroyed';

export interface UseIslandOptions {
  /**
   * How to reach the worker — a pre-connected `IslandClient` (shared
   * clients mount several mounts into one worker) or a bundler-detectable
   * factory `() => new Worker(new URL('./x.worker.ts', import.meta.url),
   * { type: 'module' })`. Exactly one is required. Mount-stable.
   */
  client?: IslandClient;
  worker?: (() => Worker) | URL;
  /** Extra pool options for the `worker` path (concurrency, taskTimeout…). */
  workerOptions?: IslandWorkerOptions & { doorbell?: boolean };
  /**
   * Which app to mount — the `apps` registry key ('charts') or an
   * `islandApp`-stamped reference. Optional against a `defineMonoWorker`
   * (1:1) worker — its single app mounts regardless. Mount-stable.
   */
  app?: string | IslandAppLike;
  /**
   * Root props, serialized to the worker. Reactive — a `ref`, a getter, or
   * a `reactive()` object — so mutations route through `updateProps`.
   */
  props?: MaybeRefOrGetter<Record<string, unknown> | undefined>;
  /**
   * Initial flush mode — 'push' (default) drives op replay off the
   * shared-memory doorbell (needs cross-origin isolation); 'poll' drains on
   * a 50ms interval and, for `worker`-shorthand mounts, builds the client
   * doorbell-free — no SharedArrayBuffer, no COOP/COEP requirement.
   * Mount-time only; switch later via the handle's `setMode`.
   */
  mode?: Mode;
  /** Island → shell channel: every `emit` op lands here. */
  onEvent?: (name: string, payload: unknown) => void;
  /** Fired after each applied op batch — stats hooks. */
  onActivity?: () => void;
  /**
   * Transclusion slots — a worker `<div data-atoll-slot="name">` hands its
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
  /** idle → mounting → ready | error → destroyed (mirrors the svelte binding). */
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
    else console.error('[atoll-vue-island] mount failed:', err);
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
    // A contract `app` can carry its own worker factory — the contract
    // module is then the whole connection, call sites pass no worker.
    const worker = options.worker ?? contractWorkerOf(options.app);
    const client =
      options.client ??
      (worker !== undefined
        ? connectIslandWorker({ name: app, worker, ...options.workerOptions })
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
        mode: options.mode,
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
      // Host detached (v-if) — the island is gone; 'idle' until a new host
      // arrives, so status doesn't sit at 'ready' over a dead tree.
      if (el === null) {
        status.value = 'idle';
        return;
      }
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
        // Same surface as the other bindings — update failures report
        // status='error' + error, not just the onError callback.
        .catch(report);
    },
  );

  if (getCurrentScope() !== undefined) {
    onScopeDispose(() => {
      generation++;
      island?.destroy();
      island = null;
      handle.value = null;
      status.value = 'destroyed';
    });
  }

  return { host, handle, status, error };
}

/* ── <AtollIsland/> ───────────────────────────────────────────────────────── */

export interface AtollIslandProps {
  /** Pre-connected client (shared across islands mounts mounts into one worker). */
  client?: IslandClient;
  /** Worker factory — alternative to `client` for the 1:1 case. */
  worker?: (() => Worker) | URL;
  /** Extra pool options for the `worker` path. */
  workerOptions?: IslandWorkerOptions & { doorbell?: boolean };
  /** Registry name or islandApp-stamped reference — see UseIslandOptions.app. */
  app?: string | IslandAppLike;
  /** Root props — may be a `reactive()` object; changes call updateProps. */
  props?: Record<string, unknown>;
  /** Initial flush mode — see UseIslandOptions.mode. */
  mode?: Mode;
  /**
   * Worker-DOM transclusion slots — `Record<name, (el | null) => void>`.
   * (These are islands slot anchors, NOT Vue slots: the callback receives
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
 * `<AtollIsland/>` — renders `<div class="atoll-island">` hosting one worker
 * island. `defineComponent` + `h()` so it works in the runtime-only Vue
 * build (no SFC compiler). `client`/`worker`/`app`/`slots` are mount-stable
 * — swap via `key`; `props` and the `on*` callbacks are read reactively.
 */
export const AtollIsland = defineComponent({
  name: 'AtollIsland',
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
    mode: {
      type: String as PropType<Mode>,
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
      mode: props.mode,
      slots: props.slots,
      onEvent: (name, payload) => props.onEvent?.(name, payload),
      onActivity: () => props.onActivity?.(),
      onReady: (islandHandle) => props.onReady?.(islandHandle),
      onError: (err) => props.onError?.(err),
    });
    expose({ handle: island.handle, status: island.status, error: island.error });
    return () => h('div', { class: 'atoll-island', ref: island.host });
  },
});

export default AtollIsland;

/* ── Worker-loaded component facades ──────────────────────────────────
 *
 * `islandComponent`/`lazyIsland` return components that take a worker app's
 * props inline — `<ChartsIsland :width="520"/>` — and route every attribute
 * that isn't a shell concern through as the island's props. Attributes are
 * undeclared, so they all land in `attrs`; a split by SHELL_PROP_KEYS gives
 * the two halves. The lazy side wraps Vue's own `defineAsyncComponent` —
 * the `React.lazy` mirror — resolving `{ default: A }` and the contract
 * module shape `{ app: A, worker? }` the same way the React facade does.
 */

/** What `app` accepts: the registry name, or a component/def to resolve. */
export type IslandAppRef<A> = A | string;

/**
 * Attributes consumed by a proxy component itself — every other attribute
 * forwards to the island as its props.
 */
export interface IslandShellProps {
  /** How to reach the worker — see UseIslandOptions.worker/client. */
  worker?: (() => Worker) | URL;
  client?: IslandClient;
  workerOptions?: IslandWorkerOptions & { doorbell?: boolean };
  /** Initial flush mode — see UseIslandOptions.mode. */
  mode?: Mode;
  /** Island → shell channel: every `emit` op lands here. */
  onEvent?: (name: string, payload: unknown) => void;
  /** Fired after each applied op batch. */
  onActivity?: () => void;
  /** The mounted handle (pid, updateProps, flush, setMode…) once ready. */
  onReady?: (island: IslandHandle) => void;
  /** Mount/update errors surface here instead of an unhandled rejection. */
  onError?: (err: unknown) => void;
  /** Worker-DOM transclusion slots — element callbacks, NOT Vue slots
   *  (see AtollIslandProps.slots). */
  slots?: Record<string, (el: HTMLElement | null) => void>;
  /** Attributes for the island's container div (class/id/style/data-*). */
  containerProps?: Record<string, unknown>;
}

const SHELL_PROP_KEYS: ReadonlySet<string> = new Set([
  'worker',
  'client',
  'workerOptions',
  'mode',
  'onEvent',
  'onActivity',
  'onReady',
  'onError',
  'slots',
  'containerProps',
]);

/**
 * Vue's fallthrough semantics: `class`/`style`/`id`/`data-*`/`aria-*`
 * attributes on the proxy belong on the container div, NOT the island
 * props — a `<ChartsIsland class="box">` should look like any other
 * component. `key`/`ref` never reach `attrs` (vnode-reserved).
 */
const CONTAINER_ATTR = /^(?:class|style|id|data-|aria-)/;

/** Shared implementation for both facades — `resolve` supplies the app (and
 *  a contract module's worker, when present) at setup time. */
function createIslandProxy(
  displayName: string,
  resolve: () => { app?: IslandAppLike | string; worker?: (() => Worker) | URL },
): Component {
  return defineComponent({
    name: displayName,
    inheritAttrs: false,
    setup(_, { attrs, expose }) {
      const resolved = resolve();
      const island = useIsland({
        app: resolved.app,
        client: attrs.client as IslandClient | undefined,
        worker: (attrs.worker ?? resolved.worker) as ((() => Worker) | URL) | undefined,
        workerOptions: attrs.workerOptions as IslandWorkerOptions | undefined,
        mode: attrs.mode as Mode | undefined,
        // Non-shell, non-DOM attrs ARE the island's props — rebuilt per
        // read so the getter's reactive tracking sees attribute updates.
        props: () => {
          const p: Record<string, unknown> = {};
          for (const [key, value] of Object.entries(attrs)) {
            if (!SHELL_PROP_KEYS.has(key) && !CONTAINER_ATTR.test(key)) p[key] = value;
          }
          return p;
        },
        slots: attrs.slots as UseIslandOptions['slots'],
        onEvent: (name, payload) => (attrs.onEvent as UseIslandOptions['onEvent'])?.(name, payload),
        onActivity: () => (attrs.onActivity as UseIslandOptions['onActivity'])?.(),
        onReady: (islandHandle) => (attrs.onReady as UseIslandOptions['onReady'])?.(islandHandle),
        onError: (err) => (attrs.onError as UseIslandOptions['onError'])?.(err),
      });
      expose({ handle: island.handle, status: island.status, error: island.error });
      return () => {
        // Fallthrough DOM attrs + explicit containerProps → the host div.
        const container: Record<string, unknown> = {
          ...(attrs.containerProps as Record<string, unknown> | undefined),
        };
        for (const [key, value] of Object.entries(attrs)) {
          if (CONTAINER_ATTR.test(key)) container[key] = value;
        }
        container.class = ['atoll-island', container.class, attrs.class].filter(Boolean);
        return h('div', { ...container, ref: island.host });
      };
    },
  });
}

/**
 * `islandComponent<P>('charts')` — a proxy component for a worker app that
 * the shell NEVER imports. `P` is the contract (usually an `import type` of
 * the worker component's props); the string is the registry key. Against a
 * `defineMonoWorker` (1:1) worker the name can be omitted entirely.
 *
 * ```ts
 * const ChartsIsland = islandComponent<ChartsProps>('charts');
 * // template: <ChartsIsland :worker="renderWorker" :width="520" />
 * ```
 */
/**
 * Facade attribute surface for `A`: app-derived props plus the shell props.
 * When `A` is an `IslandContract`, `onEvent` narrows to the contract's
 * declared event vocabulary — the cross-framework contract type.
 */
export type IslandFacadeProps<A> = IslandAppProps<A> &
  Omit<IslandShellProps, 'onEvent'> & {
    onEvent?: A extends IslandContract ? IslandContractEventHandler<A> : IslandShellProps['onEvent'];
  };

export function islandComponent<C extends IslandContract>(
  app: C,
): Component<IslandFacadeProps<C>>;
export function islandComponent<P extends object = Record<string, unknown>>(
  app?: string,
): Component<P & IslandShellProps>;
export function islandComponent<A extends IslandAppLike>(
  app: A,
): Component<IslandAppProps<A> & IslandShellProps>;
export function islandComponent(app?: string | IslandAppLike): Component {
  return createIslandProxy(`IslandComponent(${islandAppNameOf(app) ?? 'main'})`, () => ({
    app: app as IslandAppLike | undefined,
  }));
}

type LazyModule<A> = A | { default: A } | { app: A | string; worker?: (() => Worker) | URL };

/**
 * The app a lazy module resolves to — unwraps `{ default: A }` and the
 * contract-module shape `{ app: A, worker? }`, passes bare A through.
 */
export type LazyResolvedApp<T extends Promise<unknown>> =
  // A contract object IS a lazy module (`{ app, worker? }` + brand) — match
  // it before `{ app: infer A }` so props infer `P`, not `app`'s string.
  // The never guard keeps a `Promise.reject` loader on the untyped path.
  [Awaited<T>] extends [never]
    ? string
    : Awaited<T> extends { readonly islandContract: true }
      ? Awaited<T>
      : Awaited<T> extends { app: infer A }
        ? A
        : Awaited<T> extends { default: infer D }
          ? D
          : Awaited<T>;

/**
 * `lazyIsland(() => import('./worker/apps').then(m => ({ default: m.ChartsApp })))`
 * — the `React.lazy` mirror for worker apps, built on Vue's own
 * `defineAsyncComponent`: while the module loads it renders the configured
 * loading state (or nothing), then proxies all attributes to the island.
 * The dynamic import gives bundlers a split point, so the worker app's
 * dependencies only load when the island mounts.
 *
 * ```ts
 * const ChartsIsland = lazyIsland(() => import('./worker/apps').then(m => ({ default: m.ChartsApp })));
 * // template: <ChartsIsland :width="520" :worker="renderWorker" />
 * ```
 *
 * CONTRACT MODULES: for `defineMonoWorker` (1:1) topologies the loader can
 * resolve `{ app, worker }` — the island then carries its own worker factory
 * and call sites need no `worker` attribute at all.
 */
export function lazyIsland<T extends Promise<LazyModule<IslandAppLike>>>(
  loader: () => T,
  options?: {
    loadingComponent?: Component;
    errorComponent?: Component;
    delay?: number;
    timeout?: number;
    suspensible?: boolean;
  },
): Component<IslandFacadeProps<LazyResolvedApp<T>>> {
  return defineAsyncComponent({
    loader: async () => {
      const mod = await loader();
      const unwrapped =
        mod !== null && typeof mod === 'object' && 'default' in mod
          ? (mod as { default: unknown }).default
          : mod;
      const isContract =
        unwrapped !== null && typeof unwrapped === 'object' && 'app' in unwrapped;
      return createIslandProxy('LazyIsland', () => ({
        app: (
          isContract ? (unwrapped as { app: IslandAppLike | string }).app : unwrapped
        ) as IslandAppLike | string,
        worker: isContract
          ? (unwrapped as { worker?: (() => Worker) | URL }).worker
          : undefined,
      }));
    },
    ...options,
  }) as Component<IslandFacadeProps<LazyResolvedApp<T>>>;
}
