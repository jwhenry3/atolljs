/**
 * Framework-specific sub-pages — keyed by FRAMEWORKS id, each entry becomes
 * a child nav route under that framework (`fw-<id>/<sub.id>`). This is the
 * seam for per-framework docs that don't fit the generic binding template:
 * React gets the worker-islands page; other frameworks opt in the same way.
 */
import type { ReactNode } from 'react';
import { FRAMEWORKS } from './frameworks';
import { FrameworkAdvanced } from './pages/FrameworkAdvanced';
import { FrameworkExamples } from './pages/FrameworkExamples';
import { FrameworkQuickstart } from './pages/FrameworkQuickstart';
import { FrameworkIslands } from './pages/FrameworkIslands';
import { Nextjs } from './pages/Nextjs';
import { NextjsIslands } from './pages/NextjsIslands';
import { ReactWorkerIslands } from './pages/ReactWorkerIslands';

export interface FrameworkSubPage {
  id: string;
  label: string;
  page: () => ReactNode;
}

/** The data-driven Examples sub-page — content lives in fw.examples. */
const examples = (id: string): FrameworkSubPage => ({
  id: 'examples',
  label: 'Examples',
  page: () => <FrameworkExamples fw={FRAMEWORKS.find((f) => f.id === id)!} />,
});

/** The shared atoll steps + this framework's binding — fw.install/usage/quickstartNote. */
const quickstart = (id: string): FrameworkSubPage => ({
  id: 'quickstart',
  label: 'Quickstart',
  page: () => <FrameworkQuickstart fw={FRAMEWORKS.find((f) => f.id === id)!} />,
});

/** The data-driven Advanced sub-page — content lives in fw.advanced. */
const advanced = (id: string): FrameworkSubPage => ({
  id: 'advanced',
  label: 'Advanced',
  page: () => <FrameworkAdvanced fw={FRAMEWORKS.find((f) => f.id === id)!} />,
});

/**
 * Bespoke main pages — replace the generic FrameworkPage for frameworks
 * whose doc doesn't fit the binding template. Next.js needs the server-side
 * route-handler section and the static-host demo explanation.
 */
export const FRAMEWORK_PAGE_COMPONENTS: Record<string, () => ReactNode> = {
  nextjs: Nextjs,
};

export const FRAMEWORK_PAGES: Record<string, FrameworkSubPage[]> = {
  react: [
    quickstart('react'),
    examples('react'),
    advanced('react'),
    {
      id: 'worker-islands',
      label: 'Islands',
      page: () => <ReactWorkerIslands />,
    },
  ],
  vue: [
    quickstart('vue'),
    examples('vue'),
    advanced('vue'),
    {
      id: 'worker-islands',
      label: 'Islands',
      page: () => <FrameworkIslands id="vue" />,
    },
  ],
  svelte: [
    quickstart('svelte'),
    examples('svelte'),
    advanced('svelte'),
    {
      id: 'worker-islands',
      label: 'Islands',
      page: () => <FrameworkIslands id="svelte" />,
    },
  ],
  solid: [
    quickstart('solid'),
    examples('solid'),
    advanced('solid'),
    {
      id: 'worker-islands',
      label: 'Islands',
      page: () => <FrameworkIslands id="solid" />,
    },
  ],
  angular: [
    quickstart('angular'),
    examples('angular'),
    advanced('angular'),
    {
      id: 'worker-islands',
      label: 'Islands',
      page: () => <FrameworkIslands id="angular" />,
    },
  ],
  nextjs: [
    quickstart('nextjs'),
    examples('nextjs'),
    advanced('nextjs'),
    {
      id: 'worker-islands',
      label: 'Islands',
      page: () => <NextjsIslands />,
    },
  ],
};
