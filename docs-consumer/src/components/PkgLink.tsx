import type { ReactNode } from 'react';

/**
 * A package name rendered as a code span linking to its package page.
 * `site` picks the destination — 'npm' (default) for the package page,
 * 'bundlephobia' for the size report (matches what the docs measure).
 */
export function PkgLink({
  name,
  site = 'npm',
  children,
}: {
  name: string;
  site?: 'npm' | 'bundlephobia';
  children?: ReactNode;
}) {
  const href =
    site === 'bundlephobia'
      ? `https://bundlephobia.com/package/${name}`
      : `https://www.npmjs.com/package/${name}`;
  return (
    <a href={href} target="_blank" rel="noreferrer">
      {children ?? <code>{name}</code>}
    </a>
  );
}
