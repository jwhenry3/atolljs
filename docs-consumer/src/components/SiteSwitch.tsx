// Site switcher for the atoll docs family. Dev mode hops between the per-app
// dev-server ports; built output uses relative paths, which works under any
// mount point (serve-all dist/, GitHub Pages /<repo>/). The internals docs
// are in-repo markdown — the repo-docs entry links to them on GitHub.
const REPO_DOCS = 'https://github.com/jwhenry3/atolljs/tree/master/docs';
const SITES = [
  { id: 'home', label: 'demos home', dev: 'http://localhost:4173/', prod: '../' },
  { id: 'repo', label: 'internals docs (repo)', dev: REPO_DOCS, prod: REPO_DOCS },
  { id: 'consumer', label: 'package docs', dev: 'http://localhost:4181/', prod: '../consumer/' },
];

export function SiteSwitch({ current }: { current: string }) {
  return (
    <select
      className="site-switch"
      value={current}
      aria-label="Switch documentation site"
      onChange={(e) => {
        const site = SITES.find((s) => s.id === e.target.value);
        if (site && site.id !== current) {
          window.location.href = import.meta.env.DEV ? site.dev : site.prod;
        }
      }}
    >
      {SITES.map((s) => (
        <option key={s.id} value={s.id}>
          {s.label}
        </option>
      ))}
    </select>
  );
}
