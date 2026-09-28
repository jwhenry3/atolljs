/**
 * Worker entry — owns the reconciler and exposes three task methods.
 *
 * Note what's NOT here: no sharedMemory on the defineWorker call. Every op
 * rides back through the pool's ordinary postMessage channel — shared memory
 * is opt-in in this sdk, and this example exists to prove the message-only
 * path is enough for a real React renderer.
 */

import { createElement } from 'react';
import Reconciler from 'react-reconciler';
import { defineWorker } from '@jwhenry123/mesh/sdk';
import { App } from './App';
import { getHandler, hostConfig, ROOT_CONTAINER, takeOps } from './hostConfig';
import type { EventPayload, Op } from '../ops';

const reconciler = Reconciler(hostConfig);

// Legacy root (tag 0) + an error surface — no concurrent features.
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

/**
 * Commit synchronously around `fn` and return the ops it produced.
 *
 * In 0.34, `updateContainer`/setState only *schedule* work — the actual
 * render+commit happens when the root scheduler task runs (a macrotask via
 * the `scheduler` package). `flushSyncFromReconciler` pins the update
 * priority to the discrete/sync lane for the duration of `fn` and flushes
 * pending sync work in its `finally`, so by the time it returns the
 * mutation hooks have run and the op queue is full.
 */
function syncCommit(fn: () => void): Op[] {
  reconciler.flushSyncFromReconciler(fn);
  reconciler.flushSyncWork();
  return takeOps();
}

export const renderWorker = defineWorker({
  methods: {
    /** Mount <App/> into the root container; returns the initial op batch. */
    mount(): Op[] {
      return syncCommit(() => {
        reconciler.updateContainer(createElement(App), container, null, null);
      });
    },

    /**
     * Run the prop function the main thread identified by handlerId —
     * `__evt` refs are handles into the worker's handler table. State
     * updates the handler triggers commit synchronously; their ops are the
     * return value.
     */
    dispatch(handlerId: number, payload: EventPayload): Op[] {
      const handler = getHandler(handlerId);
      if (handler === undefined) return takeOps();
      return syncCommit(() => {
        handler(payload);
      });
    },

    /**
     * Drain anything that committed outside a sync task — passive effects
     * (useEffect), timers, async setState. The pool protocol has no push
     * channel, so the main thread polls this.
     */
    flush(): Op[] {
      reconciler.flushPassiveEffects();
      reconciler.flushSyncWork();
      return takeOps();
    },
  },
});

export type RenderWorker = typeof renderWorker;
