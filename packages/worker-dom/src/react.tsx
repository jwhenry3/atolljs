/**
 * `<Island/>` — the declarative counterpart to `connectIslandWorker` +
 * `mountIsland`: a worker-hosted React (or imperative proxy-DOM) tree
 * mounted as an ordinary element in a main-thread React app.
 *
 * ```tsx
 * import { Island } from '@jwhenry123/mesh-worker-dom/react';
 *
 * const renderWorker = () =>
 *   new Worker(new URL('./render.worker.ts', import.meta.url), { type: 'module' });
 *
 * <Island
 *   worker={renderWorker}
 *   app="charts"
 *   props={{ width: 520, height: 280 }}
 *   onEvent={(name, payload) => setStatus(`${name}: ${JSON.stringify(payload)}`)}
 *   slots={{ gmap: (el) => (el ? mountMainThreadMap(el) : teardownMap()) }}
 * />
 * ```
 *
 * Semantics:
 * - Mounting is async — the component renders its container div immediately,
 *   spawns the worker + replays the first op batch in an effect.
 * - `props` changes call `island.updateProps` — deduped by JSON-serialized
 *   identity, so re-rendering with an equal props object costs no round-trip
 *   (props cross the wire serialized anyway, making that the honest equality).
 * - `onEvent`/`onActivity`/`slots` are read through refs — passing fresh
 *   closures each render never remounts the worker.
 * - `app` changes remount the island; `worker`/`client` are MOUNT-STABLE —
 *   swap them via React `key`, not by passing a new value mid-life.
 * - Unmount destroys the island and terminates its worker (one island owns
 *   one client — even a `client` prop is that island's worker).
 */
import { forwardRef, useEffect, useRef } from 'react';
import type { HTMLAttributes, ReactElement, Ref } from 'react';
import { connectIslandWorker, mountIsland } from './island';
import type { IslandClient, IslandHandle, IslandWorkerOptions } from './island';

export interface IslandProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  /** Registry app name — a key of `defineIslandWorker({ apps })`. */
  app: string;
  /**
   * How to reach the worker — either a bundler-detectable factory
   * `() => new Worker(new URL('./x.worker.ts', import.meta.url))` (the
   * common case) or a pre-connected `IslandClient`. Exactly one is required.
   */
  worker?: (() => Worker) | URL;
  client?: IslandClient;
  /** Extra pool options — concurrency, taskTimeout, respawn… (poolSize stays 1). */
  workerOptions?: IslandWorkerOptions;
  /** Initial + updated root props — serialized to the worker. */
  props?: Record<string, unknown>;
  /** Island → shell channel: every `emit` op lands here. */
  onEvent?: (name: string, payload: unknown) => void;
  /**
   * Transclusion slots — a worker `<div data-mesh-slot="name">` hands its
   * real element to `slots[name](el)` (and `null` on removal). Looked up
   * per call, so keys may be added or replaced between renders.
   */
  slots?: Record<string, (el: HTMLElement | null) => void>;
  /** Fired after each applied op batch — stats hooks. */
  onActivity?: () => void;
  /** The mounted handle (pid, updateProps, flush, setMode…) once ready. */
  onReady?: (island: IslandHandle) => void;
  /** Mount/update errors surface here instead of an unhandled rejection. */
  onError?: (err: unknown) => void;
}

export const Island = forwardRef<HTMLDivElement, IslandProps>(function Island(
  {
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
    ...rest
  },
  forwardedRef: Ref<HTMLDivElement>,
): ReactElement {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const islandRef = useRef<IslandHandle | null>(null);

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
    if (typeof forwardedRef === 'function') forwardedRef(el);
    else if (forwardedRef !== null) forwardedRef.current = el;
  };

  // mount effect — app/worker/client identity is intentionally NOT tracked:
  // those are mount-stable (remount via `key`). The effect re-runs only when
  // the element itself changes, which React never does for a mounted div.
  useEffect(() => {
    const el = containerRef.current;
    if (el === null) return;
    let cancelled = false;
    let island: IslandHandle | null = null;
    const report = (err: unknown): void => {
      if (onErrorRef.current !== undefined) onErrorRef.current(err);
      else console.error('[Island] mount failed:', err);
    };

    const client =
      clientProp ??
      (worker !== undefined ? connectIslandWorker({ worker, ...workerOptions }) : undefined);
    if (client === undefined) {
      report(new Error('<Island> requires either `worker` or `client`'));
      return;
    }

    // Slot lookup delegates to the latest map — a proxy so newly added keys
    // resolve too; the driver only ever reads `slots[name]`.
    const slotProxy =
      slotsRef.current === undefined
        ? undefined
        : (new Proxy(
            {},
            { get: (_t, name) => (e: HTMLElement | null) => slotsRef.current?.[name as string]?.(e) },
          ) as Record<string, (el: HTMLElement | null) => void>);

    void (async () => {
      try {
        const handle = await mountIsland({
          client,
          el,
          app,
          props: propsRef.current ?? {},
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
  }, [app, clientProp]);

  // props → updateProps, deduped by wire-serialized identity (the same bytes
  // produce the same render — a repeat send would be a wasted round-trip).
  const propsJson = JSON.stringify(props ?? {});
  useEffect(() => {
    const island = islandRef.current;
    if (island === null) return; // mount picks up propsRef.current
    island.updateProps(props ?? {}).catch((err) => {
      if (onErrorRef.current !== undefined) onErrorRef.current(err);
      else console.error('[Island] updateProps failed:', err);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [propsJson]);

  return <div ref={setRefs} {...rest} />;
});

export default Island;
