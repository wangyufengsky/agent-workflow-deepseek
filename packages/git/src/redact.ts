/**
 * Secret redaction for anything that can reach an API response.
 *
 * Git stderr can contain credentials from remote URLs, tokens echoed by a
 * hook, or `Authorization` headers from a failing HTTP helper. We redact both
 * before wrapping errors and before storing command output.
 */

interface RedactionRule {
  readonly pattern: RegExp;
  readonly replacement: string;
}

const RULES: readonly RedactionRule[] = [
  // https://user:password@host/... -> https://***:***@host/...
  {
    pattern: /(https?:\/\/)([^\s/:@]+):([^\s/@]+)@/gi,
    replacement: '$1***:***@',
  },
  // x-access-token:ghp_xxx@github.com
  {
    pattern: /\b(x-access-token):[^\s@/]+/gi,
    replacement: '$1:***',
  },
  // GitHub fine-grained and classic tokens.
  { pattern: /\bgithub_pat_[A-Za-z0-9_]{10,}\b/g, replacement: '***' },
  { pattern: /\bgh[pousr]_[A-Za-z0-9]{10,}\b/g, replacement: '***' },
  // GitLab personal/project/group/runner tokens.
  { pattern: /\bglpat-[A-Za-z0-9_-]{10,}\b/g, replacement: '***' },
  { pattern: /\bglrt-[A-Za-z0-9_-]{10,}\b/g, replacement: '***' },
  // Authorization header values of any scheme.
  {
    pattern: /\b(authorization\s*:\s*)(bearer|basic|token|digest)\s+[^\s,;]+/gi,
    replacement: '$1$2 ***',
  },
  // Bare bearer tokens in messages.
  { pattern: /\b(bearer)\s+[A-Za-z0-9._~+/=-]{8,}/gi, replacement: '$1 ***' },
  // key/token/password/secret assignments (query strings or log lines).
  {
    pattern: /\b(private[-_]?token|access[-_]?token|refresh[-_]?token|token|password|passwd|secret)(\s*[=:]\s*)([^\s&"',;]{4,})/gi,
    replacement: '$1$2***',
  },
];

/**
 * Redact known credential shapes. Idempotent and safe for plain text; returns
 * the input unchanged when nothing matches.
 */
export function redactSecrets(input: string): string {
  let output = input;
  for (const rule of RULES) {
    output = output.replace(rule.pattern, rule.replacement);
  }
  return output;
}

/** True when the text still looks like it contains a credential. */
export function containsLikelySecret(input: string): boolean {
  // Redaction is idempotent, so any change means a credential shape matched.
  return redactSecrets(input) !== input;
}

/**
 * Host-only rendering of a URL: drops userinfo, path, query and fragment so a
 * URL with an embedded token can never be echoed back.
 */
export function safeHost(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    return url.host;
  } catch {
    return '<invalid-url>';
  }
}

/** Scheme + host + path, with userinfo and query stripped. */
export function safeUrlForDisplay(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return '<invalid-url>';
  }
}
