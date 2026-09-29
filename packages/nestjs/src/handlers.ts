// Framework-free worker-side registration — safe inside worker bundles.
import { TaskRegistry } from '@atolljs/core';
import { bindAtollWorkerInstance, getAtollTaskMeta } from './decorators';

/**
 * Registers every @AtollTask method on the given targets as a TaskRegistry
 * handler bound to that instance. Call this from the worker entry:
 *
 *   // incidents.worker.ts
 *   import { registerAtollHandlers } from '@atolljs/nestjs/handlers';
 *   import { IncidentsWorkerApi } from './incidents.api';
 *   registerAtollHandlers(IncidentsWorkerApi);
 *
 * Accepts classes (instantiated with a no-arg constructor) or instances
 * (useful when the handler needs constructor args). The instance's decorated
 * methods run their real bodies when the pool dispatches EXECUTE_TASK.
 */
export function registerAtollHandlers(
  ...targets: Array<object | (new () => object)>
): void {
  for (const target of targets) {
    const instance =
      typeof target === 'function' ? new (target as new () => object)() : target;
    // Handlers the decorator auto-registered on module load now delegate to
    // this instance too — registration order between module imports and
    // runAtollWorker stops mattering.
    bindAtollWorkerInstance(instance.constructor as new () => object, instance);
    const proto = Object.getPrototypeOf(instance);
    for (const key of Object.getOwnPropertyNames(proto)) {
      if (key === 'constructor') continue;
      const meta = getAtollTaskMeta(proto, key);
      if (meta) {
        TaskRegistry.register(meta.contract, meta.original.bind(instance));
      }
    }
  }
}
