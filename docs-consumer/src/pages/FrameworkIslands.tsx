import { CodeBlock } from '../components/CodeBlock';
import { ISLAND_FRAMEWORKS } from '../islandFrameworks';

export function FrameworkIslands({ id }: { id: string }) {
  const fw = ISLAND_FRAMEWORKS[id];
  if (!fw) return <article><h1>Unknown framework</h1></article>;
  return (
    <article>
      <h1>{fw.name}</h1>
      <p className="lead">
        {fw.intro}{' '}
        Install <code>{fw.pkg}</code> for the shell bindings and the worker-side
        renderer.
      </p>
      {fw.workerCode && (
        <>
          <h2>Worker entry</h2>
          <CodeBlock file={fw.workerCodeFile} code={fw.workerCode} />
        </>
      )}
      {fw.shellCode && (
        <>
          <h2>Shell</h2>
          <CodeBlock file={fw.shellCodeFile} code={fw.shellCode} />
        </>
      )}
      <h2>Notes</h2>
      <ul>
        {fw.notes.map((n) => <li key={n}>{n}</li>)}
      </ul>
      <p>
        Shell bindings wrap <code>connectIslandWorker</code> +{' '}
        <code>mountIsland</code> — see the <a href="#/islands">Worker islands</a>{' '}
        page for the underlying options (modes, slots, lifecycle), and{' '}
        <a href="#/island-apps">Writing island apps</a> for the worker-side
        authoring surface.
      </p>
    </article>
  );
}
