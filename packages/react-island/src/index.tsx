/**
 * `@jwhenry123/mesh-react-island` — the React shell surface for
 * `@jwhenry123/mesh-worker-dom` islands: a worker-hosted React (or
 * imperative proxy-DOM) tree mounted as an ordinary element in a
 * main-thread React app.
 *
 * ```tsx
 * import { Island } from '@jwhenry123/mesh-react-island';
 * import { ChartsApp } from './worker/apps'; // the islandApp-stamped component
 *
 * const renderWorker = () =>
 *   new Worker(new URL('./render.worker.ts', import.meta.url), { type: 'module' });
 *
 * <Island
 *   worker={renderWorker}
 *   app={ChartsApp}              // or the registry name string 'charts'
 *   props={{ width: 520 }}       // inferred from ChartsApp's own props
 *   onEvent={(name, payload) => setStatus(`${name}: ${JSON.stringify(payload)}`)}
 *   slots={{ wave: <Sparkline /> }} // React portals into worker data-mesh-slot="wave"
 * />
 * ```
 *
 * Semantics:
 * - Mounting is async — the component renders its container div immediately,
 *   spawns the worker + replays the first op batch in an effect.
 * - `props` changes call `island.updateProps` — deduped by JSON-serialized
 *   identity, so re-rendering with an equal props object costs no round-trip
 *   (props cross the wire serialized anyway, making that the honest equality).
 * - `onEvent`/`onActivity` are read through refs — passing fresh closures
 *   each render never remounts the worker. `slots` are React portals into
 *   worker-created anchor elements; the portal content renders wherever the
 *   worker places the matching `data-mesh-slot`.
 * - `app` changes remount the island; `worker`/`client` are MOUNT-STABLE —
 *   swap them via React `key`, not by passing a new value mid-life.
 * - Unmount destroys the island; the worker terminates unless the client
 *   is SHARED (several `<Island client={c}/>` mount realms into one worker —
 *   the realm unmounts and the worker dies with the last island to leave).
 *
 * The `app` prop accepts the registry name OR the app itself — a React
 * component, an `islandApp`-stamped value, or an `{ imperative }` def. Pass
 * the component to get `props` inference; `islandApp('name', Comp)` is the
 * minification-proof way to bind a component to its registry key (bare
 * function/displayName resolution is a dev convenience).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { HTMLAttributes, ReactElement, ReactNode, Ref } from 'react';
import {
  connectIslandWorker,
  islandAppNameOf,
  mountIsland,
} from '@jwhenry123/mesh-worker-dom';
import type {
  IslandAppLike,
  IslandAppProps,
  IslandClient,
  IslandHandle,
  IslandWorkerOptions,
} from '@jwhenry123/mesh-worker-dom';

// Re-export the app-contract types the component API is generic over, so
// consumers can name them without a second package import.
export type { IslandAppLike, IslandAppProps, IslandHandle };

/** What `app` accepts: the registry name, or a component/def to resolve. */
export type IslandAppRef<A> = A | string;

export interface IslandProps<A = string>
  extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  /**
   * Which app to mount — the `apps` registry key ('charts') or the app
   * itself (`ChartsApp`, an `islandApp(...)`-stamped def, `{ imperative }`).
   * A reference infers `props` from its own signature. Optional against a
   * `defineRealmWorker` (1:1) worker — its single app mounts regardless.
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
  /** Initial + updated root props — serialized to the worker. */
  props?: IslandAppProps<A>;
  /** Island → shell channel: every `emit` op lands here. */
  onEvent?: (name: string, payload: unknown) => void;
  /**
   * Transclusion slots — a worker `<div data-mesh-slot="name">` becomes a
   * React portal mount point. The element's contents are rendered by React
   * on the main thread; the worker only owns the empty anchor.
   */
  slots?: Record<string, ReactNode>;
  /** Fired after each applied op batch — stats hooks. */
  onActivity?: () => void;
  /** The mounted handle (pid, updateProps, flush, setMode…) once ready. */
  onReady?: (island: IslandHandle) => void;
  /** Mount/update errors surface here instead of an unhandled rejection. */
  onError?: (err: unknown) => void;
  /** The container div (React 19 ref-as-prop). */
  ref?: Ref<HTMLDivElement>;
}

export function Island<A = string>({
  app,
  worker,
  client: clientProp,
  workerOptions,
  props,
  onEvent,
  onActivity,
  slots,
  onReady,
  onError,
  ref,
  ...rest
}: IslandProps<A>): ReactElement {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const islandRef = useRef<IslandHandle | null>(null);
  const [slotTargets, setSlotTargets] = useState<Record<string, HTMLElement | null>>({});

  // Latest-render values — the mount effect and driver callbacks read
  // through these so fresh identities never force a remount.
  const propsRef = useRef(props);
  const onEventRef = useRef(onEvent);
  const onActivityRef = useRef(onActivity);
  const slotsRef = useRef(slots);
  const onReadyRef = useRef(onReady);
  const onErrorRef = useRef(onError);
  propsRef.current = props;
  onEventRef.current = onEvent;
  onActivityRef.current = onActivity;
  slotsRef.current = slots;
  onReadyRef.current = onReady;
  onErrorRef.current = onError;

  const setRefs = (el: HTMLDivElement | null): void => {
    containerRef.current = el;
    if (typeof ref === 'function') ref(el);
    else if (ref != null) ref.current = el;
  };

  // mount effect — worker/client identity is intentionally NOT tracked:
  // mount-stable (swap via `key`). `app` IS tracked — a different app means
  // a different island: the cleanup destroys, the re-run mounts fresh.
  // No `app` → 'main': realm workers (defineRealmWorker) mount their single
  // app namelessly; registry workers will error with the key list if 'main'
  // isn't a real key.
  const appName = app === undefined ? 'main' : islandAppNameOf(app);
  useEffect(() => {
    const el = containerRef.current;
    if (el === null) return;
    let cancelled = false;
    let island: IslandHandle | null = null;
    const report = (err: unknown): void => {
      if (onErrorRef.current !== undefined) onErrorRef.current(err);
      else console.error('[Island] mount failed:', err);
    };

    if (appName === undefined) {
      report(
        new Error(
          '<Island> could not resolve an app name — pass the registry key or stamp the app with islandApp(name, app)',
        ),
      );
      return;
    }

    const client =
      clientProp ??
      (worker !== undefined ? connectIslandWorker({ worker, ...workerOptions }) : undefined);
    if (client === undefined) {
      report(new Error('<Island> requires either `worker` or `client`'));
      return;
    }

    // React portal anchors: the worker marks `data-mesh-slot="name"`, the
    // driver hands us the real element, and we render the matching slot
    // content into it with createPortal.
    const slotProxy = new Proxy({} as Record<string, (el: HTMLElement | null) => void>, {
      get: (_t, name: string) => (e: HTMLElement | null) => {
        setSlotTargets((prev) => (prev[name] === e ? prev : { ...prev, [name]: e }));
      },
    });

    void (async () => {
      try {
        const handle = await mountIsland({
          client,
          el,
          app: appName,
          // Serialized across the wire either way — cast preserves inference
          // for props types without an index signature.
          props: (propsRef.current ?? {}) as Record<string, unknown>,
          onEvent: (name, payload) => onEventRef.current?.(name, payload),
          onActivity: () => onActivityRef.current?.(),
          slots: slotProxy,
        });
        if (cancelled) {
          handle.destroy();
          return;
        }
        island = handle;
        islandRef.current = handle;
        onReadyRef.current?.(handle);
      } catch (err) {
        if (!cancelled) report(err);
      }
    })();

    return () => {
      cancelled = true;
      islandRef.current = null;
      island?.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app, appName, clientProp]);

  // props → updateProps, deduped by wire-serialized identity (the same bytes
  // produce the same render — a repeat send would be a wasted round-trip).
  const propsJson = JSON.stringify(props ?? {});
  useEffect(() => {
    const island = islandRef.current;
    if (island === null) return; // mount picks up propsRef.current
    island.updateProps((props ?? {}) as Record<string, unknown>).catch((err) => {
      if (onErrorRef.current !== undefined) onErrorRef.current(err);
      else console.error('[Island] updateProps failed:', err);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [propsJson]);

  return (
    <>
      <div ref={setRefs} {...rest} />
      {Object.entries(slotTargets).map(([name, el]) =>
        el && slotsRef.current?.[name] != null
          ? createPortal(slotsRef.current[name] as ReactNode, el, `mesh-slot-${name}`)
          : null,
      )}
    </>
  );
}

/* ── Worker-loaded component proxies ──────────────────────────────────────
 *
 * `islandComponent`/`lazyIsland` close the last gap between a worker app and
 * a local component: the returned component takes the WORKER app's props
 * inline — `<ChartsApp width={520}/>` — and routes everything that isn't a
 * shell concern through as the island's props. `lazyIsland` additionally
 * suspends while the component's module loads, exactly like `React.lazy`
 * (and gives bundlers a code-split boundary). `islandComponent` never loads
 * the implementation at all — the worker owns it; the shell-side value is a
 * pure contract (registry name + props type).
 *
 * One asymmetry vs React.lazy, by construction: the loader phase suspends,
 * but the MOUNT phase can't — suspended trees never commit, and mounting
 * needs the container div in the DOM first. The mount window is covered by
 * the `fallback` prop instead of `<Suspense>`.
 */

/**
 * Props consumed by a proxy component itself — everything else forwards to
 * the island as its props.
 */
export interface IslandShellProps {
  /** How to reach the worker — see IslandProps.worker/client. */
  worker?: (() => Worker) | URL;
  client?: IslandClient;
  workerOptions?: IslandWorkerOptions;
  /** Island → shell channel: every `emit` op lands here. */
  onEvent?: (name: string, payload: unknown) => void;
  /** Fired after each applied op batch. */
  onActivity?: () => void;
  /** The mounted handle (pid, updateProps, flush, setMode…) once ready. */
  onReady?: (island: IslandHandle) => void;
  /** Mount/update errors surface here instead of an unhandled rejection. */
  onError?: (err: unknown) => void;
  /** Transclusion slots — see IslandProps.slots. */
  slots?: Record<string, ReactNode>;
  /** Rendered while the worker mounts — the lazy-side fallback. */
  fallback?: ReactNode;
  /**
   * Attributes for the island's container div (className/id/style/data-*).
   * `onError` is omitted — it collides with the mount-error callback.
   */
  containerProps?: Omit<HTMLAttributes<HTMLDivElement>, 'children' | 'onError'>;
}

const SHELL_PROP_KEYS: ReadonlySet<string> = new Set([
  'worker',
  'client',
  'workerOptions',
  'onEvent',
  'onActivity',
  'onReady',
  'onError',
  'slots',
  'fallback',
  'containerProps',
]);

/** Every non-shell prop is the island's props — the component contract. */
const splitProxyProps = (
  raw: Record<string, unknown>,
): { shell: IslandShellProps; islandProps: Record<string, unknown> } => {
  const shell: Record<string, unknown> = {};
  const islandProps: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (SHELL_PROP_KEYS.has(key)) shell[key] = value;
    else islandProps[key] = value;
  }
  return { shell: shell as IslandShellProps, islandProps };
};

function IslandProxy({
  app,
  ...raw
}: { app?: IslandAppRef<unknown> } & Record<string, unknown>): ReactElement {
  const { shell, islandProps } = splitProxyProps(raw);
  const [ready, setReady] = useState(false);
  return (
    <>
      {!ready ? shell.fallback : null}
      <Island
        app={app}
        worker={shell.worker}
        client={shell.client}
        workerOptions={shell.workerOptions}
        props={islandProps}
        onEvent={shell.onEvent}
        onActivity={shell.onActivity}
        slots={shell.slots}
        onReady={(h) => {
          shell.onReady?.(h);
          setReady(true);
        }}
        onError={shell.onError}
        {...shell.containerProps}
      />
    </>
  );
}

/**
 * `islandComponent<P>('charts')` — a proxy component for a worker app that
 * the shell NEVER imports. `P` is the contract (usually a `import type` of
 * the worker component's props); the string is the registry key. Against a
 * `defineRealmWorker` (1:1) worker the name can be omitted entirely.
 *
 * ```tsx
 * import type { TableProps } from './worker/apps';
 * const TableIsland = islandComponent<TableProps>('data-table');
 * <TableIsland worker={renderWorker} filter={filter} desc={desc} />
 * ```
 */
export function islandComponent<P extends object = Record<string, unknown>>(
  app?: string,
): (props: P & IslandShellProps) => ReactElement;
export function islandComponent<A extends IslandAppLike>(
  app: A,
): (props: IslandAppProps<A> & IslandShellProps) => ReactElement;
export function islandComponent(
  app?: string | IslandAppLike,
): (props: object) => ReactElement {
  const Proxy = (props: Record<string, unknown>): ReactElement => (
    <IslandProxy app={app as IslandAppLike} {...props} />
  );
  (Proxy as { displayName?: string }).displayName =
    `IslandComponent(${islandAppNameOf(app) ?? 'main'})`;
  return Proxy as (props: object) => ReactElement;
}

type LazyModule<A> = A | { default: A } | { app: A; worker?: (() => Worker) | URL };

/**
 * The app a lazy module resolves to — unwraps `{ default: A }` and the
 * contract-module shape `{ app: A, worker? }`, passes bare A through.
 */
export type LazyResolvedApp<T extends Promise<unknown>> =
  Awaited<T> extends { app: infer A }
    ? A
    : Awaited<T> extends { default: infer D }
      ? D
      : Awaited<T>;

/**
 * `lazyIsland(() => import('./worker/apps').then(m => ({ default: m.ChartsApp })))`
 * — the `React.lazy` mirror for worker apps. The returned component suspends
 * while the module loads (wrap it in `<Suspense>`), then proxies all props
 * to the island. The dynamic import gives bundlers a split point, so the
 * worker component's dependencies only load when the island mounts.
 *
 * ```tsx
 * const ChartsIsland = lazyIsland(() => import('./worker/apps').then(m => ({ default: m.ChartsApp })));
 * <Suspense fallback="loading…"><ChartsIsland width={520} worker={renderWorker} /></Suspense>
 * ```
 *
 * CONTRACT MODULES: for `defineRealmWorker` (1:1) topologies the loader can
 * resolve `{ app, worker }` — the island then carries its own worker
 * factory and call sites need no `worker` prop at all:
 *
 * ```ts
 * // worker/map.island.ts — shell-safe contract (never the .worker.ts entry
 * // itself: defining a worker installs realm globals, don't import it)
 * export { mapApp as app } from './map';
 * export const worker = () => new Worker(new URL('./map.worker.ts', import.meta.url), { type: 'module' });
 *
 * // shell.tsx
 * const MapIsland = lazyIsland(() => import('./worker/map.island'));
 * <MapIsland />  // app + worker both from the contract
 * ```
 */
export function lazyIsland<T extends Promise<LazyModule<IslandAppLike>>>(
  loader: () => T,
): (props: IslandAppProps<LazyResolvedApp<T>> & IslandShellProps) => ReactElement {
  let state:
    | { promise: Promise<unknown>; value?: unknown; worker?: unknown; error?: unknown }
    | undefined;
  const load = (): NonNullable<typeof state> => {
    state ??= {
      promise: Promise.resolve()
        .then(loader)
        .then((mod) => {
          const unwrapped =
            mod !== null && typeof mod === 'object' && 'default' in mod ? mod.default : mod;
          const isContract =
            unwrapped !== null && typeof unwrapped === 'object' && 'app' in unwrapped;
          state!.value = isContract ? (unwrapped as { app: unknown }).app : unwrapped;
          if (isContract) state!.worker = (unwrapped as { worker?: unknown }).worker;
          return state!.value;
        })
        .catch((err: unknown) => {
          state!.error = err;
          throw err;
        }),
    };
    return state;
  };
  function LazyProxy(
    props: IslandAppProps<LazyResolvedApp<T>> & IslandShellProps,
  ): ReactElement {
    const s = load();
    if (s.error !== undefined) throw s.error;
    if (s.value === undefined) throw s.promise; // Suspense — same as React.lazy
    return (
      <IslandProxy
        app={s.value}
        // The contract module's worker is the default — an explicit prop wins.
        worker={(s.worker ?? undefined) as (() => Worker) | URL | undefined}
        {...(props as Record<string, unknown>)}
      />
    );
  }
  (LazyProxy as { displayName?: string }).displayName = 'LazyIsland';
  return LazyProxy;
}

export default Island;
