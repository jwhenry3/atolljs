import { CodeBlock } from '../components/CodeBlock';
import { PkgLink } from '../components/PkgLink';
import { docHref } from '../link';

const KINDS: [string, string][] = [
  ['worker', 'pooled worker + typed client (any host), + framework bindings on UI projects'],
  ['memory', 'a *.memory.ts shared-memory contract module'],
  ['island', 'worker-rendered UI, facade (contract + lazy import) or mono variant'],
  ['mfe', 'publishable micro-frontend, island contract + contracted worker + vite.mfe.config.ts publish build'],
  ['service', 'nestjs, @AtollService class facade + registerPool module + worker entry'],
  ['method', 'nestjs, @AtollTask method-level offload on an existing service'],
  ['module', 'nestjs, registerPool boundary module + worker entry'],
  ['housed', 'nestjs, route subtree served entirely inside workers (+ gateway wiring)'],
  ['route', 'nextjs, app/api/<name>/ route pool, task or client variant'],
  ['component', "nextjs, 'use client' component bound to a pool via hooks"],
  ['instrumentation', 'nextjs, server bootstrap that warms route pools at boot'],
  ['devtools', 'observability, devtools.ts init module + @atolljs/devtools dev dep (any host)'],
];

export function Cli() {
  return (
    <article>
      <h1>The atoll CLI</h1>
      <p className="lead">
        <PkgLink name="@atolljs/cli" /> scaffolds pools, shared-memory contracts, and
        worker-rendered islands, and audits the setup. Source-level generator: it writes
        readable files into your project, nothing it emits is a runtime dependency.
      </p>
      <p>
        <strong>Experimental.</strong> The command grammar and generated code are still
        evolving: expect breaking changes between minor releases. Bugs and feedback:{' '}
        <a href="https://github.com/jwhenry3/atolljs/issues" target="_blank" rel="noreferrer">
          github.com/jwhenry3/atolljs/issues
        </a>
        .
      </p>

      <h2>Run it</h2>
      <CodeBlock
        language="bash"
        code={`npx @atolljs/cli <command>
# or, once installed: atoll <command>`}
      />
      <p>
        Requires Node ≥ 20.12: the bin ships pre-bundled, so there's nothing to
        compile on install. The generated <em>app</em> code runs on
        Node ≥ 20 and in browsers.
      </p>

      <h2>
        <code>atoll new &lt;dir&gt;</code>
      </h2>
      <p>
        Scaffold a fresh app: a Vite shell with{' '}
        <a href={docHref('hosting')}>COOP/COEP headers</a> already set, a worker-rendered
        counter island, and a hardened <code>.npmrc</code>:
      </p>
      <CodeBlock
        language="bash"
        code={`atoll new my-app --framework react   # react | vue | solid | svelte | node
atoll new my-api --framework node    # tsx Node service with a pooled worker
atoll new my-mfe --framework vue --mfe  # publishable micro-frontend package`}
      />
      <p>
        <code>--pm npm</code> picks the install command. Angular apps scaffold through the
        Angular CLI instead: <code>ng new</code>, then <code>atoll init</code> (and{' '}
        <code>atoll add mfe</code> for the MFE shape). <code>--mfe</code> flips the
        scaffold to a publishable package: <code>src/mfe/</code> contract + contracted
        worker, a <code>vite.mfe.config.ts</code> bundle build, and a dev harness page
        that mounts the island <em>through its own contract</em>, so what you preview
        is what a consumer sees. The package's <code>exports</code> points at the
        contract module; the worker bundle ships under <code>dist-mfe/</code> as a
        fetched asset.
      </p>

      <h2>
        <code>atoll init</code>
      </h2>
      <p>
        Wire Atoll into an existing project: writes the supply-chain{' '}
        <code>.npmrc</code> (<code>min-release-age=7</code>, <code>ignore-scripts</code>),
        installs the <code>@atolljs/*</code> packages your detected framework needs, and
        generates a working spine: <code>src/atoll/app.memory.ts</code>,{' '}
        <code>app.worker.ts</code>, and a typed <code>app.ts</code> client.
      </p>

      <h2>
        <code>atoll add [framework] &lt;kind&gt; [variant] [name]</code>
      </h2>
      <p>
        Generate a piece into the current project. The leading framework word overrides
        project detection: <code>atoll add react island facade counter</code>. Kinds
        without a framework scope run anywhere:
      </p>
      <table className="doc-table">
        <thead>
          <tr>
            <th>kind</th>
            <th>generates</th>
          </tr>
        </thead>
        <tbody>
          {KINDS.map(([kind, what]) => (
            <tr key={kind}>
              <td className="nowrap">
                <code>{kind}</code>
              </td>
              <td>{what}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>
        Variants resolve as a positional (<code>add island facade counter</code>),{' '}
        <code>--variant</code>, an interactive pick, or the first listed non-interactively.
        A new worker wires the lone <code>*.memory.ts</code> in its directory
        automatically: <code>--memory &lt;name&gt;</code> pins one,{' '}
        <code>--no-memory</code> opts out.
      </p>
      <p>
        <code>add mfe &lt;name&gt;</code> is the island-scoped kind with a publishing
        twist: besides <code>src/mfe/&lt;name&gt;.contract.ts</code> and the contracted
        worker entry, it writes a <code>vite.mfe.config.ts</code> at the project root:
        a <em>separate</em> Vite config so your app's own build is untouched.{' '}
        <code>vite build --config vite.mfe.config.ts</code> emits one self-contained{' '}
        <code>dist-mfe/&lt;name&gt;.worker.js</code>, and its{' '}
        <code>preview.headers</code> carry <code>Access-Control-Allow-Origin</code> as
        a working CORS example. It warns when the project has no <code>vite</code>{' '}
        (e.g. Angular CLI apps: install it to use the publish build). See{' '}
        <a href={docHref('island-mfe')}>micro-frontends</a> for the full model.
      </p>
      <p>
        <code>add devtools [session-name]</code> writes a{' '}
        <code>src/atoll/devtools.ts</code> init module, import it first in your app
        entry so the sink is installed before any pool spawns, and offers to install{' '}
        <code>@atolljs/devtools</code> as a dev dependency. The emitted file matches
        your host: browser apps get the <code>?__atoll_devtools</code> URL gate with
        the BroadcastChannel transport + flyout overlay, Angular apps get the
        aggregate-server variant (no <code>/__atoll/</code> mount), and Node hosts get
        the <code>@atolljs/devtools/node</code> entry gated on{' '}
        <code>ATOLL_DEVTOOLS=1</code>. See <a href={docHref('devtools')}>devtools</a>.
      </p>

      <h2>
        <code>atoll doctor [--fix]</code>
      </h2>
      <p>
        Audits the setup, each check maps to an invariant in these docs:
      </p>
      <ul>
        <li>Node ≥ 22.18 for the CLI bin, ≥ 20 for the runtime it generates</li>
        <li>
          <code>@atolljs/*</code> dependencies present and a lockfile committed
        </li>
        <li>
          <code>.npmrc</code> supply-chain policy, <code>--fix</code> writes it
        </li>
        <li>
          worker entries bundler-detectable, every <code>new Worker(</code> must take{' '}
          <code>new URL('./x.worker.ts', import.meta.url)</code> inline so the bundler can
          see it
        </li>
        <li>
          COOP/COEP headers in the Vite config, the{' '}
          <a href={docHref('hosting')}>SharedArrayBuffer gate</a> (skipped for Node
          projects)
        </li>
      </ul>

      <h2>Flags &amp; behavior</h2>
      <table className="doc-table">
        <tbody>
          <tr>
            <td className="nowrap">
              <code>--yes / -y</code>
            </td>
            <td>accept every default: implied when there's no TTY</td>
          </tr>
          <tr>
            <td className="nowrap">
              <code>--force</code>
            </td>
            <td>overwrite existing files (they're never touched otherwise)</td>
          </tr>
          <tr>
            <td className="nowrap">
              <code>--no-install</code>
            </td>
            <td>write files but skip the dependency install</td>
          </tr>
          <tr>
            <td className="nowrap">
              <code>--dir &lt;path&gt;</code>
            </td>
            <td>
              output directory for <code>add</code> (default <code>src/atoll/</code>)
            </td>
          </tr>
        </tbody>
      </table>
      <p>
        Missing answers prompt interactively. The bootstrap install runs once with{' '}
        <code>--min-release-age=0</code>: the just-written <code>.npmrc</code> would
        otherwise block the brand-new packages it installs; the policy governs every
        install after that.
      </p>
    </article>
  );
}
