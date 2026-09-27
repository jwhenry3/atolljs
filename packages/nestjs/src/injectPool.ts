// Nest-side injection helpers — import @nestjs/common, so they stay OUT of
// worker bundles (workers deep-import ./decorators and ./handlers instead).
import { Inject } from '@nestjs/common';
import { getMeshPoolToken } from './pools';

/**
 * Injects a configured pool: `@InjectMeshPool('incidents')` resolves the
 * WorkerPool registered under that name by MeshModule.forRoot. Prefer
 * @MeshTask for method dispatch; inject the pool for runTask/terminate/
 * first-class task-method access.
 */
export const InjectMeshPool = (name = 'default'): ParameterDecorator =>
  Inject(getMeshPoolToken(name));
