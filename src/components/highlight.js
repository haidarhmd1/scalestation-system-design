// Syntax highlighting for the Build Your Own code blocks (Prism).
// The language is picked from the file name shown above each block.
import Prism from 'prismjs';
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-python';
import 'prismjs/components/prism-go';
import 'prismjs/components/prism-yaml';
import 'prismjs/components/prism-json';
import 'prismjs/components/prism-bash';
import 'prismjs/components/prism-docker';
import 'prismjs/components/prism-nginx';
import 'prismjs/components/prism-sql';
import 'prismjs/components/prism-hcl';
import 'prismjs/components/prism-markdown';
import 'prismjs/components/prism-ini';

const BY_EXT = {
  ts: 'typescript', js: 'javascript', mjs: 'javascript', py: 'python', go: 'go',
  yml: 'yaml', yaml: 'yaml', json: 'json', sh: 'bash', sql: 'sql',
  tf: 'hcl', tfvars: 'hcl', tftpl: 'nginx', conf: 'nginx', md: 'markdown',
};
const BY_NAME = { dockerfile: 'docker', '.env.example': 'ini', '.env': 'ini' };

// "app/server.ts (add these routes)" → typescript; "Dockerfile" → docker.
export function langForPath(path = '') {
  const file = path.split(' ')[0].split('/').pop().toLowerCase();
  if (BY_NAME[file]) return BY_NAME[file];
  const ext = file.includes('.') ? file.split('.').pop() : '';
  return BY_EXT[ext] || null;
}

// Returns safe HTML (Prism escapes the source) or null when there is no grammar.
export function highlight(code, lang) {
  const grammar = lang && Prism.languages[lang];
  return grammar ? Prism.highlight(code, grammar, lang) : null;
}

// One terminal command: the program name (first word) stands out, flags get
// their own colour, and Prism handles strings, variables and # comments.
const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export function highlightCommand(line) {
  const m = line.match(/^(\s*)(\S+)(.*)$/);
  if (!m) return esc(line);
  const [, lead, cmd, rest] = m;
  const restHtml = (highlight(rest, 'bash') || esc(rest))
    // flags like -e, --scale, -f: only in plain text, never inside tags
    .replace(/(^|\s)(--?[A-Za-z][\w-]*)(?=[\s=]|$)/g, '$1<span class="token flag">$2</span>');
  return `${lead}<span class="token cmd">${esc(cmd)}</span>${restHtml}`;
}
