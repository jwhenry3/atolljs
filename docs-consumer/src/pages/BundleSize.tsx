import { bundleStats } from '../bundleStats';
import { docHref } from '../link';
import { islandPerfStats } from '../islandPerfStats';
import { PkgLink } from '../components/PkgLink';
import { SplitBar, workerShare } from '../components/SplitBar';

const kb = (bytes: number) => (bytes / 1024).toFixed(1);

interface Size { min: number; gzip: number }
interface Pkg { id: string; main: Size; worker?: Size }

const pkgs: readonly Pkg[] = bundleStats.packages;

const find = (id: string): Pkg => {
  const p = pkgs.find((p) => p.id === id);
  if (!p) throw new Error(`bundleStats is missing ${id}: rerun scripts/bundle-stats.mjs`);
  return p;
};

/** A named stack: which packages land on each thread. */
const STACKS: { label: string; main: string[]; worker: string[] }[] = [
  {
    label: 'React app, worker pool + hooks',
    main: ['@atolljs/core', '@atolljs/react'],
    worker: ['@atolljs/core'],
  },
  {
    label: 'Vue / Solid / Svelte app, worker pool + bindings',
    main: ['@atolljs/core', '@atolljs/vue'],
    worker: ['@atolljs/core'],
  },
  {
    label: 'React islands app, shell proxies on main, reconciler in worker',
    main: ['@atolljs/core', '@atolljs/islands', '@atolljs/react-island'],
    worker: ['@atolljs/core', '@atolljs/islands', '@atolljs/react-island'],
  },
  {
    label: 'Vue islands app',
    main: ['@atolljs/core', '@atolljs/islands', '@atolljs/vue-island'],
    worker: ['@atolljs/core', '@atolljs/islands', '@atolljs/vue-island'],
  },
  {
    label: 'Svelte islands app',
    main: ['@atolljs/core', '@atolljs/islands', '@atolljs/svelte-island'],
    worker: ['@atolljs/core', '@atolljs/islands', '@atolljs/svelte-island'],
  },
  {
    label: 'SolidJS islands app',
    main: ['@atolljs/core', '@atolljs/islands', '@atolljs/solid-island'],
    worker: ['@atolljs/core', '@atolljs/islands', '@atolljs/solid-island'],
  },
  {
    label: 'Angular islands app',
    main: ['@atolljs/core', '@atolljs/islands', '@atolljs/angular-island'],
    worker: ['@atolljs/core', '@atolljs/islands', '@atolljs/angular-island'],
  },
  {
    label: 'NestJS backend, pool + worker_threads adapter',
    main: ['@atolljs/core', '@atolljs/nestjs', '@atolljs/node'],
    worker: ['@atolljs/core', '@atolljs/nestjs', '@atolljs/node'],
  },
];

export function BundleSize() {
  return (
    <article>
      <h1>Bundle size &amp; load split</h1>
      <p className="lead">
        Every <code>@atolljs/*</code> package publishes source: your bundler
        does the final tree-shaking, so the numbers below are the{' '}
        <em>full entry surface</em> of each published export, bundled with
        rolldown (the Vite 8 bundler) and minified. Dependencies and peer
        dependencies are excluded from the package columns and measured
        separately below.
      </p>

      <h2>Per-package impact</h2>
      <p>
        Atoll splits each package's weight across two bundles: the{' '}
        <strong>main-thread</strong> surface (imported by your app) and the{' '}
        <strong>worker-thread</strong> surface (imported inside the worker
        entry: a separate fetch that never blocks your app bundle). The bar
        shows each package's gzip share per thread.
      </p>
      <p className="loadbar-legend">
        <span><span className="swatch swatch-main" />main thread</span>
        <span><span className="swatch swatch-worker" />worker thread</span>
      </p>
      <table className="doc-table">
        <thead>
          <tr>
            <th>Package</th>
            <th>Main thread</th>
            <th>Worker thread</th>
            <th>Load split</th>
            <th>Worker share</th>
          </tr>
        </thead>
        <tbody>
          {pkgs.map((pkg) => (
            <tr key={pkg.id}>
              <td><PkgLink name={pkg.id} site="bundlephobia" /></td>
              <td className="num">
                {kb(pkg.main.min)} kB <span className="muted">({kb(pkg.main.gzip)} gz)</span>
              </td>
              <td className="num">
                {pkg.worker ? (
                  <>
                    {kb(pkg.worker.min)} kB{' '}
                    <span className="muted">({kb(pkg.worker.gzip)} gz)</span>
                  </>
                ) : (
                  '-'
                )}
              </td>
              <td className="loadbar-cell">
                <SplitBar
                  main={pkg.main.gzip}
                  worker={pkg.worker?.gzip ?? 0}
                  label={pkg.id}
                />
              </td>
              <td className="num">
                {pkg.worker ? (
                  `${workerShare(pkg.main.gzip, pkg.worker.gzip)}%`
                ) : (
                  <span className="muted">-</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <ul>
        <li>
          <strong><code>core</code> is loaded on both threads</strong>: the
          contract layer (<code>defineSharedMemory</code>, <code>field.*</code>,
          codecs, reactivity) is counted on each side because each thread parses
          its own copy. Main adds the pool/client; the worker adds{' '}
          <code>defineWorker</code> + bootstrap.
        </li>
        <li>
          <strong>Framework bindings are near-free</strong> (0.1-2.3 kB): they
          adapt the core observables to each framework's reactivity and carry no
          domain code. The framework itself (<code>react</code>,{' '}
          <code>vue</code>, …) is a peer you already ship.
        </li>
        <li>
          <strong>Islands invert the split</strong>: ~78% of{' '}
          <code>@atolljs/islands</code> lives in the worker entry (proxy DOM,
          app registry, op pump): main thread only pays for the mount driver
          + op replay. The framework renderers are separate per-framework
          packages (<code>react-island/worker</code>,{' '}
          <code>vue-island/worker</code>, …) so a Vue-only worker never parses
          React's reconciler.
        </li>
      </ul>

      <h2>Typical stacks</h2>
      <p>
        What an app actually pays per thread, summed from the table above
        (gzip). Framework and peer packages stay out of the sums: the
        React islands worker additionally pulls{' '}
        <code>react-reconciler</code> (~39 kB gz, below).
      </p>
      <table className="doc-table">
        <thead>
          <tr>
            <th>Stack</th>
            <th>Main thread</th>
            <th>Worker thread</th>
            <th>Load split</th>
            <th>Worker share</th>
          </tr>
        </thead>
        <tbody>
          {STACKS.map((s) => {
            const main = s.main.reduce((n, id) => n + find(id).main.gzip, 0);
            const worker = s.worker.reduce((n, id) => n + (find(id).worker?.gzip ?? 0), 0);
            return (
              <tr key={s.label}>
                <td>{s.label}</td>
                <td className="num">{kb(main)} kB gz</td>
                <td className="num">{kb(worker)} kB gz</td>
                <td className="loadbar-cell">
                  <SplitBar main={main} worker={worker} label={s.label} />
                </td>
                <td className="num">{workerShare(main, worker)}%</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <h2>Processing load</h2>
      <p>
        Bundle size says what each thread <em>loads</em>: this says where
        the JS time actually <em>goes</em>. Measured, not estimated: the same
        200-row tree was mounted through every island adapter, then a
        prop-driven update and a click→state-commit. <strong>Worker</strong>{' '}
        time is the task call itself (framework render/diff, proxy-DOM
        bookkeeping, op serialization); <strong>main</strong> time is the op
        replay into real DOM. The protocol these numbers measure is detailed
        on <a href={docHref('island-proxy')}>Islands → Proxy document</a>.
      </p>
      <table className="doc-table">
        <thead>
          <tr>
            <th>Renderer</th>
            <th>Mount</th>
            <th>Prop update</th>
            <th>Click → commit</th>
            <th>Overall</th>
          </tr>
        </thead>
        <tbody>
          {islandPerfStats.results.map((r) => {
            const totalW =
              r.scenarios.mount.workerMs +
              r.scenarios.update.workerMs +
              r.scenarios.click.workerMs;
            const totalM =
              r.scenarios.mount.mainMs +
              r.scenarios.update.mainMs +
              r.scenarios.click.mainMs;
            return (
              <tr key={r.id}>
                <td>{r.label}</td>
                {(['mount', 'update', 'click'] as const).map((k) => {
                  const s = r.scenarios[k];
                  return (
                    <td key={k} className="num">
                      <SplitBar
                        main={s.mainMs}
                        worker={s.workerMs}
                        label={`${r.label} ${k}`}
                      />
                      <div>
                        {workerShare(s.workerMs, s.mainMs)}% ·{' '}
                        <span className="muted">{s.ops} ops</span>
                      </div>
                    </td>
                  );
                })}
                <td className="num">
                  <SplitBar main={totalM} worker={totalW} label={r.label} />
                  <div>{workerShare(totalW, totalM)}%</div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <ul>
        <li>
          <strong>Mount is the closest split</strong>: building the tree is
          mostly op <em>emission</em>, and emitting ~2-3k ops isn't free on
          the main thread either. Frameworks still land 55-60% of mount work
          in the worker.
        </li>
        <li>
          <strong>Updates are where islands pay off</strong>: a framework
          diff turns a label rename into ~200 ops while the worker does
          85-99% of the JS. The imperative baseline has no diff:{' '}
          <code>updateProps</code> is an honest clear+rebuild (~2,600 ops),
          an even split between writing and replaying it.
        </li>
        <li>
          <strong>Clicks are ~all worker</strong>: dispatch runs the handler
          in the island, the framework invalidates, and typically one op
          crosses back.
        </li>
        <li>
          Numbers are one happy-dom run on one machine: treat the ratios,
          not the decimals, as the data. In-process transport is ~free; real
          workers add structuredClone marshalling to the worker side.
        </li>
      </ul>

      <h2>Runtime dependencies</h2>
      <p>
        These install alongside the packages above: same measurement, browser
        builds, minified. All are only pulled when your bundler sees them
        imported: unused connectors tree-shake away (e.g. no{' '}
        <code>msgpackrCodec</code> import → no msgpackr).
      </p>
      <table className="doc-table">
        <thead>
          <tr>
            <th>Dependency</th>
            <th>Minified</th>
            <th>Gzip</th>
            <th>Pulled in by</th>
          </tr>
        </thead>
        <tbody>
          {bundleStats.dependencies.map((d) => (
            <tr key={d.id}>
              <td><PkgLink name={d.id} site="bundlephobia" /></td>
              <td className="num">{kb(d.min)} kB</td>
              <td className="num">{kb(d.gzip)} kB</td>
              <td>{d.note}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <ul>
        <li>
          <strong>zod isn't a dependency at all</strong>: <code>reef()</code>{' '}
          and <code>listSchema()</code> run on a vendored schema engine that
          speaks zod's <code>_zod.def</code> vocabulary, so the table has no
          zod row. Your own <code>import {'{ z }'} from 'zod'</code> still
          works wherever a schema is accepted, the compiler introspects it
          the same way, but installing zod is now your choice, not ours.
        </li>
        <li>
          <strong>react-reconciler is worker-side only</strong>: React island
          apps pay it inside the worker bundle, off the critical path.
        </li>
        <li>
          <strong>solid-js is a runtime dep of core</strong> (the reactive
          primitives) and a peer of <code>@atolljs/solidjs</code>: Solid apps
          pay it once, either way.
        </li>
      </ul>

      <h2>Methodology</h2>
      <p>
        Bundle sizes generated {bundleStats.generatedAt} by{' '}
        <code>node scripts/bundle-stats.mjs</code>: each published export is
        bundled with rolldown in library mode (deps/peers external, ES output,
        minified), then measured raw and gzipped. Worker entries are bundled
        from their published <code>/worker</code> (or shim) exports. Real-world
        numbers are typically lower: tree-shaking drops the exports your app
        never touches, and gzip is what crosses the wire.
      </p>
      <p>
        Processing-load numbers generated {islandPerfStats.generatedAt} by{' '}
        <code>node scripts/island-perf.mjs</code> (
        <code>packages/islands/test/islandBench.test.ts</code>): each adapter
        mounts the same {islandPerfStats.rows}-row tree through an in-process
        worker under happy-dom; the awaited task call is the worker side and
        the op-replay hook is the main side.
      </p>
    </article>
  );
}
