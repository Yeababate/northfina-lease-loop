import { ApiError, handleRoute, ok, readJsonBody } from '@/server/api-response';
import { db } from '@/server/db';
import { acknowledgeEarlyExit } from '@/server/exit-completion';
import { readExitView, requestEarlyExit, withdrawEarlyExit } from '@/server/exit-requests';
import { exitCommandSchema } from '@/server/exit-schema';
import { requirePrincipal } from '@/server/mock-users';
import { todayIso } from '@/server/today';

type Context = { params: Promise<{ id: string }> };

export const GET = handleRoute<Context>(async (request, context) => {
  const [{ id }, principal] = await Promise.all([context.params, requirePrincipal(db, request)]);
  return ok(await readExitView(db, id, principal.id, todayIso()));
});

export const POST = handleRoute<Context>(async (request, context) => {
  const [{ id }, principal, input] = await Promise.all([
    context.params,
    requirePrincipal(db, request),
    readJsonBody(request, exitCommandSchema),
  ]);
  if (input.action === 'request') {
    return ok(
      await requestEarlyExit(db, { ...input, contractId: id, userId: principal.id }, todayIso()),
      { status: 201 }
    );
  }
  const exit = await db.exitRequest.findFirst({ where: { id: input.exitId, contractId: id } });
  if (!exit) throw new ApiError(404, 'EXIT_NOT_FOUND', 'Exit request not found');
  if (input.action === 'withdraw') {
    return ok(await withdrawEarlyExit(db, input.exitId, principal.id, input.expectedRevision));
  }
  if (
    (input.action === 'receive' && exit.kind !== 'return') ||
    (input.action === 'paid' && exit.kind !== 'buyout')
  ) {
    throw new ApiError(422, 'INVALID_EXIT_ACTION', 'This action does not match the exit request');
  }
  return ok(
    await acknowledgeEarlyExit(
      db,
      {
        ...input,
        userId: principal.id,
        assetIds: input.action === 'receive' ? input.assetIds : undefined,
      },
      todayIso()
    )
  );
});
