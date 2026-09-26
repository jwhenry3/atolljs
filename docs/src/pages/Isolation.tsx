import { CodeBlock } from '../components/CodeBlock';

export function Isolation() {
  return (
    <article>
      <h1>Cross-origin isolation</h1>
      <p className="lead">
        <code>SharedArrayBuffer</code> is only exposed when{' '}
        <code>window.crossOriginIsolated === true</code>. That flag — not CORS —
        is the gate, and every page in this repo (apps, docs, embedded demos)
        has to satisfy it independently.
      </p>

      <h2>Top-level documents</h2>
      <p>A document becomes cross-origin isolated by sending two headers:</p>
      <CodeBlock
        code={`Cross-Origin-Opener-Policy:   same-origin
Cross-Origin-Embedder-Policy: require-corp`}
        language="plaintext"
      />
      <p>
        Verified in a clean-room check (<code>scripts/diag-sab.mjs</code>): a
        document with no headers reports{' '}
        <code>crossOriginIsolated: false</code> /{' '}
        <code>SharedArrayBuffer: undefined</code>; the same document with
        COOP+COEP reports <code>true</code> / <code>function</code>.
      </p>

      <h2>Inside an iframe — the full chain</h2>
      <p>
        Embedding an app that uses shared memory in a cross-origin iframe
        requires four independent pieces. If any one is missing, Chrome blocks
        the navigation with <code>ERR_BLOCKED_BY_RESPONSE</code> or the child
        loads without isolation.
      </p>
      <ol>
        <li>
          <strong>Parent sends COEP</strong> — the embedding page must itself be
          cross-origin isolated.
        </li>
        <li>
          <strong>
            <code>allow="cross-origin-isolated"</code> on the{' '}
            <code>&lt;iframe&gt;</code>
          </strong>{' '}
          — the parent must <em>delegate</em> isolation to the frame. Without
          it, a fully-configured child is still blocked. (Set in{' '}
          <code>DemoFrame</code>.)
        </li>
        <li>
          <strong>Child sends COEP + COOP</strong> — under a{' '}
          <code>require-corp</code> parent, a cross-origin document must be
          capable of isolation itself.
        </li>
        <li>
          <strong>Child sends CORP</strong> — the resource-policy opt-in for the
          cross-origin fetch: <code>same-site</code> suffices when embedder and
          app share a site (e.g. different <code>localhost</code> ports); use{' '}
          <code>cross-origin</code> for arbitrary embedders.
        </li>
      </ol>

      <h2>Measured requirement matrix</h2>
      <p>
        COEP parent on <code>:5991</code>, children cross-origin on{' '}
        <code>:5993</code>, iframe carries{' '}
        <code>allow="cross-origin-isolated"</code> — Chrome's CDP{' '}
        <code>blockedReason</code> for each child header set:
      </p>
      <table className="doc-table">
        <thead>
          <tr><th>Child headers</th><th>Result</th><th>blockedReason</th></tr>
        </thead>
        <tbody>
          <tr>
            <td>COEP + COOP + CORP same-site</td>
            <td>loads, <code>crossOriginIsolated: true</code>, SAB live in-frame</td>
            <td>—</td>
          </tr>
          <tr>
            <td>COEP + COOP, no CORP</td>
            <td>blocked</td>
            <td><code>corp-not-same-origin-after-defaulted-to-same-origin-by-coep</code></td>
          </tr>
          <tr>
            <td>CORP same-site, no COEP</td>
            <td>blocked</td>
            <td><code>coep-frame-resource-needs-coep-header</code></td>
          </tr>
          <tr>
            <td>no headers</td>
            <td>blocked</td>
            <td><code>corp-not-same-origin-…</code></td>
          </tr>
        </tbody>
      </table>
      <p>
        Framing permission is a separate axis: <code>frame-ancestors</code> CSP
        controls <em>who may embed</em>, while CORP controls{' '}
        <em>whether the response can be consumed cross-origin</em>.
      </p>

      <h2>Quirks that bit us</h2>
      <ul>
        <li>
          <strong><code>localhost</code> and <code>127.0.0.1</code> are
          different <em>sites</em>.</strong> <code>CORP: same-site</code> between
          two <code>localhost</code> ports passes; the same layout on{' '}
          <code>127.0.0.1</code> fails (<code>corp-not-same-site</code>). Match
          the hostname between embedder and child, or widen CORP.
        </li>
        <li>
          <strong><code>credentialless</code> iframes can't isolate.</strong> A
          credentialless frame is never cross-origin isolated — SAB is
          undefined inside it — so the demo frames must not use it.
        </li>
        <li>
          <strong>Dev servers don't hot-reload headers.</strong>{' '}
          <code>ng serve</code> and <code>next dev</code> read header config at
          startup — restart them after editing, or the inspector shows stale
          responses.
        </li>
        <li>
          <strong>Stable <code>index.html</code> URLs cache aggressively.</strong>{' '}
          Assets are content-hashed but the document URL never changes — this
          repo stamps links with <code>?v=&lt;build id&gt;</code> and serves{' '}
          <code>Cache-Control: no-store</code> on every surface.
        </li>
      </ul>

      <h2>Where this repo sets it</h2>
      <table className="doc-table">
        <thead>
          <tr><th>Surface</th><th>Config</th></tr>
        </thead>
        <tbody>
          <tr><td>static preview (<code>serve:all</code> / <code>serve:docs</code>)</td><td><code>scripts/serve-static.mjs</code></td></tr>
          <tr><td>vite dev servers (examples + docs)</td><td><code>server.headers</code> in each <code>vite.config.ts</code></td></tr>
          <tr><td>angular dev server</td><td><code>serve.options.headers</code> in <code>angular.json</code></td></tr>
          <tr><td>next.js (<code>dev</code> + <code>start</code>)</td><td><code>headers()</code> in <code>next.config.ts</code></td></tr>
          <tr><td>iframe delegation</td><td><code>allow="cross-origin-isolated"</code> in <code>docs/src/components/DemoFrame.tsx</code></td></tr>
        </tbody>
      </table>
      <p>
        Re-run the empirical check anytime:{' '}
        <code>node scripts/diag-sab.mjs</code> spins up fresh servers and probes
        the matrix in real Chromium;{' '}
        <code>node scripts/diag-iframe.mjs http://localhost:4180/#/fw-react</code>{' '}
        verifies the live docs embedding end to end.
      </p>
    </article>
  );
}
