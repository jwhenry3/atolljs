import { CodeBlock } from '../components/CodeBlock';
import { docHref } from '../link';

const port = 3100;
const apiBase = () =>
  typeof window === 'undefined'
    ? `http://localhost:${port}`
    : `${window.location.protocol}//${window.location.hostname}:${port}`;

const REPORT_SERVICE = `// src/facade/report.service.ts: the service class IS the facade.
// One class-level @AtollService marks EVERY method for offload under
// ReportService.<method> task ids: no per-method decorators, no
// dispatch code anywhere in the class.
import { Inject, Injectable } from '@nestjs/common';
import { threadId } from 'node:worker_threads';
import { AtollService } from '@atolljs/nestjs/decorators';
import { incidentsMemory, REGIONS, SEVERITIES, STATUSES,
         type Incident } from '@atolljs/incidents';
import { ScanTelemetry } from '../shared/scan-telemetry.service';

const OPEN = STATUSES.indexOf('open');
const rec = {} as Incident;

@Injectable()
@AtollService({ pool: 'reports' })
export class ReportService {
  // Real DI: resolves inside the worker's own Nest context.
  constructor(@Inject(ScanTelemetry) private readonly telemetry: ScanTelemetry) {}

  execSummary() {
    this.telemetry.note('execSummary');
    const conn = incidentsMemory.lists.incidents;
    // …one zero-copy scan of 1M shared records → aggregated object…
    return { total: conn.recordCount, /* bySeverity, topOpenRegion, … */ };
  }

  regionReport(region: string) { /* parameterized scan → object */ }

  workerInfo() {
    // Proof of context: threadId > 0 in a worker, telemetry is
    // this worker's own DI'd instance.
    return { threadId, scans: this.telemetry.scans, lastTask: this.telemetry.lastTask };
  }
}`;

const DASHBOARD_SERVICE = `// src/facade/dashboard.service.ts: a plain main-thread service with
// ZERO atoll imports. It injects the facade like any provider; every
// call it makes is a worker dispatch under the hood.
import { Inject, Injectable } from '@nestjs/common';
import { ReportService } from './report.service';

@Injectable()
export class DashboardService {
  constructor(@Inject(ReportService) private readonly reports: ReportService) {}

  async overview() {
    // One HTTP response composed from two EXECUTE_TASK dispatches:
    // the consumer sees ordinary async methods.
    const [summary, worker] = await Promise.all([
      this.reports.execSummary(),
      this.reports.workerInfo(),
    ]);
    return { ...summary, generatedBy: worker };
  }
}`;

const FACADE_MODULE = `// src/facade/facade.module.ts: the application boundary, imported by
// the main app AND bootstrapped inside each 'reports' worker. The pool
// is message-only: it shares the incidents pool's buffer via
// withSharedBuffer rather than allocating a second one: two pools,
// one buffer, so the scans below read the same 1M records.
import { Module } from '@nestjs/common';
import { Worker } from 'node:worker_threads';
import { AtollModule, getAtollPool } from '@atolljs/nestjs';
import { withSharedBuffer } from '@atolljs/node';

@Module({
  imports: [
    AtollModule.registerPool({
      name: 'reports',
      worker: withSharedBuffer(
        () => new Worker(new URL('./facade.worker.ts', import.meta.url)),
        () => getAtollPool('incidents')?.sharedBuffer, // lazy: respawns too
      ),
      poolSize: 2,
    }),
  ],
  providers: [ScanTelemetry, ReportService, DashboardService],
  exports: [ReportService, DashboardService, AtollModule],
})
export class FacadeAtollModule {}

// src/facade/facade.worker.ts: the whole worker entry:
//   import { runAtollWorker } from '@atolljs/nestjs/worker';
//   import { bindSharedBuffer } from '@atolljs/node';
//   import { FacadeAtollModule } from './facade.module';
//   void (async () => {
//     await bindSharedBuffer();              // incidents pool's buffer
//     await runAtollWorker(FacadeAtollModule); // real DI inside the worker
//   })();`;

const REPORT_CONTROLLER = `// src/facade/report.controller.ts: no atoll imports at all. The
// boundary is invisible end to end: controller → service → facade →
// worker, and back with a plain Promise.
import { Controller, Get, Inject, Param } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { ReportService } from './report.service';

@Controller('api/reports')
export class ReportController {
  constructor(
    @Inject(DashboardService) private readonly dashboard: DashboardService,
    @Inject(ReportService) private readonly reports: ReportService,
  ) {}

  @Get('overview')
  overview() {
    return this.dashboard.overview();   // service→service→worker
  }

  @Get('region/:region')
  region(@Param('region') region: string) {
    return this.reports.regionReport(region); // parameterized dispatch
  }

  @Get('worker')
  worker() {
    return this.reports.workerInfo();   // which worker answered
  }
}`;

const CONTRACT_FORM = `// The contract form binds only the methods a ServiceContract declares,
// dispatch happens under the contract's own taskIds (and carries its zod
// schemas for arg/result validation):
@Injectable()
@AtollService(incidentsRpc, { pool: 'incidents' })
export class IncidentsRpc {
  seedIncidents() { /* … */ }          // → task id 'incidents.seedIncidents'
  computeMetrics() { /* … */ }         // → 'incidents.computeMetrics'
  // methods NOT in the contract are untouched, they run wherever
  // they're invoked, on either side
}`;

export function NestjsFacades() {
  return (
    <article>
      <h1>NestJS, service facades</h1>
      <p className="lead">
        <code>@AtollService</code> turns a provider class into the interop
        surface itself, the service-level analog of the frontend{' '}
        <code>islandComponent</code> facade. Inject it like any provider,
        call its methods, and every call dispatches to the worker pool.
        The main↔worker boundary disappears at the call site.
      </p>

      <h2>The facade, the class is the contract</h2>
      <p>
        One class-level <code>@AtollService(&#123; pool &#125;)</code> marks
        every prototype method for offload under{' '}
        <code>ClassName.method</code> task ids, no{' '}
        <code>@AtollTask</code> per method, no dispatch code in the class.
        The same file loads on both sides: on the API thread the decorated
        methods are proxies; inside a pool worker{' '}
        <code>runAtollWorker</code> binds them to the DI-resolved instance
        and the bodies execute.
      </p>
      <CodeBlock code={REPORT_SERVICE} file="facade/report.service.ts" />

      <h2>The consumer: service to service</h2>
      <p>
        This is the piece that makes it a <em>service-level</em> facade: a
        normal injectable composes worker calls without importing anything
        atoll-shaped. <code>DashboardService</code> doesn&apos;t know, and
        can&apos;t know, that <code>ReportService</code> methods run in
        another thread. That&apos;s the test: if the consumer had to know,
        it wouldn&apos;t be a facade.
      </p>
      <CodeBlock code={DASHBOARD_SERVICE} file="facade/dashboard.service.ts" />

      <h2>The boundary, module + worker entry</h2>
      <p>
        One module is imported by the main app and bootstrapped inside
        each worker, the pool registers on the main side, resolves to{' '}
        <code>null</code> in workers, and the providers resolve on both
        sides with per-worker DI. The pool is message-only and shares the
        incidents buffer the same way the housed pool does.
      </p>
      <CodeBlock code={FACADE_MODULE} file="facade/facade.module.ts" />

      <h2>The call site: invisible by design</h2>
      <CodeBlock code={REPORT_CONTROLLER} file="facade/report.controller.ts" />

      <h2>What executes where</h2>
      <p>
        Trace <code>GET :{port}/api/reports/overview</code>, one HTTP
        request, two dispatches, zero atoll code on the API side:
      </p>
      <ol>
        <li>
          <strong>API thread</strong>, the controller calls{' '}
          <code>dashboard.overview()</code>, a plain injectable.
        </li>
        <li>
          <strong>API thread</strong>: DashboardService calls{' '}
          <code>reports.execSummary()</code> and{' '}
          <code>reports.workerInfo()</code>. The class-level decorator has
          replaced each body: the call becomes{' '}
          <code>EXECUTE_TASK ReportService.execSummary</code> on the{' '}
          <code>reports</code> pool and returns a Promise.
        </li>
        <li>
          <strong>worker</strong>, the pool dispatches to the{' '}
          TaskRegistry entry <code>runAtollWorker</code> registered at
          boot, bound to the worker&apos;s own DI-resolved{' '}
          ReportService, its <code>ScanTelemetry</code> is that
          worker&apos;s real instance.
        </li>
        <li>
          <strong>API thread</strong>: both Promises resolve with
          structured-cloned results; the response merges them.
        </li>
      </ol>
      <p>
        Hit <a href={`${apiBase()}/api/reports/worker`} target="_blank" rel="noreferrer" data-port={port}><code>{apiBase()}/api/reports/worker</code></a>{' '}
        repeatedly: the two workers alternate and each reports its own{' '}
        <code>threadId</code> and telemetry counters.
      </p>

      <h2>Two forms</h2>
      <p>
        The contract-less form above offloads every method under{' '}
        <code>ClassName.method</code> ids. The contract form declares the
        surface explicitly: useful when a class mixes offloadable and
        local-only methods, or when you want zod validation on the wire:
      </p>
      <CodeBlock code={CONTRACT_FORM} file="incidents-rpc.service.ts" />

      <h2>Choosing an interop style</h2>
      <table className="doc-table">
        <thead>
          <tr><th>Style</th><th>Call shape</th><th>Pick when</th></tr>
        </thead>
        <tbody>
          <tr>
            <td><code>@AtollService</code> facade</td>
            <td><code>inject(ReportService).execSummary()</code></td>
            <td>Service-level interop, consumers stay plain DI clients; the worker class is the contract.</td>
          </tr>
          <tr>
            <td><code>@AtollTask</code> per-method</td>
            <td><code>service.method()</code>, decorated subset</td>
            <td>Granular control: only specific methods offload (see DigestService).</td>
          </tr>
          <tr>
            <td><code>workerClient</code></td>
            <td><code>incidents.computeMetrics()</code></td>
            <td>Calling a worker&apos;s exported task map directly (contract-package workers).</td>
          </tr>
          <tr>
            <td><a href={docHref('fw-nestjs/housed')}>Housed APIs</a></td>
            <td><code>GET /api/housed/*</code></td>
            <td>Whole routes execute in workers: no main-thread call at all.</td>
          </tr>
        </tbody>
      </table>

      <h2>Try it</h2>
      <p>
        The repo&apos;s <code>examples/nestjs</code> runs the facade on a
        dedicated 2-worker <code>reports</code> pool, start it via{' '}
        <code>npm run serve:all</code>, then:
      </p>
      <ul>
        <li><a href={`${apiBase()}/api/reports/overview`} target="_blank" rel="noreferrer" data-port={port}><code>{apiBase()}/api/reports/overview</code></a>, a main-thread service composing two worker dispatches</li>
        <li><a href={`${apiBase()}/api/reports/region/west`} target="_blank" rel="noreferrer" data-port={port}><code>{apiBase()}/api/reports/region/west</code></a>, a parameterized facade call (try northeast, midwest…)</li>
        <li><a href={`${apiBase()}/api/reports/worker`} target="_blank" rel="noreferrer" data-port={port}><code>{apiBase()}/api/reports/worker</code></a>, the answering worker&apos;s threadId + per-worker telemetry</li>
      </ul>

      <h2>Notes</h2>
      <ul>
        <li>The fallback is local execution, not an error: if no pool named in @AtollService is registered, methods run on the calling thread (the validator warns at boot). Inside workers the registry is always empty, which is exactly why housed controllers can call the same class and get real bodies.</li>
        <li>Args and results cross postMessage (structured clone), keep them small; the shared buffer carries the big state.</li>
        <li>The decorated class file loads on BOTH sides, keep its imports worker-safe (no express/platform-specific deps) and its method bodies free of main-thread-only resources.</li>
        <li>Facade methods always resolve to a Promise-shaped call: write the bodies as if they ran locally; async or sync both work.</li>
      </ul>
    </article>
  );
}
