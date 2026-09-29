/**
 * The React-runtime half of the island worker — `react`, `react-reconciler`
 * and the host config live HERE so a worker bundle whose registry holds only
 * non-React apps (Vue/Svelte/Solid/Angular/imperative) never pulls the
 * reconciler in. `defineIslandWorker` reaches this module only through
 * `await import('./reactRealm')` when a mounted app resolves to a component
 * function — first mount of a React realm pays one microtask's worth of
 * module init, everything after is the same sync path.
 */
import { createElement, type ReactElement } from 'react';
import Reconciler from 'react-reconciler';
import { hostConfig } from './hostConfig';
import { ROOT_CONTAINER } from './realm';

/**
 * A mounted React realm — carries its own reconciler + container and the
 * `render`/`unmountTree` verbs, so the runtime module never needs the
 * `react` import itself (element creation is the only place it was used).
 */
export interface ReactRealm {
  /** The wire key — 'app' or 'app@instance'; op queues route by this. */
  key: string;
  /** The registry name — which component this realm renders. */
  app: string;
  /** Per-realm random id — the island's "worker pid" badge. */
  pid: string;
  imperative?: undefined;
  rendered?: undefined;
  reconciler: ReturnType<typeof Reconciler>;
  container: unknown;
  /** Mount/re-render the component into this realm's container. */
  render(App: (props: Record<string, unknown>) => ReactElement, props: Record<string, unknown>): void;
  /** Unmount the tree — emits the detach ops the driver replays. */
  unmountTree(): void;
  /** Passive effects + pending sync work — the `flush` task's React branch. */
  flush(): void;
}

/**
 * Legacy root (tag 0) — no concurrent features. Container creation is
 * per-realm, not module-level, so a second mount() can't collide with the
 * first realm's tree.
 */
export function createReactRealm(key: string, app: string, pid: string): ReactRealm {
  const reconciler = Reconciler(hostConfig);
  const container = reconciler.createContainer(
    // Realm-stamped root container — createInstance reads `.realm` off it,
    // binding every element to this realm even in out-of-task commits.
    { id: 0, realm: key } as typeof ROOT_CONTAINER,
    0,
    null,
    false,
    null,
    '',
    console.error, // onUncaughtError
    console.error, // onCaughtError
    console.error, // onRecoverableError
    null, // onDefaultTransitionIndicator
  );
  return {
    key,
    app,
    pid,
    reconciler,
    container,
    render: (App, props) =>
      reconciler.updateContainer(createElement(App, props), container, null, null),
    unmountTree: () => reconciler.updateContainer(null, container, null, null),
    flush: () => {
      reconciler.flushPassiveEffects();
      reconciler.flushSyncWork();
    },
  };
}
