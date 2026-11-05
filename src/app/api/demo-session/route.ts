import { z } from 'zod';
import { handleRoute, ok, readJsonBody } from '@/server/api-response';
import { MOCK_USER_COOKIE, selectMockUser } from '@/server/mock-users';
import { db } from '@/server/db';

export const POST = handleRoute(async (request) => {
  const input = await readJsonBody(request, z.strictObject({ username: z.string().max(80) }));
  const user = await selectMockUser(db, input.username);
  return ok(
    { id: user.id, displayName: user.displayName },
    {
      headers: {
        'Set-Cookie': `${MOCK_USER_COOKIE}=${encodeURIComponent(user.id)}; Path=/; HttpOnly; SameSite=Lax`,
      },
    }
  );
});

export const DELETE = handleRoute(async () =>
  ok(null, {
    headers: { 'Set-Cookie': `${MOCK_USER_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0` },
  })
);
