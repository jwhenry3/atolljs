// Framework-free worker-side registration — safe inside worker bundles.
import { TaskRegistry } from '@jwhenry123/mesh/sdk';
import { getMeshTaskMeta } from './decorators';

/**
 * Registers every @MeshTask method on the given targets as a TaskRegistry
 * handler bound to that instance. Call this from the worker entry:
 *
 *   // incidents.worker.ts
 *   import { registerMeshHandlers } from '@jwhenry123/mesh-nestjs/handlers';
 *   import { IncidentsWorkerApi } from './incidents.api';
 *   registerMeshHandlers(IncidentsWorkerApi);
 *
 * Accepts classes (instantiated with a no-arg constructor) or instances
 * (useful when the handler needs constructor args). The instance's decorated
 * methods run their real bodies when the pool dispatches EXECUTE_TASK.
 */
export function registerMeshHandlers(
  ...targets: Array<object | (new () => object)>
): void {
  for (const target of targets) {
    const instance =
      typeof target === 'function' ? new (target as new () => object)() : target;
    const proto = Object.getPrototypeOf(instance);
    for (const key of Object.getOwnPropertyNames(proto)) {
      if (key === 'constructor') continue;
      const meta = getMeshTaskMeta(proto, key);
      if (meta) {
        TaskRegistry.register(meta.contract, meta.original.bind(instance));
      }
    }
  }
}
