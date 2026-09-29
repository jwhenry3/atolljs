import { CodeBlock } from '../components/CodeBlock';

const port = 3100;
const apiBase = `${window.location.protocol}//${window.location.hostname}:${port}`;

const APIS = [
  { name: 'AtollModule.forRoot', signature: 'forRoot({ pools? }) / forRootAsync(...)', desc: 'Global atoll infrastructure — validator, discovery, lifecycle. Optional pools for simple apps; feature modules prefer registerPool.' },
  { name: 'AtollModule.registerPool', signature: 'registerPool(config) / registerPoolAsync(...)', desc: 'Bull-style module-level pool registration inside the feature module that owns the worker: name, worker, sharedMemory, poolSize. Injectable provider, terminated on module destroy.' },
  { name: '@AtollTask', signature: '@AtollTask(taskId | contract | { pool })', desc: 'Per-method RPC offload — calls on the API thread dispatch to the pool; the body executes inside the worker’s own Nest context.' },
  { name: '@AtollService', signature: '@AtollService({ pool }) / @AtollService(service, opts?)', desc: 'Class-level offload — marks every method for dispatch to the pool under ClassName.method ids (the contract form binds only methods declared in a ServiceContract).' },
  { name: 'workerClient', signature: 'workerClient<WorkerDef>(runner | () => runner)', desc: 'Typed Proxy over an injected pool — wrap once and call the worker’s own method names: client.seedIncidents().' },
  { name: '@InjectAtollPool', signature: '@InjectAtollPool(name)', desc: 'Inject a configured pool directly (first-class task methods / runTask).' },
  { name: 'runAtollWorker', signature: 'runAtollWorker(module)', desc: 'Worker entry point — self-contained (shim + bootstrap inside), boots a Nest application context inside the worker and registers every @AtollTask method on its DI-resolved provider.' },
  { name: 'registerAtollHandlers', signature: 'registerAtollHandlers(...instances)', desc: 'Explicit task registration for instances created outside a worker Nest context.' },
  { name: 'worker spec', signature: 'worker: path | URL | (() => Worker | NodeWorker)', desc: 'Pool worker declaration — a factory may return node:worker_threads.Worker directly; it is adapted internally, keeping `new Worker(new URL(...))` webpack-detectable without adapter ceremony.' },
];

const USAGE_MODULE = `import { Module } from '@nestjs/common';
import { Worker } from 'node:worker_threads';
import { AtollModule } from '@atolljs/nestjs';
import { digestMemory } from './digest/digest.service';
import { DigestService } from './digest/digest.service';

// The feature module owns its worker domain — the pool registers here,
// not in AppModule. The same module is bootstrapped inside each worker
// by runAtollWorker, where the pool provider resolves to null.
@Module({
  imports: [
    AtollModule.registerPool({
      name: 'digest',
      // webpack detects new Worker(new URL(...)) and emits the entry
      // as its own chunk — the config references the TS source.
      worker: () => new Worker(new URL('../digest.worker.ts', import.meta.url)),
      sharedMemory: digestMemory,
      poolSize: 2,
    }),
  ],
  providers: [DigestService],
  exports: [DigestService, AtollModule],   // re-exports the pool token
})
export class DigestAtollModule {}

// app.module.ts — global infrastructure once, zero pool config at root:
//   imports: [AtollModule.forRoot(), DigestAtollModule, IncidentsAtollModule]`;

const USAGE_SERVICE = `import { Inject, Injectable } from '@nestjs/common';
import { AtollService } from '@atolljs/nestjs/decorators';
import { defineSharedMemory, field } from '@atolljs/core/sdk';

export const digestMemory = defineSharedMemory({ jobsDone: field.number() });

// Class-level: EVERY method dispatches to the 'digest' pool under
// DigestService.<method> ids. @AtollTask({ pool }) remains for
// per-method control.
@Injectable()
@AtollService({ pool: 'digest' })
export class DigestService {
  constructor(@Inject(ScanTelemetry) private telemetry: ScanTelemetry) {}

  async hash(input: string, rounds = 50_000) {
    this.telemetry.note('hash');  // injected dep resolves inside the worker
    let digest = input;
    for (let i = 0; i < rounds; i++) {
      digest = createHash('sha256').update(digest).digest('hex');
    }
    digestMemory.jobsDone.write(digestMemory.jobsDone.read() + 1);
    return { hash: digest, rounds };
  }
}`;

const USAGE_CONTROLLER = `import { Controller, Get } from '@nestjs/common';
import { InjectAtollPool } from '@atolljs/nestjs';
import { workerClient, type WorkerPool } from '@atolljs/core/sdk';
import type { IncidentsWorker } from '@atolljs/incidents';

@Controller('api/incidents')
export class IncidentsController {
  // Wrap the injected pool once — calls read like the worker's methods.
  // Factory form resolves this.pool lazily (field inits run before the
  // constructor's parameter-property assignment).
  private readonly incidents = workerClient<IncidentsWorker>(() => this.pool);

  constructor(@InjectAtollPool('incidents') private readonly pool: WorkerPool) {}

  @Get('stats')
  stats() {
    return this.incidents.computeMetrics();
  }
}`;

const USAGE_WORKER = `// src/digest.worker.ts — bundled standalone to dist/digest.worker.js
// atoll-nestjs/worker is self-contained: its own first imports bind
// self = parentPort and wire INIT_MEMORY / EXECUTE_TASK.
import { runAtollWorker } from '@atolljs/nestjs/worker';
import { DigestAtollModule } from './digest/digest.module';

void runAtollWorker(DigestAtollModule);   // real DI inside the worker`;

const USAGE_BUILD = `// nest-cli.json — opt into webpack + a config factory
{
  "compilerOptions": {
    "webpack": true,
    "webpackConfigFactory": "webpack.config.js"
  }
}

// webpack.config.js — worker chunks are detected automatically from
// new Worker(new URL(...)); the only plugin needed resolves the aliases
module.exports = (config) => {
  config.resolve.plugins.push(
    new TsconfigPathsPlugin({ configFile: 'tsconfig.json' })
  );
  return config;
};

// package.json
//   "build": "nest build"
//   "dev":   "nest start --watch"`;

export function Nestjs() {
  return (
    <article>
      <h1>NestJS</h1>
      <p className="lead">
        <code>@atolljs/nestjs</code> — the worker atoll on the server.
        Named pools of <code>node:worker_threads</code> workers share memory
        with the API thread, and <code>@AtollService</code>/<code>@AtollTask</code>{' '}
        move a service method's body into a worker — with real dependency
        injection on both sides.
      </p>

      <h2>Install</h2>
      <CodeBlock code="npm install @atolljs/core" language="bash" />

      <h2>Pool module</h2>
      <CodeBlock code={USAGE_MODULE} file="app.module.ts" />

      <h2>Service — the decorator picks the thread</h2>
      <CodeBlock code={USAGE_SERVICE} file="digest.service.ts" />

      <h2>Controller — the pool wrapped as a typed client</h2>
      <CodeBlock code={USAGE_CONTROLLER} file="incidents.controller.ts" />

      <h2>Worker entry</h2>
      <CodeBlock code={USAGE_WORKER} file="digest.worker.ts" />

      <h2>Build</h2>
      <p>
        Plain <code>nest build</code> — webpack mode with a{' '}
        <code>webpackConfigFactory</code>. Worker chunks need no configuration:
        webpack detects each <code>new Worker(new URL('./x.worker.ts',
        import.meta.url))</code> in the pool config and compiles it as its own
        chunk, so the <code>worker:</code> factory points at the TS source —
        never a dist filename. <code>atoll-nestjs/worker</code> self-contains
        the <code>node:worker_threads</code> shim + bootstrap — worker entries
        are a couple of imports. The lower-level node pieces (
        <code>createNodeWorker</code>, the shim,{' '}
        <code>createNodePool</code>) live in{' '}
        <code>@atolljs/node</code> — usable in plain Node programs with
        no Nest at all.
      </p>
      <CodeBlock code={USAGE_BUILD} file="nest-cli.json + webpack.config.js" language="javascript" />

      <h2>Binding API</h2>
      <table className="doc-table">
        <thead>
          <tr><th>Export</th><th>Signature</th><th>What it does</th></tr>
        </thead>
        <tbody>
          {APIS.map((api) => (
            <tr key={api.name}>
              <td><code>{api.name}</code></td>
              <td><code>{api.signature}</code></td>
              <td>{api.desc}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Live example</h2>
      <p>
        The repo's <code>examples/nestjs</code> runs two pools (24-worker{' '}
        <code>incidents</code>, 2-worker <code>digest</code>) behind a REST
        API on port {port}. Start it via <code>npm run serve:all</code>, then:
      </p>
      <ul>
        <li><a href={`${apiBase}/api/incidents/stats`} target="_blank" rel="noreferrer"><code>{apiBase}/api/incidents/stats</code></a> — worker-computed aggregates</li>
        <li><a href={`${apiBase}/api/digest/worker`} target="_blank" rel="noreferrer"><code>{apiBase}/api/digest/worker</code></a> — the answering worker's threadId + per-worker telemetry</li>
        <li><a href={`${apiBase}/api/incidents/42`} target="_blank" rel="noreferrer"><code>{apiBase}/api/incidents/42</code></a> — a direct shared-memory read, zero dispatch</li>
      </ul>

      <h2>Notes</h2>
      <ul>
        <li>Server-only binding — SharedArrayBuffer in Node needs no COOP/COEP headers.</li>
        <li>nest build (webpack/ts-loader) honors emitDecoratorMetadata; explicit @Inject/@InjectAtollPool tokens are optional but harmless.</li>
        <li>Each pool's workers share one buffer — only define the pool's own contracts in a worker entry's module graph.</li>
        <li>Args/results cross postMessage (structured clone); the shared buffer carries the large state.</li>
      </ul>
    </article>
  );
}
