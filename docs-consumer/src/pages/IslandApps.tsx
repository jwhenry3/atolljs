import { CodeBlock } from '../components/CodeBlock';
import { docHref } from '../link';

export function IslandApps() {
  return (
    <article>
      <h1>Islands — quickstart</h1>
      <p className="lead">
        Island apps run inside the worker against a proxy document — every
        mutation serializes to ops the shell replays. Three app shapes cover
        the spectrum from "plain component" to "DOM-heavy library, unmodified".
        Concepts and workload guidance are on{' '}
        <a href={docHref('islands')}>Overview</a>.
      </p>

      <h2>Install</h2>
      <CodeBlock
        code={`npm install @atolljs/core @atolljs/islands
# plus your framework's island package if the worker hosts one, e.g.:
npm install @atolljs/react-island   # vue / svelte / solidjs / angular too`}
        language="bash"
      />

      <h2>Mounting</h2>
      <CodeBlock
        file="render.worker.ts — the whole worker entry"
        code={`import { definePolyWorker } from '@atolljs/islands/worker';

export const renderWorker = definePolyWorker({
  apps: {
    // Either app shape — a framework component via its island package's
    // helper, or pure proxy-DOM code with no framework at all:
    dashboard: reactIslandApp(DashboardApp),   // @atolljs/react-island/worker
    vanilla: { imperative: (doc, props) => { ... } },
  },
});`}
      />
      <table className="doc-table">
        <thead>
          <tr><th>Framework</th><th>Worker helper</th><th>Package</th></tr>
        </thead>
        <tbody>
          <tr><td>React</td><td><code>reactIslandApp</code> / <code>defineReactPolyWorker</code></td><td><code>@atolljs/react-island</code></td></tr>
          <tr><td>Vue</td><td><code>vueIslandApp</code> / <code>defineVuePolyWorker</code></td><td><code>@atolljs/vue-island</code></td></tr>
          <tr><td>Svelte</td><td><code>svelteIslandApp</code></td><td><code>@atolljs/svelte-island</code></td></tr>
          <tr><td>SolidJS</td><td><code>solidIslandApp</code></td><td><code>@atolljs/solid-island</code></td></tr>
          <tr><td>Angular</td><td><code>angularIslandApp</code></td><td><code>@atolljs/angular-island</code></td></tr>
        </tbody>
      </table>
      <CodeBlock
        file="main thread"
        code={`import { mountIsland } from '@atolljs/islands';

const island = await mountIsland({
  // The inline new URL(...) literal is what lets the bundler see the entry.
  worker: () => new Worker(new URL('./render.worker.ts', import.meta.url), { type: 'module' }),
  el: document.getElementById('island')!,
  app: 'dashboard',
  props: { ... },
  onEvent: (name, payload) => { ... },          // island → shell emit() channel
  slots: { preview: (el) => mountCanvas(el) },  // transclusion holes
});
island.updateProps({ ... });
island.destroy();`}
      />
      <table className="doc-table">
        <thead>
          <tr><th>Option</th><th>Notes</th></tr>
        </thead>
        <tbody>
          <tr><td><code>el</code></td><td>Container element the op stream replays into. Required.</td></tr>
          <tr><td><code>worker</code> / <code>client</code></td><td>Exactly one: a bundler-detectable worker factory (or URL) this mount owns, or a shared <code>connectIslandWorker</code> client.</td></tr>
          <tr><td><code>app</code></td><td>Registry key into <code>apps</code>. Optional for MonoWorkers — a single-app worker resolves its sole app regardless.</td></tr>
          <tr><td><code>props</code></td><td>Cross via <code>structuredClone</code> — uncloneable values reject naming the offending key. <code>callbackProp(fn)</code> markers pass shell functions through.</td></tr>
          <tr><td><code>onEvent</code></td><td>Receives every worker-side <code>emit(name, payload)</code>.</td></tr>
          <tr><td><code>slots</code></td><td><code>{'{ name: (el | null) => void }'}</code> — a <code>data-atoll-slot</code> element's contents are yours to fill with real main-thread DOM.</td></tr>
          <tr><td><code>mode</code></td><td><code>'push'</code> (default — SharedArrayBuffer doorbell, needs <a href={docHref('hosting')}>COOP/COEP</a>) or <code>'poll'</code> (50ms drain — no SAB, no headers needed).</td></tr>
          <tr><td><code>mountTimeout</code></td><td>Default 15s, <code>0</code> disables — a worker entry that never answers rejects with a named error instead of hanging.</td></tr>
          <tr><td><code>onActivity</code> / <code>onOps</code></td><td>Per-op-batch hooks — stats, and worker-vs-main timing split.</td></tr>
        </tbody>
      </table>
      <p>
        Pass <code>client: connectIslandWorker({'{ worker }'})</code> instead of{' '}
        <code>worker</code> when several islands should share one worker
        (multi-island-per-worker — the client is released when its last island
        destroys). When your shell is a framework app, prefer the{' '}
        <code>*-island</code> package's components — they wrap exactly these
        calls (see the Islands page under each framework).
      </p>

      <h2>Three app kinds</h2>
      <table className="doc-table">
        <thead>
          <tr><th>Shape</th><th>What it is</th></tr>
        </thead>
        <tbody>
          <tr><td>Framework component</td><td>Wrapped by the <code>*-island</code> package's <code>*IslandApp</code> helper — the framework's real renderer (reconciler/runtime) executes in the worker.</td></tr>
          <tr><td><code>{'{ imperative }'}</code></td><td><code>{'{ imperative: (doc, props) =&gt; void, dispose?(doc) }'}</code> — no framework: mutate the proxy <code>doc</code> directly, ops emit as you go. <code>updateProps</code> is dispose + clear + rebuild.</td></tr>
          <tr><td><code>RenderedIslandApp</code></td><td><code>{'{ mount(ctx) =&gt; { update?, dispose? } }'}</code> — the framework-adapter shape. The <code>*-island</code> worker packages produce these; write your own to bring a new renderer.</td></tr>
        </tbody>
      </table>
      <p>
        Stamp apps with <code>islandApp('name', app)</code> — a data property
        that survives minification (unlike <code>fn.name</code>), so shell-side
        component references resolve to the wire key. Framework components pass
        through their package's <code>define*PolyWorker</code> unwrapped.
      </p>

      <h2>Channels</h2>
      <CodeBlock
        code={`// worker side — from your *-island package's /worker entry
// (or '@atolljs/islands/worker' directly):
import { emit, runInInstance, bumpOpsVersion } from '…/worker';

// island → shell: lands in mountIsland's onEvent.
emit('rowSelected', { id: row.id });

// shell → island: pass a function marker in props…
//   props: { onSave: callbackProp((id) => save(id)) }   // from atoll-islands
// …the worker receives a callable (fire-and-forget — no return channel):
props.onSave(id);

// Transclusion — the shell fills this leaf with real main-thread DOM.
// The mechanism is one attribute; any app/framework can render it:
doc.createElement('div').setAttribute('data-atoll-slot', 'preview');
// (react-island also exports a <Slot name="preview" /> component)`}
      />
      <p>
        Mediation is unidirectional by convention — <code>emit</code> →{' '}
        <code>onEvent</code> → shell state → back in as props. Slots are the
        escape hatch for content the worker can't own (canvases, Monaco,
        Google Maps JS): the worker owns the box, the shell owns the contents.
      </p>

      <h2>The proxy document</h2>
      <p>
        Inside the worker there is no DOM — a <code>ProxyDocument</code>{' '}
        facade records every mutation as an op the shell replays. The full op
        vocabulary, DOM coverage, the geometry/events channels, limits, and
        per-renderer benchmarks live under{' '}
        <a href={docHref('island-proxy')}>Proxy document</a>.
      </p>

      <h2>Testing in-process</h2>
      <CodeBlock
        code={`import { InProcessWorker } from '@atolljs/core/testing/inProcessWorker';
vi.stubGlobal('Worker', InProcessWorker);
InProcessWorker.handlerModules = [() => import('./my.worker')];

const island = await mountIsland({ worker: () => new Worker(url, { type: 'module' }), ... });
// Real task registry, real op stream, real shared-memory binding —
// only the thread boundary is faked. flushObservers() settles microtasks.`}
      />
    </article>
  );
}
