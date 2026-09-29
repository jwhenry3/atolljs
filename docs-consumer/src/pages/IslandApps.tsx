import { CodeBlock } from '../components/CodeBlock';

export function IslandApps() {
  return (
    <article>
      <h1>Writing island apps</h1>
      <p className="lead">
        Island apps run inside the worker against a proxy document — every
        mutation serializes to ops the shell replays. Three app shapes cover
        the spectrum from "plain component" to "DOM-heavy library, unmodified".
      </p>

      <h2>Three app kinds</h2>
      <table className="doc-table">
        <thead>
          <tr><th>Shape</th><th>What it is</th></tr>
        </thead>
        <tbody>
          <tr><td>React component</td><td><code>(props) =&gt; ReactElement</code> — reconciled into the instance's own root by a real react-reconciler in the worker.</td></tr>
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
import { Slot } from '@atolljs/react-island/worker'; // React islands

// island → shell: lands in mountIsland's onEvent.
emit('rowSelected', { id: row.id });

// shell → island: pass a function marker in props…
//   props: { onSave: callbackProp((id) => save(id)) }   // from atoll-islands
// …the worker receives a callable (fire-and-forget — no return channel):
props.onSave(id);

// Transclusion — the shell fills this leaf with real main-thread DOM:
<Slot name="preview" />            // React helper
doc.createElement('div').setAttribute('data-atoll-slot', 'preview'); // any app`}
      />
      <p>
        Mediation is unidirectional by convention — <code>emit</code> →{' '}
        <code>onEvent</code> → shell state → back in as props. Slots are the
        escape hatch for content the worker can't own (canvases, Monaco,
        Google Maps JS): the worker owns the box, the shell owns the contents.
      </p>

      <h2>The proxy document</h2>
      <p>
        Each instance gets a <code>ProxyDocument</code> covering what frameworks
        and libraries actually touch: <code>createElement(NS)</code>/
        <code>createTextNode</code>/<code>createComment</code>,
        <code>insertBefore</code>/<code>appendChild</code>/<code>removeChild</code>{' '}
        (fragments splice in), <code>setAttribute(NS)</code>, reflected
        properties (<code>value</code>, <code>checked</code>,{' '}
        <code>src</code>…), <code>classList</code>/<code>style</code>/
        <code>dataset</code>, <code>textContent</code>, <code>innerHTML</code>,
        <code>cloneNode</code>, <code>template.content</code>, shadow-tree
        reads (<code>children</code>, <code>querySelector</code>,{' '}
        <code>getElementsBy*</code>), and <code>addEventListener</code> with{' '}
        <code>{'{ once, passive, capture }'}</code> crossing the wire.
      </p>
      <ul>
        <li><b>Geometry is one honest box</b> — a ResizeObserver pushes the island container's size into the instance; <code>doc.body</code>/<code>documentElement</code>/<code>doc.markContainer(el)</code> report it. Everything else returns 0/empty. <code>doc.onResize(cb)</code> re-fires on each push.</li>
        <li><b><code>installDomShim(doc)</code></b> puts the proxy doc on <code>globalThis.document</code> plus a <code>window</code> facade so real DOM-dependent libraries run unmodified — install it <em>before</em> a dynamic <code>import('lib')</code> for libraries that read globals at module scope.</li>
        <li><b>Instance-aware globals</b> — <code>document</code>/<code>window</code>/<code>Element</code> are accessors resolving to the active instance, so libraries work without an explicit shim in React islands too.</li>
        <li><b>Worker-initiated work re-enters explicitly</b> — timers/promise continuations have no active instance: <code>runInInstance(instance, fn)</code> + <code>bumpOpsVersion()</code> to flush.</li>
      </ul>

      <h2>Events</h2>
      <p>
        Handlers receive spec-shaped wire payloads — pointer coords, modifiers,
        wheel deltas, <code>key</code>, and form state stamped onto{' '}
        <code>e.target.value</code>/<code>checked</code>.{' '}
        <code>preventDefault</code>/<code>stopPropagation</code> are no-ops —
        the real event already dispatched on the main thread.
      </p>

      <h2>Limits</h2>
      <ul>
        <li>Only the island container is measured — arbitrary-element geometry and SVG metrics (<code>getBBox</code>…) return 0.</li>
        <li><code>getContext('2d'/'webgl')</code> is out of scope — canvas libraries belong on <code>OffscreenCanvas</code>, a different transport.</li>
        <li>Async callbacks that mutate or emit outside a task need <code>runInInstance</code>.</li>
      </ul>

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
