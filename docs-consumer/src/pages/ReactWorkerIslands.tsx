// Embedded sources: ?raw inlines the real files so the docs always show
// the code that ships in this repo.
import workerEntry from '../../../examples/react-dom-worker/src/worker/react.worker.tsx?raw';
import contractModule from '../../../examples/react-dom-worker/src/incidents.island.ts?raw';
import shellSource from '../../../examples/react-dom-worker/src/shell.tsx?raw';
import consoleWorkerSource from '../../../examples/react-dom-worker/src/worker/console.worker.tsx?raw';
import { CodeBlock } from '../components/CodeBlock';
import { DemoFrame } from '../components/DemoFrame';
import { PkgLink } from '../components/PkgLink';
import { docHref } from '../link';

/**
 * Worker islands under the React framework: the react-dom-worker example's
 * React shell (react-shell.html), where React itself runs INSIDE the
 * workers: the shell mounts worker-hosted components through <Island/>,
 * islandComponent, and lazyIsland proxies.
 */
export function ReactWorkerIslands() {
  return (
    <article>
      <h1>React, islands</h1>
      <p className="lead">
        <PkgLink name="@atolljs/react-island" />, a worker-hosted React (or
        imperative proxy-DOM) tree mounted as an ordinary element in a React shell.
        The worker's render loop produces serialized DOM ops; the main thread just
        replays them.
      </p>

      <h2>Live demo, React in the worker</h2>
      <p>
        Four islands, React rendered inside the workers: a counter, a second
        counter instance, a notes composer, and a 1,000,000-record incident
        benchmark, the two counters share ONE client (both mounts live in a
        single worker, <code>counter@N</code> keys, one OS thread), notes gets
        its own client on the same script, and the incidents benchmark carries
        a third worker through its lazy contract module. The shell is just a
        thin <code>&lt;Island/&gt;</code> host: worker emits land in{' '}
        <code>onEvent</code> → React state → the status line.
      </p>
      <p>
        <b>The incident benchmark is the real-world case for offloading a
        heavy component.</b> One million incidents exist as lazily generated
        logical rows: the component is a fixed-height virtualized scroller
        that renders only the ~22 visible rows plus overscan, no matter where
        you scroll. Each scroll event crosses the island protocol as a
        structured payload (the driver stamps <code>scrollTop</code>), React
        re-computes the window worker-side, and the commit rides back as an op
        batch: the stats line reports the worker-side re-render time, and a{' '}
        <code>rendered</code> emit updates the shell's status line. The main
        thread never touches more than a handful of DOM nodes; a million rows
        of state, generation, and diffing all stay off it.
      </p>
      <DemoFrame
        id="react-dom-worker"
        port={5177}
        name="react"
        path="/react-shell.html"
      />

      <h2>The proxy API</h2>
      <table className="doc-table">
        <thead>
          <tr><th>Export</th><th>Signature</th><th>What it does</th></tr>
        </thead>
        <tbody>
          <tr>
            <td><code>lazyIsland</code></td>
            <td><code>lazyIsland(loader: () =&gt; Promise&lt;{'{'} default: A {'}'} | {'{'} app, worker? {'}'} | A&gt;): FC&lt;IslandAppProps&lt;A&gt; &amp; IslandShellProps&gt;</code></td>
            <td>
              React.lazy mirrored: the returned component suspends on the dynamic
              import (a real bundler split point), then mounts the resolved app
              with props inferred from its signature. Contract modules{' '}
              <code>{'{'} app, worker {'}'}</code> carry their own worker
              factory: that's how the incidents island gets a dedicated worker.
            </td>
          </tr>
          <tr>
            <td><code>islandComponent</code></td>
            <td><code>islandComponent&lt;P&gt;('name') | islandComponent(StampedApp)</code></td>
            <td>
              The pure-contract proxy: the shell never imports the implementation;
              a registry key + a type-only props import is the whole contract.
            </td>
          </tr>
          <tr>
            <td><code>Island</code></td>
            <td><code>&lt;Island app={'{'}ref|name{'}'} client|worker props onEvent slots onReady/&gt;</code></td>
            <td>
              The underlying building block: declarative mountIsland as a
              component. <code>props</code> dedups by serialized identity.
            </td>
          </tr>
          <tr>
            <td><code>islandApp</code></td>
            <td><code>islandApp('name', app)</code></td>
            <td>
              Stamps an app (component or {'{'}imperative{'}'} def) with its registry
              name: a data property, so references survive minification.
            </td>
          </tr>
          <tr>
            <td><code>defineReactPolyWorker</code></td>
            <td><code>defineReactPolyWorker({'{'} apps {'}'})</code>, <code>react-island/worker</code></td>
            <td>
              Registry worker, one script serving a whole apps map; islands
              mount by name and several may share one client/worker. Components
              wrap through <code>reactIslandApp</code> automatically.
            </td>
          </tr>
          <tr>
            <td><code>defineReactMonoWorker</code></td>
            <td><code>defineReactMonoWorker(app)</code>, <code>react-island/worker</code></td>
            <td>
              Instance worker, the 1:1 topology: one script, one app, mounted
              namelessly. Its bundle carries only that app's dependencies.
            </td>
          </tr>
          <tr>
            <td><code>Slot / emit</code></td>
            <td><code>&lt;Slot name&gt; / emit(name, payload)</code></td>
            <td>
              Transclusion: worker markup hands a real element to the shell's
              slots map (canvases, Monaco, AG Grid). emit is the island→shell
              event channel.
            </td>
          </tr>
          <tr>
            <td><code>Island / islandComponent / lazyIsland</code></td>
            <td>from <code>react-island/worker</code></td>
            <td>
              The same mount components, for use inside a worker island: the
              mount spawns or reuses a sub-worker. Same props, same meaning.
            </td>
          </tr>
        </tbody>
      </table>

      <h2>Mounting, the proxies make islands look local</h2>
      <p>
        The counters mount through plain <code>&lt;Island/&gt;</code> elements on
        a shared <code>connectIslandWorker</code> client; notes mounts through{' '}
        <code>islandComponent('notes')</code>, a registry key is the whole
        contract; incidents mounts through <code>lazyIsland</code> with a
        contract module, so its chunk code-splits and its worker is
        self-contained. <code>&lt;Suspense&gt;</code> covers the module
        load; the proxy's <code>fallback</code> prop covers the worker-mount
        window: mounting can't suspend because a suspended tree never commits
        and the container must be in the DOM first.
      </p>
      <CodeBlock
        file="examples/react-dom-worker/src/shell.tsx"
        language="tsx"
        code={shellSource}
      />

      <h2>The worker side: React running in the worker</h2>
      <p>
        The worker bundle carries React itself :{' '}
        <code>defineReactPolyWorker</code> serves the whole apps map from one
        script, and a real <code>react-reconciler</code> drives the proxy DOM
        with state staying worker-side. Components are unremarkable React:
        hooks, controlled inputs, <code>emit(name, payload)</code> for the
        island → shell channel. The only rules: no DOM access, serializable
        props, and handlers receive the plain <code>EventPayload</code> wire
        object instead of a <code>SyntheticEvent</code> :{' '}
        <code>handler()</code> in the file adapts it to JSX's event prop
        types. See the <a href={docHref('islands')}>Islands</a> page for
        modes, slots, and lifecycle.
      </p>
      <CodeBlock
        file="examples/react-dom-worker/src/worker/react.worker.tsx"
        language="tsx"
        code={workerEntry}
      />
      <p>
        The incidents island's contract module is the whole lazy story: a
        shell-safe module that names the registry key AND carries the worker
        factory: the shell-side <code>lazyIsland</code> resolves both, so the
        benchmark's worker is a bundler-detectable split point.
      </p>
      <CodeBlock
        file="examples/react-dom-worker/src/incidents.island.ts"
        code={contractModule}
      />

      <h2>Islands inside islands: the same API, one level down</h2>
      <p>
        A worker-rendered app mounts islands with the components the shell
        uses. <code>@atolljs/react-island/worker</code> re-exports{' '}
        <code>Island</code>, <code>islandComponent</code>,{' '}
        <code>lazyIsland</code> and <code>connectIslandWorker</code>; inside a
        worker the container is a proxy element, so the mount is routed to a
        sub-worker whose DOM tunnels up through the parent island's own op
        stream. You don't pick a different API for nesting, only a mount shape:
      </p>
      <ul>
        <li>
          <code>worker={'{'}factory{'}'}</code> spawns a sub-worker for that
          mount (from the parent worker, so the <code>new Worker</code>{' '}
          literal lives in the parent worker's bundle).
        </li>
        <li>
          <code>client={'{'}connectIslandWorker({'{'} worker {'}'}){'}'}</code>,
          built inside the parent worker, adds one instance per mount to a
          single sub-worker: shared runtime, shared thread.
        </li>
        <li>
          <code>onEvent</code> runs in the parent island's scope, so{' '}
          <code>emit</code> relays to the shell; <code>slots</code> portal
          worker-side content into the sub-island, and names you don't list
          bubble up to the shell's <code>slots</code>.
        </li>
      </ul>
      <p>
        The demo's ops console shows why the shape matters. One PolyWorker
        (below) is mounted three ways: <code>pulse</code> +{' '}
        <code>export</code> on a shared client, where an export freezes the
        pulse; the same two apps with <code>worker</code> each, where it
        doesn't; and <code>regions</code>, whose worker nests{' '}
        <code>region.worker.tsx</code> both ways: three region cards on one
        shared sub-client and a forecast model on its own sub-worker. See{' '}
        <a href={docHref('island-apps')}>Quickstart</a> for the
        definition/worker/instance model.
      </p>
      <CodeBlock
        file="examples/react-dom-worker/src/worker/console.worker.tsx"
        language="tsx"
        code={consoleWorkerSource}
      />

      <h2>Notes</h2>
      <ul>
        <li>
          <b>Mediation is unidirectional</b>: an island's <code>emit</code> lands in{' '}
          <code>onEvent</code>, the shell sets state, and it flows back in as props.
          No hand-wired <code>updateProps</code> calls.
        </li>
        <li>
          <b>Two fallback phases:</b> <code>&lt;Suspense&gt;</code> for the module
          load, the proxy's <code>fallback</code> prop for the worker mount.
        </li>
        <li>
          <b>React commits in the dispatch's sync lane</b>: unlike the other
          frameworks' async schedulers, <code>useLayoutEffect</code> fires while
          the task still holds the instance, so commit-phase <code>emit</code>
          needs no <code>runInInstance</code> re-entry. That's how the incidents
          benchmark reports its re-render time from a layout effect.
        </li>
        <li>
          <b>Fixed-dimension libs</b> (recharts) get width/height as props:
          there's no ResizeObserver channel into the worker; measurement reads on
          the proxy DOM return zero.
        </li>
        <li>
          <b>Structural walls stay walls:</b> closed libraries that need real DOM
          (Google Maps JS) are housed via transclusion slots or iframe elements:
          the worker owns the box, the shell owns the contents.
        </li>
      </ul>
    </article>
  );
}
