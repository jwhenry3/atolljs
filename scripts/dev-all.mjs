import { apps } from './apps.mjs';
import { checkPorts, launch, npmCmd, npmScript } from './orchestrate.mjs';

if (!(await checkPorts(apps.map(([name, , port]) => [name, port])))) {
  process.exit(1);
}

for (const [name, cwd] of apps) {
  launch(name, cwd, npmCmd, npmScript('dev'));
}
