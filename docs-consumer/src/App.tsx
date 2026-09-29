import { useEffect, useState, type ReactNode } from 'react';
import { SiteSwitch } from './components/SiteSwitch';
import { FRAMEWORKS } from './frameworks';
import { FRAMEWORK_PAGE_COMPONENTS, FRAMEWORK_PAGES } from './frameworkPages';
import { BundleSize } from './pages/BundleSize';
import { CustomBindings } from './pages/CustomBindings';
import { CustomIslandRenderer } from './pages/CustomIslandRenderer';
import { FrameworkPage } from './pages/FrameworkPage';
import { Hosting } from './pages/Hosting';
import { IslandApps } from './pages/IslandApps';
import { Islands } from './pages/Islands';
import { Nestjs } from './pages/Nestjs';
import { NestjsClustering } from './pages/NestjsClustering';
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
import { SharedMemoryApi } from './pages/SharedMemoryApi';
import { SharedWorker } from './pages/SharedWorker';
import { TasksAndPool } from './pages/TasksAndPool';

interface Route {
  id: string;
  label: string;
  page: () => ReactNode;
  /** Sub-pages — rendered indented under this link in the sidebar. */
  children?: Route[];
}

const SECTIONS: { label: string; routes: Route[] }[] = [
  {
    label: 'Getting started',
    routes: [{ id: 'quickstart', label: 'Quickstart', page: () => <Quickstart /> }],
  },
  {
    label: 'Core concepts',
    routes: [
      { id: 'overview', label: 'Overview', page: () => <Overview /> },
      { id: 'shared-memory', label: 'Shared memory', page: () => <SharedMemoryApi /> },
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

const allRoutes = SECTIONS.flatMap((s) => s.routes.flatMap((r) => [r, ...(r.children ?? [])]));

function useHashRoute() {
  const [route, setRoute] = useState(() => window.location.hash.slice(2) || 'overview');
  useEffect(() => {
    const onChange = () => setRoute(window.location.hash.slice(2) || 'overview');
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}

export function App() {
  const route = useHashRoute();
  const active =
    allRoutes.find((r) => r.id === route) ??
    allRoutes.find((r) => r.id === 'overview')!;

  return (
    <div className="shell">
      <aside className="sidebar">
        <a className="brand" href="#/overview">
          atoll<span className="brand-sub">package docs</span>
        </a>
        <SiteSwitch current="consumer" />
        {SECTIONS.map((section) => (
          <nav key={section.label} className="nav-section">
            <h3>{section.label}</h3>
            {section.routes.map((r) => (
              <span key={r.id} style={{ display: 'contents' }}>
                <a
                  href={`#/${r.id}`}
                  className={r.id === active.id ? 'nav-link active' : 'nav-link'}
                >
                  {r.label}
                </a>
                {r.children?.map((sub) => (
                  <a
                    key={sub.id}
                    href={`#/${sub.id}`}
                    className={
                      sub.id === active.id
                        ? 'nav-link nav-sublink active'
                        : 'nav-link nav-sublink'
                    }
                  >
                    {sub.label}
                  </a>
                ))}
              </span>
            ))}
          </nav>
        ))}
      </aside>
      <main className="content">{active.page()}</main>
    </div>
  );
}
