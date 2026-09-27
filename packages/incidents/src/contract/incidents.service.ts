import { z } from 'zod';
import { defineService } from '@jwhenry123/mesh/sdk';
import {
  metricsSchema,
  queryArgsSchema,
  queryResultSchema,
} from './memory.contracts';

/**
 * The incidents worker's RPC surface — the single declaration imported by
 * both threads. The worker binds handlers via implementService; the main
 * thread hands `incidentsService.tasks` to the WorkerPool config (or a
 * createClient proxy). Wire ids derive as `incidents.<method>`, and each
 * method's signature infers from its schemas — no type annotations needed.
 */
export const incidentsService = defineService('incidents', {
  seedIncidents: { resultSchema: z.number() },
  queryIncidents: {
    argsSchema: z.tuple([queryArgsSchema]),
    resultSchema: queryResultSchema,
  },
  computeMetrics: { resultSchema: metricsSchema },
});
