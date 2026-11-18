import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { Config } from '../../../../packages/contracts/src/config.js';
import { DomainError } from '../../../../packages/contracts/src/commands.js';

export function cloudflareIdentity(config: NonNullable<Config['cloudflareAccess']>) {
  const issuer = `https://${config.team}.cloudflareaccess.com`;
  const keys = createRemoteJWKSet(new URL('/cdn-cgi/access/certs', issuer), { timeoutDuration: 5000 });
  const owners = new Set(config.ownerEmails);
  return async (assertion: string | string[] | undefined) => {
    if (typeof assertion !== 'string' || assertion.length > 8192) {
      throw new DomainError('cloudflare_sign_in_required', 403);
    }
    let claims;
    try {
      ({ payload: claims } = await jwtVerify(assertion, keys, {
        issuer, audience: config.audience, algorithms: ['RS256'],
        requiredClaims: ['exp', 'iat', 'sub', 'type', 'email'],
      }));
    } catch {
      throw new DomainError('cloudflare_sign_in_required', 403);
    }
    if (claims.type !== 'app' || typeof claims.email !== 'string' || !owners.has(claims.email.toLowerCase()) ||
      typeof claims.sub !== 'string' || !claims.sub || typeof claims.exp !== 'number' || !Number.isSafeInteger(claims.exp)) {
      throw new DomainError('cloudflare_sign_in_required', 403);
    }
    return { email: claims.email.toLowerCase(), expiresAt: claims.exp * 1000 };
  };
}
