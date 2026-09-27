import { createEffect, createRoot } from 'solid-js';
import fastJsonStringify from 'fast-json-stringify';
import { WorkerPool, jsonCodec, msgpackCodec, msgpackrCodec, reactive, type Codec, type Logger } from '../../sdk/index';
import { benchmarkTasks } from './task.contracts';
import { CATEGORIES, benchMemory, orderArraySchema, type OrderRecord } from './memory.contracts';

const fmtInt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 0 });
const fmtMB = (bytes: number) => `${(bytes / 1e6).toLocaleString(undefined, { maximumFractionDigits: 1 })}MB`;
const ops = (n: number, ms: number) => `${fmtInt(n / (ms / 1000))} ops/sec`;

// Schema-compiled JSON stringify (fast-json-stringify) — encode only,
// decode still falls back to JSON.parse.
const orderJsonSchema = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      id: { type: 'number' },
      sku: { type: 'string' },
      category: { type: 'string' },
      price: { type: 'number' },
      quantity: { type: 'number' },
      active: { type: 'boolean' },
    },
  },
} as const;
const stringifyOrders = fastJsonStringify(orderJsonSchema);
const fastJsonCodec: Codec = {
  encode: (v) => new TextEncoder().encode(stringifyOrders(v as OrderRecord[])),
  decode: (b) => JSON.parse(new TextDecoder().decode(b)),
};

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export async function runBenchmark(log: Logger = console.log) {
  const workerUrl = new URL('./benchmark.worker.ts', import.meta.url);
  const pool = new WorkerPool({ workerUrl, sharedMemory: benchMemory, poolSize: 4, tasks: benchmarkTasks });

  // Phase 1 — task dispatch round-trips (postMessage + registry + schema overhead)
  const TASKS = 500;
  let t0 = performance.now();
  await Promise.all(Array.from({ length: TASKS }, () => pool.noop()));
  let ms = performance.now() - t0;
  log(`task dispatch      : ${fmtInt(TASKS)} tasks in ${ms.toFixed(1)}ms (${ops(TASKS, ms)})`);

  // Phase 2 — worker blasts connector writes while main observes reactively
  const checksum = reactive(benchMemory.checksum);
  const stopObserving = checksum.observeRemote();
  let notifications = -1; // subtract the effect's initial run
  const dispose = createRoot((d) => {
    createEffect(() => { checksum.get(); notifications++; });
    return d;
  });

  const WRITES = 200_000;
  ms = await pool.blastConnectorWrites(WRITES);
  log(`remote writes      : ${fmtInt(WRITES)} connector writes in ${ms.toFixed(1)}ms (${ops(WRITES, ms)})`);
  await new Promise((r) => setTimeout(r, 50)); // let the notification loop drain
  const pct = ((notifications / WRITES) * 100).toFixed(1);
  log(`remote notify      : ${fmtInt(notifications)} reactive updates delivered (${pct}% — bursts coalesce to latest)`);

  // Phase 3 — zero-copy typed-array writes (baseline, no connector machinery)
  const VIEW_WRITES = 2_000_000;
  ms = await pool.blastViewWrites(VIEW_WRITES);
  log(`zero-copy writes   : ${fmtInt(VIEW_WRITES)} view writes in ${ms.toFixed(1)}ms (${ops(VIEW_WRITES, ms)})`);

  // Phase 4 — structured writes: zod validation + msgpack encode + store per write
  const OBJ_WRITES = 10_000;
  ms = await pool.blastObjectWrites(OBJ_WRITES);
  log(`structured writes  : ${fmtInt(OBJ_WRITES)} object writes in ${ms.toFixed(1)}ms (${ops(OBJ_WRITES, ms)})`);

  // Phase 5 — codec bake-off on the main thread
  const payload = { seq: 1, values: [1, 2.5, 3.5], label: 'batch-42' };
  const CODEC_OPS = 20_000;
  for (const [name, codec] of [['json', jsonCodec], ['msgpack', msgpackCodec], ['msgpackr', msgpackrCodec]] as const) {
    t0 = performance.now();
    for (let i = 0; i < CODEC_OPS; i++) codec.decode(codec.encode(payload));
    ms = performance.now() - t0;
    log(`codec ${name.padEnd(7)}: ${ops(CODEC_OPS, ms)} round-trips (${fmtInt(codec.encode(payload).byteLength)}B payload)`);
  }

  // Phase 6 — same connector-write loop on the main thread for comparison
  const LOCAL_WRITES = 200_000;
  t0 = performance.now();
  for (let i = 0; i < LOCAL_WRITES; i++) benchMemory.checksum.write(i);
  ms = performance.now() - t0;
  log(`local writes       : ${fmtInt(LOCAL_WRITES)} connector writes in ${ms.toFixed(1)}ms (${ops(LOCAL_WRITES, ms)})`);

  // Phase 7 — large structured dataset round-trip: fake records → shared
  // memory → worker aggregates → publishes stats → main reacts
  const N = 2_000_000;
  const rand = mulberry32(42);
  const records: OrderRecord[] = Array.from({ length: N }, (_, i) => ({
    id: i,
    sku: `SKU-${10000 + ((rand() * 90000) | 0)}`,
    category: CATEGORIES[(rand() * CATEGORIES.length) | 0],
    price: Math.round(rand() * 50000) / 100,
    quantity: 1 + ((rand() * 20) | 0),
    active: rand() > 0.2,
  }));
  // Attribute the persist cost: schema validate, codec encode, then the
  // bundled connector write (which re-validates + encodes + copies)
  t0 = performance.now();
  const validated = orderArraySchema.parse(records);
  const validateMs = performance.now() - t0;
  t0 = performance.now();
  const packed = msgpackrCodec.encode(validated); // same codec the contract write() uses
  const encodeMs = performance.now() - t0;
  t0 = performance.now();
  benchMemory.records.write(records);
  const writeMs = performance.now() - t0;
  log(`dataset persist    : validate ${validateMs.toFixed(1)}ms + encode ${encodeMs.toFixed(1)}ms + write ${writeMs.toFixed(1)}ms — ${fmtInt(N)} records, ${fmtMB(packed.byteLength)}`);

  const analysis = reactive(benchMemory.analysis);
  const stopAnalysis = analysis.observeRemote();
  let notifiedAt = 0;
  const disposeAnalysis = createRoot((d) => {
    createEffect(() => {
      if (analysis.get()) notifiedAt = performance.now();
    });
    return d;
  });

  const taskStart = performance.now();
  const stats = await pool.analyzeDataset(N);
  const resolvedAt = performance.now();
  const taskMs = resolvedAt - taskStart;
  log(`worker analyze     : decode ~${stats.decodeMs.toFixed(1)}ms + validate ${stats.validateMs.toFixed(1)}ms + aggregate ${stats.scanMs.toFixed(1)}ms (task round-trip ${taskMs.toFixed(1)}ms)`);
  await new Promise((r) => setTimeout(r, 30)); // let the notification drain
  const lag = notifiedAt ? `${(notifiedAt - resolvedAt).toFixed(1)}ms` : 'not delivered';
  log(`result propagate   : reactive update landed ${lag} relative to task resolution`);
  const viaMemory = analysis.peek();
  log(`stats              : $${fmtInt(stats.revenue)} revenue, ${fmtInt(stats.activeCount)}/${fmtInt(stats.count)} active, ${fmtInt(Object.keys(stats.byCategory).length)} categories — channels agree: ${viaMemory.revenue === stats.revenue}`);
  stopAnalysis();
  disposeAnalysis();

  // Phase 8 — codec bake-off at dataset scale: single encode+decode of all records
  const codecs: [string, Codec][] = [
    ['json', jsonCodec],
    ['msgpack', msgpackCodec],
    ['msgpackr', msgpackrCodec],
    ['fast-json', fastJsonCodec],
  ];
  for (const [name, codec] of codecs) {
    t0 = performance.now();
    const encoded = codec.encode(records);
    const eMs = performance.now() - t0;
    t0 = performance.now();
    codec.decode(encoded);
    const dMs = performance.now() - t0;
    log(`codec ${name.padEnd(7)}: encode ${eMs.toFixed(0)}ms, decode ${dMs.toFixed(0)}ms, ${fmtMB(encoded.byteLength)} @ ${fmtInt(N)} records`);
  }

  // Phase 9 — fixed-layout list records: same 2M dataset, zero serialization.
  // Persist is per-record DataView writes; the worker scan is direct reads.
  const flat = benchMemory.recordsFlat;
  t0 = performance.now();
  for (let i = 0; i < N; i++) {
    const r = records[i];
    flat.writeAt(i, {
      id: r.id,
      price: r.price,
      quantity: r.quantity,
      active: r.active ? 1 : 0,
      category: CATEGORIES.indexOf(r.category),
      sku: r.sku,
    });
  }
  flat.commit(); // one version bump for the whole batch
  ms = performance.now() - t0;
  log(`flat persist       : ${fmtInt(N)} list records (${fmtMB(flat.byteLength)} raw) in ${ms.toFixed(1)}ms — no validate/encode/copy`);

  const flatStart = performance.now();
  const flatStats = await pool.flatAnalyzeDataset();
  const flatMs = performance.now() - flatStart;
  log(`flat analyze       : direct scan ${flatStats.scanMs.toFixed(1)}ms (task round-trip ${flatMs.toFixed(1)}ms) — no decode/validate`);
  const spot = flat.readAt(123456);
  const src = records[123456];
  const agree = flatStats.revenue === stats.revenue
    && spot.id === src.id && spot.price === src.price && spot.sku === src.sku;
  log(`flat stats         : $${fmtInt(flatStats.revenue)} revenue, ${fmtInt(flatStats.activeCount)} active — agrees with structured path: ${agree}`);

  stopObserving();
  dispose();
  pool.terminate();
}
