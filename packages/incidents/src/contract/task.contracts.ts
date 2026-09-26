import { z } from 'zod';
import type { TaskContract } from '@jwhenry123/mesh/sdk';
import { metricsSchema, queryArgsSchema, queryResultSchema, type Metrics, type QueryArgs, type QueryResult } from './memory.contracts';

export const SeedIncidents: TaskContract<[], number> = {
  taskId: 'inc-seed',
  resultSchema: z.number(),
};

export const QueryIncidents: TaskContract<[query: QueryArgs], QueryResult> = {
  taskId: 'inc-query',
  argsSchema: z.tuple([queryArgsSchema]),
  resultSchema: queryResultSchema,
};

export const ComputeMetrics: TaskContract<[], Metrics> = {
  taskId: 'inc-metrics',
  resultSchema: metricsSchema,
};
