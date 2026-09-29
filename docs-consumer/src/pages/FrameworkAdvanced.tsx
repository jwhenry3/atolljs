import { CodeBlock } from '../components/CodeBlock';
import type { FrameworkDoc } from '../frameworks';

/**
 * Per-framework advanced-usage sub-page — pool tuning, per-call
 * abort/timeout, shared observables, lifecycle. Content lives in
 * fw.advanced beside the rest of the doc data.
 */
export function FrameworkAdvanced({ fw }: { fw: FrameworkDoc }) {
  return (
    <article>
      <h1>{fw.name} — advanced usage</h1>
      <p className="lead">
        Escape hatches past the binding layer: <code>connectWorker</code>{' '}
        tuning, per-call abort/timeout, shared observables, and pool
        lifecycle — same APIs under every framework's idiom.
      </p>

      {(fw.advanced ?? []).map((ex) => (
        <section key={ex.title}>
          <h2>{ex.title}</h2>
          {ex.desc && <p>{ex.desc}</p>}
          <CodeBlock
            code={ex.code}
            file={ex.file}
            language={ex.language ?? fw.usageLanguage}
          />
        </section>
      ))}
    </article>
  );
}
