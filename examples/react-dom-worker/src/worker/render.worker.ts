/**
 * Registry worker — the multi-app topology: one script, four React apps.
 * `mount(instance, props)` picks a component out of `apps` and renders it into
 * the instance's own root (its own reconciler, op queue, and pid). Two islands
 * can even share ONE client to co-locate their mounts in a single worker —
 * the shell's two data-table islands do exactly that.
 *
 * Registry shape here: React components (reconciled). The two imperative
 * islands live in their own instance workers instead (map.worker.ts,
 * vanilla.worker.ts) — 1:1 scripts that ship zero React.
 */
import { definePolyWorker } from '@atolljs/islands/worker';
import { ChartsApp, ControlsApp, StatsApp, TableApp } from './apps';

// Every value is the islandApp-stamped definition — the shell can mount by
// component reference (lazyIsland) and a stamp/key drift warns here.
export const renderWorker = definePolyWorker({
  apps: {
    controls: ControlsApp,
    'data-table': TableApp,
    stats: StatsApp,
    charts: ChartsApp,
  },
});

export type RenderWorker = typeof renderWorker;
