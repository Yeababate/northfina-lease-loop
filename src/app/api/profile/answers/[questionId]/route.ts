// PUT    /api/profile/answers/:questionId  body { "profile": "consumer", "value": "FI" }
//        Remembers one answer, validated like the application validates it. Answers that
//        stop applying because of it are forgotten and listed in `removed` (#51).
// DELETE /api/profile/answers/:questionId?profile=<key>  → forget one answer.
import { z } from 'zod';
import { loadQuestions } from '@/data/load';
import { handleRoute, ok, readJsonBody } from '@/server/api-response';
import { db } from '@/server/db';
import { requirePrincipal } from '@/server/mock-users';
import { forgetAnswer, requireProfileKey, saveAnswer } from '@/server/saved-answers';
import { todayIso } from '@/server/today';

/** One answer, as the question types store it; the same caps as the signing body. */
const bodySchema = z.strictObject({
  profile: z.string().max(40),
  value: z.union([
    z.string().max(500),
    z.number().int().nonnegative(),
    z.array(z.string().max(200)).max(50),
  ]),
});

const PRIVATE = { headers: { 'Cache-Control': 'private, no-store' } };

export const PUT = handleRoute(
  async (request, { params }: RouteContext<'/api/profile/answers/[questionId]'>) => {
    const { questionId } = await params;
    const body = await readJsonBody(request, bodySchema);
    const user = await requirePrincipal(db, request);
    const { questions } = await loadQuestions();
    const result = await saveAnswer(
      db,
      {
        userId: user.id,
        profileKey: requireProfileKey(body.profile),
        questionId,
        value: body.value,
        today: todayIso(),
      },
      questions
    );
    return ok({ questionId, ...result }, PRIVATE);
  }
);

export const DELETE = handleRoute(
  async (request, { params }: RouteContext<'/api/profile/answers/[questionId]'>) => {
    const { questionId } = await params;
    const user = await requirePrincipal(db, request);
    const key = requireProfileKey(new URL(request.url).searchParams.get('profile'));
    const { questions } = await loadQuestions();
    return ok(await forgetAnswer(db, user.id, key, questionId, questions), PRIVATE);
  }
);
