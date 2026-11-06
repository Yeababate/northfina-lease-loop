import { z } from 'zod';
import { loadCoefficientTable, loadPriceLists } from '@/data/load';
import { centsSchema } from '@/data/schemas';
import { priceContract } from '@/domain/contract-pricing';
import { ApiError, handleRoute, ok, readJsonBody } from '@/server/api-response';
import { db } from '@/server/db';
import { rulesForAsset } from '@/server/discount-rules';
import {
  chooseEndTerm,
  completeEndTermBuyout,
  getPassOnPrice,
  readEndTermView,
  withdrawEndTerm,
} from '@/server/end-of-term';
import { requirePrincipal } from '@/server/mock-users';
import { todayIso } from '@/server/today';

const commandSchema = z.discriminatedUnion('action', [
  z.strictObject({
    action: z.literal('choose'),
    kind: z.enum(['end_buyout', 'end_return', 'pass_on']),
    nomineeId: z.string().min(1).max(100).optional(),
  }),
  z.strictObject({ action: z.literal('withdraw') }),
  z.strictObject({ action: z.literal('paid'), expectedGrossCents: centsSchema }),
]);

export const GET = handleRoute(
  async (request, { params }: RouteContext<'/api/contracts/[id]/end-of-term'>) => {
    const [{ id }, user] = await Promise.all([params, requirePrincipal(db, request)]);
    const today = todayIso();
    const view = await readEndTermView(db, id, user.id, today);
    if (view.role !== 'nominee' || view.completedOn || today < view.endOn) return ok(view);
    const query = new URL(request.url).searchParams;
    const termMonths = z
      .enum(['12', '24', '36', '48'])
      .default('36')
      .parse(query.get('term') ?? undefined);
    const downPaymentCents = z.coerce
      .number()
      .pipe(centsSchema)
      .parse(query.get('down') ?? 0);
    const [lists, table, discounts] = await Promise.all([
      loadPriceLists(),
      loadCoefficientTable(),
      rulesForAsset(db, view.assetId),
    ]);
    const override = await getPassOnPrice(db, id, view.assetId, user.id, today, { lists, table });
    const quote = priceContract(
      lists,
      table,
      { assetId: view.assetId, termMonths: Number(termMonths), downPaymentCents },
      today,
      discounts,
      override
    );
    if (!quote.ok)
      throw new ApiError(422, 'INVALID_PRICE', 'This lease cannot be priced', quote.reason);
    return ok({ ...view, quote: quote.price });
  }
);

export const POST = handleRoute(
  async (request, { params }: RouteContext<'/api/contracts/[id]/end-of-term'>) => {
    const [{ id }, user, input] = await Promise.all([
      params,
      requirePrincipal(db, request),
      readJsonBody(request, commandSchema),
    ]);
    if (input.action === 'withdraw') return ok(await withdrawEndTerm(db, id, user.id));
    const today = todayIso();
    if (input.action === 'paid')
      return ok(await completeEndTermBuyout(db, id, user.id, input.expectedGrossCents, today));
    return ok(await chooseEndTerm(db, { ...input, contractId: id, userId: user.id }, today), {
      status: 201,
    });
  }
);
