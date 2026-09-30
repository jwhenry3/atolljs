/**
 * A package name rendered as a code span linking to its Bundlephobia page —
 * the size report matches what the docs measure per package.
 */
export function PkgLink({ name }: { name: string }) {
  return (
    <a
      href={`https://bundlephobia.com/package/${name}`}
      target="_blank"
      rel="noreferrer"
    >
      <code>{name}</code>
    </a>
  );
}
