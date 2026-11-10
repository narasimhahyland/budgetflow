// Shared detection patterns for scripts/secret-scan.mjs and the .cursor/hooks guards.
// Patterns must be high precision: a false positive blocks commits and agent reads.
// Keep character classes in every pattern so this file never matches itself.

/** Shannon entropy in bits per character. */
function entropyPerChar(value) {
  const counts = new Map();
  for (const ch of value) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let bits = 0;
  for (const n of counts.values()) {
    const p = n / value.length;
    bits -= p * Math.log2(p);
  }
  return bits;
}

/**
 * A long value assigned to a secret-named variable is a secret when it looks random.
 * Thresholds: dev placeholders in infra/.env.example are hyphen-separated English words
 * (`minio-dev-only`, `integration-secrets-dev-only-0001`), so an unbroken 32-character run of
 * base64/hex characters already excludes them; 12 distinct characters and 3.0 bits per character
 * then exclude repeated filler (`changeme` repeated scores 2.75) while staying well under the
 * floor of real keys (32 hex characters measured at worst 2.95, typically 3.7; base64 above 4.0).
 */
function looksRandom(value) {
  return new Set(value).size >= 12 && entropyPerChar(value) >= 3.0;
}

/**
 * True when the match sits inside a URL (`http://keycloak:8080/realms/budgetflow/protocol/...`
 * reads as a key-named variable followed by a long path). Credentials actually embedded in a URL
 * are caught by `credentials-in-url`.
 */
function insideUrl(text, index) {
  const token = String(text).slice(0, index).split(/\s/).pop() ?? '';
  return token.includes('://');
}

export const SECRET_PATTERNS = [
  { id: 'github-token', re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}\b/ },
  { id: 'github-fine-grained-pat', re: /\bgithub_pat_[A-Za-z0-9_]{60,}\b/ },
  { id: 'npm-token', re: /\bnpm_[A-Za-z0-9]{36}\b/ },
  // Values starting with $ (env reference) or < (documented placeholder) are not secrets.
  { id: 'npmrc-auth', re: /_auth(?:Token)?\s*=\s*(?![$<])[^\s'"]{8,}/ },
  { id: 'private-key', re: /-----BEGIN (?:[A-Z]+ )*PRIVATE KEY-----/ },
  { id: 'aws-access-key', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  // Amazon Bedrock API key: an ABSK prefix followed by a long base64 run.
  { id: 'aws-bedrock-api-key', re: /\bABSK[A-Za-z0-9+/]{32,}={0,2}/ },
  { id: 'anthropic-api-key', re: /\bsk-ant-[A-Za-z0-9_-]{24,}/ },
  { id: 'slack-token', re: /\bxox[abposr]-[A-Za-z0-9-]{10,}/ },
  { id: 'google-api-key', re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { id: 'stripe-live-key', re: /\b[rs]k_live_[0-9A-Za-z]{20,}\b/ },
  { id: 'jwt', re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/ },
  { id: 'credentials-in-url', re: /\bhttps?:\/\/[^\s/:@'"]+:[^\s/:@'"]{6,}@[A-Za-z0-9.-]+/ },
  // Catch-all for key shapes with no recognizable prefix: a random-looking value on a
  // secret-named variable. Values starting with $ (env reference) or < (placeholder) cannot
  // match, because the value charset excludes both.
  {
    id: 'high-entropy-secret-value',
    re: /(?<![\w./:])[A-Za-z0-9_.]*(?:TOKEN|SECRET|PASSWORD|PASSWD|KEY)[A-Za-z0-9_.]*["']?\s*[:=]\s*["']?([A-Za-z0-9+/_]{32,}={0,2})/i,
    verify: (m, text) => looksRandom(m[1]) && !insideUrl(text, m.index),
  },
];

// Public-repo hygiene: internal hosts must not be committed.
export const INTERNAL_PATTERNS = [
  { id: 'internal-wiki-or-tracker-url', re: /\b[a-z0-9-]+\.atlassian\.net\b/i },
  {
    id: 'internal-company-url',
    re: /\bhttps?:\/\/(?!www\.)[a-z0-9.-]+\.(?:hyland\.com|hylandcloud\.com)\b/i,
  },
];

// Files that must never be committed, whatever their content.
export const FORBIDDEN_FILES = [
  {
    id: 'env-file',
    re: /(^|\/)\.env(\.[^/]+)?$/,
    allow: /(^|\/)\.env\.(example|sample|template)$/,
  },
  { id: 'key-file', re: /\.(pem|key|p12|pfx|jks|keystore)$/i },
  { id: 'ssh-private-key', re: /(^|\/)id_(rsa|dsa|ecdsa|ed25519)$/ },
  { id: 'credentials-file', re: /(^|\/)(credentials|secrets)(\.[a-z]+)?\.json$/i },
  { id: 'har-capture', re: /\.har$/i },
  { id: 'playwright-trace', re: /(^|\/)trace(-[^/]*)?\.zip$/i },
];

// Paths an agent must never read or print (relative to $HOME).
export const SENSITIVE_HOME_FILES = [
  '.npmrc',
  '.netrc',
  '.git-credentials',
  '.pypirc',
  '.docker/config.json',
  '.config/gh/hosts.yml',
  '.aws/credentials',
  '.kube/config',
];

export const SENSITIVE_HOME_DIRS = ['.ssh'];

export const SECRET_ENV_NAME =
  /(TOKEN|SECRET|PASSWORD|PASSWD|PRIVATE_KEY|API_KEY|ACCESS_KEY|CREDENTIAL|_AUTH$|^NPM_CONFIG__AUTH)/i;

export const ALLOW_MARKER = 'secret-scan:allow';

/**
 * Returns [{ id, index, match }] for every secret-like match in text.
 * A pattern may carry a `verify(match, text)` predicate; a match it rejects is not a finding.
 */
export function findSecrets(text, patterns = SECRET_PATTERNS) {
  const hits = [];
  for (const { id, re, verify } of patterns) {
    const m = re.exec(text);
    if (m && (!verify || verify(m, text))) hits.push({ id, index: m.index, match: m[0] });
  }
  return hits;
}

/** Masks a matched value for safe display: first 4 characters, then an ellipsis. */
export function mask(value) {
  return `${String(value).slice(0, 4)}…(${String(value).length} chars)`;
}
