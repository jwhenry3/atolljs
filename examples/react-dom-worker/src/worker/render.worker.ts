/**
 * Worker entry — the whole island runtime comes from the package; this file
 * only declares WHICH apps the registry holds. Every island's worker runs
 * this same script; `mount(realm, props)` picks an app by name and renders
 * it into the realm's own root (its own reconciler, op queue, and pid).
 *
 * Registry shapes: a React component (reconciled), or
 * `{ imperative: (doc, props) => void }` — realms with no React at all,
 * driven entirely through the worker-side proxy DOM.
 */
import { defineIslandWorker } from '@jwhenry123/mesh-worker-dom/worker';
import { ChartsApp, ControlsApp, StatsApp, TableApp } from './apps';
import { buildMap } from './map';
import { buildVanilla } from './vanilla';

export const renderWorker = defineIslandWorker({
  apps: {
    controls: ControlsApp,
    'data-table': TableApp,
    stats: StatsApp,
    charts: ChartsApp,
    vanilla: { imperative: buildVanilla },
    map: { imperative: buildMap },
  },
});

export type RenderWorker = typeof renderWorker;
