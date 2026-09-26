import { TaskRegistry } from '../../sdk/worker/registry';
import { AnalyzeDataset, BlastConnectorWrites, BlastObjectWrites, BlastViewWrites, FlatAnalyzeDataset, Noop } from './task.contracts';
import { CATEGORIES, benchMemory, orderArraySchema, type FlatRecord } from './memory.contracts';
import '../../sdk/worker/workerBootstrap'; // Wires up message listeners

TaskRegistry.register(Noop, () => 0);

// Zero-copy baseline: raw writes into the shared typed-array view
TaskRegistry.register(BlastViewWrites, (iterations) => {
  const counters = benchMemory.counters.read();
  const len = counters.length;
  const start = performance.now();
  for (let i = 0; i < iterations; i++) {
    counters[i % len] = i;
  }
  return performance.now() - start;
});

// Connector writes: each iteration does a field write + Atomics.add + Atomics.notify
TaskRegistry.register(BlastConnectorWrites, (iterations) => {
  const checksum = benchMemory.checksum;
  const start = performance.now();
  for (let i = 0; i < iterations; i++) {
    checksum.write(i);
  }
  return performance.now() - start;
});

// Structured writes: schema validation + codec encode + store, every iteration
TaskRegistry.register(BlastObjectWrites, (iterations) => {
  const payload = benchMemory.payload;
  const start = performance.now();
  for (let i = 0; i < iterations; i++) {
    payload.write({ seq: i, values: [i, i * 1.5, i * 2.5], label: `batch-${i % 100}` });
  }
  return performance.now() - start;
});

// Large-dataset pipeline: decode the shared records, aggregate, publish stats back
TaskRegistry.register(AnalyzeDataset, (_count) => {
  const readStart = performance.now();
  const records = benchMemory.records.read() ?? []; // codec decode + schema validate
  const readMs = performance.now() - readStart;

  // Attribute decode vs validate: re-parse the decoded records for a validate-only cost
  const validateStart = performance.now();
  orderArraySchema.parse(records);
  const validateMs = performance.now() - validateStart;
  const decodeMs = Math.max(0, readMs - validateMs);

  const scanStart = performance.now();
  let revenue = 0;
  let activeCount = 0;
  const byCategory: Record<string, number> = {};
  for (const r of records) {
    if (!r.active) continue;
    activeCount++;
    revenue += r.price * r.quantity;
    byCategory[r.category] = (byCategory[r.category] ?? 0) + 1;
  }
  const scanMs = performance.now() - scanStart;

  const result = { count: records.length, activeCount, revenue, byCategory, decodeMs, validateMs, scanMs, computedBy: 'worker' };
  benchMemory.analysis.write(result);
  return result;
});

// Same aggregation over fixed-layout records: readAt into a reused object —
// no decode, no validate, no per-record allocation
TaskRegistry.register(FlatAnalyzeDataset, () => {
  const flat = benchMemory.recordsFlat;
  const start = performance.now();
  let revenue = 0;
  let activeCount = 0;
  const byCategory: Record<string, number> = {};
  const rec = {} as FlatRecord;
  const scanFields: (keyof FlatRecord)[] = ['active', 'price', 'quantity', 'category'];
  for (let i = 0; i < flat.recordCount; i++) {
    flat.readAt(i, rec, scanFields);
    if (!rec.active) continue;
    activeCount++;
    revenue += rec.price * rec.quantity;
    byCategory[CATEGORIES[rec.category]] = (byCategory[CATEGORIES[rec.category]] ?? 0) + 1;
  }
  const scanMs = performance.now() - start;
  const result = { count: flat.recordCount, activeCount, revenue, byCategory, decodeMs: 0, validateMs: 0, scanMs, computedBy: 'worker' };
  benchMemory.analysis.write(result);
  return result;
});
