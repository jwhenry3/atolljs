// Site switcher for the mesh docs family. Dev mode hops between the per-app
// dev-server ports; built output uses relative paths, which works under any
// mount point (serve-all dist/, GitHub Pages /<repo>/).
const SITES = [
  { id: 'home', label: 'demos home', dev: 'http://localhost:4173/', prod: '../' },
  { id: 'sdk', label: 'sdk docs', dev: 'http://localhost:4180/', prod: '../sdk/' },
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
