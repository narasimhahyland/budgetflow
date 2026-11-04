// Shared detection patterns for scripts/secret-scan.mjs and the .cursor/hooks guards.
// Patterns must be high precision: a false positive blocks commits and agent reads.
// Keep character classes in every pattern so this file never matches itself.

export const SECRET_PATTERNS = [
  { id: 'github-token', re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}\b/ },
  { id: 'github-fine-grained-pat', re: /\bgithub_pat_[A-Za-z0-9_]{60,}\b/ },
  { id: 'npm-token', re: /\bnpm_[A-Za-z0-9]{36}\b/ },
  // Values starting with $ (env reference) or < (documented placeholder) are not secrets.
  { id: 'npmrc-auth', re: /_auth(?:Token)?\s*=\s*(?![$<])[^\s'"]{8,}/ },
  { id: 'private-key', re: /-----BEGIN (?:[A-Z]+ )*PRIVATE KEY-----/ },
  { id: 'aws-access-key', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { id: 'slack-token', re: /\bxox[abposr]-[A-Za-z0-9-]{10,}/ },
  { id: 'google-api-key', re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { id: 'stripe-live-key', re: /\b[rs]k_live_[0-9A-Za-z]{20,}\b/ },
  { id: 'jwt', re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/ },
  { id: 'credentials-in-url', re: /\bhttps?:\/\/[^\s/:@'"]+:[^\s/:@'"]{6,}@[A-Za-z0-9.-]+/ },
];

// Public-repo hygiene: internal hosts must not be committed.
export const INTERNAL_PATTERNS = [
  { id: 'internal-wiki-or-tracker-url', re: /\b[a-z0-9-]+\.atlassian\.net\b/i },
  { id: 'internal-company-url', re: /\bhttps?:\/\/(?!www\.)[a-z0-9.-]+\.(?:hyland\.com|hylandcloud\.com)\b/i },
];

// Files that must never be committed, whatever their content.
export const FORBIDDEN_FILES = [
  { id: 'env-file', re: /(^|\/)\.env(\.[^/]+)?$/, allow: /(^|\/)\.env\.(example|sample|template)$/ },
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

export const SECRET_ENV_NAME = /(TOKEN|SECRET|PASSWORD|PASSWD|PRIVATE_KEY|API_KEY|ACCESS_KEY|CREDENTIAL|_AUTH$|^NPM_CONFIG__AUTH)/i;

export const ALLOW_MARKER = 'secret-scan:allow';

/** Returns [{ id, index }] for every secret-like match in text. */
export function findSecrets(text, patterns = SECRET_PATTERNS) {
  const hits = [];
  for (const { id, re } of patterns) {
    const m = re.exec(text);
    if (m) hits.push({ id, index: m.index, match: m[0] });
  }
  return hits;
}

/** Masks a matched value for safe display: first 4 characters, then an ellipsis. */
export function mask(value) {
  return `${String(value).slice(0, 4)}…(${String(value).length} chars)`;
}
