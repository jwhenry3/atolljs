/**
 * Real node:worker_threads fixture implementing the atoll wire protocol for
 * the incidents contract in plain JS — sibling of atollProtocol.worker.mjs.
 * INIT_MEMORY captures the shared buffer; EXECUTE_TASK dispatches the wire
 * ids that `defineWorker({ methods: { … } })` derives from the flat method
 * map — the method NAME is the taskId ('seedIncidents', 'computeMetrics',
 * 'queryIncidents'; no def.taskId overrides exist on the service units).
 * Used by the Next.js /api/incidents functional test — vitest can't bundle
 * the TS worker entry the way webpack/turbopack does.
 *
 * Buffer layout (contract-derived — packages/incidents/src/contract/
 * memory.contracts.ts; fields are packed in spec order on 8-byte alignment,
 * version block trails):
 *   lists.incidents       1,000,000 × 32B records            @ 0
 *   state.metrics         u32 written-flag + u32 aux + 8×f64 @ 32,000,000
 *   signals.seedProgress  f64                              @ 32,000,072
 *
 * Endianness mirrors the connector factories: `field.number()` reads through
 * a Float64Array (platform endianness), while the fixed-object record IO uses
 * DataView's big-endian default — so metrics writes go through DataView.
 * Plain `read()`s don't consult the version counters, so no Atomics bumps are
 * needed here; a reader would only need them for waitAsync observation.
 */
import { parentPort } from 'node:worker_threads';

const SEED_PROGRESS_F64 = 4_000_009; // byteOffset 32,000,072 / 8
const METRICS_FLAG_U32 = 8_000_000; // byteOffset 32,000,000 / 4
const METRICS_BASE_BYTE = 32_000_008; // flag(4) + aux(4), then 8 f64s

let f64;
let u32;
let view;

const writeMetrics = (m) => {
  const order = [
    'total',
    'open',
    'acknowledged',
    'resolved',
    'critical',
    'customersAffected',
    'avgDurationMin',
    'scanMs',
  ];
  order.forEach((k, i) => view.setFloat64(METRICS_BASE_BYTE + i * 8, m[k]));
  // Flag last — same mid-write guarantee the connector's own write() makes.
  u32[METRICS_FLAG_U32] = 1;
};

const handlers = {
  /**
   * 'seedIncidents' — the real task writes 1M records and bumps progress per
   * chunk; the fixture skips the records (an unseeded table reads as zeros)
   * and jumps straight to progress=100, returning elapsed ms like the real
   * task does.
   */
  seedIncidents: () => {
    const t0 = performance.now();
    f64[SEED_PROGRESS_F64] = 100;
    return performance.now() - t0;
  },

  /**
   * 'computeMetrics' — writes the aggregate snapshot the real task would
   * produce over the (zeroed, unseeded) table: every record reads as
   * status=0/severity=0, so all 1M count as open, none critical.
   */
  computeMetrics: () => {
    const t0 = performance.now();
    const metrics = {
      total: 1_000_000,
      open: 1_000_000,
      acknowledged: 0,
      resolved: 0,
      critical: 0,
      customersAffected: 0,
      avgDurationMin: 0,
      scanMs: performance.now() - t0,
    };
    writeMetrics(metrics);
    return metrics;
  },

  /** 'queryIncidents' — no rows seeded, so every query scans empty. */
  queryIncidents: () => ({
    rows: [],
    total: 1_000_000,
    filtered: 0,
    scanMs: 0,
    sortMs: 0,
  }),
};

parentPort.on('message', async (msg) => {
  if (msg.type === 'INIT_MEMORY') {
    f64 = new Float64Array(msg.memory.buffer);
    u32 = new Uint32Array(msg.memory.buffer);
    view = new DataView(msg.memory.buffer);
    return;
  }
  if (msg.type === 'EXECUTE_TASK') {
    try {
      const handler = handlers[msg.taskId];
      if (!handler) throw new Error(`Task handler not found for id: ${msg.taskId}`);
      const result = await handler(msg.args ?? []);
      parentPort.postMessage({ messageId: msg.messageId, success: true, result });
    } catch (err) {
      parentPort.postMessage({ messageId: msg.messageId, success: false, error: err.message });
    }
  }
});
