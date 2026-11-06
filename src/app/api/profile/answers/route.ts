// GET    /api/profile/answers                 → the signed-in user's remembered answer sets,
//                                                 with the sticky flags of each (#51).
// DELETE /api/profile/answers[?profile=<key>]  → forget everything, or one set.
import { loadQuestions } from '@/data/load';
import { handleRoute, ok } from '@/server/api-response';
import { db } from '@/server/db';
import { requirePrincipal } from '@/server/mock-users';
import { forgetAll, listSavedProfiles, requireProfileKey } from '@/server/saved-answers';
import { todayIso } from '@/server/today';

const PRIVATE = { headers: { 'Cache-Control': 'private, no-store' } };

export const GET = handleRoute(async (request) => {
  const user = await requirePrincipal(db, request);
  const { questions } = await loadQuestions();
  return ok({ profiles: await listSavedProfiles(db, user.id, questions, todayIso()) }, PRIVATE);
});

export const DELETE = handleRoute(async (request) => {
  const user = await requirePrincipal(db, request);
  const profile = new URL(request.url).searchParams.get('profile');
  const key = profile === null ? null : requireProfileKey(profile);
  return ok(await forgetAll(db, user.id, key), PRIVATE);
});
