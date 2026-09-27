import { Injectable, Module, OnApplicationBootstrap } from '@nestjs/common';
import { Worker } from 'node:worker_threads';
import { InjectMeshPool, MeshModule } from '@jwhenry123/mesh-nestjs';
import { createNodeWorker } from '@jwhenry123/mesh-node';
import {
  incidentsMemory,
  incidentsTasks,
  type IncidentsPool,
} from '@jwhenry123/mesh-incidents';
import { IncidentsController } from './incidents.controller';
import { IncidentsMeshModule } from './shared/incidents-mesh.module';
import { DigestMeshModule } from './digest/digest.module';
import { DigestController } from './digest/digest.controller';
import { digestMemory } from './digest/digest.service';

/**
 * The shared buffer lives in process memory — every restart (including
 * `node --watch` rebuilds in dev) hands out a fresh, zeroed buffer. Seed at
 * boot so the API never serves an empty store.
 */
@Injectable()
class SeedOnBootstrap implements OnApplicationBootstrap {
  constructor(@InjectMeshPool('incidents') private readonly pool: IncidentsPool) {}
  async onApplicationBootstrap() {
    await this.pool.seedIncidents();
  }
}

@Module({
  imports: [
    MeshModule.forRoot({
      pools: [
        {
          name: 'incidents',
          // Worker factory pointing at the TS source — webpack detects
          // `new Worker(new URL(...))`, compiles the entry as its own chunk,
          // and rewrites the URL to the emitted file. No dist filename
          // coupling; the source IS the reference.
          createWorker: () =>
            createNodeWorker(
              new Worker(new URL('./incidents.worker.ts', import.meta.url)),
            ),
          sharedMemory: incidentsMemory,
          poolSize: 'auto',
          tasks: incidentsTasks,
        },
        // Second pool — that's the whole integration cost: a worker entry,
        // a shared contract, a module, and this config block.
        {
          name: 'digest',
          createWorker: () =>
            createNodeWorker(
              new Worker(new URL('./digest.worker.ts', import.meta.url)),
            ),
          sharedMemory: digestMemory,
          poolSize: 2,
        },
      ],
    }),
    // Same modules the workers bootstrap — services resolve on both sides.
    IncidentsMeshModule,
    DigestMeshModule,
  ],
  controllers: [IncidentsController, DigestController],
  providers: [SeedOnBootstrap],
})
export class AppModule {}
