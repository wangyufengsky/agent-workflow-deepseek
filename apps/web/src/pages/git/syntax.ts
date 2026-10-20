/**
 * 轻量、按行、无依赖的语法着色（审计 GIT-02：diff 缺语法着色）。
 *
 * 设计稿要求 diff 代码有语法着色；这里按文件扩展名选一组关键字与词法规则，
 * 只做「把一行拆成带类名的片段」，不执行代码、不加载外部高亮库，也不改变
 * 文本内容（片段拼起来与原始行逐字符相同）。颜色全部由 git.css 用主题令牌
 * 定义，四主题自动继承。
 */

export type TokenClass =
  | 'com' // 注释
  | 'str' // 字符串
  | 'num' // 数字
  | 'kw' // 关键字
  | 'type' // 类型 / 类名
  | 'fn' // 函数调用
  | 'op' // 运算符 / 标点
  | 'tag' // 标签名
  | 'attr' // 属性 / 键
  | 'meta'; // Markdown 标记等

export interface SyntaxToken {
  readonly text: string;
  readonly cls?: TokenClass;
}

interface LanguageSpec {
  readonly lineComment?: string;
  readonly blockComment?: readonly [string, string];
  readonly strings?: readonly string[];
  readonly keywords?: readonly string[];
  readonly literals?: readonly string[];
  readonly hashComment?: boolean;
  /** 键名（JSON / YAML / CSS 属性 / HTML 属性）放在冒号或等号前。 */
  readonly keyBefore?: ':' | '=';
  readonly html?: boolean;
  readonly markdown?: boolean;
  readonly shell?: boolean;
  readonly sql?: boolean;
  readonly css?: boolean;
}

const TS_KEYWORDS = [
  'abstract', 'as', 'async', 'await', 'break', 'case', 'catch', 'class', 'const', 'continue', 'declare',
  'default', 'delete', 'do', 'else', 'enum', 'export', 'extends', 'false', 'finally', 'for', 'from',
  'function', 'get', 'if', 'implements', 'import', 'in', 'instanceof', 'interface', 'is', 'keyof',
  'let', 'new', 'null', 'of', 'private', 'protected', 'public', 'readonly', 'return', 'satisfies',
  'set', 'static', 'super', 'switch', 'this', 'throw', 'true', 'try', 'type', 'typeof', 'undefined',
  'var', 'void', 'while', 'with', 'yield',
];

const PY_KEYWORDS = [
  'and', 'as', 'assert', 'async', 'await', 'break', 'class', 'continue', 'def', 'del', 'elif', 'else',
  'except', 'False', 'finally', 'for', 'from', 'global', 'if', 'import', 'in', 'is', 'lambda', 'None',
  'nonlocal', 'not', 'or', 'pass', 'raise', 'return', 'True', 'try', 'while', 'with', 'yield',
];

const GO_KEYWORDS = [
  'break', 'case', 'chan', 'const', 'continue', 'default', 'defer', 'else', 'fallthrough', 'for', 'func',
  'go', 'goto', 'if', 'import', 'interface', 'map', 'package', 'range', 'return', 'select', 'struct',
  'switch', 'type', 'var', 'nil', 'true', 'false',
];

const JAVA_KEYWORDS = [
  'abstract', 'assert', 'boolean', 'break', 'byte', 'case', 'catch', 'char', 'class', 'const', 'continue',
  'default', 'do', 'double', 'else', 'enum', 'extends', 'final', 'finally', 'float', 'for', 'if',
  'implements', 'import', 'instanceof', 'int', 'interface', 'long', 'native', 'new', 'package', 'private',
  'protected', 'public', 'return', 'short', 'static', 'strictfp', 'super', 'switch', 'synchronized',
  'this', 'throw', 'throws', 'transient', 'try', 'void', 'volatile', 'while', 'true', 'false', 'null',
];

const SH_KEYWORDS = [
  'if', 'then', 'else', 'elif', 'fi', 'for', 'in', 'do', 'done', 'case', 'esac', 'while', 'until',
  'function', 'return', 'local', 'export', 'set', 'unset', 'shift', 'exit', 'trap', 'eval', 'source',
];

const SQL_KEYWORDS = [
  'select', 'from', 'where', 'and', 'or', 'not', 'insert', 'into', 'values', 'update', 'set', 'delete',
  'create', 'table', 'alter', 'drop', 'index', 'join', 'left', 'right', 'inner', 'outer', 'on', 'group',
  'by', 'order', 'having', 'limit', 'offset', 'as', 'distinct', 'union', 'case', 'when', 'then', 'else',
  'end', 'is', 'null', 'in', 'exists', 'primary', 'key', 'foreign', 'references', 'default', 'constraint',
  'begin', 'commit', 'rollback', 'transaction', 'with', 'returning',
];

const CSS_KEYWORDS = ['important', 'inherit', 'initial', 'unset', 'none', 'auto', 'flex', 'grid', 'block', 'inline', 'relative', 'absolute'];

const SPEC_BY_EXTENSION: Readonly<Record<string, LanguageSpec>> = {
  ts: { lineComment: '//', blockComment: ['/*', '*/'], strings: ['"', "'", '`'], keywords: TS_KEYWORDS, literals: ['true', 'false', 'null', 'undefined'] },
  tsx: { lineComment: '//', blockComment: ['/*', '*/'], strings: ['"', "'", '`'], keywords: TS_KEYWORDS, literals: ['true', 'false', 'null', 'undefined'], html: true },
  js: { lineComment: '//', blockComment: ['/*', '*/'], strings: ['"', "'", '`'], keywords: TS_KEYWORDS, literals: ['true', 'false', 'null', 'undefined'] },
  jsx: { lineComment: '//', blockComment: ['/*', '*/'], strings: ['"', "'", '`'], keywords: TS_KEYWORDS, literals: ['true', 'false', 'null', 'undefined'], html: true },
  json: { strings: ['"'], literals: ['true', 'false', 'null'], keyBefore: ':' },
  css: { blockComment: ['/*', '*/'], strings: ['"', "'"], keywords: CSS_KEYWORDS, keyBefore: ':', css: true },
  scss: { lineComment: '//', blockComment: ['/*', '*/'], strings: ['"', "'"], keyBefore: ':', css: true },
  html: { blockComment: ['<!--', '-->'], strings: ['"', "'"], html: true },
  xml: { blockComment: ['<!--', '-->'], strings: ['"', "'"], html: true },
  vue: { lineComment: '//', blockComment: ['<!--', '-->'], strings: ['"', "'"], keywords: TS_KEYWORDS, html: true },
  svelte: { lineComment: '//', blockComment: ['<!--', '-->'], strings: ['"', "'"], keywords: TS_KEYWORDS, html: true },
  md: { strings: ['`'], markdown: true },
  markdown: { strings: ['`'], markdown: true },
  py: { hashComment: true, strings: ['"', "'"], keywords: PY_KEYWORDS, literals: ['True', 'False', 'None'] },
  go: { lineComment: '//', blockComment: ['/*', '*/'], strings: ['"', '`'], keywords: GO_KEYWORDS, literals: ['true', 'false', 'nil'] },
  java: { lineComment: '//', blockComment: ['/*', '*/'], strings: ['"'], keywords: JAVA_KEYWORDS },
  kt: { lineComment: '//', blockComment: ['/*', '*/'], strings: ['"'], keywords: JAVA_KEYWORDS },
  rs: { lineComment: '//', blockComment: ['/*', '*/'], strings: ['"'], keywords: ['fn', 'let', 'mut', 'pub', 'impl', 'trait', 'struct', 'enum', 'match', 'if', 'else', 'for', 'while', 'loop', 'return', 'use', 'mod', 'crate', 'self', 'super', 'as', 'const', 'static', 'async', 'await', 'move', 'ref', 'where', 'unsafe', 'type', 'in'] },
  sh: { hashComment: true, strings: ['"', "'"], keywords: SH_KEYWORDS, shell: true },
  bash: { hashComment: true, strings: ['"', "'"], keywords: SH_KEYWORDS, shell: true },
  zsh: { hashComment: true, strings: ['"', "'"], keywords: SH_KEYWORDS, shell: true },
  sql: { lineComment: '--', blockComment: ['/*', '*/'], strings: ["'"], keywords: SQL_KEYWORDS, sql: true },
  yaml: { hashComment: true, strings: ['"', "'"], literals: ['true', 'false', 'null', 'yes', 'no'], keyBefore: ':' },
  yml: { hashComment: true, strings: ['"', "'"], literals: ['true', 'false', 'null', 'yes', 'no'], keyBefore: ':' },
  toml: { hashComment: true, strings: ['"', "'"], literals: ['true', 'false'], keyBefore: '=' },
  ini: { hashComment: true, strings: ['"', "'"], keyBefore: '=' },
  c: { lineComment: '//', blockComment: ['/*', '*/'], strings: ['"'], keywords: ['int', 'char', 'float', 'double', 'void', 'return', 'if', 'else', 'for', 'while', 'switch', 'case', 'break', 'continue', 'struct', 'typedef', 'static', 'const', 'sizeof', 'include', 'define'] },
  h: { lineComment: '//', blockComment: ['/*', '*/'], strings: ['"'], keywords: ['int', 'char', 'float', 'double', 'void', 'return', 'if', 'else', 'for', 'while', 'switch', 'case', 'break', 'continue', 'struct', 'typedef', 'static', 'const', 'sizeof', 'include', 'define'] },
  cpp: { lineComment: '//', blockComment: ['/*', '*/'], strings: ['"'], keywords: ['int', 'char', 'float', 'double', 'void', 'return', 'if', 'else', 'for', 'while', 'switch', 'case', 'break', 'continue', 'struct', 'class', 'namespace', 'template', 'using', 'const', 'static', 'auto', 'nullptr', 'true', 'false'] },
  dockerfile: { hashComment: true, strings: ['"', "'"], keywords: ['FROM', 'RUN', 'CMD', 'COPY', 'ADD', 'ENV', 'ARG', 'WORKDIR', 'EXPOSE', 'ENTRYPOINT', 'USER', 'VOLUME', 'LABEL'] },
};

export function languageForPath(path: string): string {
  const base = path.slice(path.lastIndexOf('/') + 1).toLowerCase();
  if (base === 'dockerfile' || base.startsWith('dockerfile.')) return 'dockerfile';
  const dot = base.lastIndexOf('.');
  return dot === -1 ? 'txt' : base.slice(dot + 1);
}

interface CompiledSpec {
  readonly spec: LanguageSpec;
  readonly keywords: ReadonlySet<string>;
  readonly literals: ReadonlySet<string>;
}

function compile(spec: LanguageSpec): CompiledSpec {
  return {
    spec,
    keywords: new Set(spec.keywords ?? []),
    literals: new Set(spec.literals ?? []),
  };
}

const UNKNOWN: CompiledSpec = { spec: {}, keywords: new Set(), literals: new Set() };
const COMPILED = new Map<string, CompiledSpec>();

function compiledFor(language: string): CompiledSpec {
  const cached = COMPILED.get(language);
  if (cached !== undefined) return cached;
  const entries = Object.entries(SPEC_BY_EXTENSION);
  let found: CompiledSpec = UNKNOWN;
  for (const [extension, spec] of entries) {
    // `markdown` 这种全名扩展名也要命中（与短扩展名共存）。
    const suffix = language === extension || language.endsWith(extension);
    if (suffix) {
      found = compile(spec);
      break;
    }
  }
  COMPILED.set(language, found);
  return found;
}

interface HighlighterState {
  /** 当前行之前处于块注释中。 */
  readonly inBlockComment: boolean;
}

const INITIAL_STATE: HighlighterState = { inBlockComment: false };

/**
 * 高亮一行。调用方按行顺序传入上一行返回的 `state`，块注释可跨行。
 * 返回的 token 文本拼起来与输入行完全一致。
 */
export function highlightLine(
  line: string,
  language: string,
  state: HighlighterState = INITIAL_STATE,
): { readonly tokens: readonly SyntaxToken[]; readonly state: HighlighterState } {
  if (line.length === 0) return { tokens: [], state };
  const { spec, keywords, literals } = compiledFor(language);
  if (spec.html === true) return highlightHtml(line, spec, state);
  if (spec.markdown === true) return highlightMarkdown(line);
  if (spec.css === true) return highlightCss(line, spec, keywords, state);
  if (spec.sql === true) return highlightSql(line, spec);
  return highlightCode(line, spec, keywords, literals, state);
}

/** 通用代码高亮（TS/JS/PY/GO/JAVA/RS/SH/JSON/YAML/TOML…）。 */
function highlightCode(
  line: string,
  spec: LanguageSpec,
  keywords: ReadonlySet<string>,
  literals: ReadonlySet<string>,
  state: HighlighterState,
): { readonly tokens: readonly SyntaxToken[]; readonly state: HighlighterState } {
  const tokens: SyntaxToken[] = [];
  let index = 0;
  let inBlock = state.inBlockComment;
  const push = (text: string, cls?: TokenClass): void => {
    if (text.length === 0) return;
    tokens.push(cls === undefined ? { text } : { text, cls });
  };
  const block = spec.blockComment;
  while (index < line.length) {
    if (inBlock) {
      if (block === undefined) {
        inBlock = false;
        continue;
      }
      const end = line.indexOf(block[1], index);
      if (end === -1) {
        push(line.slice(index), 'com');
        return { tokens, state: { inBlockComment: true } };
      }
      push(line.slice(index, end + block[1].length), 'com');
      index = end + block[1].length;
      inBlock = false;
      continue;
    }
    const rest = line.slice(index);
    if (spec.lineComment !== undefined && rest.startsWith(spec.lineComment)) {
      push(rest, 'com');
      return { tokens, state: { inBlockComment: false } };
    }
    if (spec.hashComment === true && rest.startsWith('#')) {
      push(rest, 'com');
      return { tokens, state: { inBlockComment: false } };
    }
    if (block !== undefined && rest.startsWith(block[0])) {
      const end = line.indexOf(block[1], index + block[0].length);
      if (end === -1) {
        push(rest, 'com');
        return { tokens, state: { inBlockComment: true } };
      }
      push(line.slice(index, end + block[1].length), 'com');
      index = end + block[1].length;
      continue;
    }
    const char = line[index] ?? '';
    const quote = (spec.strings ?? []).find((candidate) => rest.startsWith(candidate));
    if (quote !== undefined) {
      let cursor = index + quote.length;
      let value = quote;
      while (cursor < line.length) {
        const current = line[cursor] ?? '';
        value += current;
        if (current === '\\' && cursor + 1 < line.length) {
          value += line[cursor + 1] ?? '';
          cursor += 2;
          continue;
        }
        if (current === quote) break;
        cursor += 1;
      }
      push(value, 'str');
      index += value.length;
      continue;
    }
    // 键名：JSON / YAML / TOML / INI 的 `"key":`、`key:`、`key =`。
    if (spec.keyBefore !== undefined) {
      const keyMatch = /^([A-Za-z_$][\w$.-]*|"[^"]*"|'[^']*')(\s*)([:=])/.exec(rest);
      if (keyMatch !== null) {
        push(keyMatch[1] ?? '', 'attr');
        push(keyMatch[2] ?? '');
        push(keyMatch[3] ?? '', 'op');
        index += keyMatch[0].length;
        continue;
      }
    }
    if (spec.shell === true) {
      const variable = /^\$\{[^}]*\}|^\$[A-Za-z_][\w]*/.exec(rest);
      if (variable !== null) {
        push(variable[0], 'type');
        index += variable[0].length;
        continue;
      }
    }
    const number = /^(?:0[xX][0-9a-fA-F]+|\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(rest);
    if (number !== null) {
      push(number[0], 'num');
      index += number[0].length;
      continue;
    }
    const word = /^[A-Za-z_$][\w$]*/.exec(rest);
    if (word !== null) {
      const value = word[0];
      if (keywords.has(value)) push(value, 'kw');
      else if (literals.has(value)) push(value, 'num');
      else if (/^[A-Z][A-Za-z0-9_$]*$/.test(value)) push(value, 'type');
      else if (/^\s*\(/.test(line.slice(index + value.length))) push(value, 'fn');
      else push(value);
      index += value.length;
      continue;
    }
    const operator = /^[+\-*/%=<>!&|^~?:.,;()[\]{}@#]+/.exec(rest);
    if (operator !== null) {
      push(operator[0], 'op');
      index += operator[0].length;
      continue;
    }
    push(char);
    index += 1;
  }
  return { tokens, state: { inBlockComment: inBlock } };
}

function highlightHtml(
  line: string,
  spec: LanguageSpec,
  state: HighlighterState,
): { readonly tokens: readonly SyntaxToken[]; readonly state: HighlighterState } {
  const tokens: SyntaxToken[] = [];
  let index = 0;
  while (index < line.length) {
    const rest = line.slice(index);
    if (spec.blockComment !== undefined && rest.startsWith(spec.blockComment[0])) {
      const end = line.indexOf(spec.blockComment[1], index);
      const endIndex = end === -1 ? line.length : end + spec.blockComment[1].length;
      tokens.push({ text: line.slice(index, endIndex), cls: 'com' });
      index = endIndex;
      continue;
    }
    const tag = /^<\/?([A-Za-z][\w:-]*)/.exec(rest);
    if (tag !== null) {
      tokens.push({ text: tag[0].slice(0, tag[0].length - (tag[1]?.length ?? 0)), cls: 'op' });
      tokens.push({ text: tag[1] ?? '', cls: 'tag' });
      index += tag[0].length;
      continue;
    }
    const attr = /^([A-Za-z_:][\w:.-]*)(\s*=\s*)/.exec(rest);
    if (attr !== null) {
      tokens.push({ text: attr[1] ?? '', cls: 'attr' });
      tokens.push({ text: attr[2] ?? '', cls: 'op' });
      index += attr[0].length;
      continue;
    }
    const quote = /^"[^"]*"|^'[^']*'/.exec(rest);
    if (quote !== null) {
      tokens.push({ text: quote[0], cls: 'str' });
      index += quote[0].length;
      continue;
    }
    const brace = /^[{}<>/=]+/.exec(rest);
    if (brace !== null) {
      tokens.push({ text: brace[0], cls: 'op' });
      index += brace[0].length;
      continue;
    }
    tokens.push({ text: line[index] ?? '' });
    index += 1;
  }
  return { tokens, state };
}

function highlightCss(
  line: string,
  spec: LanguageSpec,
  keywords: ReadonlySet<string>,
  state: HighlighterState,
): { readonly tokens: readonly SyntaxToken[]; readonly state: HighlighterState } {
  const tokens: SyntaxToken[] = [];
  let index = 0;
  let inBlock = state.inBlockComment;
  while (index < line.length) {
    const rest = line.slice(index);
    const block = spec.blockComment;
    if (inBlock && block !== undefined) {
      const end = line.indexOf(block[1], index);
      if (end === -1) {
        tokens.push({ text: rest, cls: 'com' });
        return { tokens, state: { inBlockComment: true } };
      }
      tokens.push({ text: line.slice(index, end + block[1].length), cls: 'com' });
      index = end + block[1].length;
      inBlock = false;
      continue;
    }
    if (block !== undefined && rest.startsWith(block[0])) {
      inBlock = true;
      index += block[0].length;
      tokens.push({ text: block[0], cls: 'com' });
      continue;
    }
    const property = /^([A-Za-z-]+)(\s*:)/.exec(rest);
    if (property !== null) {
      tokens.push({ text: property[1] ?? '', cls: 'attr' });
      tokens.push({ text: property[2] ?? '', cls: 'op' });
      index += property[0].length;
      continue;
    }
    const quote = /^"[^"]*"|^'[^']*'/.exec(rest);
    if (quote !== null) {
      tokens.push({ text: quote[0], cls: 'str' });
      index += quote[0].length;
      continue;
    }
    const number = /^\d[\d.]*(?:px|rem|em|%|vh|vw|s|ms|deg|fr)?/.exec(rest);
    if (number !== null) {
      tokens.push({ text: number[0], cls: 'num' });
      index += number[0].length;
      continue;
    }
    const word = /^[A-Za-z-][\w-]*/.exec(rest);
    if (word !== null) {
      tokens.push(keywords.has(word[0]) ? { text: word[0], cls: 'kw' } : { text: word[0] });
      index += word[0].length;
      continue;
    }
    const operator = /^[{}();:,>~+*/=!]+/.exec(rest);
    if (operator !== null) {
      tokens.push({ text: operator[0], cls: 'op' });
      index += operator[0].length;
      continue;
    }
    tokens.push({ text: line[index] ?? '' });
    index += 1;
  }
  return { tokens, state: { inBlockComment: inBlock } };
}

function highlightSql(
  line: string,
  spec: LanguageSpec,
): { readonly tokens: readonly SyntaxToken[]; readonly state: HighlighterState } {
  const tokens: SyntaxToken[] = [];
  const keywordSet = new Set(spec.keywords ?? []);
  let index = 0;
  while (index < line.length) {
    const rest = line.slice(index);
    if (line.startsWith('--', index)) {
      tokens.push({ text: rest, cls: 'com' });
      break;
    }
    const quote = /^'(?:''|[^'])*'/.exec(rest);
    if (quote !== null) {
      tokens.push({ text: quote[0], cls: 'str' });
      index += quote[0].length;
      continue;
    }
    const number = /^\d+(?:\.\d+)?/.exec(rest);
    if (number !== null) {
      tokens.push({ text: number[0], cls: 'num' });
      index += number[0].length;
      continue;
    }
    const word = /^[A-Za-z_][\w$]*/.exec(rest);
    if (word !== null) {
      tokens.push(keywordSet.has(word[0].toLowerCase()) ? { text: word[0], cls: 'kw' } : { text: word[0] });
      index += word[0].length;
      continue;
    }
    const operator = /^[,;().*=<>+\-/]+/.exec(rest);
    if (operator !== null) {
      tokens.push({ text: operator[0], cls: 'op' });
      index += operator[0].length;
      continue;
    }
    tokens.push({ text: line[index] ?? '' });
    index += 1;
  }
  return { tokens, state: INITIAL_STATE };
}

function highlightMarkdown(line: string): { readonly tokens: readonly SyntaxToken[]; readonly state: HighlighterState } {
  const tokens: SyntaxToken[] = [];
  let index = 0;
  while (index < line.length) {
    const rest = line.slice(index);
    if (index === 0) {
      const heading = /^#{1,6}\s+.*$/.exec(rest);
      if (heading !== null) {
        tokens.push({ text: heading[0], cls: 'kw' });
        break;
      }
      const fence = /^(```|~~~).*$/.exec(rest);
      if (fence !== null) {
        tokens.push({ text: fence[0], cls: 'meta' });
        break;
      }
      const list = /^(\s*)([-*+]|\d+\.)\s/.exec(rest);
      if (list !== null) {
        tokens.push({ text: list[1] ?? '' });
        tokens.push({ text: list[2] ?? '', cls: 'op' });
        index += list[0].length;
        continue;
      }
    }
    const code = /^`[^`]*`/.exec(rest);
    if (code !== null) {
      tokens.push({ text: code[0], cls: 'str' });
      index += code[0].length;
      continue;
    }
    const bold = /^\*\*[^*]+\*\*|^__[^_]+__/.exec(rest);
    if (bold !== null) {
      tokens.push({ text: bold[0], cls: 'type' });
      index += bold[0].length;
      continue;
    }
    const link = /^\[[^\]]*\]\([^)]*\)/.exec(rest);
    if (link !== null) {
      tokens.push({ text: link[0], cls: 'attr' });
      index += link[0].length;
      continue;
    }
    tokens.push({ text: line[index] ?? '' });
    index += 1;
  }
  return { tokens, state: INITIAL_STATE };
}
