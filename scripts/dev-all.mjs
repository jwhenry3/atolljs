import { apps } from './apps.mjs';
import { checkPorts, launch, npmCmd, npmScript } from './orchestrate.mjs';

// Node demos gate devtools on ATOLL_DEVTOOLS — arm it so dev:all shows
// live telemetry on the aggregate dashboard (:4780) out of the box.
// Browser demos keep their own gate (?__atoll_devtools in the URL).
const NODE_DEMOS = new Set([
  'nestjs', 'express', 'fastify', 'hono', 'koa', 'http-offload', 'nextjs',
]);

if (!(await checkPorts(apps.map(([name, , port]) => [name, port])))) {
  process.exit(1);
}

for (const [name, cwd] of apps) {
  const env = NODE_DEMOS.has(name)
    ? { ...process.env, ATOLL_DEVTOOLS: '1' }
    : undefined;
  launch(name, cwd, npmCmd, npmScript('dev'), env);
}
