import { CodeBlock } from '../components/CodeBlock';
import { DemoFrame } from '../components/DemoFrame';
import type { FrameworkDoc } from '../frameworks';

export function FrameworkPage({ fw }: { fw: FrameworkDoc }) {
  return (
    <article>
      <h1>{fw.name}</h1>
      <p className="lead">
        <code>{fw.pkg}</code> — {fw.summary}
      </p>

      <h2>Install</h2>
      <CodeBlock code={fw.install} language="bash" />

      <h2>Usage</h2>
      <CodeBlock code={fw.usage} file={fw.usageFile} language={fw.usageLanguage} />

      <h2>Binding API</h2>
      <table className="doc-table">
        <thead>
          <tr><th>Export</th><th>Signature</th><th>What it does</th></tr>
        </thead>
        <tbody>
          {fw.apis.map((api) => (
            <tr key={api.name}>
              <td><code>{api.name}</code></td>
              <td><code>{api.signature}</code></td>
              <td>{api.desc}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Live demo</h2>
      <DemoFrame id={fw.id} port={fw.port} name={fw.pkg} />

      {fw.notes.length > 0 && (
        <>
          <h2>Notes</h2>
          <ul>
            {fw.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </>
      )}
    </article>
  );
}
