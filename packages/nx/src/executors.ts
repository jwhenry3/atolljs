import type { ExecutorContext } from '@nx/devkit';
import { runAtollAsync } from './atoll';

export interface DoctorExecutorSchema {
  fix?: boolean;
}

export async function doctorExecutor(
  options: DoctorExecutorSchema,
  context: ExecutorContext,
): Promise<{ success: boolean }> {
  const argv = ['doctor'];
  if (options.fix) argv.push('--fix');
  const code = await runAtollAsync(argv, context.root);
  return { success: code === 0 };
}

export interface DevtoolsExecutorSchema {
  port?: number;
  otlp?: string;
  otlpHeaders?: string;
  otlpService?: string;
}

/** Serving executor — resolves when the devtools server exits. */
export async function devtoolsExecutor(
  options: DevtoolsExecutorSchema,
  context: ExecutorContext,
): Promise<{ success: boolean }> {
  const argv = ['devtools'];
  if (options.port) argv.push('--port', String(options.port));
  if (options.otlp) argv.push('--otlp', options.otlp);
  if (options.otlpHeaders) argv.push('--otlp-headers', options.otlpHeaders);
  if (options.otlpService) argv.push('--otlp-service', options.otlpService);
  const code = await runAtollAsync(argv, context.root);
  // Stopping a serve target (Ctrl+C, nx kill) isn't a failure.
  return { success: code === 0 || code === 130 || code === 143 };
}
