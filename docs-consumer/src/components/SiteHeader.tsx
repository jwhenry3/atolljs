import { consumerRootHref, routeDepth } from '../link';

/**
 * Sticky top bar — brand, site-level tabs, version switcher, and external
 * icon links. Pure markup (no client JS needed): the same HTML works in the
 * dev app and in the prerendered Pages artifact, where docs.js drives the
 * switcher. Hrefs resolve relative to the consumer root so the artifact
 * works under any mount (/, /consumer/, /atolljs/consumer/, or a versioned
 * snapshot one segment deeper).
 */
// 'v0.1.6' on a release-snapshot build, 'latest' otherwise. Inside a version
// mount the consumer root is one extra '../' down (consumer/v0.1.6/<route>/).
const VERSION = import.meta.env.VITE_DOCS_VERSION || 'latest';
const versioned = VERSION !== 'latest';

// Computed per render — consumerRootHref() depends on the route depth the
// prerender currently emits, so module-level constants would bake depth-0
// links into every page.
const hrefs = () =>
  import.meta.env.DEV
    ? { home: 'http://localhost:4173/', docs: '/', blog: '/blog/' }
    : {
        home: `${consumerRootHref()}${versioned ? '../../' : '../'}`,
        docs: consumerRootHref(),
        blog: `${consumerRootHref()}blog/`,
      };

// Dev-mode handler for the version select (docs.js handles the prerendered
// site) — same segment-swap math: climb to the consumer root, then back down
// through the chosen version dir, preserving the current route.
function versionHref(v: string) {
  const up = '../'.repeat(routeDepth() + (versioned ? 1 : 0));
  const segs = location.pathname.split('/').filter(Boolean);
  const rel = routeDepth() ? `${segs.slice(-routeDepth()).join('/')}/` : '';
  return up + (v === 'latest' ? '' : `${v}/`) + rel;
}

const GITHUB =
  'M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12';
const NPM =
  'M1.763 0C.786 0 0 .786 0 1.763v20.474C0 23.214.786 24 1.763 24h20.474c.977 0 1.763-.786 1.763-1.763V1.763C24 .786 23.214 0 22.237 0H1.763zM5.13 5.323l13.837.019-.009 13.836h-3.464l.01-10.382h-3.456L12.04 19.17H5.113V5.323z';

export function SiteHeader({ active }: { active: 'docs' | 'blog' }) {
  const href = hrefs();
  return (
    <header className="site-header">
      <a className="site-brand" href={href.docs}>
        {/* The horizontal lockup packs a tagline that's illegible at header
            height — icon + real text stays crisp at any size. */}
        <img src={`${consumerRootHref()}atoll-icon-dark.svg`} alt="" />
        <span className="site-brand-name">
          ATOLL<span className="site-brand-js">JS</span>
        </span>
      </a>
      <nav className="site-tabs" aria-label="Sites">
        <a href={href.home}>Home</a>
        <a href={href.docs} className={active === 'docs' ? 'active' : undefined}>
          Documentation
        </a>
        <a href={href.blog} className={active === 'blog' ? 'active' : undefined}>
          Blog
        </a>
      </nav>
      {/* Versioned snapshots (consumer/v<x.y.z>/) — docs.js repopulates the
          options from the live versions.json and drives navigation; the
          baked options are the no-JS floor. */}
      <select
        className="version-switch"
        aria-label="Docs version"
        defaultValue={VERSION}
        // One baked option can't switch anything — docs.js reveals the
        // select once versions.json proves snapshots exist.
        hidden={!versioned}
        onChange={(e) => {
          location.href = versionHref(e.target.value);
        }}
      >
        {(versioned ? [VERSION, 'latest'] : ['latest']).map((v) => (
          <option key={v} value={v}>
            {v}
          </option>
        ))}
      </select>
      <nav className="site-icons" aria-label="Project links">
        <a
          href="https://github.com/jwhenry3/atolljs"
          target="_blank"
          rel="noreferrer"
          aria-label="GitHub repository"
          title="GitHub"
        >
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <path fill="currentColor" d={GITHUB} />
          </svg>
        </a>
        <a
          href="https://www.npmjs.com/org/atolljs"
          target="_blank"
          rel="noreferrer"
          aria-label="npm organization"
          title="npm"
        >
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <path fill="currentColor" d={NPM} />
          </svg>
        </a>
        <a
          href="https://github.com/jwhenry3/atolljs/issues"
          target="_blank"
          rel="noreferrer"
          aria-label="Issues and feedback"
          title="Issues"
        >
          <svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true">
            <path
              fill="currentColor"
              d="M8 9.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3ZM8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Z"
            />
          </svg>
        </a>
      </nav>
    </header>
  );
}
