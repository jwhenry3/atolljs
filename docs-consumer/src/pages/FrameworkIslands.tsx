import { CodeBlock } from '../components/CodeBlock';
import { PkgLink } from '../components/PkgLink';
import { docHref } from '../link';
import { ISLAND_FRAMEWORKS } from '../islandFrameworks';

export function FrameworkIslands({ id }: { id: string }) {
  const fw = ISLAND_FRAMEWORKS[id];
  if (!fw) return <article><h1>Unknown framework</h1></article>;
  return (
    <article>
      <h1>{fw.name}</h1>
      <p className="lead">
        {fw.intro}{' '}
        Install <PkgLink name={fw.pkg} /> for the shell bindings and the worker-side
        renderer.
      </p>
      {fw.componentCode && (
        <>
          <h2>Worker component — what goes inside</h2>
          <CodeBlock file={fw.componentCodeFile} code={fw.componentCode} />
        </>
      )}
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
        <code>mountIsland</code> — see the <a href={docHref('islands')}>Islands</a>{' '}
        page for the underlying options (modes, slots, lifecycle), and{' '}
        <a href={docHref('island-apps')}>Writing island apps</a> for the worker-side
        authoring surface.
      </p>
    </article>
  );
}
