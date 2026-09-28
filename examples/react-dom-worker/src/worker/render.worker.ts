/**
 * Worker entry — owns the reconcilers and exposes the island task methods.
 *
 * APP REGISTRY: every island's worker runs THIS same script. `mount(realm,
 * props)` picks a component out of REGISTRY and reconciles it into that
 * realm's own root: its own reconciler, container, op queue, and pid.
 * In production each worker mounts exactly one realm — one client,
 * poolSize 1, one tree. Multiple realms in one module only happen in the
 * in-process test, where every island shares the module graph.
 *
 * REALM KEYS are `app` or `app@instance` — the part before the last '@'
 * names the registry app, the rest distinguishes instances so the same
 * microfrontend can mount more than once (mountIsland mints a fresh key
 * per island). Wire signatures carry the realm key (`updateProps(realm,
 * props)`, `flush(realm)`, `whoami(realm)`) so a call routes to its realm —
 * the main-thread mountIsland helper binds it, so shell code just calls
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
  /** The wire key — 'app' or 'app@instance'; op queues route by this. */
  key: string;
  /** The registry name — which component this realm renders. */
  app: string;
  /** Per-realm random id — shown in the island's badge as proof it's a
   *  distinct render realm (in production: a distinct worker). Stable across
   *  remounts of the same realm key. */
  pid: string;
  reconciler: ReturnType<typeof Reconciler>;
  container: unknown;
}

/** realm key → mounted realm. Production workers hold exactly one entry. */
const realms = new Map<string, Realm>();

const newPid = (): string => `w-${Math.random().toString(36).slice(2, 8)}`;

/** 'controls' or 'data-table@7' → 'data-table' — registry name part of a realm key. */
const appNameOf = (realm: string): string => {
  const at = realm.lastIndexOf('@');
  return at === -1 ? realm : realm.slice(0, at);
};

// Legacy root (tag 0) — no concurrent features. Container creation is
// per-realm, not module-level, so a second mount() can't collide with the
// first realm's tree.
function createRealm(key: string, pid: string): Realm {
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
  return { key, app: appNameOf(key), pid, reconciler, container };
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
  const prev = setActiveRealm(realm.key);
  try {
    realm.reconciler.flushSyncFromReconciler(fn);
    realm.reconciler.flushSyncWork();
    return takeOps(realm.key);
  } finally {
    setActiveRealm(prev);
  }
}

export const renderWorker = defineWorker({
  sharedMemory: renderMemory,
  methods: {
    /**
     * Mount REGISTRY[appNameOf(realm)] into its own root; returns the
     * initial op batch. The realm key may carry an instance suffix
     * ('data-table@3') so the same app can mount multiple times.
     *
     * Mounting a realm key that is already mounted is a REMOUNT: the old
     * tree is unmounted first (a `clear` op + GC of its instance records),
     * then a fresh container renders the new tree — the returned batch
     * replays cleanly onto an emptied root. The pid is kept across remounts.
     */
    mount(realm: string, props: Record<string, unknown> = {}): Op[] {
      const App = REGISTRY[appNameOf(realm)];
      if (App === undefined) {
        throw new Error(
          `mount: unknown app "${realm}" — registry has: ${Object.keys(REGISTRY).join(', ')}`,
        );
      }

      let ops: Op[] = [];
      let mounted = realms.get(realm);
      if (mounted !== undefined) {
        // Remount — unmount the existing tree so React detaches its
        // instances, then rebuild on a fresh container.
        const old = mounted;
        ops = syncCommit(old, () => {
          old.reconciler.updateContainer(null, old.container, null, null);
        });
        mounted = createRealm(realm, old.pid);
      } else {
        mounted = createRealm(realm, newPid());
      }
      realms.set(realm, mounted);

      return ops.concat(
        syncCommit(mounted, () => {
          mounted.reconciler.updateContainer(createElement(App, props), mounted.container, null, null);
        }),
      );
    },

    /**
     * Re-render the realm's root with new props — the shell→island channel.
     * `updateProps` is how the shell mediates between islands (controls
     * emits filterChanged → shell → table.updateProps({filter})).
     */
    updateProps(realm: string, props: Record<string, unknown>): Op[] {
      const mounted = realms.get(realm);
      if (mounted === undefined) {
        throw new Error(`updateProps: "${realm}" is not mounted in this worker — mount() first`);
      }
      const App = REGISTRY[mounted.app];
      return syncCommit(mounted, () => {
        mounted.reconciler.updateContainer(createElement(App, props), mounted.container, null, null);
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
    flush(realm: string): Op[] {
      const mounted = realms.get(realm);
      if (mounted === undefined) return [];
      const prev = setActiveRealm(realm);
      try {
        mounted.reconciler.flushPassiveEffects();
        mounted.reconciler.flushSyncWork();
        return takeOps(realm);
      } finally {
        setActiveRealm(prev);
      }
    },

    /** The mounted realm's random id — the island's "worker pid" badge. */
    whoami(realm: string): string {
      return realms.get(realm)?.pid ?? 'unmounted';
    },
  },
});

export type RenderWorker = typeof renderWorker;
