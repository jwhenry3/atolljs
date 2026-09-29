// Nest-side injection helpers — import @nestjs/common, so they stay OUT of
// worker bundles (workers deep-import ./decorators and ./handlers instead).
import { Inject } from '@nestjs/common';
import { getAtollPoolToken } from './pools';

/**
 * Injects a configured pool: `@InjectAtollPool('incidents')` resolves the
 * WorkerPool registered under that name by AtollModule.forRoot. Prefer
 * @AtollTask for method dispatch; inject the pool for runTask/terminate/
 * first-class task-method access.
 */
export const InjectAtollPool = (name = 'default'): ParameterDecorator =>
  Inject(getAtollPoolToken(name));
