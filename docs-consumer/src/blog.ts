import { Marked, type Tokens } from 'marked';
import hljs from './hl';

/**
 * Blog posts are authored in `docs/blog/*.md` (in-repo markdown, same tree as
 * the internals docs) and compiled to HTML here at build time — one statically
 * prerendered page per post, styled with the site's own `figure.code` /
 * `.doc-table` chrome.
 */

const ESCAPE: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
};
const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ESCAPE[c]);

/**
 * Posts cite sources as repo-relative doc links (`../tasks-and-pool.md`),
 * which resolve correctly when the markdown is read on GitHub. At compile
 * time they're rewritten to absolute consumer-site paths — `/consumer/<r>/`
 * for local serves and `/atolljs/consumer/<r>/` in the Pages deployment
 * (VITE_CONSUMER_BASE set by scripts/build-pages.mjs / pages.yml). Anything
 * unmapped falls back to the GitHub blob URL rather than a dead link.
 */
const CONSUMER_BASE = import.meta.env.DEV
  ? '/' // vite dev serves the app at the origin root
  : ((import.meta.env.VITE_CONSUMER_BASE as string | undefined) ?? '/consumer/');
const DOC_ROUTES: Record<string, string> = {
  'overview': '',
  'shared-memory': 'shared-memory',
  'reef': 'reef',
  'tasks-and-pool': 'tasks',
  'reactivity': 'reactivity',
  'shared-worker': 'shared-worker',
  'islands': 'islands',
  'islands-frameworks': 'island-apps',
  'islands-worker': 'island-proxy',
  'cross-origin-isolation': 'hosting',
  'porting': 'custom-bindings',
  'frameworks/node': 'fw-node',
  'frameworks/node-backends': 'fw-node/adapters',
  'frameworks/nestjs': 'fw-nestjs',
  'frameworks/react': 'fw-react',
  'frameworks/vue': 'fw-vue',
  'frameworks/solid': 'fw-solid',
  'frameworks/svelte': 'fw-svelte',
  'frameworks/angular': 'fw-angular',
  'frameworks/nextjs': 'fw-nextjs-server',
};

const DOC_LINK = /href="\.\.\/([^"#]+?)\.md(#([^"]*))?"/g;

function rewriteDocLinks(html: string): string {
  return html.replace(DOC_LINK, (_m, path: string, _frag, anchor: string) => {
    const route = DOC_ROUTES[path];
    const suffix = anchor ? `#${anchor}` : '';
    if (route !== undefined) {
      return `href="${CONSUMER_BASE}${route ? `${route}/` : ''}${suffix}"`;
    }
    return `href="https://github.com/jwhenry3/atolljs/blob/main/docs/${path}.md${suffix}"`;
  });
}

const marked = new Marked({
  gfm: true,
  renderer: {
    // fenced code -> site CodeBlock markup (hljs-highlighted, figure chrome)
    code({ text, lang }: Tokens.Code): string {
      const language = lang && hljs.getLanguage(lang) ? lang : 'plaintext';
      const value =
        language === 'plaintext'
          ? escapeHtml(text.trimEnd())
          : hljs.highlight(text.trimEnd(), { language }).value;
      return `<figure class="code"><pre class="hljs"><code>${value}</code></pre></figure>`;
    },
  },
});

interface RawPost {
  slug: string;
  md: string;
}

const files = import.meta.glob('../../docs/blog/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const raw: RawPost[] = Object.entries(files).map(([path, md]) => ({
  slug: /([^/\\]+)\.md$/.exec(path)![1],
  md,
}));

/**
 * Optional YAML-style front matter per post (GitHub renders the block as a
 * small table above the article):
 *
 *   ---
 *   date: 2026-09-30        — sorts posts/series newest-first in nav + index
 *   series: Facades         — groups the post under a series heading
 *   title: ...              — overrides the `#` heading as the post title
 *   pinned: true            — standalone posts only: sorts above all groups
 *   ---
 */
interface FrontMatter {
  date?: string;
  series?: string;
  title?: string;
  pinned?: string;
}

function splitFrontMatter(md: string): { fm: FrontMatter; body: string } {
  const m = /^---[ \t]*\n([\s\S]*?)\n---[ \t]*\n?/.exec(md);
  if (!m) return { fm: {}, body: md };
  const fm: FrontMatter = {};
  for (const line of m[1].split('\n')) {
    const kv = /^([\w-]+)\s*:\s*(.+?)\s*$/.exec(line);
    if (
      kv &&
      (kv[1] === 'date' || kv[1] === 'series' || kv[1] === 'title' || kv[1] === 'pinned')
    ) {
      fm[kv[1]] = kv[2];
    }
  }
  return { fm, body: md.slice(m[0].length) };
}

export interface BlogPostMeta {
  slug: string;
  title: string;
  /** First `<h2>` after the title — used as the post's subtitle on the index. */
  subtitle?: string;
  /** First body paragraph, inline markdown stripped — index excerpt. */
  excerpt: string;
  /** Compiled, site-styled HTML for the post body (title h1 included). */
  html: string;
  /** Front matter — `YYYY-MM-DD`, absent if undated. */
  date?: string;
  /** Front matter — series the post belongs to, absent if standalone. */
  series?: string;
  /** Front matter — `pinned: true` floats the post above every series group. */
  pinned?: boolean;
}

const stripInline = (s: string) =>
  s
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[*_~]+/g, '')
    .trim();

function firstParagraph(md: string): string {
  for (const block of md.split(/\n\s*\n/)) {
    const t = block.trim();
    if (!t || /^[#>|`-]/.test(t)) continue;
    return stripInline(t.replace(/\n/g, ' '));
  }
  return '';
}

export const POSTS: BlogPostMeta[] = raw
  .map(({ slug, md }) => {
    const { fm, body } = splitFrontMatter(md);
    const title = fm.title ?? /^#\s+(.+)$/m.exec(body)?.[1]?.trim() ?? slug;
    const subtitle = /^\s*##\s+(.+)$/m.exec(body)?.[1]?.trim();
    const html = rewriteDocLinks(marked.parse(body) as string)
      .replaceAll('<table>', '<table class="doc-table">')
      // h1 + first h2 are rendered as page chrome (title / subtitle lead)
      .replace(/<h1[^>]*>.*?<\/h1>/, '')
      .replace(/^\s*<h2[^>]*>.*?<\/h2>/, '');
    return {
      slug,
      title,
      subtitle,
      excerpt: firstParagraph(body),
      html,
      date: fm.date,
      series: fm.series,
      pinned: fm.pinned === 'true',
    };
  })
  // pinned posts lead; then newest first, undated sink to the bottom
  .sort(
    (a, b) =>
      Number(b.pinned) - Number(a.pinned) ||
      (b.date ?? '').localeCompare(a.date ?? '') ||
      a.slug.localeCompare(b.slug)
  );

export const postBySlug = (slug: string) => POSTS.find((p) => p.slug === slug);

/**
 * Sidebar order — series groups and standalone articles interleaved by
 * recency: each series sits where its newest post lands, standalone posts
 * fill the rest of the timeline. Within a series, newest first.
 */
export type BlogNavEntry =
  | { type: 'post'; post: BlogPostMeta }
  | { type: 'series'; series: string; posts: BlogPostMeta[] };

export const BLOG_NAV: BlogNavEntry[] = (() => {
  const bySeries = new Map<string, BlogPostMeta[]>();
  const standalone: BlogPostMeta[] = [];
  for (const post of POSTS) {
    if (post.series) {
      const list = bySeries.get(post.series) ?? [];
      list.push(post);
      bySeries.set(post.series, list);
    } else {
      standalone.push(post);
    }
  }
  const entries: BlogNavEntry[] = [
    ...[...bySeries.entries()].map(
      ([series, posts]): BlogNavEntry => ({ type: 'series', series, posts })
    ),
    ...standalone.map((post): BlogNavEntry => ({ type: 'post', post })),
  ];
  const newest = (e: BlogNavEntry) =>
    e.type === 'post' ? (e.post.date ?? '') : (e.posts[0]?.date ?? '');
  const pinned = (e: BlogNavEntry) => e.type === 'post' && e.post.pinned === true;
  return entries.sort(
    (x, y) => Number(pinned(y)) - Number(pinned(x)) || newest(y).localeCompare(newest(x))
  );
})();
