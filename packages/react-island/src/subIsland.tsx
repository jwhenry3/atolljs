/**
 * `SubIsland` — the original name for a nested mount, kept as an alias.
 * New code uses `Island` from `@atolljs/react-island/worker`, which is the
 * same component (and props) the page uses: inside a worker its container
 * is a proxy element, so `mountIsland` routes to the nested path.
 *
 *   const subWorker = () =>
 *     new Worker(new URL('./counter.worker.tsx', import.meta.url), { type: 'module' });
 *
 *   function Dashboard() {
 *     return <Island worker={subWorker} app="counter" props={{ label: 'nested' }} />;
 *   }
 *
 * `SubIsland` differs only in defaults: it tags devtools mounts as
 * `framework: 'react'` and stamps `data-atoll-sub-island` on its host div.
 */
import type { CSSProperties, ReactElement } from 'react';
import type { IslandClient, IslandHandle, Mode } from '@atolljs/islands/worker';
import { Island } from './index';

export interface SubIslandProps {
  /** Bundler-detectable sub-worker entry, evaluated INSIDE this worker. */
  worker?: (() => Worker) | URL;
  /** A shared `connectIslandWorker` client built inside this worker. */
  client?: IslandClient;
  /** Registry app name — a key of the sub-worker's `apps` map. */
  app?: string;
  /** Wire props for the sub-app's root — serializable data only. */
  props?: Record<string, unknown>;
  /** Sub-island emit channel — a plain worker-side call. */
  onEvent?: (name: string, payload: unknown) => void;
  /** Flush transport — 'push' (default) or 'poll'. */
  mode?: Mode;
  className?: string;
  style?: CSSProperties;
  /** Receives the mounted handle (pid, instance, updateProps, destroy). */
  onReady?: (handle: IslandHandle) => void;
}

export function SubIsland(props: SubIslandProps): ReactElement {
  return <Island framework="react" data-atoll-sub-island="" {...props} />;
}
