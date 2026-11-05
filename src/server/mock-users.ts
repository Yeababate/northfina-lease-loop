// Demo participants (issue #5) resolved from the demo sign-in name (issue #1). The name in
// main's HTTP-only demo-name cookie is the only identity; it is mock selection, not
// authentication. Each canonical username maps to one stable DemoUser, so lifecycle
// records link IDs and never trust a typed name. See docs/profile-tooling.md.
import { randomUUID } from 'node:crypto';
import { cookieValue, demoParticipantName } from '@/domain/demo-participant';
import { ApiError } from './api-response';
import { withAudit } from './audit';
import { DEMO_NAME_COOKIE } from './demo-cookie';
import type { PrismaClient } from './prisma-client';

/**
 * The DemoUser for a sign-in name, created with an audit row the first time the name is
 * seen. Case, width and spacing variants of a name resolve to the same participant.
 */
export async function ensureDemoUser(db: PrismaClient, name: string) {
  const parsed = demoParticipantName(name);
  if (!parsed.ok) throw new ApiError(422, 'INVALID_USERNAME', 'A valid name is required');
  const existing = await db.demoUser.findUnique({
    where: { canonicalUsername: parsed.canonicalUsername },
  });
  if (existing) return existing;
  const id = randomUUID();
  try {
    return await withAudit(
      db,
      { actor: id, action: 'demo_user.created', entityType: 'demo_user', entityId: id },
      (tx) =>
        tx.demoUser.create({
          data: {
            id,
            canonicalUsername: parsed.canonicalUsername,
            displayName: parsed.displayName,
          },
        })
    );
  } catch (error) {
    // A concurrent creator owns its own audit row. Never log an unused candidate ID.
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002') {
      const winner = await db.demoUser.findUnique({
        where: { canonicalUsername: parsed.canonicalUsername },
      });
      if (winner) return winner;
    }
    throw error;
  }
}

/** The participant for a stored sign-in name, or null when the name is missing or invalid. */
export async function principalForDemoName(db: PrismaClient, name: string | null) {
  if (name === null || !demoParticipantName(name).ok) return null;
  return ensureDemoUser(db, name);
}

/** Route handlers: the participant named by the request's demo-name cookie, if any. */
export async function principalFromRequest(db: PrismaClient, request: Request) {
  return principalForDemoName(db, cookieValue(request.headers.get('cookie'), DEMO_NAME_COOKIE));
}

export async function requirePrincipal(db: PrismaClient, request: Request) {
  const principal = await principalFromRequest(db, request);
  if (!principal) throw new ApiError(401, 'LOGIN_REQUIRED', 'Sign in with a demo name first');
  return principal;
}
