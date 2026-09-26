import { useMemo } from 'react';
import hljs from '../hl';

interface CodeBlockProps {
  code: string;
  language?: string;
  file?: string;
}

export function CodeBlock({ code, language = 'typescript', file }: CodeBlockProps) {
  const html = useMemo(() => {
    const trimmed = code.trim();
    if (!hljs.getLanguage(language)) {
      return trimmed.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
    return hljs.highlight(trimmed, { language }).value;
  }, [code, language]);
  return (
    <figure className="code">
      {file && <figcaption className="code-file">{file}</figcaption>}
      <pre className="hljs">
        <code dangerouslySetInnerHTML={{ __html: html }} />
      </pre>
    </figure>
  );
}
