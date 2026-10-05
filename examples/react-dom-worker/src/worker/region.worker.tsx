/**
 * Region worker: the NESTED PolyWorker of the ops console. It is spawned
 * from inside console.worker.tsx's 'regions' app, never by the page:
 *
 *   main thread shell ──▶ console.worker ('regions') ──▶ region.worker (this)
 *                                                    └─▶ compute.worker ×3 (pool)
 *                                                    └─▶ compute.worker ×1
 *
 * Both apps here are RENDER-ONLY: every card and the forecast panel mount
 * on ONE shared sub-client (one sub-worker, one React runtime). Buttons
 * emit a request; the host runs the work on compute workers and passes
 * the result back as props, so a recompute never stalls a card.
 */
import { defineReactPolyWorker, emit } from '@atolljs/react-island/worker';
import { islandApp } from '@atolljs/islands/worker';
import { handler, useHeartbeat } from './opsKit';

/** 'region' — a live per-region SLA card; the host computes the SLA. */
const RegionCardApp = islandApp('region', function RegionCardApp({
  region = 'us-east',
  sla = 'not computed',
  busy = false,
}: {
  region?: string;
  sla?: string;
  busy?: boolean;
}) {
  const { beats, worstStall } = useHeartbeat();
  return (
    <div className="ops-card ops-region">
      <div className="ops-card-title">{region}</div>
      <div className="ops-beat">
        <span className={`ops-dot ${beats % 2 ? 'on' : ''}`} /> live · ticks {beats}
      </div>
      <div className={`ops-stall ${worstStall ? 'hit' : ''}`}>longest stall {worstStall}ms</div>
      <div className="ops-result">{busy ? 'computing on the pool…' : sla}</div>
      <button className="mw-btn" disabled={busy} onClick={handler(() => emit('recompute', { region }))}>
        recompute SLA
      </button>
    </div>
  );
});

/** 'forecast' — the capacity model's panel; the model runs on its own compute worker. */
const ForecastApp = islandApp('forecast', function ForecastApp({
  result = 'model idle',
  busy = false,
}: {
  result?: string;
  busy?: boolean;
}) {
  const { beats, worstStall } = useHeartbeat();
  return (
    <div className="ops-card ops-forecast">
      <div className="ops-card-title">capacity forecast</div>
      <div className="ops-beat">
        <span className={`ops-dot ${beats % 2 ? 'on' : ''}`} /> live · ticks {beats}
      </div>
      <div className={`ops-stall ${worstStall ? 'hit' : ''}`}>longest stall {worstStall}ms</div>
      <div className="ops-result">{busy ? 'scoring on the compute worker…' : result}</div>
      <button className="mw-btn" disabled={busy} onClick={handler(() => emit('runModel', {}))}>
        run model
      </button>
    </div>
  );
});

export const regionWorker = defineReactPolyWorker({
  apps: { region: RegionCardApp, forecast: ForecastApp },
});
