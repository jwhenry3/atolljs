// Worker-side Nest bootstrap — builds a real application context inside the
// worker so @MeshTask services resolve their constructor dependencies there.
// The first two imports are load-bearing and ORDER-SENSITIVE: the shim binds
// `self = parentPort` (Node workers have no worker global), then the SDK
// bootstrap wires INIT_MEMORY / EXECUTE_TASK onto it. Both are no-ops on the
// main thread, so this module is also safe to pull in via the package barrel.
import '@jwhenry123/mesh-node/shim';
import '@jwhenry123/mesh/sdk/worker/workerBootstrap';
import { DiscoveryModule, DiscoveryService, NestFactory } from '@nestjs/core';
import { Module, type INestApplicationContext, type Type } from '@nestjs/common';
import { scoped } from '@jwhenry123/mesh/sdk';
import { getMeshTaskMeta } from './decorators';
import { registerMeshHandlers } from './handlers';

const log = scoped('mesh-worker');

/**
 * Bootstraps a Nest application context inside the worker and registers every
 * provider's @MeshTask methods — bound to the DI-resolved instance — as
 * TaskRegistry handlers. The worker entry needs only this import (the shim
 * and SDK bootstrap are self-contained above — keep this import first):
 *
 *   // incidents.worker.ts
 *   import { runMeshWorker } from '@jwhenry123/mesh-nestjs/worker';
 *   import '@jwhenry123/mesh-incidents/worker/incidents.worker'; // contract tasks
 *   import { IncidentsMeshModule } from './shared/incidents-mesh.module';
 *   void runMeshWorker(IncidentsMeshModule);
 *
 * The module is the application boundary: the main app imports the same
 * module, so controllers inject the same service classes. Calling an
 * @MeshTask method on the main thread dispatches it like an RPC; the
 * worker's DI'd instance runs the real body.
 */
export async function runMeshWorker(
  module: Type<unknown>,
): Promise<INestApplicationContext> {
  // DiscoveryService isn't auto-registered in standalone contexts —
  // DiscoveryModule provides it.
  @Module({ imports: [DiscoveryModule, module] })
  class MeshWorkerModule {}

  const app = await NestFactory.createApplicationContext(MeshWorkerModule, {
    logger: false,
  });
  const discovery = app.get(DiscoveryService);
  let registered = 0;
  for (const wrapper of discovery.getProviders()) {
    const instance = wrapper.instance as object | undefined;
    if (!instance || typeof instance !== 'object') continue;
    const proto = Object.getPrototypeOf(instance);
    if (
      Object.getOwnPropertyNames(proto).some((key) => getMeshTaskMeta(proto, key))
    ) {
      registerMeshHandlers(instance);
      registered++;
    }
  }
  log.info(`mesh worker context ready — ${registered} decorated service(s)`);
  return app;
}
