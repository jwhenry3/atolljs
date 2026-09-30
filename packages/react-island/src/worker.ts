/**
 * `@atolljs/react-island/worker` — the worker-side half of React
 * islands: `reactIslandApp(Component)` wraps a React component as a islands
 * `RenderedIslandApp`, so it can sit in a `definePolyWorker` `apps`
 * registry beside Vue/Svelte/Solid/Angular and imperative apps:
 *
 *   // render.worker.ts — React-only registry
 *   import { defineReactPolyWorker } from '@atolljs/react-island/worker';
 *   export const renderWorker = defineReactPolyWorker({
 *     apps: { controls: ControlsApp, charts: ChartsApp },
 *   });
 *
 *   // one-app worker
 *   import { defineReactMonoWorker } from '@atolljs/react-island/worker';
 *   export const worker = defineReactMonoWorker(ChartsApp);
 *
 *   // mixed-framework registry — compose the adapters directly
 *   import { definePolyWorker } from '@atolljs/islands/worker';
 *   import { reactIslandApp } from '@atolljs/react-island/worker';
 *   export const renderWorker = definePolyWorker({ apps: {
 *     charts: reactIslandApp(ChartsApp),
 *     badge: vueIslandApp(VueBadge),
 *   }});
 *
 * The reconciler + host config live in `reactInstance.ts`/`hostConfig.ts`:
 * importing THIS module is what pulls `react` + `react-reconciler` into a
 * worker bundle (once, shared across every React app in the registry).
 * `@atolljs/islands/worker` itself stays framework-neutral — non-React
 * registries never see this code.
 */
import { createElement, type ComponentType } from 'react';
import type { SharedMemory, WorkerDefinition } from '@atolljs/core';
import {
  defineMonoWorker,
  definePolyWorker,
  islandApp,
  islandAppNameOf,
} from '@atolljs/islands/worker';
import type {
  DoorbellSpec,
  ImperativeIslandApp,
  IslandWorkerMethods,
  RenderContext,
  RenderedHandle,
  RenderedIslandApp,
} from '@atolljs/islands/worker';
import { createReactInstance } from './reactInstance';

// Worker entries shouldn't need a second package specifier for the
// island→shell channel — `import { emit } from '@atolljs/react-island/worker'`.
export { emit, runInInstance } from '@atolljs/islands/worker';
export { Slot } from './slot';

type AnyComponent = ComponentType<Record<string, unknown>>;

/**
 * Wrap a React component as a `RenderedIslandApp` — `mount` creates the
 * instance's reconciler + container and renders the initial tree inside the
 * sync lane; `update` re-renders with new props (the reconciler diffs, only
 * changed ops emit); `sync` is the dispatch-time commit pin; `dispose`
 * schedules the unmount; `flush` drains passive effects + pending sync work
 * for the `flush` task.
 *
 * A stamped component (`islandApp('name', Comp)`) keeps its stamp through
 * the wrap, so registry warn-checks and `defineMonoWorker` name resolution
 * still see the shell-facing name.
 */
export function reactIslandApp(App: AnyComponent): RenderedIslandApp {
  const app: RenderedIslandApp = {
    mount({ instance, props }: RenderContext): RenderedHandle {
      const react = createReactInstance(instance);
      const render = (next: Record<string, unknown>): void =>
        react.sync(() => react.render(createElement(App, next)));
      render(props);
      return {
        update: render,
        sync: (fn) => react.sync(fn),
        dispose: () => react.sync(() => react.unmountTree()),
        flush: () => react.flush(),
      };
    },
  };
  const stamp = islandAppNameOf(App);
  if (stamp !== undefined) (app as { islandAppName?: string }).islandAppName = stamp;
  return app;
}

/** Stamp + wrap in one step — `reactIsland('charts', ChartsApp)` yields the
 *  registry value AND the name the shell mounts by. */
export const reactIsland = (
  name: string,
  App: AnyComponent,
): RenderedIslandApp & { readonly islandAppName: string } =>
  islandApp(name, reactIslandApp(App));

export interface ReactPolyWorkerRegistry {
  /**
   * Name → React component (or `{ imperative }` app) registry, mirroring
   * `definePolyWorker({ apps })`. Components pass through `reactIslandApp`;
   * imperative defs and already-wrapped apps (e.g. `reactIsland()` results)
   * register as-is.
   */
  apps: Record<string, AnyComponent | ImperativeIslandApp | RenderedIslandApp>;
  /** Doorbell contract override — forwarded to `definePolyWorker`. */
  sharedMemory?: SharedMemory<DoorbellSpec>;
}

/**
 * `definePolyWorker` for React apps — maps each component in the registry
 * through `reactIslandApp` and delegates. One worker, many React islands;
 * for a mixed-framework registry call `definePolyWorker` with the per-app
 * adapters instead.
 */
export function defineReactPolyWorker(
  registry: ReactPolyWorkerRegistry,
  options?: { sharedMemory?: SharedMemory<DoorbellSpec> },
): WorkerDefinition<DoorbellSpec, IslandWorkerMethods> {
  const apps: Record<string, RenderedIslandApp | ImperativeIslandApp> = {};
  for (const [key, app] of Object.entries(registry.apps)) {
    apps[key] = typeof app === 'function' ? reactIslandApp(app) : app;
  }
  return definePolyWorker({
    apps,
    sharedMemory: registry.sharedMemory ?? options?.sharedMemory,
  });
}

/**
 * `defineMonoWorker` for React apps — one worker pinned to a single
 * component (or `{ imperative }` app), the isolated-bundle host shape.
 */
export function defineReactMonoWorker(
  app: AnyComponent | ImperativeIslandApp | RenderedIslandApp,
  options?: { sharedMemory?: SharedMemory<DoorbellSpec> },
): WorkerDefinition<DoorbellSpec, IslandWorkerMethods> {
  return typeof app === 'function'
    ? defineMonoWorker(reactIslandApp(app), options)
    : defineMonoWorker(app, options);
}
