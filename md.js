// Tiny Markdown + front-matter parser. Bundled so the app works fully offline.

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Parses a small YAML subset: `key: value`, `key:` followed by `  - item` lines, `# comments`.
export function parseNote(text) {
  const meta = {};
  let body = text.replace(/^﻿/, '');
  const m = body.match(/^---\s*\n([\s\S]*?)\n---\s*(?:\n|$)/);
  if (m) {
    body = body.slice(m[0].length);
    let last = null;
    for (const raw of m[1].split('\n')) {
      const line = raw.replace(/\s+$/, '');
      if (!line.trim() || line.trim().startsWith('#')) continue;
      const li = line.match(/^\s+-\s*(.*)$/) || line.match(/^-\s*(.*)$/);
      if (li && last) {
        if (!Array.isArray(meta[last])) meta[last] = [];
        const v = unquote(li[1]);
        if (v) meta[last].push(v);
        continue;
      }
      const kv = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
      if (kv) {
        last = kv[1];
        const v = unquote(kv[2]);
        meta[last] = v === 'true' ? true : v === 'false' ? false : v;
      }
    }
  }
  return { meta, body: body.trim() };
}

function unquote(v) {
  v = v.trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  return v;
}

function inline(s) {
  s = esc(s);
  const codes = [];
  s = s.replace(/`([^`]+)`/g, (_, c) => `\u0000${codes.push(c) - 1}\u0000`);
  s = s
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_]+)__/g, '<strong>$1</strong>')
    .replace(/(^|[^*\w])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
    .replace(/(^|[^_\w])_([^_\s][^_]*)_(?!\w)/g, '$1<em>$2</em>')
    .replace(/==([^=]+)==/g, '<mark>$1</mark>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[i]}</code>`);
}

export function renderMarkdown(src) {
  const lines = String(src ?? '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    let m;
    if ((m = line.match(/^(#{1,4})\s+(.*)$/))) {
      const n = m[1].length + 1; // # -> h2, keeps h1 for the session title
      out.push(`<h${n}>${inline(m[2])}</h${n}>`); i++; continue;
    }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) { out.push('<hr>'); i++; continue; }
    if (/^\s*>/.test(line)) {
      const buf = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) buf.push(lines[i++].replace(/^\s*>\s?/, ''));
      out.push(`<blockquote>${renderMarkdown(buf.join('\n'))}</blockquote>`); continue;
    }
    if (/^\s*([-*+]|\d+[.)])\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]/.test(line);
      const items = [];
      while (i < lines.length && /^\s*([-*+]|\d+[.)])\s+/.test(lines[i]) && /^\s*\d+[.)]/.test(lines[i]) === ordered) {
        let t = lines[i++].replace(/^\s*([-*+]|\d+[.)])\s+/, '');
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !/^\s*([-*+]|\d+[.)])\s+/.test(lines[i])) t += '\n' + lines[i++].trim();
        const box = t.match(/^\[( |x|X)\]\s+(.*)$/s);
        items.push(box ? `<li class="task">${box[1] === ' ' ? '☐' : '☑'} ${inline(box[2]).replace(/\n/g, '<br>')}</li>`
                       : `<li>${inline(t).replace(/\n/g, '<br>')}</li>`);
      }
      out.push(`<${ordered ? 'ol' : 'ul'}>${items.join('')}</${ordered ? 'ol' : 'ul'}>`); continue;
    }
    const buf = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|\s*>|\s*([-*+]|\d+[.)])\s+|\s*-{3,}\s*$)/.test(lines[i])) buf.push(lines[i++]);
    out.push(`<p>${buf.map(inline).join('<br>')}</p>`);
  }
  return out.join('\n');
}

// Plain text (Sessionize bios/abstracts) -> paragraphs.
export function renderPlain(s) {
  return String(s ?? '').trim().split(/\n\s*\n/).map(p => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('');
}
