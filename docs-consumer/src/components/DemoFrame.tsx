import { consumerRootHref } from '../link';

interface DemoFrameProps {
  id: string;
  port: number;
  name: string;
  /** Non-index page within the app: e.g. '/react-shell.html'. */
  path?: string;
}

/**
 * Embeds one of the framework example apps. In a docs dev server the examples
 * run on their own ports (npm run dev:all); in the built docs they are mounted
 * at ./<id>/ relative to the site root: works under any base path
 * (serve:all, GitHub Pages). Server-rendered examples (Next.js) get no frame
 * at all: a static host has no Node runtime to render them.
 *
 * Multiple DemoFrames on one page are folded into a tabbed dock by
 * prerender.mjs's docs.js: `name` becomes the tab label, so keep it short.
 */
export function DemoFrame({ id, port, name, path = '' }: DemoFrameProps) {
  const base = import.meta.env.DEV
    ? `${window.location.protocol}//${window.location.hostname}:${port}`
    // Routes are emitted as `<route>/index.html`, so demos mount relative to
    // the consumer root: climb back out of this page's directory first.
    : `${consumerRootHref()}${id}/`;
  // ?v=<build stamp>: index.html keeps a stable name, so a fresh stamp per
  // build forces browsers past aggressively cached documents.
  const src = `${base}${path.replace(/^\//, '')}?v=${__BUILD_ID__}`;
  const label = import.meta.env.DEV
    ? `${window.location.hostname}:${port}${path}`
    : `${id}/${path.replace(/^\//, '')}`;
  return (
    <div className="demo-frame">
      <div className="demo-frame-bar">
        <span className="demo-label">
          <code>{name}</code>
        </span>
        <a href={src} target="_blank" rel="noreferrer">
          {label} ↗
        </a>
      </div>
      <iframe
        src={src}
        title={`${name} live demo`}
        // Let the embedded app keep cross-origin isolation so
        // SharedArrayBuffer stays available inside the frame.
        allow="cross-origin-isolated"
      />
      <p className="demo-hint">
        If the frame is blank, the examples aren't up: run{' '}
        <code>npm run dev:all</code> (dev servers) or <code>npm run serve:all</code>{' '}
        (built apps) from the repository root.
      </p>
    </div>
  );
}
