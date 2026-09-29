import { CodeBlock } from '../components/CodeBlock';
import { DemoFrame } from '../components/DemoFrame';

export function Islands() {
  return (
    <article>
      <h1>Worker islands</h1>
      <p className="lead">
        <code>@atolljs/islands</code> renders a framework tree{' '}
        <em>inside</em> a Atoll worker: the worker owns the render loop and every
        commit serializes to an op stream the main thread replays as real DOM
        mutations into your element. Opt-in DOM rendering off the main thread —
        the shell keeps events, layout, and slots; the worker keeps the app.
      </p>

      <h2>Vocabulary</h2>
      <table className="doc-table">
        <thead>
          <tr><th>Term</th><th>Meaning</th></tr>
        </thead>
        <tbody>
          <tr>
            <td><strong>Island</strong></td>
            <td>The mounted unit — <code>mountIsland()</code> puts one instance of a registered app into a container element. Each mount mints an <code>app@N</code> instance key scoping its op queue, document, and events.</td>
          </tr>
          <tr>
            <td><strong>PolyWorker</strong></td>
            <td><code>definePolyWorker({'{ apps }'})</code> — one worker hosting a registry of named apps; several islands can share it.</td>
          </tr>
          <tr>
            <td><strong>MonoWorker</strong></td>
            <td><code>defineMonoWorker(app)</code> — one worker pinned to a single app; own bundle, own failure domain.</td>
          </tr>
          <tr>
            <td><strong>Shell</strong></td>
            <td>Your main-thread app — plain DOM via <code>mountIsland</code>, or a framework via the <code>*-island</code> packages.</td>
          </tr>
        </tbody>
      </table>

      <h2>Install</h2>
      <CodeBlock
        code={`npm install @atolljs/core @atolljs/islands
# plus the shell package for your framework, e.g.:
npm install @atolljs/react-island`}
        language="bash"
      />

      <h2>Quickstart</h2>
      <CodeBlock
        file="render.worker.ts — the whole worker entry"
        code={`import { definePolyWorker } from '@atolljs/islands/worker';

export const renderWorker = definePolyWorker({
  apps: {
    dashboard: DashboardApp,                          // a React component
    vanilla: { imperative: (doc, props) => { ... } }, // or pure proxy-DOM code
  },
});`}
      />
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
      <p>
        Pass <code>client: connectIslandWorker({'{ worker }'})</code> instead of{' '}
        <code>worker</code> when several islands should share one worker
        (multi-island-per-worker — the client is released when its last island
        destroys). When your shell is a framework app, prefer the{' '}
        <code>*-island</code> package's components — they wrap exactly these
        calls (see the Worker islands page under each framework).
      </p>

      <h2>Live demo</h2>
      <p>
        Seven islands across three topologies — React apps on a registry worker
        (two sharing one client), imperative islands on dedicated workers
        running real Leaflet 1.9 and a vendored widget, unmodified.
      </p>
      <DemoFrame id="react-dom-worker" port={5177} name="react-dom-worker" />

      <h2>mountIsland options</h2>
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
          <tr><td><code>mode</code></td><td><code>'push'</code> (default — SharedArrayBuffer doorbell, needs <a href="#/hosting">COOP/COEP</a>) or <code>'poll'</code> (50ms drain — no SAB, no headers needed).</td></tr>
          <tr><td><code>mountTimeout</code></td><td>Default 15s, <code>0</code> disables — a worker entry that never answers rejects with a named error instead of hanging.</td></tr>
          <tr><td><code>onActivity</code> / <code>onOps</code></td><td>Per-op-batch hooks — stats, and worker-vs-main timing split.</td></tr>
        </tbody>
      </table>

      <h2>Which workloads belong in an island</h2>
      <p>
        Every event costs one postMessage round trip — <code>pointermove</code>,
        per-keystroke input, and scroll handlers re-render on worker latency,
        and <code>preventDefault</code> can't work (the real event already
        dispatched). Keep high-frequency input on the main thread — slots exist
        for exactly this — and put coarse interactions (clicks, toggles, form
        submits) behind the island. Main-thread replay scales with op{' '}
        <em>count</em>, not tree size, so fine-grained framework updates are
        cheap while whole-tree rebuilds cost an order of magnitude more per
        frame.
      </p>
    </article>
  );
}
