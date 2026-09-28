/**
 * Worker entry — owns the reconcilers and exposes the island task methods.
 *
 * APP REGISTRY: every island's worker runs THIS same script. `mount(app,
 * props)` picks a component out of REGISTRY and reconciles it into that
 * app's own root ("realm"): its own reconciler, container, op queue, and
 * pid. In production each worker mounts exactly one app — one client,
 * poolSize 1, one tree. Multiple realms in one module only happen in the
 * in-process test, where every island shares the module graph.
 *
 * Wire signatures carry the app name (`updateProps(app, props)`,
 * `flush(app)`, `whoami(app)`) so a call can be routed to its realm — the
 * main-thread mountIsland helper binds it, so shell code just calls
 * `island.updateProps(props)`.
 *
 * Ops still ride back through the pool's ordinary postMessage channel — the
 * sharedMemory contract here is only the doorbell (see memory.ts): a commit
 * counter the main thread observe()s to trigger flush() as a push. Drop it
 * entirely and the example still works on the 50ms poll — that's the
 * message-only mode.
 */

import { createElement, type ReactElement } from 'react';
import Reconciler from 'react-reconciler';
import { defineWorker } from '@jwhenry123/mesh/sdk';
import { renderMemory } from '../memory';
import { ControlsApp, StatsApp, TableApp } from './apps';
import { getHandler, hostConfig, ROOT_CONTAINER, setActiveRealm, takeOps } from './hostConfig';
import type { EventPayload, Op } from '../ops';

/** The apps an island can mount — keyed by the name the shell passes to mount(). */
const REGISTRY: Record<string, (props: Record<string, unknown>) => ReactElement> = {
  controls: ControlsApp as (props: Record<string, unknown>) => ReactElement,
  'data-table': TableApp as (props: Record<string, unknown>) => ReactElement,
  stats: StatsApp as (props: Record<string, unknown>) => ReactElement,
};

interface Realm {
  app: string;
  /** Per-mount random id — shown in the island's badge as proof it's a
   *  distinct render realm (in production: a distinct worker). Stable across
   *  remounts of the same app. */
  pid: string;
  reconciler: ReturnType<typeof Reconciler>;
  container: unknown;
}

/** app name → mounted realm. Production workers hold exactly one entry. */
const realms = new Map<string, Realm>();

const newPid = (): string => `w-${Math.random().toString(36).slice(2, 8)}`;

// Legacy root (tag 0) — no concurrent features. Container creation is
// per-realm, not module-level, so a second mount() can't collide with the
// first realm's tree.
function createRealm(app: string, pid: string): Realm {
  const reconciler = Reconciler(hostConfig);
  const container = reconciler.createContainer(
    ROOT_CONTAINER,
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
  return { app, pid, reconciler, container };
}

/**
 * Commit synchronously around `fn` and return the ops it produced, scoped
 * to `realm`'s queue.
 *
 * In 0.34, `updateContainer`/setState only *schedule* work — the actual
 * render+commit happens when the root scheduler task runs (a macrotask via
 * the `scheduler` package). `flushSyncFromReconciler` pins the update
 * priority to the discrete/sync lane for the duration of `fn` and flushes
 * pending sync work in its `finally`, so by the time it returns the
 * mutation hooks have run and the realm's op queue is full.
 */
function syncCommit(realm: Realm, fn: () => void): Op[] {
  const prev = setActiveRealm(realm.app);
  try {
    realm.reconciler.flushSyncFromReconciler(fn);
    realm.reconciler.flushSyncWork();
    return takeOps(realm.app);
  } finally {
    setActiveRealm(prev);
  }
}

export const renderWorker = defineWorker({
  sharedMemory: renderMemory,
  methods: {
    /**
     * Mount REGISTRY[app] into its own root; returns the initial op batch.
     *
     * Mounting an app that is already mounted is a REMOUNT: the old tree is
     * unmounted first (a `clear` op + GC of its instance records), then a
     * fresh container renders the new tree — the returned batch replays
     * cleanly onto an emptied root. The pid is kept across remounts.
     */
    mount(app: string, props: Record<string, unknown> = {}): Op[] {
      const App = REGISTRY[app];
      if (App === undefined) {
        throw new Error(
          `mount: unknown app "${app}" — registry has: ${Object.keys(REGISTRY).join(', ')}`,
        );
      }

      let ops: Op[] = [];
      let realm = realms.get(app);
      if (realm !== undefined) {
        // Remount — unmount the existing tree so React detaches its
        // instances, then rebuild on a fresh container.
        const old = realm;
        ops = syncCommit(old, () => {
          old.reconciler.updateContainer(null, old.container, null, null);
        });
        realm = createRealm(app, old.pid);
      } else {
        realm = createRealm(app, newPid());
      }
      realms.set(app, realm);

      const mounted = realm;
      return ops.concat(
        syncCommit(mounted, () => {
          mounted.reconciler.updateContainer(createElement(App, props), mounted.container, null, null);
        }),
      );
    },

    /**
     * Re-render the app's root with new props — the shell→island channel.
     * `updateProps` is how the shell mediates between islands (controls
     * emits filterChanged → shell → table.updateProps({filter})).
     */
    updateProps(app: string, props: Record<string, unknown>): Op[] {
      const realm = realms.get(app);
      if (realm === undefined) {
        throw new Error(`updateProps: "${app}" is not mounted in this worker — mount() first`);
      }
      const App = REGISTRY[realm.app];
      return syncCommit(realm, () => {
        realm.reconciler.updateContainer(createElement(App, props), realm.container, null, null);
      });
    },

    /**
     * Run the prop function the main thread identified by handlerId —
     * `__evt` refs are handles into the worker's handler table. The entry
     * records which realm registered it, so the re-render's ops land on the
     * right island's queue.
     */
    dispatch(handlerId: number, payload: EventPayload): Op[] {
      const entry = getHandler(handlerId);
      if (entry === undefined) return [];
      const realm = realms.get(entry.realm);
      if (realm === undefined) return []; // stale handler — its tree was remounted
      return syncCommit(realm, () => {
        entry.fn(payload);
      });
    },

    /**
     * Drain one realm's ops committed outside a sync task — passive effects
     * (useEffect), timers, async setState. The pool protocol has no push
     * channel, so the main thread polls this (or the doorbell pushes it).
     */
    flush(app: string): Op[] {
      const realm = realms.get(app);
      if (realm === undefined) return [];
      const prev = setActiveRealm(app);
      try {
        realm.reconciler.flushPassiveEffects();
        realm.reconciler.flushSyncWork();
        return takeOps(app);
      } finally {
        setActiveRealm(prev);
      }
    },

    /** The mounted realm's random id — the island's "worker pid" badge. */
    whoami(app: string): string {
      return realms.get(app)?.pid ?? 'unmounted';
    },
  },
});

export type RenderWorker = typeof renderWorker;
