import { CodeBlock } from '../components/CodeBlock';
import { DemoFrame } from '../components/DemoFrame';
import { PkgLink } from '../components/PkgLink';
import { docHref } from '../link';

export function IslandMfe() {
  return (
    <article>
      <h1>Islands: micro-frontends</h1>
      <p className="lead">
        An island is already a micro-frontend: a UI subtree rendered inside a
        worker, replayed to the DOM over an op protocol. What makes it a
        <em> publishable</em> MFE is the <strong>contract</strong>: a
        framework-free module that names the app, declares its props/events
        wire shape, and carries the worker factory. Shells import the contract
        and nothing else: no worker component, no worker framework.
      </p>

      <h2>The contract is the boundary</h2>
      <p>
        One file is imported by <em>both</em> sides: it is the only shared
        artifact. Schemas come from <PkgLink name="@atolljs/core" />'s bundled
        <code>z</code> vocabulary (message-domain validation, distinct from{' '}
        <a href={docHref('reef')}>reef</a>'s fixed-width memory layouts):
      </p>
      <CodeBlock
        file="counter.contract.ts, the whole public surface"
        code={`import { z } from '@atolljs/core';
import { defineIslandContract } from '@atolljs/islands';

export const counterContract = defineIslandContract({
  app: 'counter',
  props: z.object({ label: z.string().optional() }),
  events: {
    incremented: z.object({ count: z.number(), label: z.string() }),
  },
  worker: () =>
    new Worker(new URL('./counter.worker.tsx', import.meta.url), { type: 'module' }),
});`}
      />
      <ul>
        <li>
          <b>Shell side</b>: props and <code>onEvent</code> payload types infer
          from the schemas; <code>contract.worker</code> supplies the
          connection, so call sites pass no worker at all.
        </li>
        <li>
          <b>Worker side</b>: the same module attaches to the app (
          <code>defineReactMonoWorker(App, {'{ contract }'})</code> and friends):
          props parse at mount and <code>updateProps</code>, declared event
          payloads parse at <code>emit()</code>. Contract drift between shell
          and worker fails loudly instead of silently dropping fields.
        </li>
        <li>
          <b>Neither side imports the other.</b> A React shell never bundles
          Angular; an Angular worker never bundles React.
        </li>
      </ul>

      <h2>Facades per shell</h2>
      <p>
        Every <code>*-island</code> facade accepts the contract directly, pick
        the facade for your <em>shell</em> framework, not the worker's:
      </p>
      <table className="doc-table">
        <thead>
          <tr><th>Shell</th><th>Facade</th><th>Call site</th></tr>
        </thead>
        <tbody>
          <tr>
            <td>React</td>
            <td><code>islandComponent(contract)</code></td>
            <td><code>{'<CounterIsland label="a" onEvent={h} />'}</code></td>
          </tr>
          <tr>
            <td>Vue</td>
            <td><code>islandComponent(contract)</code></td>
            <td><code>{'<CounterIsland v-bind="{ label, onEvent }" />'}</code></td>
          </tr>
          <tr>
            <td>Solid</td>
            <td><code>islandComponent(contract)</code></td>
            <td><code>{'<CounterIsland label="a" onEvent={h} />'}</code></td>
          </tr>
          <tr>
            <td>Svelte</td>
            <td><code>use:island</code></td>
            <td><code>{'<div use:island={{ app: contract, props, onEvent }} />'}</code></td>
          </tr>
          <tr>
            <td>Angular</td>
            <td><code>islandComponent({'{ contract, selector }'})</code></td>
            <td><code>{'<counter-island [props]="p" [onEvent]="h" />'}</code></td>
          </tr>
        </tbody>
      </table>
      <p>
        Angular's facade generates a standalone component whose{' '}
        <code>[props]</code>/<code>[onEvent]</code> inputs type off the
        contract, the worker's component class never enters the shell bundle.
      </p>
      <p>
        And the call sites, each shell's own idiom, verbatim from the
        examples:
      </p>
      <CodeBlock
        file="react, examples/react-host/src/shell.tsx"
        code={`import { islandComponent } from '@atolljs/react-island';
import counterContract from '../mfe/contracts/counter.contract';

const CounterIsland = islandComponent(counterContract);

<CounterIsland
  label="alpha"
  onEvent={(name, payload) => {
    if (name === 'incremented') console.log(payload.count, payload.label);
  }}
/>`}
      />
      <CodeBlock
        file="vue: examples/vue-host/src/App.vue"
        code={`<script setup lang="ts">
import { islandComponent } from '@atolljs/vue-island';
import counterContract from '../mfe/contracts/counter.contract';

const CounterIsland = islandComponent(counterContract);
</script>

<template>
  <!-- attrs forward as island props; onEvent narrows to the contract -->
  <CounterIsland v-bind="{ label: 'alpha', onEvent }" />
</template>`}
      />
      <CodeBlock
        file="solid: examples/solid-host/src/shell.tsx"
        code={`import { islandComponent } from '@atolljs/solid-island';
import counterContract from '../mfe/contracts/counter.contract';

const CounterIsland = islandComponent(counterContract);

<CounterIsland
  label="alpha"
  onEvent={(name, payload) => {
    if (name === 'incremented') console.log(payload.count, payload.label);
  }}
/>`}
      />
      <CodeBlock
        file="svelte: examples/svelte-host/src/App.svelte"
        code={`<script lang="ts">
  import { island } from '@atolljs/svelte-island';
  import counterContract from '../mfe/contracts/counter.contract';
</script>

<!-- the contract object IS the app, its worker factory supplies the connection -->
<div use:island={{
  app: counterContract,
  props: { label: 'alpha' },
  onEvent: (name, payload) => { /* narrowed to the contract */ },
}} />`}
      />
      <CodeBlock
        file="angular, examples/angular-host/src/shell.ts"
        code={`import { islandComponent } from '@atolljs/angular-island';
import counterContract from '../mfe/contracts/counter.contract';

const CounterIsland = islandComponent({
  contract: counterContract,
  selector: 'counter-island',
});
// → standalone component; [props]/[onEvent] type off the contract

// in the shell component's template:
<counter-island
  [props]="{ label: 'alpha' }"
  [onEvent]="onCounterEvent"     // IslandContractEventHandler<typeof contract>
/>`}
      />

      <h2>Live examples: every shell hosting every framework</h2>
      <p>
        <code>examples/mfe/</code> in the repo holds five contracts + five
        worker entries (one MFE each in React, Vue, Solid, Svelte, Angular).
        Each host below mounts all five: including its own framework through
        the same contract path.
      </p>
      {/* One DemoFrame per host: docs.js folds them into a tabbed dock,
          keeping iframe src in data-src so each tab loads on first open. */}
      <DemoFrame id="react-host" port={5180} name="react" />
      <DemoFrame id="vue-host" port={5181} name="vue" />
      <DemoFrame id="solid-host" port={5182} name="solid" />
      <DemoFrame id="svelte-host" port={5183} name="svelte" />
      <DemoFrame id="angular-host" port={5184} name="angular" />
      <DemoFrame id="mfe-publish" port={5185} name="mfe-pkg" />
      <DemoFrame id="mfe-consumer" port={5187} name="mfe-shell" />
      <table className="doc-table">
        <thead>
          <tr><th>Host</th><th>Directory</th><th>Port</th></tr>
        </thead>
        <tbody>
          <tr><td>React</td><td><code>examples/react-host</code></td><td>5180</td></tr>
          <tr><td>Vue</td><td><code>examples/vue-host</code></td><td>5181</td></tr>
          <tr><td>Solid</td><td><code>examples/solid-host</code></td><td>5182</td></tr>
          <tr><td>Svelte</td><td><code>examples/svelte-host</code></td><td>5183</td></tr>
          <tr><td>Angular</td><td><code>examples/angular-host</code></td><td>5184</td></tr>
        </tbody>
      </table>

      <h2>Authoring a publishable MFE</h2>
      <p>
        <a href={docHref('cli')}>The CLI</a> scaffolds the whole shape :{' '}
        <code>atoll add mfe &lt;name&gt;</code> emits the contract + worker +
        publish config into an existing project, and{' '}
        <code>atoll new &lt;dir&gt; --mfe</code> stands up a standalone MFE
        package with a dev harness that mounts the island through its own
        contract. Hand-rolled, an MFE ships two artifacts per framework
        entry: the contract module and the worker bundle. The worker attaches
        the contract so both sides validate the same wire shape:
      </p>
      <CodeBlock
        file="counter.worker.tsx: worker entry"
        code={`import { defineReactMonoWorker, emit } from '@atolljs/react-island/worker';
import counterContract from './counter.contract';

function CounterApp({ label = 'react mfe' }: { label?: string }) {
  const [count, setCount] = useState(0);
  return <button onClick={() => {
    const n = count + 1;
    setCount(n);
    emit('incremented', { count: n, label }); // payload validates at emit()
  }}>{label}: {count}</button>;
}

export const worker = defineReactMonoWorker(CounterApp, { contract: counterContract });`}
      />
      <p>
        Same-shape helpers exist per worker framework:{' '}
        <code>defineVueMonoWorker</code>, <code>defineSolidMonoWorker</code>,{' '}
        <code>defineSvelteMonoWorker</code>,{' '}
        <code>defineAngularMonoWorker(Component, {'{ contract }'})</code>. One
        worker per MFE keeps each framework's runtime, and its failure domain
        , inside its own bundle.
      </p>
      <p>
        Mount semantics, the worker-side adapter options, and validation
        errors are documented in the{' '}
        <a href={docHref('island-apps')}>island apps</a> quickstart and the
        repo's <code>docs/islands-worker.md</code> (Contracts section).
      </p>

      <h2>Distributing the MFE, npm package or CDN</h2>
      <p>
        The two artifacts are different <em>kinds</em> of entry, and that
        distinction matters:
      </p>
      <ul>
        <li>
          <strong>The contract is a module entry.</strong> It belongs in the
          package's <code>exports</code> map (
          <code>{'"." → "./src/mfe/x.contract.ts"'}</code>):
          shells <code>import</code> it, and shipping it as TS source means
          consumers' bundlers compile it and infer the typed surface
          directly.
        </li>
        <li>
          <strong>The worker is a fetched asset, not an import.</strong>{' '}
          Nothing in a shell's module graph references it: the browser fetches
          it as a Worker script. So it's never an <code>exports</code> entry,
          and it must <em>not</em> be a second <code>build.lib</code> entry in
          the publish config: a two-entry lib build code-splits the shared
          contract into a separate chunk, leaving runtime{' '}
          <code>import</code>s inside the worker bundle: breaking
          self-containment and forcing CORS on every chunk. Keep the publish
          build single-entry.
        </li>
      </ul>
      <p>
        <strong>Shape 1, npm package.</strong> Ship the contract{' '}
        <em>and</em> the built bundle together (<code>files: ['src/mfe',
        'dist-mfe']</code>); the worker URL resolves package-relative, no CDN,
        no CORS:
      </p>
      <CodeBlock
        file="contract inside the published package"
        code={`// Hoisted new URL = ASSET semantics: the consumer's bundler emits the
// file verbatim. Written inline as new Worker(new URL(...)) it would be
// detected as a worker ENTRY and re-bundled instead of copied.
const bundledWorkerUrl = new URL(
  '../../dist-mfe/ticker.worker.js',
  import.meta.url,
);
worker: () => new Worker(bundledWorkerUrl, { type: 'module' }),

// consuming shell's vite.config.ts, the optimizer must not pre-bundle the
// contract, or the new URL asset reference resolves against the bundle:
//   optimizeDeps: { exclude: ['@scope/my-mfe'] }`}
      />
      <p>
        <strong>Shape 2, remote URL.</strong> The contract's{' '}
        <code>worker</code> field is just a factory, but one browser rule
        applies: <strong>a worker's script URL must be same-origin</strong> :{' '}
        <code>new Worker('https://cdn…')</code> throws <code>SecurityError</code>{' '}
        regardless of CORS. The escape is a same-origin module shim that
        imports the remote bundle; a <code>blob:</code> URL inherits the
        page's origin, so only the fetch inside it needs CORS:
      </p>
      <CodeBlock
        file="ticker.contract.ts: remote worker via same-origin shim"
        code={`const MFE_BASE = import.meta.env.VITE_MFE_ORIGIN ?? 'https://mfe.example.com';
const WORKER_URL = \`\${MFE_BASE}/ticker@1.4.0.worker.js\`;

export const tickerContract = defineIslandContract({
  app: 'ticker',
  props: z.object({
    label: z.string().optional(),
    intervalMs: z.number().optional(),
  }),
  events: { tick: z.object({ count: z.number() }) },
  worker: () =>
    new Worker(
      // blob: is same-origin, the remote import inside it fetches w/ CORS
      URL.createObjectURL(
        new Blob([\`import \${JSON.stringify(WORKER_URL)};\`], {
          type: 'text/javascript',
        }),
      ),
      { type: 'module' },
    ),
});`}
      />
      <p>
        Three rules, all browser/platform constraints rather than Atoll ones:
      </p>
      <ul>
        <li>
          <strong>Same-origin worker URL</strong>, the constructor itself
          never consults CORS; the remote bundle loads through the blob (or
          a hosted shim file) and its <code>import</code> fetches
          cross-origin.
        </li>
        <li>
          <strong>CORS</strong>: the remote bundle needs{' '}
          <code>Access-Control-Allow-Origin</code> for that import fetch.
          That single header also satisfies COEP on the shell page
          (module-worker fetches are CORS-mode, so neither{' '}
          <code>require-corp</code> nor <code>credentialless</code> asks for
          more).
        </li>
        <li>
          <strong>Version the URL</strong>, bundlers fingerprint local
          entries for free; a remote URL is the cache key, so pin a version
          or content hash (<code>ticker@1.4.0.worker.js</code>) and keep the
          contract module and deployed bundle on the same version, prop or
          event drift surfaces as a mount-time or emit-time{' '}
          <code>ZodError</code>.
        </li>
      </ul>
      <p>
        Two publish-build edges the scaffolded{' '}
        <code>vite.mfe.config.ts</code> handles for you: lib mode doesn't
        define <code>process.env.NODE_ENV</code> (framework dev/prod checks
        crash on a bare <code>process</code>), and the contract's own worker
        factory is bundled into the artifact: its <code>new URL</code> would
        resolve the <em>previous</em> dist-mfe output and inline it into its
        successor. A small <code>enforce: 'pre'</code> plugin stubs it (dead
        code anyway: a worker never spawns itself). See the working pair in{' '}
        <code>examples/mfe-publish</code> + <code>examples/mfe-consumer</code>.
      </p>
      <p>
        Page-side requirements don't change: the SharedArrayBuffer doorbell
        still needs COOP/COEP on the <em>shell</em> (the buffer is posted to
        the worker, not fetched), and non-isolated pages fall back to{' '}
        <code>mode: 'poll'</code> / <code>doorbell: false</code> as before.
        The full serving matrix and failure table live in the repo's{' '}
        <code>docs/islands-remote.md</code>.
      </p>
    </article>
  );
}
