import { CodeBlock } from '../components/CodeBlock';
import { DemoFrame } from '../components/DemoFrame';
import type { FrameworkDoc } from '../frameworks';

export function FrameworkPage({ fw }: { fw: FrameworkDoc }) {
  return (
    <article>
      <h1>{fw.name}</h1>
      <p className="lead">
        <code>{fw.binding}</code> — {fw.summary}
      </p>

      <h2>Live demo</h2>
      <DemoFrame id={fw.id} port={fw.port} name={fw.binding} />

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

      <h2>The binding itself</h2>
      <p>
        Bindings contain zero domain code — they adapt the sdk's{' '}
        <code>ObservableValue</code>/<code>AsyncTask</code> to the framework's
        reactivity model. This is the whole package:
      </p>
      <CodeBlock code={fw.bindingSource} file={fw.bindingFile} />

      <h2>Composition — the app connects the dots</h2>
      <p>
        The example owns the incident-specific glue: it imports the domain tasks and
        contract from <code>@jwhenry123/mesh-incidents</code> and binds them through{' '}
        <code>{fw.binding}</code>.
      </p>
      <CodeBlock code={fw.glueSource} file={fw.glueFile} />

      <h2>View</h2>
      <CodeBlock code={fw.viewSource} file={fw.viewFile} language={fw.viewLanguage} />

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
