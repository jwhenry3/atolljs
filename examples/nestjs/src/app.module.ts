import { Injectable, Module, OnApplicationBootstrap } from '@nestjs/common';
import { InjectAtollPool, AtollModule } from '@atolljs/nestjs';
import { workerClient, type WorkerPool } from '@atolljs/core';
import { type IncidentsWorker } from '@atolljs/incidents';
import { IncidentsController } from './incidents.controller';
import { IncidentsAtollModule } from './shared/incidents-atoll.module';
import { DigestAtollModule } from './digest/digest.module';
import { DigestController } from './digest/digest.controller';
import { HousedAtollModule } from './housed/housed-atoll.module';

/**
 * The shared buffer lives in process memory — every restart (including
 * `node --watch` rebuilds in dev) hands out a fresh, zeroed buffer. Seed at
 * boot so the API never serves an empty store.
 */
@Injectable()
class SeedOnBootstrap implements OnApplicationBootstrap {
  private readonly incidents = workerClient<IncidentsWorker>(() => this.pool);
  constructor(@InjectAtollPool('incidents') private readonly pool: WorkerPool) {}
  async onApplicationBootstrap() {
    await this.incidents.seedIncidents();
  }
}

@Module({
  imports: [
    // Global atoll infrastructure once — pool registration stays inside the
    // feature modules that own each worker domain (registerPool).
    AtollModule.forRoot(),
    // Import order matters: HousedAtollModule's worker factory reads the
    // 'incidents' pool's sharedBuffer via getAtollPool — it must register first.
    IncidentsAtollModule,
    HousedAtollModule,
    DigestAtollModule,
  ],
  controllers: [IncidentsController, DigestController],
  providers: [SeedOnBootstrap],
})
export class AppModule {}
