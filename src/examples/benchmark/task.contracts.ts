import { z } from 'zod';
import { TaskContract } from '../../sdk/contract/types';
import { Analysis, analysisSchema } from './memory.contracts';

const iterationsArg = z.tuple([z.number()]);
const msResult = z.number();

/* ── Throughput probes ────────────────────────────────────────────────────
   Task dispatch, raw view writes, connector writes, structured writes.     */

export const Noop: TaskContract<[], number> = {
  taskId: 'bench-noop',
  resultSchema: msResult,
};

/** Raw typed-array writes — the zero-copy baseline. */
export const BlastViewWrites: TaskContract<[iterations: number], number> = {
  taskId: 'bench-blast-view',
  argsSchema: iterationsArg,
  resultSchema: msResult,
};

/** Connector writes — each one bumps the version counter and notifies. */
export const BlastConnectorWrites: TaskContract<[iterations: number], number> = {
  taskId: 'bench-blast-connector',
  argsSchema: iterationsArg,
  resultSchema: msResult,
};

/** Structured writes — zod validate + msgpack encode per iteration. */
export const BlastObjectWrites: TaskContract<[iterations: number], number> = {
  taskId: 'bench-blast-object',
  argsSchema: iterationsArg,
  resultSchema: msResult,
};

/* ── Dataset analysis ─────────────────────────────────────────────────────
   Serialized path vs fixed-layout path over the same 2M orders.            */

/** Scan the large shared dataset, publish stats back through shared memory. */
export const AnalyzeDataset: TaskContract<[count: number], Analysis> = {
  taskId: 'bench-analyze',
  argsSchema: iterationsArg,
  resultSchema: analysisSchema,
};

/** Same aggregation over the fixed-layout list records — no decode pass. */
export const FlatAnalyzeDataset: TaskContract<[], Analysis> = {
  taskId: 'bench-analyze-flat',
  resultSchema: analysisSchema,
};

/* ── Task map — baked into the pool, keys become method names ───────────── */

export const benchmarkTasks = {
  noop: Noop,
  blastViewWrites: BlastViewWrites,
  blastConnectorWrites: BlastConnectorWrites,
  blastObjectWrites: BlastObjectWrites,
  analyzeDataset: AnalyzeDataset,
  flatAnalyzeDataset: FlatAnalyzeDataset,
};
