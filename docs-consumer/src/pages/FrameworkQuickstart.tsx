import { CodeBlock } from '../components/CodeBlock';
import { docHref } from '../link';
import type { FrameworkDoc } from '../frameworks';
import { SHARED_CONNECT, SHARED_MEMORY, SHARED_WORKER } from '../snippets';

/**
 * Per-framework quickstart — the same minimal counter as the top-level
 * Quickstart page, ending in this framework's binding step. Steps 2–4 are
 * shared snippets (framework-agnostic); the framework contributes its
 * install command, usage file, and a one-line binding note
 * (fw.quickstartNote).
 */
export function FrameworkQuickstart({ fw }: { fw: FrameworkDoc }) {
  return (
    <article>
      <h1>{fw.name} — quickstart</h1>
      <p className="lead">
        A minimal counter in {fw.name}: one shared field, one worker method,
        one component. Steps 2–4 are the same for every framework — only the
        last step differs.
      </p>

      <h2>1 · Install</h2>
      <CodeBlock code={fw.install} language="bash" />

      <h2>2 · Declare shared memory — imported by both threads</h2>
      <CodeBlock code={SHARED_MEMORY} file="counter.memory.ts" />

      <h2>3 · Define the worker — methods live here</h2>
      <CodeBlock code={SHARED_WORKER} file="counter.worker.ts" />

      <h2>4 · Connect from the main thread — type only</h2>
      <CodeBlock code={SHARED_CONNECT} file="counter.ts" />

      <h2>5 · Bind it in {fw.name}</h2>
      {fw.quickstartNote && <p>{fw.quickstartNote}</p>}
      <CodeBlock code={fw.usage} file={fw.usageFile} language={fw.usageLanguage} />

      <h2>With shared memory: cross-origin isolation</h2>
      <p>
        <code>SharedArrayBuffer</code> only exists when the page is
        cross-origin isolated — see <a href={docHref('hosting')}>Hosting &amp; headers</a>{' '}
        for the COOP/COEP setup. Leave <code>sharedMemory</code> out of both{' '}
        <code>defineWorker</code> and <code>connectWorker</code> and you have a
        typed, pooled worker RPC that needs neither header.
      </p>
    </article>
  );
}
