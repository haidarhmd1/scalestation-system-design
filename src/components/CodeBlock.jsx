import { useMemo, useState } from 'react';
import { highlight, highlightCommand, langForPath } from './highlight.js';

// A file or terminal snippet with a copy button and syntax highlighting.
export default function CodeBlock({ title, note, code, terminal, tone }) {
  const [copied, setCopied] = useState(false);
  const lines = useMemo(() => code.replace(/\n$/, '').split('\n'), [code]);
  // Highlighted HTML for files (Prism escapes the source, so this is safe).
  const lang = terminal ? 'bash' : langForPath(title);
  const html = useMemo(() => (terminal ? null : highlight(code, lang)), [code, lang, terminal]);
  const copy = async () => {
    const text = terminal ? lines.filter((l) => !l.trim().startsWith('#')).map((l) => l.replace(/\s+#.*$/, '')).join('\n') : code;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard blocked: user can still select the text */ }
  };
  return (
    <div className={`code ${terminal ? 'terminal' : ''} ${tone || ''}`}>
      <div className="code-head">
        <span className="code-title mono">{terminal ? '$ ' : ''}{title}</span>
        {note && <span className="code-note">{note}</span>}
        <button className="btn ghost small code-copy" onClick={copy}>{copied ? 'Copied ✓' : 'Copy'}</button>
      </div>
      {terminal ? (
        <pre className="language-bash"><code>{lines.map((l, i) => (l.trim().startsWith('#')
          ? <span key={i} className="cmt">{l}{'\n'}</span>
          : <span key={i}><span className="prompt">$ </span><span dangerouslySetInnerHTML={{ __html: highlightCommand(l) }} />{'\n'}</span>))}</code></pre>
      ) : html ? (
        <pre className={`language-${lang}`}><code dangerouslySetInnerHTML={{ __html: html }} /></pre>
      ) : (
        <pre><code>{code}</code></pre>
      )}
    </div>
  );
}
