import { z } from 'zod';
import { loadVatRates } from '@/data/load';
import { handleRoute, ok, readJsonBody } from '@/server/api-response';
import { db } from '@/server/db';
import { generateInvoices, listInvoices } from '@/server/invoices';

type Context = { params: Promise<{ id: string }> };
const schema = z.strictObject({ actor: z.string().trim().min(1).max(100) });

export const GET = handleRoute(async (_request, { params }: Context) => {
  const { id } = await params;
  return ok(await listInvoices(db, id));
});

export const POST = handleRoute(async (request, { params }: Context) => {
  const { id } = await params;
  const { actor } = await readJsonBody(request, schema);
  return ok(await generateInvoices(db, id, actor, await loadVatRates()));
});
