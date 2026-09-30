import { islandPerfStats } from '../islandPerfStats';
import { docHref } from '../link';
import { Segments } from '../components/SplitBar';

const kb = (bytes: number) => (bytes / 1024).toFixed(0);

const OPS: { op: string; emits: string; notes: string }[] = [
  { op: 'create', emits: 'createElement(NS)', notes: '`{ id, type, props, ns? }` — props arrive wire-serialized; `ns` keeps SVG/MathML correctly namespaced (foreignObject/desc/title return to HTML).' },
  { op: 'text', emits: 'createTextNode', notes: '`{ id, text }` — also how empty comments anchor, so fragments and conditionals have driver-side nodes.' },
  { op: 'append', emits: 'insertBefore / appendChild', notes: '`{ parent, child, before? }` — parent 0 is the root container. Fragments splice their children in.' },
  { op: 'remove', emits: 'removeChild', notes: '`{ child }` — detaches a node wherever it is mounted.' },
  { op: 'update', emits: 're-rendered props', notes: 'Full re-serialized prop set — the driver diffs against its last-seen set, so unchanged props cost nothing.' },
  { op: 'utext', emits: 'text node write', notes: 'New text for a text instance — also how `element.textContent` lands (replaces children with one text node).' },
  { op: 'clear', emits: 'root rebuild', notes: 'Clears the island container — the renderer\'s clearContainer / an imperative instance\'s rebuild.' },
  { op: 'attr', emits: 'setAttribute / classList / dataset', notes: '`{ id, name, value }` — `value: null` removes the attribute.' },
  { op: 'style', emits: 'style mutations', notes: 'Only changed keys cross; `--*` route to setProperty, a trailing `!important` encodes priority.' },
  { op: 'listen', emits: 'addEventListener', notes: '`handler` is a worker handler-table id — the driver wires the DOM listener to dispatch back. `id: 0` targets the root container, which is how delegated/document listeners work.' },
  { op: 'unlisten', emits: 'removeEventListener', notes: 'type + handler identify the binding; `capture` must match the listen\'s.' },
  { op: 'emit', emits: 'emit(name, payload)', notes: 'The one op that is NOT a DOM mutation — the island→shell event channel, delivered to `onEvent`.' },
];

export function ProxyDocument() {
  return (
    <article>
      <h1>Islands — the proxy document</h1>
      <p className="lead">
        Inside the worker there is no DOM — there is a{' '}
        <code>ProxyDocument</code>: a faithful facade that records every
        mutation as an op in a queue. Task calls return the flushed batch;
        the main thread's only job is replaying ops against real nodes. No
        shared memory is involved — ops ride <code>postMessage</code>.
      </p>

      <h2>The pipeline</h2>
      <p>
        <code>
          worker app → ProxyDocument → per-instance op queue → task batch →
          postMessage → driver replay → real DOM
        </code>
      </p>
      <p>
        Every island owns an independent op stream keyed by its{' '}
        <code>app@N</code> instance — separate queue, document, and node map —
        so several islands can share one worker without cross-talk. The task
        surface each worker exposes is fixed: <code>mount</code>,{' '}
        <code>updateProps</code>, <code>dispatch</code>, <code>setSize</code>,{' '}
        <code>flush</code>, <code>unmount</code> — each returns the op batch it
        produced.
      </p>

      <h2>The op vocabulary</h2>
      <p>
        Twelve ops cover the entire protocol — everything a reconciler or
        hand-rolled DOM code can express:
      </p>
      <table className="doc-table">
        <thead>
          <tr><th>Op</th><th>Emitted by</th><th>Semantics</th></tr>
        </thead>
        <tbody>
          {OPS.map((o) => (
            <tr key={o.op}>
              <td><code>{o.op}</code></td>
              <td>{o.emits}</td>
              <td dangerouslySetInnerHTML={{ __html: o.notes.replace(/`([^`]+)`/g, '<code>$1</code>') }} />
            </tr>
          ))}
        </tbody>
      </table>

      <h2>DOM coverage</h2>
      <p>
        The facade implements what frameworks and libraries actually touch:{' '}
        <code>createElement(NS)</code>/<code>createTextNode</code>/
        <code>createComment</code>, <code>insertBefore</code>/
        <code>appendChild</code>/<code>removeChild</code> (fragments splice
        in), <code>setAttribute(NS)</code>, reflected properties (
        <code>value</code>, <code>checked</code>, <code>src</code>…),{' '}
        <code>classList</code>/<code>style</code>/<code>dataset</code>,{' '}
        <code>textContent</code>, <code>innerHTML</code>,{' '}
        <code>cloneNode</code>, <code>template.content</code>, shadow-tree
        reads (<code>children</code>, <code>querySelector</code>,{' '}
        <code>getElementsBy*</code>), and <code>addEventListener</code> with{' '}
        <code>{'{ once, passive, capture }'}</code> crossing the wire.
      </p>
      <ul>
        <li><b>Instance-aware globals</b> — <code>document</code>/<code>window</code>/<code>Element</code> resolve to the active instance, so libraries work without an explicit shim.</li>
        <li><b><code>installDomShim(doc)</code></b> puts the proxy doc on <code>globalThis.document</code> plus a <code>window</code> facade for libraries that read globals at module scope — install it <em>before</em> a dynamic <code>import('lib')</code>.</li>
        <li><b>Worker-initiated work re-enters explicitly</b> — timers and promise continuations have no active instance: <code>runInInstance(instance, fn)</code> + <code>bumpOpsVersion()</code> to flush.</li>
      </ul>

      <h2>Geometry — the one honest box</h2>
      <p>
        The only measurement channel is the island container itself: the
        driver observes <code>el</code> with a ResizeObserver and calls{' '}
        <code>setSize(instance, w, h)</code> at mount and on resizes
        (throttled ~100ms). Geometry reads on <code>doc.body</code>,{' '}
        <code>documentElement</code>, and elements marked{' '}
        <code>doc.markContainer(el)</code> return that box; everything else
        returns an honest 0. <code>doc.onResize(cb)</code> re-fires on each
        push — the callbacks' ops ride back in <code>setSize</code>'s return
        batch.
      </p>

      <h2>Events</h2>
      <p>
        Handlers receive a spec-shaped <code>EventPayload</code> — pointer
        coords, modifiers, wheel deltas (+<code>deltaMode</code>),{' '}
        <code>key</code>, <code>which</code>, <code>pointerType</code>,
        target form state, and <code>scrollTop</code>. A synthesized{' '}
        <code>target</code> gives delegated handlers a proxy-DOM node to
        <code>closest()</code>/<code>dataset</code> against.{' '}
        <code>preventDefault</code>/<code>stopPropagation</code> exist as
        no-ops so library code doesn't crash — they cannot cancel anything:
        the real event already dispatched on the main thread.
      </p>

      <h2>Benchmarks — where the time goes</h2>
      <p>
        Measured, not estimated: the same {islandPerfStats.rows}-row tree
        mounted through every adapter, then a prop-driven update and a
        click→state-commit. Each cell splits the JS cost three ways —{' '}
        <strong>app</strong> (framework render/diff + adapter glue),{' '}
        <strong>engine</strong> (proxy-DOM bookkeeping: op recording, prop
        serialization, instance allocation, queue drain), and{' '}
        <strong>replay</strong> (main thread applying ops to real DOM).
      </p>
      <p className="loadbar-legend">
        <span><span className="swatch swatch-app" />app / renderer</span>
        <span><span className="swatch swatch-proxy" />proxy engine</span>
        <span><span className="swatch swatch-main" />main-thread replay</span>
      </p>
      <table className="doc-table">
        <thead>
          <tr>
            <th>Renderer</th>
            <th>Mount</th>
            <th>Prop update</th>
            <th>Click → commit</th>
          </tr>
        </thead>
        <tbody>
          {islandPerfStats.results.map((r) => (
            <tr key={r.id}>
              <td>{r.label}</td>
              {(['mount', 'update', 'click'] as const).map((k) => {
                const s = r.scenarios[k];
                return (
                  <td key={k} className="num">
                    <Segments
                      segments={[
                        { value: s.appMs, className: 'loadbar-app', title: `app/renderer — ${s.appMs}ms` },
                        { value: s.proxyMs, className: 'loadbar-proxy', title: `proxy engine — ${s.proxyMs}ms` },
                        { value: s.mainMs, className: 'loadbar-main', title: `main replay — ${s.mainMs}ms` },
                      ]}
                    />
                    <div>
                      {s.appMs}+{s.proxyMs}+{s.mainMs}ms ·{' '}
                      <span className="muted">{s.ops} ops</span>
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <ul>
        <li><strong>The engine is cheap relative to the renderer</strong> — framework mounts spend ~10–35% of worker time in proxy bookkeeping; the rest is the framework's own render/diff.</li>
        <li><strong>Imperative is the ceiling case</strong> — with no framework, the app IS proxy calls, so the engine dominates its worker time; that row is the proxy document's own cost profile.</li>
        <li><strong>Replay scales with op count, not tree size</strong> — a diffed framework update emits ~200 ops; the imperative rebuild emits ~2,600 and pays for it on the main thread.</li>
        <li><strong>Clicks are ~all worker</strong> — dispatch runs the handler in the island; typically one op crosses back.</li>
      </ul>

      <h3>Memory &amp; wire inflation</h3>
      <p>
        The proxy layer keeps its own state per island — this is what it
        retains after the three scenarios, plus how much op traffic each
        renderer generated:
      </p>
      <table className="doc-table">
        <thead>
          <tr>
            <th>Renderer</th>
            <th className="num">Proxy nodes</th>
            <th className="num">Handlers</th>
            <th className="num">Ops Σ</th>
            <th className="num">Wire Σ</th>
            <th className="num">Bytes/op</th>
          </tr>
        </thead>
        <tbody>
          {islandPerfStats.results.map((r) => {
            const ops =
              r.scenarios.mount.ops + r.scenarios.update.ops + r.scenarios.click.ops;
            const bytes =
              r.scenarios.mount.opBytes +
              r.scenarios.update.opBytes +
              r.scenarios.click.opBytes;
            return (
              <tr key={r.id}>
                <td>{r.label}</td>
                <td className="num">{r.mem.liveNodes}</td>
                <td className="num">{r.mem.handlers}</td>
                <td className="num">{ops}</td>
                <td className="num">{kb(bytes)} KB</td>
                <td className="num">{Math.round(bytes / (ops || 1))}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <ul>
        <li><strong>One instance record per rendered node</strong> — the shadow map keeps id → record for everything the island has mounted, so a {islandPerfStats.rows}-row tree costs ~1,000+ proxy records on top of the real DOM nodes.</li>
        <li><strong>Records survive removal</strong> — the instance map is never pruned (event dispatch may still resolve a detached target id), so long-lived churning islands accumulate; a full remount is the reclaim.</li>
        <li><strong>~45–50 bytes per op on the wire</strong> — a 200-row mount is a ~100–160 KB structuredClone batch. Big state should live in shared memory, not in props — the serialization boundary is postMessage.</li>
        <li>One happy-dom run on one machine — treat the ratios, not the decimals, as the data. In-process transport is ~free; real workers add marshalling to the worker side. Regenerate with <code>npm run stats:islands</code>.</li>
      </ul>

      <h2>Limits</h2>
      <ul>
        <li>Only the island container is measured — arbitrary-element geometry and SVG metrics (<code>getBBox</code>…) return 0.</li>
        <li><code>getContext('2d'/'webgl')</code> is out of scope — canvas libraries belong on <code>OffscreenCanvas</code>, a different transport.</li>
        <li>Async callbacks that mutate or emit outside a task need <code>runInInstance</code>.</li>
      </ul>
      <p>
        Byte-side numbers — what each thread <em>loads</em> — are on{' '}
        <a href={docHref('bundle-size')}>Bundle size &amp; load</a>; mounting mechanics
        on <a href={docHref('island-apps')}>Quickstart</a>.
      </p>
    </article>
  );
}
