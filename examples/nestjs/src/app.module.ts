import { Injectable, Module, OnApplicationBootstrap } from '@nestjs/common';
import { InjectMeshPool, MeshModule } from '@jwhenry123/mesh-nestjs';
import { type IncidentsPool } from '@jwhenry123/mesh-incidents';
import { IncidentsController } from './incidents.controller';
import { IncidentsMeshModule } from './shared/incidents-mesh.module';
import { DigestMeshModule } from './digest/digest.module';
import { DigestController } from './digest/digest.controller';

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
    // Global mesh infrastructure once — pool registration stays inside the
    // feature modules that own each worker domain (registerPool).
    MeshModule.forRoot(),
    IncidentsMeshModule,
    DigestMeshModule,
  ],
  controllers: [IncidentsController, DigestController],
  providers: [SeedOnBootstrap],
})
export class AppModule {}
