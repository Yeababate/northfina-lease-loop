import { randomUUID } from 'node:crypto';
import { normalizeMockUsername, mockUserIdFromCookie } from '@/domain/mock-identity';
import { ApiError } from './api-response';
import { withAudit } from './audit';
import type { PrismaClient } from './prisma-client';

export const MOCK_USER_COOKIE = 'lease-loop-user';

/** A typed username deliberately selects a demo identity; this is not authentication. */
export async function selectMockUser(db: PrismaClient, username: string) {
  const parsed = normalizeMockUsername(username);
  if (!parsed.ok) throw new ApiError(422, 'INVALID_USERNAME', 'A valid username is required');
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

export async function principalFromRequest(db: PrismaClient, request: Request) {
  const id = mockUserIdFromCookie(request.headers.get('cookie'));
  return id ? db.demoUser.findUnique({ where: { id } }) : null;
}

export async function requirePrincipal(db: PrismaClient, request: Request) {
  const principal = await principalFromRequest(db, request);
  if (!principal) throw new ApiError(401, 'LOGIN_REQUIRED', 'Select a demo username first');
  return principal;
}
