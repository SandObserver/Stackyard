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

/** Type a plain (unquoted) scalar. The text is already free of comments.
    @param {string} s */
function plain(s) {
  if (s === '~' || s === 'null' || s === 'Null' || s === 'NULL') return null;
  if (s === 'true' || s === 'True' || s === 'TRUE' || s === 'yes' || s === 'Yes') return true;
  if (s === 'false' || s === 'False' || s === 'FALSE' || s === 'no' || s === 'No') return false;
  if (/^-?\d+$/.test(s)) return Number(s);
  if (/^-?\d*\.\d+$/.test(s)) return Number(s);
  return s;
}

/* Homepage substitutes these out of the raw text before it parses the file, so
   the braces are never YAML to it. Reading them as a flow mapping turns a real
   href into a parse failure. */
const PLACEHOLDER_RE = /^\{\{|^\$\{/;

const FLOW_DEPTH = 32;

/** @typedef {{ s: string, i: number, line: number, ctx: Ctx }} Flow */

/** @param {Flow} p */
const flowSpace = p => {
  while (p.i < p.s.length && /\s/.test(p.s[p.i])) p.i++;
};

/** One value inside a flow collection. Plain text runs to the next structural
    character, which is why a bare URL keeps its colon and its slashes.
    @param {Flow} p @param {number} depth */
function flowNode(p, depth) {
  if (depth > FLOW_DEPTH) throw new YamlLiteError('flow collection nested too deeply', p.line);
  flowSpace(p);
  const c = p.s[p.i];
  if (c === undefined) throw new YamlLiteError('unterminated flow collection', p.line);
  if (c === '[' || c === '{') return flowCollection(p, depth);
  if (c === '"' || c === "'") return flowQuoted(p);
  const start = p.i;
  while (p.i < p.s.length && !/[,\]}]/.test(p.s[p.i])) {
    /* A colon only ends the key when a space or a closing bracket follows it,
       matching the block form, so "http://host:8080" stays one value. */
    if (p.s[p.i] === ':' && /^[\s,\]}]|^$/.test(p.s.slice(p.i + 1, p.i + 2))) break;
    p.i++;
  }
  const text = p.s.slice(start, p.i).trim();
  const alias = /^\*(\S+)$/.exec(text);
  if (alias) {
    if (!p.ctx.anchors.has(alias[1])) throw new YamlLiteError('an alias to a block anchor is not supported', p.line);
    return p.ctx.anchors.get(alias[1]);
  }
  return plain(text);
}

/** @param {Flow} p */
function flowQuoted(p) {
  const q = p.s[p.i];
  const re = q === '"' ? /^"((?:[^"\\]|\\.)*)"/ : /^'((?:[^']|'')*)'/;
  const m = re.exec(p.s.slice(p.i));
  if (!m) throw new YamlLiteError(`unterminated ${q === '"' ? 'double' : 'single'}-quoted value`, p.line);
  p.i += m[0].length;
  return q === '"' ? unescapeDouble(m[1]) : m[1].replace(/''/g, "'");
}

/** @param {Flow} p @param {number} depth */
function flowCollection(p, depth) {
  const open = p.s[p.i++];
  const seq = open === '[';
  const close = seq ? ']' : '}';
  const out = seq ? [] : Object.create(null);
  flowSpace(p);
  if (p.s[p.i] === close) {
    p.i++;
    return out;
  }
  for (;;) {
    const node = flowNode(p, depth + 1);
    flowSpace(p);
    if (seq) {
      out.push(node);
    } else {
      let value = null;
      if (p.s[p.i] === ':') {
        p.i++;
        flowSpace(p);
        if (!/[,\]}]/.test(p.s[p.i] || ',')) value = flowNode(p, depth + 1);
      }
      /* A flow mapping key is text. An object or a list cannot name a field. */
      if (node !== null && typeof node === 'object') throw new YamlLiteError('flow mapping key is not text', p.line);
      out[String(node)] = value;
      flowSpace(p);
    }
    if (p.s[p.i] === ',') {
      p.i++;
      flowSpace(p);
      /* A trailing comma before the bracket is allowed. */
      if (p.s[p.i] === close) {
        p.i++;
        return out;
      }
      continue;
    }
    if (p.s[p.i] === close) {
      p.i++;
      return out;
    }
    throw new YamlLiteError('unterminated flow collection', p.line);
  }
}

/** @param {string} s @param {number} line @param {Ctx} ctx */
function parseFlow(s, line, ctx) {
  const p = { s, i: 0, line, ctx };
  const out = flowCollection(p, 0);
  flowSpace(p);
  if (p.i < s.length && s[p.i] !== '#') throw new YamlLiteError('trailing text after a flow collection', line);
  return out;
}

/** @param {string} raw @param {number} line @param {Ctx} ctx */
function scalar(raw, line, ctx) {
  const s = raw.trim();
  if (s === '') return '';
  const anchor = /^&(\S+)(?:\s+([\s\S]*))?$/.exec(s);
  if (anchor) {
    if (anchor[2] === undefined || anchor[2].trim() === '')
      throw new YamlLiteError('an anchor on a block is not supported', line);
    const value = scalar(anchor[2], line, ctx);
    ctx.anchors.set(anchor[1], value);
    return value;
  }
  const alias = /^\*(\S+)\s*$/.exec(s);
  if (alias) {
    if (!ctx.anchors.has(alias[1])) throw new YamlLiteError('an alias to a block anchor is not supported', line);
    return ctx.anchors.get(alias[1]);
  }
  if (s[0] === '"') {
    const m = /^"((?:[^"\\]|\\.)*)"\s*(?:#.*)?$/.exec(s);
    if (!m) throw new YamlLiteError('unterminated double-quoted value', line);
    return unescapeDouble(m[1]);
  }
  if (s[0] === "'") {
    const m = /^'((?:[^']|'')*)'\s*(?:#.*)?$/.exec(s);
    if (!m) throw new YamlLiteError('unterminated single-quoted value', line);
    return m[1].replace(/''/g, "'");
  }
  if (PLACEHOLDER_RE.test(s)) {
    const cut = s.search(/\s#/);
    return cut === -1 ? s : s.slice(0, cut).trim();
  }
  if (s[0] === '{' || s[0] === '[') return parseFlow(s, line, ctx);
  /* A trailing comment needs a space before the #, or "#00ff00" and a URL
     fragment are eaten. */
  const cut = s.search(/\s#/);
  return plain(cut === -1 ? s : s.slice(0, cut).trim());
}

/** @typedef {{ indent: number, text: string, line: number, block?: string, bad?: string }} Line */

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

/** @typedef {{ tolerant: boolean, errors: Array<{ line: number, reason: string }>,
                anchors: Map<string, any> }} Ctx */

/** Parse a block starting at `pos` whose lines are indented at least `indent`.
    @param {Line[]} lines @param {{ pos: number }} cur @param {number} indent @param {Ctx} ctx */
function block(lines, cur, indent, ctx) {
  const first = lines[cur.pos];
  return first.text.startsWith('- ') || first.text === '-'
    ? sequence(lines, cur, indent, ctx)
    : mapping(lines, cur, indent, ctx);
}

/** Refuse an anchor written on a key. It names the key, not the value, and
    nothing in either source format uses it.
    @param {string} text @param {number} line */
function refuseAnchor(text, line) {
  if (/^&\S+\s+\S+\s*:/.test(text)) throw new YamlLiteError('an anchor on a key is not supported', line);
}

/** The anchor an inline value is nothing but, as in "- &ref_0" with the node
    itself indented underneath.
    @param {string|undefined} inline */
const blockAnchor = inline => {
  const m = inline === undefined ? null : /^&(\S+)\s*$/.exec(inline.trim());
  return m ? m[1] : '';
};

/** Fold a merge key's value into the mapping it was written in. Keys already
    set win, which is what a merge means.
    @param {any} map @param {any} value @param {number} line */
function merge(map, value, line) {
  const sources = Array.isArray(value) ? value : [value];
  for (const src of sources) {
    if (!src || typeof src !== 'object' || Array.isArray(src))
      throw new YamlLiteError('a merge key needs a mapping', line);
    for (const k of Object.keys(src)) if (!(k in map)) map[k] = src[k];
  }
}

/** Give up on the node that started at `start` and step over every line that
    belongs to it, so one unreadable entry costs its own subtree and no more.
    @param {Line[]} lines @param {{ pos: number }} cur @param {number} start
    @param {number} indent @param {Ctx} ctx @param {unknown} err */
function recover(lines, cur, start, indent, ctx, err) {
  if (!ctx.tolerant || !(err instanceof YamlLiteError)) throw err;
  ctx.errors.push({ line: err.line, reason: err.reason });
  cur.pos = start + 1;
  while (cur.pos < lines.length && lines[cur.pos].indent > indent) cur.pos++;
}

/** @param {Line[]} lines @param {{ pos: number }} cur @param {number} indent @param {Ctx} ctx */
function sequence(lines, cur, indent, ctx) {
  const out = [];
  while (cur.pos < lines.length) {
    const l = lines[cur.pos];
    if (l.indent < indent) break;
    if (l.indent > indent) {
      const start = cur.pos;
      recover(lines, cur, start, indent, ctx, new YamlLiteError('unexpected indentation', l.line));
      continue;
    }
    if (!(l.text.startsWith('- ') || l.text === '-')) break;
    const start = cur.pos;
    try {
      out.push(sequenceEntry(lines, cur, indent, ctx));
    } catch (err) {
      recover(lines, cur, start, indent, ctx, err);
    }
  }
  return out;
}

/** One element of a sequence, with `cur` already on its dash line.
    @param {Line[]} lines @param {{ pos: number }} cur @param {number} indent @param {Ctx} ctx */
function sequenceEntry(lines, cur, indent, ctx) {
  const l = lines[cur.pos];
  if (l.bad) throw new YamlLiteError(l.bad, l.line);
  const after = l.text.slice(1);
  const rest = after.trim();
  cur.pos++;
  /* Dashy's own editor writes every item this way: an anchor alone on the dash
     line, the item indented under it, and an alias wherever it repeats. */
  const anchor = blockAnchor(rest);
  if (rest === '' || anchor) {
    let value = null;
    if (cur.pos < lines.length && lines[cur.pos].indent > indent) value = block(lines, cur, lines[cur.pos].indent, ctx);
    if (anchor) ctx.anchors.set(anchor, value);
    return value;
  }
  refuseAnchor(rest, l.line);
  if (rest.startsWith('- ') || rest === '-')
    throw new YamlLiteError('a sequence inside a sequence line is not supported', l.line);
  /* Ahead of the key match, or a flow mapping's brace and first key read as a
     key line and parse into something that was never in the file. */
  if (rest[0] === '{' || rest[0] === '[') return scalar(rest, l.line, ctx);
  const m = KEY_RE.exec(rest);
  if (m) {
    /* The compound "- key: value" form. The element is a mapping whose first
       key sits on the dash line, so its own indentation is the column the key
       text starts at, not a fixed offset from the dash: "-  key" is as valid
       as "- key" and its continuation lines line up with the key. */
    const inner = indent + 1 + (after.length - after.trimStart().length);
    const map = Object.create(null);
    assign(map, m, l.line, lines, cur, inner, ctx, l);
    while (cur.pos < lines.length && lines[cur.pos].indent === inner) {
      const nl = lines[cur.pos];
      if (nl.text.startsWith('- ') || nl.text === '-') break;
      if (!mappingEntry(map, lines, cur, inner, ctx)) break;
    }
    return map;
  }
  return scalar(rest, l.line, ctx);
}

/** Set one key on `map` from a matched key line, reading its nested block when
    the value is empty.
    @param {any} map @param {RegExpExecArray} m @param {number} line
    @param {Line[]} lines @param {{ pos: number }} cur @param {number} indent
    @param {Ctx} ctx @param {Line} [own] the key's own line, when it carried a block scalar */
function assign(map, m, line, lines, cur, indent, ctx, own) {
  const key = m[1] !== undefined ? unescapeDouble(m[1]) : m[2] !== undefined ? m[2].replace(/''/g, "'") : m[3].trim();
  if (own && own.block !== undefined) {
    map[key] = own.block;
    return;
  }
  const inline = m[4];
  const anchor = blockAnchor(inline);
  /** Record the anchor this key carried, then store the value under the key. */
  const set = value => {
    if (anchor) ctx.anchors.set(anchor, value);
    if (key === '<<') merge(map, value, line);
    else map[key] = value;
  };
  if (!anchor && inline !== undefined && inline.trim() !== '' && !/^#/.test(inline.trim())) {
    set(scalar(inline, line, ctx));
    return;
  }
  const next = lines[cur.pos];
  if (!next) {
    set(null);
    return;
  }
  /* A sequence belonging to a key is written either indented under it or level
     with it, and level is the more common of the two: Dashy's own default
     config writes navLinks that way. Only a sequence may do this. A mapping at
     the same column is the next key of the same parent, not this key's value. */
  if (next.indent === indent && (next.text.startsWith('- ') || next.text === '-')) {
    set(sequence(lines, cur, indent, ctx));
    return;
  }
  if (next.indent <= indent) {
    set(null);
    return;
  }
  set(block(lines, cur, next.indent, ctx));
}

/** Read one "key: value" line into `map`. Returns false when the line does not
    start a key, which ends the mapping.
    @param {any} map @param {Line[]} lines @param {{ pos: number }} cur
    @param {number} indent @param {Ctx} ctx */
function mappingEntry(map, lines, cur, indent, ctx) {
  const l = lines[cur.pos];
  const start = cur.pos;
  try {
    if (l.bad) throw new YamlLiteError(l.bad, l.line);
    refuseAnchor(l.text, l.line);
    const m = KEY_RE.exec(l.text);
    if (!m) throw new YamlLiteError('expected "key: value"', l.line);
    cur.pos++;
    assign(map, m, l.line, lines, cur, indent, ctx, l);
  } catch (err) {
    recover(lines, cur, start, indent, ctx, err);
  }
  return true;
}

/** @param {Line[]} lines @param {{ pos: number }} cur @param {number} indent @param {Ctx} ctx */
function mapping(lines, cur, indent, ctx) {
  const map = Object.create(null);
  while (cur.pos < lines.length) {
    const l = lines[cur.pos];
    if (l.indent < indent) break;
    if (l.indent > indent) {
      recover(lines, cur, cur.pos, indent, ctx, new YamlLiteError('unexpected indentation', l.line));
      continue;
    }
    if (l.text.startsWith('- ') || l.text === '-') {
      /* A sequence at the same column as the keys of the mapping it belongs to.
         Only valid as the whole value of the key above, which assign handles. */
      break;
    }
    if (!mappingEntry(map, lines, cur, indent, ctx)) break;
  }
  return map;
}

/** @param {string} text @param {boolean} tolerant */
function run(text, tolerant) {
  /** @type {Ctx} */
  const ctx = { tolerant, errors: [], anchors: new Map() };
  const lines = scan(String(text == null ? '' : text));
  if (!lines.length) return { doc: null, errors: ctx.errors };
  if (lines[0].indent !== 0) throw new YamlLiteError('unexpected indentation', lines[0].line);
  const cur = { pos: 0 };
  const doc = block(lines, cur, 0, ctx);
  if (cur.pos < lines.length) throw new YamlLiteError('unexpected indentation', lines[cur.pos].line);
  return { doc, errors: ctx.errors };
}

/** Parse a YAML subset document.

    Objects come back with a null prototype: the keys are attacker-influenced
    names from someone else's config, and a key called "constructor" or
    "__proto__" must answer as data rather than as an inherited member.

    @param {string} text @returns {any}
    @throws {YamlLiteError} on anything outside the subset */
export function parseYaml(text) {
  return run(text, false).doc;
}

/** Parse a document, dropping what cannot be read instead of refusing the file.
    Each dropped node is reported, so the caller can tell someone what is
    missing rather than losing it silently.

    @param {string} text @returns {{ doc: any, errors: Array<{ line: number, reason: string }> }}
    @throws {YamlLiteError} when the whole file cannot be scanned */
export function parseYamlTolerant(text) {
  return run(text, true);
}
