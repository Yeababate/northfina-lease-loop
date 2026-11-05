// Request body for creating or editing a bundle grouping. Shape only; the bundle rules
// (distinct assets, ownership, supported terms) are checked in src/domain/bundle.ts.
import { z } from 'zod';
import { BUNDLE_DESCRIPTION_MAX, BUNDLE_MAX_ITEMS, BUNDLE_NAME_MAX } from '@/domain/bundle';

export const bundleBodySchema = z.strictObject({
  name: z.string().max(BUNDLE_NAME_MAX * 2),
  description: z
    .string()
    .max(BUNDLE_DESCRIPTION_MAX * 2)
    .default(''),
  assetIds: z.array(z.string().min(1).max(100)).max(BUNDLE_MAX_ITEMS * 2),
  terms: z.array(z.number().int().positive()).max(12),
  published: z.boolean().default(false),
});

export const bundleUpdateSchema = bundleBodySchema.extend({
  expectedRevision: z.number().int().positive(),
});
