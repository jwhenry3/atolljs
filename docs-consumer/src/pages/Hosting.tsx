import { CodeBlock } from '../components/CodeBlock';

export function Hosting() {
  return (
    <article>
      <h1>Hosting &amp; headers</h1>
      <p className="lead">
        <code>SharedArrayBuffer</code> is only exposed when{' '}
        <code>window.crossOriginIsolated === true</code>. That flag — not CORS —
        is the gate, and your host must opt the document into it on every
        response.
      </p>

      <h2>Required response headers</h2>
      <CodeBlock
        code={`Cross-Origin-Opener-Policy:   same-origin
Cross-Origin-Embedder-Policy: require-corp`}
        language="plaintext"
      />
      <p>
        Without them the SDK can't create the shared buffer:{' '}
        <code>crossOriginIsolated</code> is <code>false</code> and{' '}
        <code>SharedArrayBuffer</code> is <code>undefined</code>.
      </p>

      <h2>Per-server configuration</h2>
      <CodeBlock
        file="vite.config.ts (dev + preview)"
        code={`export default defineConfig({
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Resource-Policy': 'same-site',
    },
  },
});`}
      />
      <CodeBlock
        file="angular.json (ng serve)"
        language="json"
        code={`"serve": {
  "builder": "@angular/build:dev-server",
  "options": {
    "headers": {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
      "Cross-Origin-Resource-Policy": "same-site"
    }
  }
}`}
      />
      <CodeBlock
        file="next.config.ts (dev + next start)"
        code={`async headers() {
  return [{
    source: '/:path*',
    headers: [
      { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
      { key: 'Cross-Origin-Embedder-Policy', value: 'require-corp' },
      { key: 'Cross-Origin-Resource-Policy', value: 'same-site' },
    ],
  }];
}`}
      />
      <CodeBlock
        file="nginx"
        language="bash"
        code={`add_header Cross-Origin-Opener-Policy "same-origin" always;
add_header Cross-Origin-Embedder-Policy "require-corp" always;
add_header Cross-Origin-Resource-Policy "same-site" always;`}
      />

      <h2>Embedding your app in an iframe</h2>
      <p>
        Cross-origin embedding requires four independent pieces — if any one is
        missing, Chrome blocks the navigation (
        <code>ERR_BLOCKED_BY_RESPONSE</code>) or the child loads without
        isolation:
      </p>
      <ol>
        <li>The <strong>parent page</strong> is itself cross-origin isolated.</li>
        <li>
          The <strong>iframe element</strong> delegates isolation:{' '}
          <code>allow="cross-origin-isolated"</code>. Without it, a
          fully-configured child is still blocked.
        </li>
        <li>
          The <strong>child sends COEP + COOP</strong> — a cross-origin document
          embedded under a <code>require-corp</code> parent must be capable of
          isolation itself.
        </li>
        <li>
          The <strong>child sends CORP</strong> —{' '}
          <code>same-site</code> suffices when embedder and app share a site
          (e.g. different <code>localhost</code> ports);{' '}
          <code>cross-origin</code> for arbitrary embedders.
        </li>
      </ol>
      <CodeBlock
        code={`<iframe src="https://app.example.com" allow="cross-origin-isolated"></iframe>`}
        language="html"
      />

      <h3>Measured requirement matrix</h3>
      <p>
        COEP parent embedding cross-origin children; Chrome's block reason for
        each child header set:
      </p>
      <table className="doc-table">
        <thead>
          <tr><th>Child headers</th><th>Result</th><th>blockedReason</th></tr>
        </thead>
        <tbody>
          <tr>
            <td>COEP + COOP + CORP same-site</td>
            <td>loads, isolated, <code>SharedArrayBuffer</code> live in-frame</td>
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
        Separately, <code>frame-ancestors</code> CSP controls <em>who may
        embed</em> your app — an independent axis from CORP:
      </p>
      <CodeBlock
        code={`Content-Security-Policy: frame-ancestors 'self' https://docs.example.com`}
        language="plaintext"
      />

      <h2>Gotchas</h2>
      <ul>
        <li>
          <strong><code>localhost</code> ≠ <code>127.0.0.1</code>.</strong> Chrome
          treats them as different <em>sites</em>: <code>CORP: same-site</code>{' '}
          between <code>localhost</code> ports passes, the same layout on{' '}
          <code>127.0.0.1</code> fails. Match hostnames between embedder and
          child, or use <code>CORP: cross-origin</code>.
        </li>
        <li>
          <strong>Avoid <code>credentialless</code> iframes</strong> — a
          credentialless frame can never be cross-origin isolated, so{' '}
          <code>SharedArrayBuffer</code> is undefined inside it.
        </li>
        <li>
          <strong>Dev servers don't hot-reload header config</strong> — restart
          after editing <code>angular.json</code>, <code>next.config.ts</code>,
          etc.
        </li>
        <li>
          <strong>Serve <code>index.html</code> with{' '}
          <code>Cache-Control: no-store</code></strong> (or stamp its URL with a
          per-build <code>?v=</code>) — assets are content-hashed, but the
          stable document URL is exactly what stale caches hold onto.
        </li>
      </ul>
    </article>
  );
}
