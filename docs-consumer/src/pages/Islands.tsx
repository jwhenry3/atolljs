import { DemoFrame } from '../components/DemoFrame';
import { PkgLink } from '../components/PkgLink';
import { docHref } from '../link';

export function Islands() {
  return (
    <article>
      <h1>Islands: overview</h1>
      <p className="lead">
        <PkgLink name="@atolljs/islands" /> renders a framework tree{' '}
        <em>inside</em> a Atoll worker: the worker owns the render loop and every
        commit serializes to an op stream the main thread replays as real DOM
        mutations into your element. Opt-in DOM rendering off the main thread:
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
            <td>The mounted unit: <code>mountIsland()</code> puts one instance of a registered app into a container element. Each mount mints an <code>app@N</code> instance key scoping its op queue, document, and events.</td>
          </tr>
          <tr>
            <td><strong>PolyWorker</strong></td>
            <td><code>definePolyWorker({'{ apps }'})</code>, one worker hosting a registry of named apps; several islands can share it.</td>
          </tr>
          <tr>
            <td><strong>MonoWorker</strong></td>
            <td><code>defineMonoWorker(app)</code>, one worker pinned to a single app; own bundle, own failure domain.</td>
          </tr>
          <tr>
            <td><strong>Shell</strong></td>
            <td>Your main-thread app: plain DOM via <code>mountIsland</code>, or a framework via the <code>*-island</code> packages.</td>
          </tr>
        </tbody>
      </table>

      <p>
        Install, mounting, and the mount API live under{' '}
        <a href={docHref('island-apps')}>Quickstart</a>.
      </p>

      <h2>Live demo</h2>
      <p>
        Eleven islands on a framework-free shell: plain{' '}
        <code>mountIsland</code> calls, no framework on the main thread at
        all. The React apps ride the registry worker script (
        <code>data-table</code> mounts twice: same app, separate workers),{' '}
        <code>vue-notes</code> runs a real Vue createRenderer, a row of{' '}
        <code>counter</code> islands is rendered by Svelte, Solid and Angular
        workers, and the imperative islands get dedicated instance workers
        running a hand-written proxy-DOM app and unmodified Leaflet 1.9.
        Every supported renderer runs on this one page.
      </p>
      <DemoFrame id="react-dom-worker" port={5177} name="vanilla" />

      <h2>Which workloads belong in an island</h2>
      <p>
        Every event costs one postMessage round trip: <code>pointermove</code>,
        per-keystroke input, and scroll handlers re-render on worker latency,
        and <code>preventDefault</code> can't work (the real event already
        dispatched). Keep high-frequency input on the main thread, slots exist
        for exactly this, and put coarse interactions (clicks, toggles, form
        submits) behind the island. Main-thread replay scales with op{' '}
        <em>count</em>, not tree size, so fine-grained framework updates are
        cheap while whole-tree rebuilds cost an order of magnitude more per
        frame.
      </p>
    </article>
  );
}
