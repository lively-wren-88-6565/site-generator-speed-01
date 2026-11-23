// Fast drop-in for makefun-site 1.0.0 (site-generator-speed-01).
// Same answers as makefun-site's build() on every input, written for CPU time:
// fused single-pass Markdown, template codegen, memoised slugs, no per-char
// escaping, no regex word counting. No cross-case state: every run() builds
// its own caches and compiled templates.

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const RESERVED = ['posts', 'tags', 'page'];
const KEYS = ['title', 'date', 'tags', 'draft', 'layout', 'slug', 'summary'];
const ESCAPABLE = new Set(['\\', '`', '*', '_', '[', ']', '(', ')', '#', '+', '-', '.', '!', '>']);
const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const ESC_RE = /[&<>"']/;
const ESC_RE_G = /[&<>"']/g;

const byCodeUnits = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const hasOwn = (o, k) => Object.hasOwn(o, k);

/** HTML escape; returns the input untouched when it holds nothing to escape. */
function esc(s) {
  if (!ESC_RE.test(s)) return s;
  return s.replace(ESC_RE_G, (c) => ESCAPES[c]);
}

/** A slug, memoised per run. ASCII strings skip NFKD entirely. */
function slugify(text, memo) {
  const hit = memo.get(text);
  if (hit !== undefined) return hit;
  let out;
  let ascii = true;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) > 127) { ascii = false; break; }
  }
  const plain = ascii ? text : text.normalize('NFKD').replace(/\p{M}/gu, '');
  let s = '';
  let gap = false;
  for (let i = 0; i < plain.length; i++) {
    const cc = plain.charCodeAt(i);
    let keep = null;
    if (cc >= 65 && cc <= 90) keep = String.fromCharCode(cc + 32);
    else if ((cc >= 97 && cc <= 122) || (cc >= 48 && cc <= 57)) keep = plain[i];
    if (keep === null) { gap = s.length > 0; continue; }
    if (gap) s += '-';
    gap = false;
    s += keep;
  }
  out = s.slice(0, 64).replace(/-+$/, '');
  if (out === '') out = 'untitled';
  memo.set(text, out);
  return out;
}

function uniqueSlug(slug, taken) {
  let out = slug;
  for (let n = 2; taken.has(out); n++) out = `${slug}-${n}`;
  taken.add(out);
  return out;
}

function longDate(d) {
  return `${Number(d.slice(8, 10))} ${MONTHS[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`;
}

function isWSCode(cc) {
  return cc === 32 || cc === 9 || cc === 10 || cc === 11 || cc === 12 || cc === 13 || cc === 160 || cc === 0x1680 ||
    (cc >= 0x2000 && cc <= 0x200a) || cc === 0x2028 || cc === 0x2029 || cc === 0x202f || cc === 0x205f || cc === 0x3000 || cc === 0xfeff;
}

/** Words: runs of non-whitespace, counted without building a match array. */
function wordsCount(s) {
  let n = 0;
  let inW = false;
  for (let i = 0; i < s.length; i++) {
    const cc = s.charCodeAt(i);
    // JS \s: ASCII whitespace (cc <= 32 covers space \t \n \v \f \r) plus the
    // Unicode spaces below; inlined here instead of a call per character.
    const ws = cc <= 32 || cc === 160 || cc === 0x1680 || (cc >= 0x2000 && cc <= 0x200a) ||
      cc === 0x2028 || cc === 0x2029 || cc === 0x202f || cc === 0x205f || cc === 0x3000 || cc === 0xfeff;
    if (ws) inW = false;
    else if (!inW) { inW = true; n++; }
  }
  return n;
}

// ---------------------------------------------------------------- front matter

function daysIn(y, m) {
  if (m === 2) return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28;
  return m === 4 || m === 6 || m === 9 || m === 11 ? 30 : 31;
}

function stringOf(raw) {
  if (raw[0] === '"') {
    if (raw.length < 2 || raw[raw.length - 1] !== '"') return { error: 'a quoted string is not closed' };
    let out = '';
    for (let i = 1; i < raw.length - 1; i++) {
      const c = raw[i];
      if (c === '\\') {
        const n = raw[i + 1];
        if ((n !== '"' && n !== '\\') || i + 1 === raw.length - 1) return { error: 'a quoted string holds an escape other than \\" or \\\\' };
        out += n;
        i++;
      } else if (c === '"') return { error: 'a quoted string holds a stray quote' };
      else out += c;
    }
    return { value: out };
  }
  if (raw[0] === '[') return { error: 'a bare string opens on [' };
  return { value: raw };
}

function valueOf(key, raw) {
  switch (key) {
    case 'title':
    case 'summary': {
      const s = stringOf(raw);
      return 'error' in s ? { error: `key "${key}": ${s.error}` } : s;
    }
    case 'date': {
      let ok = raw.length === 10 && raw[4] === '-' && raw[7] === '-';
      if (ok) {
        for (let i = 0; i < 10; i++) {
          if (i === 4 || i === 7) continue;
          const c = raw.charCodeAt(i);
          if (c < 48 || c > 57) { ok = false; break; }
        }
      }
      const y = ok ? Number(raw.slice(0, 4)) : 0;
      const mo = ok ? Number(raw.slice(5, 7)) : 0;
      const d = ok ? Number(raw.slice(8, 10)) : 0;
      if (!ok || y < 1970 || y > 2099 || mo < 1 || mo > 12 || d < 1 || d > daysIn(y, mo)) {
        return { error: 'key "date": not a date from 1970-01-01 to 2099-12-31 (YYYY-MM-DD)' };
      }
      return { value: raw };
    }
    case 'tags': {
      if (!raw.startsWith('[') || !raw.endsWith(']')) return { error: 'key "tags": not a list [a, b]' };
      const inner = raw.slice(1, -1);
      if (inner.trim() === '') return { value: [] };
      const tags = inner.split(',').map((t) => t.trim());
      for (const t of tags) {
        if (t === '' || t.includes('"') || t.includes('[') || t.includes(']')) {
          return { error: 'key "tags": an empty tag, or one holding " [ or ]' };
        }
      }
      return { value: tags };
    }
    case 'draft':
      return raw === 'true' ? { value: true } : raw === 'false' ? { value: false } : { error: 'key "draft": true or false' };
    case 'layout': {
      let ok = raw.length > 0;
      for (let i = 0; ok && i < raw.length; i++) {
        const c = raw.charCodeAt(i);
        if (!((c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 45)) ok = false;
      }
      return ok ? { value: raw } : { error: 'key "layout": not a template name' };
    }
    case 'slug': {
      let ok = raw.length > 0 && raw.length <= 64;
      let prevDash = true;
      for (let i = 0; ok && i < raw.length; i++) {
        const c = raw.charCodeAt(i);
        if (c === 45) { if (prevDash) ok = false; prevDash = true; }
        else if ((c >= 97 && c <= 122) || (c >= 48 && c <= 57)) prevDash = false;
        else ok = false;
      }
      if (ok && prevDash) ok = false;
      return ok ? { value: raw } : { error: 'key "slug": not a slug' };
    }
    default:
      return { error: `unknown key "${key}"` };
  }
}

function isBlankLine(line) {
  for (let i = 0; i < line.length; i++) {
    const c = line.charCodeAt(i);
    if (c !== 32 && c !== 9) return false;
  }
  return true;
}

/** Front matter and body, or { error } with the first reason, exactly as the reference. */
function parseFrontMatter(text) {
  if (text !== '---' && !text.startsWith('---\n')) return { error: 'no front matter' };
  // Pass 1: find the closing line (the reference checks closure before any line).
  const lines = [];
  let p = text === '---' ? 3 : 4;
  let closeEnd = -1;
  while (true) {
    if (p >= text.length) return { error: 'the front matter is not closed' };
    const nl = text.indexOf('\n', p);
    const end = nl === -1 ? text.length : nl;
    const line = text.slice(p, end);
    if (line === '---') { closeEnd = nl === -1 ? text.length : nl + 1; break; }
    lines.push(line);
    if (nl === -1) return { error: 'the front matter is not closed' };
    p = nl + 1;
  }
  // Pass 2: validate the lines between, in order.
  const data = {};
  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx];
    const n = idx + 2; // line number, counting the opening '---' as line 1
    if (isBlankLine(line) || line[0] === '#') continue;
    let j = 0;
    while (j < line.length) {
      const c = line.charCodeAt(j);
      if (!((c >= 97 && c <= 122) || c === 95)) break;
      j++;
    }
    if (j === 0 || line[j] !== ':') return { error: `line ${n} is not "key: value"` };
    const key = line.slice(0, j);
    const rest = line.slice(j + 1);
    let raw;
    if (rest === '') raw = '';
    else if (rest[0] === ' ') {
      let e = rest.length;
      while (e > 1 && (rest.charCodeAt(e - 1) === 32 || rest.charCodeAt(e - 1) === 9)) e--;
      raw = rest.slice(1, e);
    } else return { error: `line ${n} is not "key: value"` };
    if (!KEYS.includes(key)) return { error: `unknown key "${key}"` };
    if (hasOwn(data, key)) return { error: `key "${key}" is given twice` };
    if (raw === '') return { error: `key "${key}" has no value` };
    const v = valueOf(key, raw);
    if ('error' in v) return v;
    data[key] = v.value;
  }
  if (!hasOwn(data, 'title')) return { error: 'no title' };
  return { data, body: closeEnd >= text.length ? '' : text.slice(closeEnd) };
}

// ---------------------------------------------------------------- markdown

function trimLine(line) {
  let a = 0;
  let b = line.length;
  while (a < b && (line.charCodeAt(a) === 32 || line.charCodeAt(a) === 9)) a++;
  while (b > a && (line.charCodeAt(b - 1) === 32 || line.charCodeAt(b - 1) === 9)) b--;
  return line.slice(a, b);
}

function isLangChar(cc) {
  return (cc >= 65 && cc <= 90) || (cc >= 97 && cc <= 122) || (cc >= 48 && cc <= 57) || cc === 95 || cc === 43 || cc === 45;
}

/** Fence open: the language, or null. */
function fenceLang(line) {
  if (!line.startsWith('```')) return null;
  let j = 3;
  while (j < line.length && isLangChar(line.charCodeAt(j))) j++;
  for (let k = j; k < line.length; k++) {
    const c = line.charCodeAt(k);
    if (c !== 32 && c !== 9) return null;
  }
  return line.slice(3, j);
}

function isFenceClose(line) {
  if (!line.startsWith('```')) return false;
  for (let k = 3; k < line.length; k++) {
    const c = line.charCodeAt(k);
    if (c !== 32 && c !== 9) return false;
  }
  return true;
}

function headingOf(line) {
  let j = 0;
  while (j < line.length && line.charCodeAt(j) === 35) j++;
  if (j < 1 || j > 6) return null;
  const c = line.charCodeAt(j);
  if (c !== 32 && c !== 9) return null;
  let k = j;
  while (k < line.length && (line.charCodeAt(k) === 32 || line.charCodeAt(k) === 9)) k++;
  let e = line.length;
  while (e > k && (line.charCodeAt(e - 1) === 32 || line.charCodeAt(e - 1) === 9)) e--;
  if (e === k) return null;
  return { depth: j, text: line.slice(k, e) };
}

function isHR(line) {
  const head = line.slice(0, 3);
  if (head !== '---' && head !== '***') return false;
  for (let k = 3; k < line.length; k++) {
    const c = line.charCodeAt(k);
    if (c !== 32 && c !== 9) return false;
  }
  return true;
}

function endsParagraph(line) {
  return isBlankLine(line) || fenceLang(line) !== null || headingOf(line) !== null || isHR(line);
}

function listStart(line) {
  const c0 = line.charCodeAt(0);
  if ((c0 === 45 || c0 === 42) && line.charCodeAt(1) === 32) return { ordered: false, start: 1, text: line.slice(2) };
  let j = 0;
  while (j < line.length) {
    const c = line.charCodeAt(j);
    if (c < 48 || c > 57) break;
    j++;
  }
  if (j >= 1 && j <= 9 && line.charCodeAt(j) === 46 && line.charCodeAt(j + 1) === 32) {
    return { ordered: true, start: Number(line.slice(0, j)), text: line.slice(j + 2) };
  }
  return null;
}

function isContinued(line) {
  if (line.charCodeAt(0) !== 32 || line.charCodeAt(1) !== 32) return false;
  let k = 2;
  while (k < line.length && line.charCodeAt(k) === 32) k++;
  return k < line.length && !isWSCode(line.charCodeAt(k));
}

function findUnescaped(s, what, from) {
  for (let j = from; j <= s.length - what.length; j++) {
    if (s[j] === '\\' && j + 1 < s.length && ESCAPABLE.has(s[j + 1])) { j++; continue; }
    if (s.startsWith(what, j)) return j;
  }
  return -1;
}

function findSingleStar(s, from) {
  for (let j = from; j < s.length; j++) {
    const c = s[j];
    if (c === '\\' && j + 1 < s.length && ESCAPABLE.has(s[j + 1])) { j++; continue; }
    if (c !== '*') continue;
    if (s[j + 1] === '*') { j++; continue; }
    return j;
  }
  return -1;
}

/** `s[a..b)` HTML-escaped into `out`, one pass, no regular expression. */
function escInto(out, s, a, b) {
  let start = a;
  for (let i = a; i < b; i++) {
    const c = s[i];
    let e;
    if (c === '&') e = '&amp;';
    else if (c === '<') e = '&lt;';
    else if (c === '>') e = '&gt;';
    else if (c === '"') e = '&quot;';
    else if (c === "'") e = '&#39;';
    else continue;
    if (i > start) out.push(s.slice(start, i));
    out.push(e);
    start = i + 1;
  }
  if (b > start) out.push(s.slice(start, b));
}

/** Inline rendering of `s[a..b)` into `out`; ranges, never substrings. */
function inlineInto(out, s, a, b, link) {
  let i = a;
  let lit = a; // start of the current literal run
  const flush = (to) => { if (to > lit) escInto(out, s, lit, to); };
  while (i < b) {
    const c = s[i];
    if (c === '\\' && i + 1 < b && ESCAPABLE.has(s[i + 1])) {
      flush(i);
      out.push(s[i + 1]);
      i += 2;
      lit = i;
      continue;
    }
    if (c === '`') {
      const j = s.indexOf('`', i + 1);
      if (j !== -1 && j < b && j > i + 1) {
        flush(i);
        out.push('<code>');
        escInto(out, s, i + 1, j);
        out.push('</code>');
        i = j + 1;
        lit = i;
      } else i++;
      continue;
    }
    if (c === '*') {
      if (s[i + 1] === '*') {
        const j = findUnescaped(s, '**', i + 2);
        if (j !== -1 && j < b && j > i + 2) {
          flush(i);
          out.push('<strong>');
          inlineInto(out, s, i + 2, j, link);
          out.push('</strong>');
          i = j + 2;
          lit = i;
        } else i += 2;
        continue;
      }
      const j = findSingleStar(s, i + 1);
      if (j !== -1 && j < b && j > i + 1) {
        flush(i);
        out.push('<em>');
        inlineInto(out, s, i + 1, j, link);
        out.push('</em>');
        i = j + 1;
        lit = i;
      } else i++;
      continue;
    }
    if (c === '[') {
      const k = findUnescaped(s, ']', i + 1);
      const m = k !== -1 && k < b && s[k + 1] === '(' ? s.indexOf(')', k + 2) : -1;
      const hasTarget = m !== -1 && m < b && m > k + 2;
      const target = hasTarget ? s.slice(k + 2, m) : '';
      if (hasTarget && !/\s/.test(target)) {
        flush(i);
        const href = link(target);
        out.push('<a href="');
        escInto(out, href, 0, href.length);
        out.push('">');
        inlineInto(out, s, i + 1, k, link);
        out.push('</a>');
        i = m + 1;
        lit = i;
        continue;
      }
      i++;
      continue;
    }
    i++;
  }
  flush(b);
}

function renderMarkdown(src, link, memo) {
  const lines = src.split('\n');
  const n = lines.length;
  const ids = new Set();
  const parts = [];
  const toc = [];
  let excerpt = null;
  let i = 0;
  while (i < n) {
    const line = lines[i];
    if (isBlankLine(line)) { i++; continue; }
    const lang = fenceLang(line);
    if (lang !== null) {
      i++;
      parts.push('<pre><code');
      if (lang !== '') parts.push(` class="language-${esc(lang)}"`);
      parts.push('>');
      while (i < n && !isFenceClose(lines[i])) {
        const l = lines[i++];
        escInto(parts, l, 0, l.length);
        parts.push('\n');
      }
      i++;
      parts.push('</code></pre>\n');
      continue;
    }
    const heading = headingOf(line);
    if (heading !== null) {
      const id = uniqueSlug(slugify(heading.text, memo), ids);
      parts.push(`<h${heading.depth} id="${id}">`);
      const m = parts.length;
      inlineInto(parts, heading.text, 0, heading.text.length, link);
      if (heading.depth === 2 || heading.depth === 3) toc.push({ level: heading.depth, id, html: parts.slice(m).join('') });
      parts.push(`</h${heading.depth}>\n`);
      i++;
      continue;
    }
    if (isHR(line)) { parts.push('<hr>\n'); i++; continue; }
    if (line.charCodeAt(0) === 62) {
      const body = [];
      while (i < n && lines[i].charCodeAt(0) === 62) {
        const l = lines[i++];
        body.push(l.startsWith('> ') ? l.slice(2) : l.slice(1));
      }
      const kept = [];
      for (const l of body) {
        const t = trimLine(l);
        if (t !== '') kept.push(t);
      }
      if (kept.length === 0) parts.push('<blockquote>\n</blockquote>\n');
      else {
        const joined = kept.join('\n');
        parts.push('<blockquote>\n<p>');
        inlineInto(parts, joined, 0, joined.length, link);
        parts.push('</p>\n</blockquote>\n');
      }
      continue;
    }
    const li = listStart(line);
    if (li !== null) {
      const isOrdered = li.ordered;
      const start = li.start;
      const items = [];
      while (i < n) {
        const m = listStart(lines[i]);
        if (m !== null && m.ordered === isOrdered) {
          items.push([trimLine(m.text)]);
          i++;
        } else if (isContinued(lines[i])) {
          items[items.length - 1].push(trimLine(lines[i]));
          i++;
        } else break;
      }
      const tag = isOrdered ? 'ol' : 'ul';
      const open = isOrdered && start !== 1 ? `<ol start="${start}">` : `<${tag}>`;
      parts.push(`${open}\n`);
      for (const item of items) {
        const joined = item.join('\n');
        parts.push('<li>');
        inlineInto(parts, joined, 0, joined.length, link);
        parts.push('</li>\n');
      }
      parts.push(`</${tag}>\n`);
      continue;
    }
    const body = [trimLine(line)];
    i++;
    while (i < n && !endsParagraph(lines[i])) body.push(trimLine(lines[i++]));
    const joined = body.join('\n');
    parts.push('<p>');
    const m = parts.length;
    inlineInto(parts, joined, 0, joined.length, link);
    if (excerpt === null) excerpt = parts.slice(m).join('');
    parts.push('</p>\n');
  }
  return { html: parts.join(''), toc, excerpt: excerpt ?? '' };
}

// ---------------------------------------------------------------- templates

class TemplateError extends Error {}

const PATH_RE = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/;
const FOR_RE = /^for ([A-Za-z_][A-Za-z0-9_]*) in (\S+)$/;
const IF_RE = /^if (not )?(\S+)$/;
const INCLUDE_RE = /^include "([a-z0-9-]+)"$/;

function pathOf(name, text) {
  if (!PATH_RE.test(text)) throw new TemplateError(`template "${name}": ${JSON.stringify(text)} is not a path`);
  return text.split('.');
}

function tokenize(name, src) {
  const tokens = [];
  let text = '';
  let i = 0;
  while (i < src.length) {
    const open = src.indexOf('{', i);
    if (open === -1 || open === src.length - 1) {
      text += src.slice(i);
      break;
    }
    const next = src[open + 1];
    if (next !== '{' && next !== '%') {
      text += src.slice(i, open + 1);
      i = open + 1;
      continue;
    }
    text += src.slice(i, open);
    if (next === '{') {
      const raw = src[open + 2] === '{';
      const close = src.indexOf(raw ? '}}}' : '}}', open + (raw ? 3 : 2));
      if (close === -1) throw new TemplateError(`template "${name}": a ${raw ? '{{{' : '{{'} is not closed`);
      if (text !== '') tokens.push({ t: 'text', text });
      text = '';
      tokens.push({ t: raw ? 'raw' : 'var', path: pathOf(name, src.slice(open + (raw ? 3 : 2), close).trim()) });
      i = close + (raw ? 3 : 2);
      continue;
    }
    const close = src.indexOf('%}', open + 2);
    if (close === -1) throw new TemplateError(`template "${name}": a {% is not closed`);
    const end = close + 2;
    const lineStart = src.lastIndexOf('\n', open - 1) + 1;
    const nl = src.indexOf('\n', end);
    const lineEnd = nl === -1 ? src.length : nl;
    const standalone = /^[ \t]*$/.test(src.slice(lineStart, open)) && /^[ \t]*$/.test(src.slice(end, lineEnd));
    if (standalone) text = text.slice(0, text.length - (open - lineStart));
    if (text !== '') tokens.push({ t: 'text', text });
    text = '';
    tokens.push({ t: 'tag', tag: src.slice(open + 2, close).trim() });
    i = standalone ? (nl === -1 ? src.length : nl + 1) : end;
  }
  if (text !== '') tokens.push({ t: 'text', text });
  return tokens;
}

function parseTemplate(name, src) {
  const root = { kind: 'root', body: [] };
  const stack = [root];
  let body = root.body;
  for (const tok of tokenize(name, src)) {
    if (tok.t === 'text') body.push({ kind: 'text', text: tok.text });
    else if (tok.t === 'var' || tok.t === 'raw') body.push({ kind: tok.t, path: tok.path });
    else {
      const tag = tok.tag;
      const top = stack[stack.length - 1];
      let m;
      if ((m = FOR_RE.exec(tag)) !== null) {
        const node = { kind: 'for', name: m[1], path: pathOf(name, m[2]), body: [] };
        body.push(node);
        stack.push(node);
        body = node.body;
      } else if ((m = IF_RE.exec(tag)) !== null) {
        const node = { kind: 'if', not: m[1] !== undefined, path: pathOf(name, m[2]), then: [], else: null };
        body.push(node);
        stack.push(node);
        body = node.then;
      } else if (tag === 'else') {
        if (top.kind !== 'if' || top.else !== null) throw new TemplateError(`template "${name}": an else outside an if`);
        top.else = [];
        body = top.else;
      } else if (tag === 'endfor' || tag === 'endif') {
        if (top.kind !== (tag === 'endfor' ? 'for' : 'if')) throw new TemplateError(`template "${name}": an ${tag} with no open ${tag.slice(3)}`);
        stack.pop();
        const parent = stack[stack.length - 1];
        body = parent.kind === 'root' ? parent.body : parent.kind === 'for' ? parent.body : parent.else ?? parent.then;
      } else if ((m = INCLUDE_RE.exec(tag)) !== null) body.push({ kind: 'include', name: m[1] });
      else throw new TemplateError(`template "${name}": {% ${tag} %} is not a tag`);
    }
  }
  if (stack.length > 1) throw new TemplateError(`template "${name}": a ${stack[stack.length - 1].kind} is not closed`);
  return root.body;
}

/** A value as text, exactly as the reference. */
function textOf(v) {
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (Array.isArray(v)) return v.map(textOf).join(', ');
  return '';
}

function truthy(v) {
  if (Array.isArray(v)) return v.length > 0;
  return v !== undefined && v !== null && v !== false && v !== '' && v !== 0;
}

/** First segment: innermost loop binding in L, else the page's values in V. */
function rootVal(L, V, name) {
  return L !== null && hasOwn(L, name) ? L[name] : V[name];
}

/** A later segment: an own property of an object, else undefined. */
function segVal(v, name) {
  return v === null || v === undefined || typeof v !== 'object' || !hasOwn(v, name) ? undefined : v[name];
}

function escText(v) {
  return typeof v === 'string' ? esc(v) : esc(textOf(v));
}

/** Compile parsed nodes to a render function (out, V, L, depth). */
function compileTemplate(nodes) {
  let uid = 0;
  const expr = (path, lvar) => {
    let e = `rootVal(${lvar},V,${JSON.stringify(path[0])})`;
    for (let k = 1; k < path.length; k++) e = `segVal(${e},${JSON.stringify(path[k])})`;
    return e;
  };
  const gen = (list, lvar) => {
    let code = '';
    for (const n of list) {
      if (n.kind === 'text') code += `out.push(${JSON.stringify(n.text)});`;
      else if (n.kind === 'var') code += `out.push(escText(${expr(n.path, lvar)}));`;
      else if (n.kind === 'raw') code += `out.push(textOf(${expr(n.path, lvar)}));`;
      else if (n.kind === 'if') {
        const cond = n.not ? `!truthy(${expr(n.path, lvar)})` : `truthy(${expr(n.path, lvar)})`;
        code += `if(${cond}){${gen(n.then, lvar)}}`;
        if (n.else !== null) code += `else{${gen(n.else, lvar)}}`;
      } else if (n.kind === 'for') {
        const id = uid++;
        const nl = `L${id}`;
        const xs = `X${id}`;
        const kk = `K${id}`;
        const xx = `E${id}`;
        code += `{const ${xs}=${expr(n.path, lvar)};if(Array.isArray(${xs})){const __n=${xs}.length;for(let ${kk}=0;${kk}<__n;${kk}++){const ${xx}=${xs}[${kk}];const ${nl}={...${lvar},${JSON.stringify(n.name)}:${xx},loop:{index:${kk}+1,first:${kk}===0,last:${kk}===__n-1,length:__n}};${gen(n.body, nl)}}}}`;
      } else if (n.kind === 'include') {
        code += `if(depth<8){const __f=TPL.get(${JSON.stringify(n.name)});if(__f!==undefined)__f(out,V,${lvar},depth+1,TPL,escText,textOf,truthy,rootVal,segVal);}`;
      }
    }
    return code;
  };
  const body = gen(nodes, 'L');
  return new Function('out', 'V', 'L', 'depth', 'TPL', 'escText', 'textOf', 'truthy', 'rootVal', 'segVal', body);
}

// ---------------------------------------------------------------- build

function resolvePath(dir, rel) {
  const parts = dir === '' ? [] : dir.split('/');
  for (const seg of rel.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (parts.length === 0) return null;
      parts.pop();
    } else parts.push(seg);
  }
  return parts.join('/');
}

const dirOf = (path) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');

function hasScheme(t) {
  const c = t.charCodeAt(0);
  if (!((c >= 65 && c <= 90) || (c >= 97 && c <= 122))) return false;
  for (let i = 1; i < t.length; i++) {
    const d = t.charCodeAt(i);
    if (d === 58) return true;
    if (!((d >= 65 && d <= 90) || (d >= 97 && d <= 122) || (d >= 48 && d <= 57) || d === 43 || d === 45 || d === 46)) return false;
  }
  return false;
}

export function run(input) {
  const memo = new Map();
  const templates = new Map();
  const report = [];
  for (const name of Object.keys(input.templates).sort(byCodeUnits)) {
    try {
      templates.set(name, compileTemplate(parseTemplate(name, input.templates[name])));
    } catch (err) {
      if (!(err instanceof TemplateError)) throw err;
      report.push(err.message);
    }
  }
  // The compiled render functions look their includes up in this same map.
  const TPL = templates;

  const files = [...input.files].sort((x, y) => byCodeUnits(x.path, y.path));
  const sources = [];
  const statics = [];
  for (const f of files) {
    if (f.path.endsWith('.md')) {
      sources.push({ path: f.path, text: f.content.indexOf('\r') === -1 ? f.content : f.content.replace(/\r\n?/g, '\n') });
    } else statics.push({ path: f.path, content: f.content });
  }

  const kept = [];
  for (const s of sources) {
    const fm = parseFrontMatter(s.text);
    if ('error' in fm) {
      report.push(`refused ${s.path}: ${fm.error}`);
      continue;
    }
    s.data = fm.data;
    s.body = fm.body;
    s.post = s.path.startsWith('posts/');
    const own = s.path.startsWith('tags/') ? 'tags' : s.path.startsWith('page/') ? 'page' : undefined;
    if (own !== undefined) {
      report.push(`refused ${s.path}: ${own}/ is the generator's own`);
      continue;
    }
    if (s.post && !hasOwn(s.data, 'date')) {
      report.push(`refused ${s.path}: a post needs a date`);
      continue;
    }
    const layout = s.data.layout ?? (s.post ? 'post' : 'page');
    if (!templates.has(layout)) {
      report.push(`refused ${s.path}: layout "${layout}" is no template that parses`);
      continue;
    }
    s.layout = layout;
    if (s.data.draft === true) {
      report.push(`draft ${s.path}`);
      continue;
    }
    kept.push(s);
  }

  const base = input.site.base_url.replace(/\/+$/, '');
  const bySource = new Map();
  const taken = new Map();
  for (const s of kept) {
    const dir = s.post ? 'posts' : dirOf(s.path);
    let set = taken.get(dir);
    if (set === undefined) {
      set = new Set(dir === '' ? RESERVED : []);
      taken.set(dir, set);
    }
    const slug = uniqueSlug(s.data.slug ?? slugify(s.data.title, memo), set);
    s.slug = slug;
    s.outDir = dir === '' ? slug : `${dir}/${slug}`;
    s.url = `${base}/${s.outDir}/`;
    bySource.set(s.path, s);
  }

  const staticPaths = new Set(statics.map((f) => f.path));
  const broken = new Set();
  for (const s of kept) {
    const dir = dirOf(s.path);
    const linkCache = new Map();
    const link = (target) => {
      const hit = linkCache.get(target);
      if (hit !== undefined) return hit;
      let r;
      if (hasScheme(target) || target.startsWith('/') || target.startsWith('#')) r = target;
      else {
        const hash = target.indexOf('#');
        const rel = hash === -1 ? target : target.slice(0, hash);
        const frag = hash === -1 ? '' : target.slice(hash);
        const path = rel === '' ? null : resolvePath(dir, rel);
        if (path !== null && bySource.has(path)) r = `${bySource.get(path).url}${frag}`;
        else if (path !== null && staticPaths.has(path)) r = `${base}/${path}${frag}`;
        else { broken.add(`broken-link ${s.path} -> ${target}`); r = target; }
      }
      linkCache.set(target, r);
      return r;
    };
    const md = renderMarkdown(s.body, link, memo);
    s.html = md.html;
    s.toc = md.toc;
    s.excerpt = md.excerpt;
  }

  const posts = kept.filter((s) => s.post);
  posts.sort((x, y) => byCodeUnits(y.data.date, x.data.date) || byCodeUnits(x.slug, y.slug));
  posts.forEach((p, k) => {
    p.newer = k === 0 ? null : posts[k - 1];
    p.older = k === posts.length - 1 ? null : posts[k + 1];
  });

  const bySlug = new Map();
  const ownTags = (s) => {
    const seen = new Set();
    const out = [];
    for (const name of s.data.tags ?? []) {
      const slug = slugify(name, memo);
      if (!seen.has(slug)) { seen.add(slug); out.push(name); }
    }
    return out;
  };
  for (const p of posts) {
    p.tagRefs = [];
    for (const name of ownTags(p)) {
      const slug = slugify(name, memo);
      let tag = bySlug.get(slug);
      if (tag === undefined) {
        tag = { name, slug, url: `${base}/tags/${slug}/`, posts: [] };
        bySlug.set(slug, tag);
      }
      tag.posts.push(p);
      p.tagRefs.push(tag);
    }
  }
  for (const s of kept) {
    if (!s.post) {
      s.tagRefs = ownTags(s).map((name) => {
        const slug = slugify(name, memo);
        return bySlug.get(slug) ?? { name, slug, url: '', posts: [] };
      });
    }
  }
  const tags = [...bySlug.values()].sort((x, y) => y.posts.length - x.posts.length || byCodeUnits(x.slug, y.slug));

  const linkOf = (s) => (s === null ? null : { title: s.data.title, url: s.url, date: s.data.date ?? '', date_long: s.data.date === undefined ? '' : longDate(s.data.date) });
  const cardOf = (s) => ({
    title: s.data.title,
    url: s.url,
    date: s.data.date ?? '',
    date_long: s.data.date === undefined ? '' : longDate(s.data.date),
    summary: s.data.summary ?? '',
    excerpt: s.excerpt,
    reading_minutes: Math.max(1, Math.ceil(wordsCount(s.body) / 200)),
    tags: s.tagRefs.map((t) => ({ name: t.name, slug: t.slug, url: t.url })),
  });
  const cards = new Map(posts.map((p) => [p, cardOf(p)]));
  const site = { title: input.site.title, base_url: base };
  const allTags = tags.map((t) => ({ name: t.name, slug: t.slug, url: t.url, count: t.posts.length }));
  const recent = posts.slice(0, input.site.recent).map((p) => cards.get(p));
  const output = {};
  const render = (name, vars) => {
    const fn = templates.get(name);
    if (fn === undefined) return null;
    const out = [];
    fn(out, { site, tags: allTags, recent, ...vars }, null, 0, TPL, escText, textOf, truthy, rootVal, segVal);
    return out.join('');
  };
  for (const s of kept) {
    const card = s.post ? cards.get(s) : cardOf(s);
    const page = Object.assign({}, card, {
      slug: s.slug,
      content: s.html,
      toc: s.toc.map((h) => ({ level: h.level, id: h.id, html: h.html })),
      newer: linkOf(s.newer ?? null),
      older: linkOf(s.older ?? null),
      is_post: s.post,
    });
    output[`${s.outDir}/index.html`] = render(s.layout, { page });
  }
  const per = input.site.per_page;
  const pages = Math.max(1, Math.ceil(posts.length / per));
  const indexUrl = (k) => (k === 1 ? `${base}/` : `${base}/page/${k}/`);
  for (let k = 1; k <= pages; k++) {
    const html = render('index', {
      posts: posts.slice((k - 1) * per, k * per).map((p) => cards.get(p)),
      pager: { number: k, total: pages, url: indexUrl(k), newer_url: k === 1 ? '' : indexUrl(k - 1), older_url: k === pages ? '' : indexUrl(k + 1) },
    });
    if (html !== null) output[k === 1 ? 'index.html' : `page/${k}/index.html`] = html;
  }
  for (const t of tags) {
    const html = render('tag', { tag: { name: t.name, slug: t.slug, url: t.url, count: t.posts.length, posts: t.posts.map((p) => cards.get(p)) } });
    if (html !== null) output[`tags/${t.slug}/index.html`] = html;
  }
  const tagsHtml = render('tags', {});
  if (tagsHtml !== null) output['tags/index.html'] = tagsHtml;
  for (const f of statics) {
    if (hasOwn(output, f.path)) report.push(`shadowed ${f.path}: a built page has its path`);
    else output[f.path] = f.content;
  }
  const lines = [...report, ...broken].sort(byCodeUnits);
  const npages = kept.filter((s) => !s.post).length;
  lines.push(`built ${npages} pages, ${posts.length} posts, ${tags.length} tags and ${statics.length} static files`);
  output['build-report.txt'] = `${lines.join('\n')}\n`;
  return output;
}
