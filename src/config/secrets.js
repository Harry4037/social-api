'use strict';
// ─────────────────────────────────────────────────────────
//  Refuse to start in production with weak / missing secrets.
//  A guessable JWT secret = anyone can log in as anyone.
// ─────────────────────────────────────────────────────────
const KNOWN_WEAK = /^(secret|changeme|change_this_secret|your[_-].*|test.*|password|jwt.*secret|x|abc.*|123.*)$/i;

const checkSecrets = (env = process.env) => {
  const problems = [];
  const need = (name, minLen = 32) => {
    const v = env[name];
    if (!v) problems.push(`${name} is not set`);
    else if (v.length < minLen) problems.push(`${name} is too short (min ${minLen} characters)`);
    else if (KNOWN_WEAK.test(v)) problems.push(`${name} looks like a placeholder`);
  };
  need('JWT_ACCESS_SECRET');
  need('JWT_REFRESH_SECRET');
  need('ADMIN_JWT_SECRET');
  if (env.JWT_ACCESS_SECRET && env.JWT_ACCESS_SECRET === env.JWT_REFRESH_SECRET) {
    problems.push('JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be different');
  }
  if (env.ADMIN_JWT_SECRET && env.ADMIN_JWT_SECRET === env.JWT_ACCESS_SECRET) {
    problems.push('ADMIN_JWT_SECRET must be different from JWT_ACCESS_SECRET');
  }
  if (!env.DATABASE_URL) problems.push('DATABASE_URL is not set');
  return problems;
};

/** In production: log every problem and stop the process. */
const assertSecrets = (logger = console, env = process.env) => {
  if (env.NODE_ENV !== 'production') return true;
  const problems = checkSecrets(env);
  if (!problems.length) return true;
  problems.forEach(p => logger.error(`[config] ${p}`));
  logger.error('[config] Refusing to start. Generate secrets with: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"');
  return false;
};

module.exports = { checkSecrets, assertSecrets };
