/**
 * Ops console worker: a second PolyWorker definition on the React shell,
 * built to show that a definition is a menu of apps, not a thread, and
 * that render workers and compute workers are different jobs. The shell
 * spawns it in three shapes (see shell.tsx):
 *
 *   - Row A: 'pulse' + 'export' on ONE shared client, export computed
 *     INLINE. The synchronous aggregation freezes the pulse beside it:
 *     the anti-pattern, kept so the stall is visible.
 *   - Row B: the same two apps on another shared client, export offloaded
 *     to a compute worker (`workers: 1`). Still one render worker, and
 *     the pulse never stalls.
 *   - Row C: 'regions' on its own worker. It renders region.worker.tsx
 *     sub-islands on ONE shared sub-client and runs their work on compute
 *     workers: a 3-worker pool for recomputes, one worker for the model.
 *
 * Every worker spawned from this definition shares the bundle (React, the
 * opsKit helpers) but evaluates its own copy: shared deps, isolated state.
 */
import { useEffect, useState } from 'react';
import { connectSubWorker } from '@atolljs/core';
import {
  connectIslandWorker,
  defineReactPolyWorker,
  emit,
  Island,
} from '@atolljs/react-island/worker';
import { getActiveInstance, islandApp } from '@atolljs/islands/worker';
import { aggregate, handler, isolated, reenter, useHeartbeat, type AggregateResult } from './opsKit';
import type { ComputeWorker } from './compute.worker';

/**
 * The compute entry. The `new Worker(new URL(...))` literal stays inline
 * in this factory so vite detects it inside the worker bundle too.
 */
const computeEntry = (): Worker =>
  new Worker(new URL('./compute.worker.ts', import.meta.url), { type: 'module' });

/** Row B's export lane: one compute worker, no pool. Lazy: spawns on the first offloaded export. */
const exportLane = connectSubWorker<ComputeWorker>({ name: 'export-lane', worker: computeEntry, workers: 1 });

/** 'pulse' — live telemetry: a heartbeat that reports its worst stall. */
const PulseApp = islandApp('pulse', function PulseApp({
  label = 'telemetry',
}: {
  label?: string;
}) {
  const { beats, worstStall, reset } = useHeartbeat();
  return (
    <div className="ops-card ops-pulse">
      <div className="ops-card-title">{label} pulse</div>
      <div className="ops-beat">
        <span className={`ops-dot ${beats % 2 ? 'on' : ''}`} /> live · ticks {beats}
      </div>
      <div className={`ops-stall ${worstStall ? 'hit' : ''}`}>longest stall {worstStall}ms</div>
      <button className="mw-btn" onClick={handler(reset)}>
        reset
      </button>
    </div>
  );
});

const summary = (r: AggregateResult) =>
  `${r.rows.toLocaleString()} rows · ${r.p1.toLocaleString()} P1 · ${Math.round(r.ms)}ms`;

/**
 * 'export' — a CPU-heavy report export (~1.2s). `offload: false` runs it
 * on this render worker's thread; `offload: true` sends it to the compute
 * lane and re-enters the instance when the reply lands.
 */
const ExportApp = islandApp('export', function ExportApp({
  label = 'report',
  budgetMs = 1200,
  offload = false,
}: {
  label?: string;
  budgetMs?: number;
  offload?: boolean;
}) {
  const [last, setLast] = useState('no export yet');
  const [busy, setBusy] = useState(false);
  const [instance] = useState(() => getActiveInstance()!);
  const done = (r: AggregateResult) => {
    setLast(summary(r));
    emit('exported', { label, ms: Math.round(r.ms), rows: r.rows, offloaded: offload });
  };
  return (
    <div className="ops-card ops-export">
      <div className="ops-card-title">{label} export</div>
      <div className="ops-result">{busy ? 'exporting on the compute worker…' : last}</div>
      <button
        className="mw-btn"
        disabled={busy}
        onClick={handler(() => {
          if (!offload) return done(aggregate(budgetMs));
          setBusy(true);
          exportLane.ops.exportReport(budgetMs).then(
            (r) => reenter(instance, () => { setBusy(false); done(r); }),
            (e: unknown) => reenter(instance, () => { setBusy(false); setLast(`export failed: ${String(e)}`); }),
          );
        })}
      >
        export report
      </button>
    </div>
  );
});

/** The nested render definition, same inline-literal rule as computeEntry. */
const regionEntry = (): Worker =>
  new Worker(new URL('./region.worker.tsx', import.meta.url), { type: 'module' });

const subMode = isolated ? 'push' : 'poll';
const SLA_MS = 900;
const MODEL_MS = 1500;
const POOL_SIZE = 3;

interface CardState {
  sla?: string;
  busy?: boolean;
}

/**
 * 'regions' — a regional workspace. Rendering and compute are split:
 *   - every region card AND the forecast panel mount on ONE shared
 *     sub-client (one region.worker, one React runtime);
 *   - recomputes run on a `workers: 3` compute pool (independent, so they
 *     overlap); the model runs on a `workers: 1` compute worker.
 * Cards emit a request, the host runs it, results come back as props.
 */
const RegionsApp = islandApp('regions', function RegionsApp({
  regions = ['us-east', 'eu-central', 'ap-south'],
}: {
  regions?: string[];
}) {
  const [cards] = useState(() => connectIslandWorker({ name: 'region-cards', worker: regionEntry, doorbell: isolated }));
  const [slaPool] = useState(() => connectSubWorker<ComputeWorker>({ name: 'sla', worker: computeEntry, workers: POOL_SIZE }));
  const [modelLane] = useState(() => connectSubWorker<ComputeWorker>({ name: 'model-lane', worker: computeEntry, workers: 1 }));
  const [instance] = useState(() => getActiveInstance()!);
  const [slas, setSlas] = useState<Record<string, CardState>>({});
  const [forecast, setForecast] = useState<{ result?: string; busy: boolean }>({ busy: false });
  const [report, setReport] = useState('no region recomputed yet');

  useEffect(
    () => () => {
      slaPool.terminate();
      modelLane.terminate();
    },
    [slaPool, modelLane],
  );

  const recompute = (list: string[]) => {
    const t0 = performance.now();
    setSlas((s) => ({ ...s, ...Object.fromEntries(list.map((r) => [r, { ...s[r], busy: true }])) }));
    Promise.all(
      list.map((region) =>
        slaPool.ops.sla(region, SLA_MS).then((r) => {
          reenter(instance, () =>
            setSlas((s) => ({
              ...s,
              [region]: { sla: `P1 ${r.p1.toLocaleString()} · mean ${r.meanDur.toFixed(1)}m`, busy: false },
            })),
          );
          return r;
        }),
      ),
    ).then(
      (results) => {
        const wallMs = Math.round(performance.now() - t0);
        const workMs = results.reduce((a, r) => a + Math.round(r.ms), 0);
        reenter(instance, () => {
          setReport(
            list.length === 1
              ? `${list[0]} recomputed in ${wallMs}ms on the compute pool`
              : `${list.length} regions in ${wallMs}ms wall, ${workMs}ms of work, across ${POOL_SIZE} pool workers`,
          );
          emit('regionRecomputed', { regions: list, wallMs, workMs });
        });
      },
      (e: unknown) =>
        reenter(instance, () => {
          setSlas((s) => ({ ...s, ...Object.fromEntries(list.map((r) => [r, { ...s[r], busy: false }])) }));
          setReport(`recompute failed: ${String(e)}`);
        }),
    );
  };

  const runModel = () => {
    setForecast((f) => ({ ...f, busy: true }));
    modelLane.ops.forecast(MODEL_MS).then(
      (r) =>
        reenter(instance, () => {
          setForecast({ busy: false, result: `scored ${r.rows.toLocaleString()} rows in ${Math.round(r.ms)}ms` });
          emit('forecasted', { ms: Math.round(r.ms), rows: r.rows });
        }),
      (e: unknown) => reenter(instance, () => setForecast({ busy: false, result: `model failed: ${String(e)}` })),
    );
  };

  return (
    <div className="ops-regions">
      <div className="ops-sub-head">
        render: {regions.length} region cards + the forecast panel, ONE shared sub-worker (region.worker)
      </div>
      <div className="ops-grid">
        {regions.map((region) => (
          <Island
            key={region}
            client={cards}
            app="region"
            props={{ region, ...slas[region] }}
            mode={subMode}
            framework="react"
            className="ops-sub"
            onEvent={(name) => {
              if (name === 'recompute') recompute([region]);
            }}
          />
        ))}
        <Island
          client={cards}
          app="forecast"
          props={forecast}
          mode={subMode}
          framework="react"
          className="ops-sub"
          onEvent={(name) => {
            if (name === 'runModel') runModel();
          }}
        />
      </div>
      <div className="ops-sub-head">
        compute: recomputes on a {POOL_SIZE}-worker pool (<code>workers: {POOL_SIZE}</code>), the model on one
        worker (<code>workers: 1</code>), compute.worker, no React
      </div>
      <button className="mw-btn ops-all" onClick={handler(() => recompute(regions))}>
        recompute all ({regions.length} in parallel)
      </button>
      <div className="vanilla-readout">{report}</div>
    </div>
  );
});

export const consoleWorker = defineReactPolyWorker({
  apps: { pulse: PulseApp, export: ExportApp, regions: RegionsApp },
});
