// Emits dist/**/*.d.ts after the root vite build — package.json's `types`
// fields point into dist/, but the lib build only emits js. Sources use
// extensionless relative imports (bundler resolution), so emitted specifiers
// get a `.js` suffix appended — legal under every consumer resolution mode.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { fixDtsSpecifiers } from './build-lib.mjs';

const tscBin = fileURLToPath(new URL('../node_modules/typescript/bin/tsc', import.meta.url));
execFileSync(process.execPath, [tscBin, '-p', 'tsconfig.dts.json'], { stdio: 'inherit' });
fixDtsSpecifiers('dist');
