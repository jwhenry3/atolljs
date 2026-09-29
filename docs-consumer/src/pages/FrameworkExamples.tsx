import { CodeBlock } from '../components/CodeBlock';
import type { FrameworkDoc } from '../frameworks';

/**
 * Per-framework examples sub-page — the patterns that don't fit the minimal
 * usage snippet (data-layer composition, field slicing, task-state UI).
 * Content lives in fw.examples so it stays beside the rest of the doc data.
 */
export function FrameworkExamples({ fw }: { fw: FrameworkDoc }) {
  return (
    <article>
      <h1>{fw.name} — examples</h1>
      <p className="lead">
        Beyond the minimal binding snippet — the patterns{' '}
        <code>examples/{fw.id}</code> is built on: composing a data layer,
        slicing shared fields, and driving the UI off task state.
      </p>

      {fw.examples.map((ex) => (
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
