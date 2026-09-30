/**
 * Route-depth plumbing for the prerendered site.
 *
 * Docs pages are emitted one level (or more) below the consumer root —
 * `fw-node/clustering` becomes `fw-node/clustering/index.html` — so every
 * relative link needs `../` steps matching the depth of the page currently
 * being rendered. Renders are sequential (one page per renderToString call,
 * and dev re-renders never interleave), so a module-level depth is safe and
 * keeps pages free of prop drilling.
 */
let currentDepth = 0;

export function setRouteDepth(depth: number) {
  currentDepth = depth;
}

export function routeDepth() {
  return currentDepth;
}

/** `../` × the current page's depth — resolves to the consumer site root. */
export function consumerRootHref() {
  return '../'.repeat(currentDepth);
}

/** Href to route `id` (e.g. 'fw-node/clustering') relative to this page.
 *  'overview' is emitted as the consumer root index, so it links to root. */
export function docHref(id: string) {
  return id === 'overview' ? consumerRootHref() : `${consumerRootHref()}${id}/`;
}
