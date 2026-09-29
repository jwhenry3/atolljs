// One task's whole stack: method contract → worker impl. The result shape
// reuses metricsSchema — it already lives in the memory contract because it
// is also the `metrics` field's field schema.
import { scoped, serviceMethod } from '@atolljs/core';
import { incidentsMemory, metricsSchema, type Incident, type Metrics } from '../contract/memory.contracts';

const log = scoped('incidents');
const fmtInt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 0 });
const rec = {} as Incident;

/** ComputeMetrics — full-table aggregate scan; publishes to `metrics`. */
export const computeMetrics = serviceMethod({
  def: { resultSchema: metricsSchema },
  run(): Metrics {
    const t0 = performance.now();
    const conn = incidentsMemory.lists.incidents;
    const fields: (keyof Incident)[] = ['status', 'severity', 'customers', 'durationMin'];
    let open = 0;
    let acknowledged = 0;
    let resolved = 0;
    let critical = 0;
    let customersAffected = 0;
    let durationSum = 0;
    for (let i = 0; i < conn.recordCount; i++) {
      conn.readAt(i, rec, fields);
      if (rec.status === 0) open++;
      else if (rec.status === 1) acknowledged++;
      else resolved++;
      if (rec.severity === 3) critical++;
      customersAffected += rec.customers;
      durationSum += rec.durationMin;
    }
    const metrics = {
      total: conn.recordCount,
      open,
      acknowledged,
      resolved,
      critical,
      customersAffected,
      avgDurationMin: durationSum / conn.recordCount,
      scanMs: performance.now() - t0,
    };
    incidentsMemory.state.metrics.write(metrics);
    log.info(`metrics published: ${fmtInt(open + acknowledged + resolved)} incidents in ${metrics.scanMs.toFixed(1)}ms (${fmtInt(critical)} critical)`);
    return metrics;
  },
});
