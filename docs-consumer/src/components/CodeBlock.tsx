import { createContext, useContext, useMemo } from 'react';
import hljs from '../hl';

interface CodeBlockProps {
  code: string;
  language?: string;
  file?: string;
  side?: CodeSide;
}

export type CodeSide = 'backend' | 'frontend';

/** Page-level default for which side of the island a snippet runs on. */
export const CodeSideContext = createContext<CodeSide | undefined>(undefined);

const HTML_ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#x27;': "'",
  '&#39;': "'",
};

const unescapeHtml = (s: string) =>
  s.replace(/&(?:amp|lt|gt|quot|#x27|#39);/g, (m) => HTML_ENTITIES[m]);

const stripSpans = (s: string) => s.replace(/<\/?span[^>]*>/g, '');

const JS_LANGS = new Set(['ts', 'tsx', 'typescript', 'js', 'jsx', 'javascript']);

/**
 * hljs' JSX support delegates tag markup to the xml grammar, which bails at
 * the first `>`, including the `>` of `=>` inside prop expressions, leaving
 * `prop={...}` bodies as unstyled plain text. Post-pass: find top-level `{`
 * in unstyled regions preceded by `=` (JSX prop expressions, object literals)
 * and re-highlight the balanced brace region, recursively.
 */
function highlightJsxExpressions(html: string, language: string): string {
  const stack: string[] = [];
  let out = '';
  let i = 0;
  while (i < html.length) {
    const nextOpen = html.indexOf('<span', i);
    const nextClose = html.indexOf('</span>', i);
    const nextBrace = html.indexOf('{', i);
    const first = Math.min(
      nextOpen === -1 ? Infinity : nextOpen,
      nextClose === -1 ? Infinity : nextClose,
      nextBrace === -1 ? Infinity : nextBrace,
    );
    if (first === Infinity) {
      out += html.slice(i);
      break;
    }
    // `{` exprs worth re-highlighting are plain text nodes whose innermost
    // enclosing span is the JSX tag markup: hljs wraps xml sublanguage
    // output in `language-xml`, and emits `hljs-tag` for the delimiters.
    const top = stack[stack.length - 1];
    const inTagCtx =
      stack.length === 0 || top === 'hljs-tag' || top === 'language-xml';
    if (first === nextBrace && inTagCtx) {
      // only `prop={`, walk back over whitespace for `=`
      let p = nextBrace - 1;
      while (p >= 0 && (html[p] === ' ' || html[p] === '\n' || html[p] === '\t')) p--;
      if (p < 0 || html[p] !== '=') {
        out += html.slice(i, nextBrace + 1);
        i = nextBrace + 1;
        continue;
      }
      // scan to matching }, braces in the region are source text even where
      // they sit inside leaf spans, so a plain char count is sufficient
      let depth = 0;
      let k = nextBrace;
      for (; k < html.length; k++) {
        if (html[k] === '{') depth++;
        else if (html[k] === '}' && --depth === 0) {
          k++;
          break;
        }
      }
      const inner = stripSpans(html.slice(nextBrace + 1, k - 1));
      const exprHtml = hljs.highlight(unescapeHtml(inner), { language }).value;
      out += html.slice(i, nextBrace);
      out += '{';
      out += highlightJsxExpressions(exprHtml, language);
      out += '}';
      i = k;
      continue;
    }
    if (first === nextOpen) {
      const gt = html.indexOf('>', nextOpen);
      const openTag = html.slice(nextOpen, gt + 1);
      const cls = /class="([^"]*)"/.exec(openTag)?.[1] ?? '';
      out += html.slice(i, gt + 1);
      stack.push(cls);
      i = gt + 1;
      continue;
    }
    if (first === nextClose) {
      out += html.slice(i, nextClose + '</span>'.length);
      stack.pop();
      i = nextClose + '</span>'.length;
      continue;
    }
    // plain `{` inside a non-tag span: emit and move on
    out += html.slice(i, nextBrace + 1);
    i = nextBrace + 1;
  }
  return out;
}

export function CodeBlock({ code, language = 'typescript', file, side }: CodeBlockProps) {
  const contextSide = useContext(CodeSideContext);
  const resolvedSide = side ?? contextSide;
  const html = useMemo(() => {
    const trimmed = code.trim();
    if (!hljs.getLanguage(language)) {
      return trimmed.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
    if (!JS_LANGS.has(language)) {
      return hljs.highlight(trimmed, { language }).value;
    }
    // hljs delegates JSX tags to the xml grammar, which ends a tag at the
    // first `>`: including the `>` of `=>` in prop expressions. Shield `=>`
    // behind a sentinel so tags survive, then restore it in the output.
    const shielded = trimmed.replace(/=>/g, '=»');
    const highlighted = hljs.highlight(shielded, { language }).value;
    return highlightJsxExpressions(highlighted, 'typescript').replace(/»/g, '&gt;');
  }, [code, language]);
  return (
    <figure className="code" data-side={resolvedSide}>
      {(file || resolvedSide) && (
        <figcaption className="code-file">
          <span>{file}</span>
          {resolvedSide && <span className="code-side">{resolvedSide}</span>}
        </figcaption>
      )}
      <pre className="hljs">
        <code dangerouslySetInnerHTML={{ __html: html }} />
      </pre>
    </figure>
  );
}
