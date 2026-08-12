// @ts-check

/** Thrown for anything outside the supported subset, with the source line. */
export class YamlLiteError extends Error {
  /** @param {string} message @param {number} line */
  constructor(message, line) {
    super(`Line ${line}: ${message}`);
    this.name = 'YamlLiteError';
    this.line = line;
    this.reason = message;
  }
}

/* The key stops at the first colon followed by a space or end of line, so
   "url: http://host:8080" splits once and keeps the port. */
const KEY_RE = /^(?:(?:"((?:[^"\\]|\\.)*)")|(?:'((?:[^']|'')*)')|([^:#]+?))\s*:(?:\s+(.*))?$/;

/** @param {string} s */
const unescapeDouble = s => s.replace(/\\(["\\/nrt])/g, (_, c) => ({ n: '\n', r: '\r', t: '\t' })[c] || c);

/** @param {string} raw @param {number} line */
function scalar(raw, line) {
  const s = raw.trim();
  if (s === '') return '';
  if (s[0] === '"') {
    const m = /^"((?:[^"\\]|\\.)*)"\s*$/.exec(s);
    if (!m) throw new YamlLiteError('unterminated double-quoted value', line);
    return unescapeDouble(m[1]);
  }
  if (s[0] === "'") {
    const m = /^'((?:[^']|'')*)'\s*$/.exec(s);
    if (!m) throw new YamlLiteError('unterminated single-quoted value', line);
    return m[1].replace(/''/g, "'");
  }
  if (s[0] === '&' || s[0] === '*') throw new YamlLiteError('anchors and aliases are not supported', line);
  /* An empty flow sequence is unambiguous. Anything with contents inside the
     brackets is refused. */
  if (s === '[]') return [];
  if (s === '{}') return Object.create(null);
  if (s[0] === '{' || s[0] === '[') throw new YamlLiteError('flow collections are not supported', line);
  if (s === '~' || s === 'null' || s === 'Null' || s === 'NULL') return null;
  if (s === 'true' || s === 'True' || s === 'TRUE' || s === 'yes' || s === 'Yes') return true;
  if (s === 'false' || s === 'False' || s === 'FALSE' || s === 'no' || s === 'No') return false;
  if (/^-?\d+$/.test(s)) return Number(s);
  if (/^-?\d*\.\d+$/.test(s)) return Number(s);
  /* A trailing comment needs a space before the #, or "#00ff00" and a URL
     fragment are eaten. */
  const cut = s.search(/\s#/);
  return cut === -1 ? s : s.slice(0, cut).trim();
}

/** @typedef {{ indent: number, text: string, line: number, block?: string }} Line */

const BLOCK_RE = /^(.*?):\s*([|>])([-+]?)(\d*)\s*$/;

/** Fold the lines of a block scalar into its value. A folded block joins its
    lines with spaces, a literal block keeps them. A blank line is a paragraph
    break either way.

    @param {string[]} raw the block's lines, already stripped of its indentation
    @param {string} style either "|" or ">" @param {string} chomp */
function foldBlock(raw, style, chomp) {
  if (!raw.length) return '';
  let body;
  if (style === '|') body = raw.join('\n');
  else {
    body = '';
    for (let i = 0; i < raw.length; i++) {
      const cur = raw[i];
      if (i === 0) body = cur;
      else if (cur === '' || raw[i - 1] === '' || /^\s/.test(cur) || /^\s/.test(raw[i - 1])) body += '\n' + cur;
      else body += ' ' + cur;
    }
  }
  if (chomp === '-') return body.replace(/\n+$/, '');
  /* "keep" means every trailing newline the block ended with, so the blank
     lines must still be here. */
  if (chomp === '+') return body + '\n';
  return body.replace(/\n+$/, '') + (body.length ? '\n' : '');
}

/** @param {string} text @returns {Line[]} */
function scan(text) {
  /** @type {Line[]} */
  const out = [];
  let docs = 0;
  /* A byte order mark left in place becomes part of the first key. */
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows = text.split(/\r\n|\r|\n/);
  /* The empty string after a final newline is not a line of the file. */
  if (rows.length > 1 && rows[rows.length - 1] === '') rows.pop();

  for (let i = 0; i < rows.length; i++) {
    const raw = rows[i];
    const line = i + 1;
    if (/^\s*$/.test(raw)) continue;
    if (/^\s*#/.test(raw)) continue;
    if (/^ *\t/.test(raw)) throw new YamlLiteError('tab indentation is not supported', line);
    const trimmed = raw.trim();
    if (trimmed === '---') {
      /* A second marker means a multi-document file. Reading only the first
         document drops the rest. */
      if (++docs > 1 || out.length) throw new YamlLiteError('multi-document files are not supported', line);
      continue;
    }
    if (trimmed === '...') throw new YamlLiteError('multi-document files are not supported', line);
    /* Refuse anchors where a node begins, not here. A value is free text, and
       `description: The *arr stack` is not an alias. */
    if (/^<<\s*:/.test(trimmed)) throw new YamlLiteError('merge keys are not supported', line);

    const indent = raw.length - raw.trimStart().length;
    const bm = BLOCK_RE.exec(trimmed);
    /* A block scalar's lines are text, not structure. Nothing below this point
       may look at them. */
    if (bm && bm[1] !== '' && !bm[1].includes('#')) {
      const body = [];
      let base = bm[4] ? indent + Number(bm[4]) : -1;
      let j = i + 1;
      for (; j < rows.length; j++) {
        const r = rows[j];
        if (/^\s*$/.test(r)) {
          body.push('');
          continue;
        }
        const ri = r.length - r.trimStart().length;
        if (ri <= indent) break;
        if (base === -1) base = ri;
        if (ri < base) break;
        body.push(r.slice(base));
      }
      out.push({ indent, text: bm[1].trim() + ':', line, block: foldBlock(body, bm[2], bm[3]) });
      i = j - 1;
      continue;
    }
    out.push({ indent, text: trimmed, line });
  }
  return out;
}

/** Parse a block starting at `pos` whose lines are indented at least `indent`.
    @param {Line[]} lines @param {{ pos: number }} cur @param {number} indent */
function block(lines, cur, indent) {
  const first = lines[cur.pos];
  return first.text.startsWith('- ') || first.text === '-' ? sequence(lines, cur, indent) : mapping(lines, cur, indent);
}

/** Refuse an anchor or alias where a node begins. The same characters inside a
    value stay ordinary text.
    @param {string} text @param {number} line */
function refuseAnchor(text, line) {
  if (/^[&*]\S/.test(text)) throw new YamlLiteError('anchors and aliases are not supported', line);
}

/** @param {Line[]} lines @param {{ pos: number }} cur @param {number} indent */
function sequence(lines, cur, indent) {
  const out = [];
  while (cur.pos < lines.length) {
    const l = lines[cur.pos];
    if (l.indent < indent) break;
    if (l.indent > indent) throw new YamlLiteError('unexpected indentation', l.line);
    if (!(l.text.startsWith('- ') || l.text === '-')) break;
    const after = l.text.slice(1);
    const rest = after.trim();
    cur.pos++;
    if (rest === '') {
      /* "-" alone: the element is the block indented under it. */
      if (cur.pos < lines.length && lines[cur.pos].indent > indent) out.push(block(lines, cur, lines[cur.pos].indent));
      else out.push(null);
      continue;
    }
    refuseAnchor(rest, l.line);
    if (rest.startsWith('- ') || rest === '-')
      throw new YamlLiteError('a sequence inside a sequence line is not supported', l.line);
    /* Ahead of the key match, or a flow mapping's brace and first key read as a
       key line and parse into something that was never in the file. */
    if (rest[0] === '{' || rest[0] === '[') {
      out.push(scalar(rest, l.line));
      continue;
    }
    const m = KEY_RE.exec(rest);
    if (m) {
      /* The compound "- key: value" form. The element is a mapping whose first
         key sits on the dash line, so its own indentation is the column the key
         text starts at, not a fixed offset from the dash: "-  key" is as valid
         as "- key" and its continuation lines line up with the key. */
      const inner = indent + 1 + (after.length - after.trimStart().length);
      const map = Object.create(null);
      assign(map, m, l.line, lines, cur, inner, l);
      while (cur.pos < lines.length && lines[cur.pos].indent === inner) {
        const nl = lines[cur.pos];
        if (nl.text.startsWith('- ') || nl.text === '-') break;
        const nm = KEY_RE.exec(nl.text);
        if (!nm) throw new YamlLiteError('expected "key: value"', nl.line);
        cur.pos++;
        assign(map, nm, nl.line, lines, cur, inner, nl);
      }
      out.push(map);
      continue;
    }
    out.push(scalar(rest, l.line));
  }
  return out;
}

/** Set one key on `map` from a matched key line, reading its nested block when
    the value is empty.
    @param {any} map @param {RegExpExecArray} m @param {number} line
    @param {Line[]} lines @param {{ pos: number }} cur @param {number} indent
    @param {Line} [own] the key's own line, when it carried a block scalar */
function assign(map, m, line, lines, cur, indent, own) {
  const key = m[1] !== undefined ? unescapeDouble(m[1]) : m[2] !== undefined ? m[2].replace(/''/g, "'") : m[3].trim();
  if (own && own.block !== undefined) {
    map[key] = own.block;
    return;
  }
  const inline = m[4];
  if (inline !== undefined && inline.trim() !== '' && !/^#/.test(inline.trim())) {
    map[key] = scalar(inline, line);
    return;
  }
  const next = lines[cur.pos];
  if (!next) {
    map[key] = null;
    return;
  }
  /* A sequence belonging to a key is written either indented under it or level
     with it, and level is the more common of the two: Dashy's own default
     config writes navLinks that way. Only a sequence may do this. A mapping at
     the same column is the next key of the same parent, not this key's value. */
  if (next.indent === indent && (next.text.startsWith('- ') || next.text === '-')) {
    map[key] = sequence(lines, cur, indent);
    return;
  }
  if (next.indent <= indent) {
    map[key] = null;
    return;
  }
  map[key] = block(lines, cur, next.indent);
}

/** @param {Line[]} lines @param {{ pos: number }} cur @param {number} indent */
function mapping(lines, cur, indent) {
  const map = Object.create(null);
  while (cur.pos < lines.length) {
    const l = lines[cur.pos];
    if (l.indent < indent) break;
    if (l.indent > indent) throw new YamlLiteError('unexpected indentation', l.line);
    if (l.text.startsWith('- ') || l.text === '-') {
      /* A sequence at the same column as the keys of the mapping it belongs to.
         Only valid as the whole value of the key above, which assign handles. */
      break;
    }
    refuseAnchor(l.text, l.line);
    const m = KEY_RE.exec(l.text);
    if (!m) throw new YamlLiteError('expected "key: value"', l.line);
    cur.pos++;
    assign(map, m, l.line, lines, cur, indent, l);
  }
  return map;
}

/** Parse a YAML subset document.

    Objects come back with a null prototype: the keys are attacker-influenced
    names from someone else's config, and a key called "constructor" or
    "__proto__" must answer as data rather than as an inherited member.

    @param {string} text @returns {any}
    @throws {YamlLiteError} on anything outside the subset */
export function parseYaml(text) {
  const lines = scan(String(text == null ? '' : text));
  if (!lines.length) return null;
  if (lines[0].indent !== 0) throw new YamlLiteError('unexpected indentation', lines[0].line);
  const cur = { pos: 0 };
  const doc = block(lines, cur, 0);
  if (cur.pos < lines.length) throw new YamlLiteError('unexpected indentation', lines[cur.pos].line);
  return doc;
}
