/**
 * `SubIsland` — mounts a nested island (a REAL sub-worker running a normal
 * `definePolyWorker`/`defineMonoWorker` entry) inside a worker-rendered
 * React tree:
 *
 *   // inside a component registered in the PARENT worker's registry —
 *   // this module lands in the parent worker's bundle, so the `new Worker`
 *   // literal stays bundler-detectable (vite rewrites it recursively).
 *   const subWorker = () =>
 *     new Worker(new URL('./counter.worker.tsx', import.meta.url), { type: 'module' });
 *
 *   function Dashboard() {
 *     return <SubIsland worker={subWorker} app="counter" props={{ label: 'nested' }} />;
 *   }
 *
 * The component renders a `<div>` inside the parent island; on ref it hands
 * the proxy element to `mountIsland`, which replays the sub-worker's ops
 * into the parent instance's shadow tree — the inner DOM tunnels upward
 * through the parent's own op stream and lands on the page inside this div.
 *
 * Lifecycle: mounts once on the first ref callback (async — the handshake
 * has to spawn a worker); `props`/`propsProp` changes flow through
 * `handle.updateProps`; unmount destroys the sub-island (its owned
 * sub-worker terminates; a shared `client` stays alive for siblings).
 * `worker`/`client`/`app` are mount-identity — swap them via React `key`,
 * not in-place.
 */
import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactElement } from 'react';
import { mountIsland } from '@atolljs/islands/worker';
import type {
  IslandClient,
  IslandHandle,
  Mode,
  MountIslandOptions,
} from '@atolljs/islands/worker';
import type { ProxyElement } from '@atolljs/islands/worker';

export interface SubIslandProps {
  /**
   * Bundler-detectable sub-worker entry — a `() => new Worker(new URL(...))`
   * factory (or URL) evaluated INSIDE this worker. Mutually exclusive with
   * `client`.
   */
  worker?: (() => Worker) | URL;
  /**
   * A shared `connectIslandWorker` client built inside this worker —
   * several `<SubIsland client={c}/>` instances share ONE sub-worker
   * (multi-island-per-worker, same as the main side).
   */
  client?: IslandClient;
  /** Registry app name — a key of the sub-worker's `apps` map. */
  app?: string;
  /** Wire props for the sub-app's root — serializable data only. */
  props?: Record<string, unknown>;
  /**
   * Sub-island emit channel — every `emit(name, payload)` the sub-app
   * produces arrives here as a plain worker-side call (no marshalling —
   * this function never leaves the worker).
   */
  onEvent?: (name: string, payload: unknown) => void;
  /** Flush transport — 'push' via the sub-pool's doorbell buffer (default) or 'poll'. */
  mode?: Mode;
  /** className/style for the host `<div>` the sub-island renders inside. */
  className?: string;
  style?: CSSProperties;
  /** Receives the mounted handle (pid, instance, updateProps, destroy). */
  onReady?: (handle: IslandHandle) => void;
}

export function SubIsland({
  worker,
  client,
  app,
  props,
  onEvent,
  mode,
  className,
  style,
  onReady,
}: SubIslandProps): ReactElement {
  // The proxy element the sub-island replays into — set by the ref callback.
  const hostEl = useRef<ProxyElement | null>(null);
  const handleRef = useRef<IslandHandle | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  // onReady/onEvent are caller callbacks — keep them current so a handler
  // re-identity doesn't re-trigger the mount effect. Same for worker/client
  // — an inline `worker={() => new Worker(...)}` changes identity each
  // render but means "the same entry"; the factory only ever runs once.
  const cb = useRef({ onEvent, onReady, worker, client });
  cb.current = { onEvent, onReady, worker, client };

  useEffect(() => {
    const el = hostEl.current;
    if (el === null) return;
    let cancelled = false;
    void mountIsland({
      el,
      worker: cb.current.worker,
      client: cb.current.client,
      app,
      props,
      mode,
      framework: 'react',
      onEvent: (name, payload) => cb.current.onEvent?.(name, payload),
    } as MountIslandOptions).then(
      (h) => {
        if (cancelled) {
          h.destroy();
          return;
        }
        handleRef.current = h;
        cb.current.onReady?.(h);
      },
      (err: unknown) => {
        if (!cancelled) setFailed(err instanceof Error ? err.message : String(err));
      },
    );
    return () => {
      cancelled = true;
      handleRef.current?.destroy();
      handleRef.current = null;
    };
    // Mount identity is (app, mode) — swapping the worker entry needs a
    // React `key` remount (documented), not an in-place worker swap.
  }, [app, mode]);

  // Props flow through updateProps — the sub-app diffs; the host div's own
  // props are unrelated React state.
  const propsJson = JSON.stringify(props ?? {});
  const prevJson = useRef(propsJson);
  useEffect(() => {
    if (prevJson.current === propsJson) return;
    prevJson.current = propsJson;
    void handleRef.current?.updateProps(props ?? {});
  }, [propsJson, props]);

  return (
    <div
      className={className}
      style={style}
      data-atoll-sub-island=""
      ref={(el) => {
        hostEl.current = el as unknown as ProxyElement;
      }}
    >
      {failed !== null ? <div data-atoll-sub-island-error="">{failed}</div> : null}
    </div>
  );
}
