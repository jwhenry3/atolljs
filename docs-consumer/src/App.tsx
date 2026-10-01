import { useEffect, type ReactNode } from 'react';
import { CodeSideContext } from './components/CodeBlock';
import { SiteHeader } from './components/SiteHeader';
import { FRAMEWORKS } from './frameworks';
import { consumerRootHref, docHref, setRouteDepth } from './link';
import { metaFor } from './routeMeta';
import { FRAMEWORK_PAGE_COMPONENTS, FRAMEWORK_PAGES } from './frameworkPages';
import { BLOG_NAV } from './blog';
import { BlogIndex, BlogPost } from './pages/Blog';
import { BundleSize } from './pages/BundleSize';
import { Cli } from './pages/Cli';
import { CustomBindings } from './pages/CustomBindings';
import { CustomIslandRenderer } from './pages/CustomIslandRenderer';
import { FrameworkPage } from './pages/FrameworkPage';
import { Hosting } from './pages/Hosting';
import { IslandApps } from './pages/IslandApps';
import { IslandMfe } from './pages/IslandMfe';
import { Islands } from './pages/Islands';
import { Nestjs } from './pages/Nestjs';
import { NestjsClustering } from './pages/NestjsClustering';
import { NestjsFacades } from './pages/NestjsFacades';
import { NestjsHoused } from './pages/NestjsHoused';
import { NestjsPersistence } from './pages/NestjsPersistence';
import { NestjsWebsockets } from './pages/NestjsWebsockets';
import { NextjsServer } from './pages/Nextjs';
import { NextjsCustomServer } from './pages/NextjsCustomServer';
import { NextjsJobs } from './pages/NextjsJobs';
import { NextjsReadModel } from './pages/NextjsReadModel';
import { NextjsWarmup } from './pages/NextjsWarmup';
import { NodeAdapters, NodeBackends } from './pages/NodeBackends';
import { NodeClustering } from './pages/NodeClustering';
import { NodeGateway } from './pages/NodeGateway';
import { NodePersistence } from './pages/NodePersistence';
import { NodeWebsockets } from './pages/NodeWebsockets';
import { Overview } from './pages/Overview';
import { ProxyDocument } from './pages/ProxyDocument';
import { Quickstart } from './pages/Quickstart';
import { Reactivity } from './pages/Reactivity';
import { Reef } from './pages/Reef';
import { SharedMemoryApi } from './pages/SharedMemoryApi';
import { SharedWorker } from './pages/SharedWorker';
import { TasksAndPool } from './pages/TasksAndPool';

interface Route {
  id: string;
  label: string;
  page: () => ReactNode;
  /** Sub-pages — rendered indented under this link in the sidebar. */
  children?: RouteChild[];
}

/** A named group of sub-pages — renders a subhead in the sidebar (blog series). */
interface RouteGroup {
  group: string;
  children: Route[];
}

type RouteChild = Route | RouteGroup;

const isGroup = (c: RouteChild): c is RouteGroup => 'group' in c;

const SECTIONS: { label: string; routes: Route[] }[] = [
  {
    label: 'Getting started',
    routes: [
      { id: 'overview', label: 'Overview', page: () => <Overview /> },
      { id: 'quickstart', label: 'Quickstart', page: () => <Quickstart /> },
      { id: 'cli', label: 'CLI', page: () => <Cli /> },
    ],
  },
  {
    label: 'Core concepts',
    routes: [
      { id: 'shared-memory', label: 'Shared memory', page: () => <SharedMemoryApi /> },
      { id: 'reef', label: 'Reef schemas', page: () => <Reef /> },
      { id: 'tasks', label: 'Worker pool & tasks', page: () => <TasksAndPool /> },
      { id: 'reactivity', label: 'Reactivity', page: () => <Reactivity /> },
      { id: 'shared-worker', label: 'Shared worker', page: () => <SharedWorker /> },
      { id: 'bundle-size', label: 'Bundle size & load', page: () => <BundleSize /> },
    ],
  },
  {
    label: 'Islands',
    routes: [
      { id: 'islands', label: 'Overview', page: () => <Islands /> },
      { id: 'island-apps', label: 'Quickstart', page: () => <IslandApps /> },
      { id: 'island-mfe', label: 'Micro-frontends', page: () => <IslandMfe /> },
      { id: 'island-proxy', label: 'Proxy document', page: () => <ProxyDocument /> },
    ],
  },
  {
    label: 'Backend',
    routes: [
      {
        id: 'fw-node',
        label: 'Node.js',
        page: () => <NodeBackends />,
        children: [
          { id: 'fw-node/adapters', label: 'Framework adapters', page: () => <NodeAdapters /> },
          { id: 'fw-node/clustering', label: 'Clustering', page: () => <NodeClustering /> },
          { id: 'fw-node/gateway', label: 'Gateway routing', page: () => <NodeGateway /> },
          { id: 'fw-node/websockets', label: 'WebSockets', page: () => <NodeWebsockets /> },
          { id: 'fw-node/persistence', label: 'Persistence', page: () => <NodePersistence /> },
        ],
      },
      {
        id: 'fw-nestjs',
        label: 'NestJS',
        page: () => <Nestjs />,
        children: [
          { id: 'fw-nestjs/facades', label: 'Service facades', page: () => <NestjsFacades /> },
          { id: 'fw-nestjs/housed', label: 'Housed APIs', page: () => <NestjsHoused /> },
          { id: 'fw-nestjs/clustering', label: 'Clustering', page: () => <NestjsClustering /> },
          { id: 'fw-nestjs/websockets', label: 'WebSockets', page: () => <NestjsWebsockets /> },
          { id: 'fw-nestjs/persistence', label: 'Persistence', page: () => <NestjsPersistence /> },
        ],
      },
      {
        id: 'fw-nextjs-server',
        label: 'Next.js',
        page: () => <NextjsServer />,
        children: [
          { id: 'fw-nextjs-server/jobs', label: 'Job queue', page: () => <NextjsJobs /> },
          { id: 'fw-nextjs-server/read-model', label: 'Read-model API', page: () => <NextjsReadModel /> },
          { id: 'fw-nextjs-server/warmup', label: 'Boot warmup', page: () => <NextjsWarmup /> },
          { id: 'fw-nextjs-server/custom-server', label: 'Custom server', page: () => <NextjsCustomServer /> },
        ],
      },
    ],
  },
  {
    label: 'Frontend',
    routes: FRAMEWORKS.map((fw) => ({
      id: `fw-${fw.id}`,
      label: fw.name,
      // Bespoke pages (e.g. Next.js) opt in via FRAMEWORK_PAGE_COMPONENTS.
      page: FRAMEWORK_PAGE_COMPONENTS[fw.id] ?? (() => <FrameworkPage key={fw.id} fw={fw} />),
      // Framework-specific sub-pages opt in via FRAMEWORK_PAGES — see
      // frameworkPages.tsx (React gets the worker-islands page).
      children: FRAMEWORK_PAGES[fw.id]?.map((sub) => ({
        id: `fw-${fw.id}/${sub.id}`,
        label: sub.label,
        page: sub.page,
      })),
    })),
  },
  {
    label: 'Extending',
    routes: [
      { id: 'custom-bindings', label: 'Custom bindings', page: () => <CustomBindings /> },
      { id: 'custom-islands', label: 'Custom island renderers', page: () => <CustomIslandRenderer /> },
    ],
  },
  {
    label: 'Deployment',
    routes: [{ id: 'hosting', label: 'Hosting & headers', page: () => <Hosting /> }],
  },
];

/**
 * The blog is a separate menu tree — on blog pages the sidebar swaps the
 * package-docs sections for the post list (series groups, newest first).
 */
const BLOG_SECTION: { label: string; routes: Route[] } = {
  label: 'Posts',
  routes: [
    {
      id: 'blog',
      label: 'All posts',
      page: () => <BlogIndex />,
      children: BLOG_NAV.map((e) =>
        e.type === 'post'
          ? {
              id: `blog/${e.post.slug}`,
              label: e.post.title,
              page: () => <BlogPost slug={e.post.slug} />,
            }
          : {
              group: e.series,
              children: e.posts.map((p) => ({
                id: `blog/${p.slug}`,
                label: p.title,
                page: () => <BlogPost slug={p.slug} />,
              })),
            }
      ),
    },
  ],
};

export const allRoutes = [...SECTIONS, BLOG_SECTION].flatMap((s) =>
  s.routes.flatMap((r) => [
    r,
    ...(r.children ?? []).flatMap((c) => (isGroup(c) ? c.children : [c])),
  ])
);
export { SECTIONS };

const routeIds = new Set(allRoutes.map((r) => r.id));

/**
 * Resolve the active route from `location.pathname`. Routes are emitted as
 * `<id>/index.html`, so the route id is always the trailing path segment(s)
 * under whatever mount point the site lives at (`/` in dev, `/consumer/` in
 * production) — match the longest trailing suffix that is a known id.
 */
function routeFromPathname(pathname: string): string | null {
  const segs = pathname.split('/').filter(Boolean);
  if (segs.length === 0) return 'overview'; // the site root is the overview page
  for (let take = Math.min(2, segs.length); take > 0; take--) {
    const candidate = segs.slice(-take).join('/');
    if (routeIds.has(candidate)) return candidate;
  }
  return null;
}

export function App({ route }: { route?: string }) {
  // No route match → real not-found state instead of silently showing the
  // overview (the dev equivalent of the deployed 404.html).
  const active =
    allRoutes.find((r) => r.id === route) ??
    allRoutes.find((r) => r.id === (routeFromPathname(window.location.pathname) ?? ''));
  const notFound = !active;
  const shown = active ?? allRoutes.find((r) => r.id === 'overview')!;

  const isBlog = !notFound && (shown.id === 'blog' || shown.id.startsWith('blog/'));

  // Links, iframe srcs, and the site switcher are relative to the page's own
  // depth under the consumer root — publish it for the whole render. The
  // overview page lives AT the root (dist/index.html), so depth 0.
  setRouteDepth(shown.id === 'overview' ? 0 : shown.id.split('/').length);

  useEffect(() => {
    document.title = notFound ? 'Atoll docs — page not found' : metaFor(shown.id, shown.label).title;
    // Legacy `#/route` URLs (old npm homepages, bookmarks) — bounce to the
    // real path. docs.js does the same in the prerendered site; this covers
    // the dev server where docs.js isn't loaded.
    const legacy = window.location.hash.slice(2);
    if (legacy && routeIds.has(legacy)) {
      window.location.replace(docHref(legacy));
    }
    // Keep the active section in view — mirrors the same reveal in docs.js
    // for the prerendered site (which runs no React).
    const sidebar = document.querySelector('.sidebar');
    const activeLink = sidebar?.querySelector<HTMLElement>('.nav-link.active');
    if (sidebar && activeLink) {
      const sb = sidebar.getBoundingClientRect();
      const ar = activeLink.getBoundingClientRect();
      if (ar.top < sb.top || ar.bottom > sb.bottom) {
        sidebar.scrollTop += ar.top - sb.top - sb.height / 3;
      }
    }
  }, [shown.id, shown.label, notFound]);

  return (
    <div className="shell">
      <img
        className="brand-watermark"
        aria-hidden="true"
        src={`${consumerRootHref()}atoll-dark-t.svg`}
        alt=""
      />
      <SiteHeader active={isBlog ? 'blog' : 'docs'} />
      <div className="shell-body">
      <aside className="sidebar">
        {/* Blog pages get the post list instead of the docs tree. */}
        {(isBlog ? [BLOG_SECTION] : SECTIONS).map((section) => (
          <nav key={section.label} className="nav-section">
            <h3>{section.label}</h3>
            {section.routes.map((r) => (
              <span key={r.id} style={{ display: 'contents' }}>
                <a
                  href={docHref(r.id)}
                  className={r.id === active?.id ? 'nav-link active' : 'nav-link'}
                >
                  {r.label}
                </a>
                {r.children?.map((sub) =>
                  isGroup(sub) ? (
                    <span key={sub.group} style={{ display: 'contents' }}>
                      <span className="nav-group">{sub.group}</span>
                      {sub.children.map((post) => (
                        <a
                          key={post.id}
                          href={docHref(post.id)}
                          className={
                            post.id === active?.id
                              ? 'nav-link nav-sublink active'
                              : 'nav-link nav-sublink'
                          }
                        >
                          {post.label}
                        </a>
                      ))}
                    </span>
                  ) : (
                    <a
                      key={sub.id}
                      href={docHref(sub.id)}
                      className={
                        sub.id === active?.id
                          ? 'nav-link nav-sublink active'
                          : 'nav-link nav-sublink'
                      }
                    >
                      {sub.label}
                    </a>
                  )
                )}
              </span>
            ))}
          </nav>
        ))}
      </aside>
      <main className="content">
        {notFound ? (
          <article>
            <h1>Page not found</h1>
            <p>
              <code>{window.location.pathname}</code> doesn't match a docs
              page.
            </p>
            <p>
              <a href="/">Back to the docs overview</a>
            </p>
          </article>
        ) : (
          <CodeSideContext.Provider value={sideFor(shown.id)}>
            {shown.page()}
          </CodeSideContext.Provider>
        )}
        <footer className="site-footer">
          <span>
            MIT licensed · © 2026 Justin Henry ·{' '}
            <a href="https://github.com/jwhenry3/atolljs/blob/main/LICENSE">LICENSE</a>
          </span>
          <nav>
            <a href="https://github.com/jwhenry3/atolljs" target="_blank" rel="noreferrer">GitHub</a>
            <a href="https://www.npmjs.com/org/atolljs" target="_blank" rel="noreferrer">npm</a>
            <a href="https://github.com/jwhenry3/atolljs/issues" target="_blank" rel="noreferrer">Issues</a>
            <a href="https://github.com/jwhenry3/atolljs/blob/main/CHANGELOG.md" target="_blank" rel="noreferrer">Changelog</a>
          </nav>
        </footer>
      </main>
      </div>
    </div>
  );
}

const sideFor = (id: string) => {
  const section = SECTIONS.find((s) =>
    s.routes.some(
      (r) =>
        r.id === id ||
        r.children?.some((c) =>
          isGroup(c) ? c.children.some((p) => p.id === id) : c.id === id,
        ),
    ),
  );
  if (section?.label === 'Backend') return 'backend' as const;
  if (section?.label === 'Frontend') return 'frontend' as const;
  return undefined;
};
