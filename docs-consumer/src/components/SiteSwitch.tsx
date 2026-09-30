import { consumerRootHref } from '../link';

// Site switcher for the atoll docs family. Dev mode hops between the per-app
// dev-server ports; built output uses relative paths, which works under any
// mount point (serve-all dist/, GitHub Pages /<repo>/). The internals docs
// are in-repo markdown — the repo-docs entry links to them on GitHub.
const REPO_DOCS = 'https://github.com/jwhenry3/atolljs/tree/main/docs';

interface Site {
  id: string;
  label: string;
  dev: string;
  /** Prod href — string, or resolved against the consumer root (docs pages
   *  render one or more directories deep). */
  prod: string | ((root: string) => string);
}

const SITES: Site[] = [
  // Home lives one level above the consumer root.
  { id: 'home', label: 'demos home', dev: 'http://localhost:4173/', prod: (r) => `${r}../` },
  { id: 'repo', label: 'internals docs (repo)', dev: REPO_DOCS, prod: REPO_DOCS },
  { id: 'consumer', label: 'package docs', dev: 'http://localhost:4181/', prod: (r) => r },
];

function href(site: Site): string {
  if (import.meta.env.DEV) return site.dev;
  const prod = typeof site.prod === 'function' ? site.prod(consumerRootHref()) : site.prod;
  return prod;
}

export function SiteSwitch({ current }: { current: string }) {
  return (
    <select
      className="site-switch"
      defaultValue={current}
      aria-label="Switch documentation site"
      onChange={(e) => {
        const site = SITES.find((s) => s.id === e.target.value);
        if (site && site.id !== current) window.location.href = href(site);
      }}
    >
      {SITES.map((s) => (
        // data-href lets the prerendered site (no React at runtime) wire the
        // same navigation from docs.js.
        <option key={s.id} value={s.id} data-href={href(s)}>
          {s.label}
        </option>
      ))}
    </select>
  );
}
