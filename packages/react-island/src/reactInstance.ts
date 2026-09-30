/// <reference path="./react-reconciler.d.ts" />
/**
 * The React-runtime half of a React island — `react`, `react-reconciler`
 * and the host config live HERE so a worker bundle whose registry holds only
 * non-React apps (Vue/Svelte/Solid/Angular/imperative) never pulls the
 * reconciler in. `@atolljs/react-island/worker` reaches this module through
 * `reactIslandApp`'s mount, inside the RenderedIslandApp contract.
 */
import type { ReactElement } from 'react';
import Reconciler from 'react-reconciler';
import { hostConfig } from './hostConfig';
import type { RootContainer } from '@atolljs/islands/worker';

/**
 * A mounted React tree — carries its own reconciler + container and the
 * `render`/`unmountTree`/`flush` verbs the adapter maps onto the
 * RenderedHandle contract. Identity (key/app/pid) lives on the core
 * Instance — this object is only the renderer half.
 */
export interface ReactInstance {
  reconciler: ReturnType<typeof Reconciler>;
  container: unknown;
  /**
   * Commit synchronously around `fn`.
   *
   * In 0.34, `updateContainer`/setState only *schedule* work — the actual
   * render+commit happens when the root scheduler task runs (a macrotask via
   * the `scheduler` package). `flushSyncFromReconciler` pins the update
   * priority to the discrete/sync lane for the duration of `fn` and
   * `flushSyncWork` flushes pending sync work, so by the time it returns the
   * mutation hooks have run and the instance's op queue is full.
   */
  sync(fn: () => void): void;
  /** Schedule a mount/re-render of `el` — call inside `sync`. */
  render(el: ReactElement): void;
  /** Schedule the detach — emits the remove ops; call inside `sync`. */
  unmountTree(): void;
  /** Passive effects + pending sync work — the `flush` task's React branch. */
  flush(): void;
}

/**
 * Legacy root (tag 0) — no concurrent features. Container creation is
 * per-instance, not module-level, so a second mount() can't collide with the
 * first instance's tree.
 */
export function createReactInstance(instance: string): ReactInstance {
  const reconciler = Reconciler(hostConfig);
  const container = reconciler.createContainer(
    // Instance-stamped root container — createInstance reads `.instance` off it,
    // binding every element to this instance even in out-of-task commits.
    { id: 0, instance } as RootContainer,
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
    reconciler,
    container,
    sync: (fn) => {
      reconciler.flushSyncFromReconciler(fn);
      reconciler.flushSyncWork();
    },
    render: (el) => reconciler.updateContainer(el, container, null, null),
    unmountTree: () => reconciler.updateContainer(null, container, null, null),
    flush: () => {
      reconciler.flushPassiveEffects();
      reconciler.flushSyncWork();
    },
  };
}
