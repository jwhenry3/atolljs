import { z } from 'zod';
import { defineService, rpc } from '@jwhenry123/mesh/sdk';
import {
  metricsSchema,
  queryArgsSchema,
  queryResultSchema,
  type Metrics,
  type QueryArgs,
  type QueryResult,
} from './memory.contracts';

/**
 * The incidents worker's RPC surface — the single declaration imported by
 * both threads. The worker binds handlers via implementService; the main
 * thread hands `incidentsService.tasks` to the WorkerPool config (or a
 * createClient proxy). Wire ids derive as `incidents.<method>`.
 */
export const incidentsService = defineService('incidents', {
  seedIncidents: rpc<[], number>({ resultSchema: z.number() }),
  queryIncidents: rpc<[query: QueryArgs], QueryResult>({
    argsSchema: z.tuple([queryArgsSchema]),
    resultSchema: queryResultSchema,
  }),
  computeMetrics: rpc<[], Metrics>({ resultSchema: metricsSchema }),
});
