import { docHref } from '../link';
import { POSTS, postBySlug } from '../blog';

export function BlogIndex() {
  return (
    <article>
      <h1>Blog</h1>
      <p className="lead">
        Long-form writing on what AtollJS is for and how its pieces fit
        together. Posts live in <code>docs/blog/</code> in the repo and are
        compiled into this site.
      </p>
      <div className="post-list">
        {POSTS.map((p) => (
          <a key={p.slug} className="post-card" href={docHref(`blog/${p.slug}`)}>
            <h2>{p.title}</h2>
            <p className="post-meta">
              {[p.series, p.date].filter(Boolean).join(' · ')}
            </p>
            {p.subtitle && <p className="post-sub">{p.subtitle}</p>}
            <p>{p.excerpt}</p>
          </a>
        ))}
      </div>
    </article>
  );
}

export function BlogPost({ slug }: { slug: string }) {
  const post = postBySlug(slug);
  if (!post) {
    return (
      <article>
        <h1>Post not found</h1>
        <p>
          <a href={docHref('blog')}>← All posts</a>
        </p>
      </article>
    );
  }
  return (
    <article className="md-body">
      <p className="post-back">
        <a href={docHref('blog')}>← All posts</a>
      </p>
      <h1>{post.title}</h1>
      <p className="post-meta">
        {[post.series && `Series: ${post.series}`, post.date].filter(Boolean).join(' · ')}
      </p>
      {post.subtitle && <p className="lead">{post.subtitle}</p>}
      {/* compiled from in-repo markdown in docs/blog/ */}
      <div dangerouslySetInnerHTML={{ __html: post.html }} />
    </article>
  );
}
