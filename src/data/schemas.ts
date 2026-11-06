// Zod schemas for every file in data/. Read these as documentation: they say exactly what
// each field is. The loaders in ./load.ts check every file against its schema at startup.
//
// House rules used throughout the data pack:
// - Money is an integer number of euro cents, VAT excluded, unless the name says otherwise.
// - Dates are ISO calendar dates, `YYYY-MM-DD`. Date ranges include both ends.
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Shared building blocks
// ---------------------------------------------------------------------------

/** ISO calendar date, `YYYY-MM-DD`. Two ISO dates compare correctly as strings. */
export const isoDateSchema = z.iso.date();

/** Integer euro cents, never negative. 189900 means 1 899,00 €. */
export const centsSchema = z.number().int().nonnegative();

/** A lease term in months, as used for object keys in the data pack ("12", "24", ...). */
export const termMonthsKeySchema = z
  .string()
  .regex(/^\d+$/, 'term must be a whole number of months');

export const assetCategorySchema = z.enum(['e_bike', 'laptop', 'farm_machine']);
export type AssetCategory = z.infer<typeof assetCategorySchema>;

/** Best first. A returned item usually needs refurbishment to move up. */
export const assetConditionSchema = z.enum(['new', 'like_new', 'good', 'fair', 'poor']);
export type AssetCondition = z.infer<typeof assetConditionSchema>;

export const assetStatusSchema = z.enum(['available', 'reserved', 'returned']);
export type AssetStatus = z.infer<typeof assetStatusSchema>;

/** What the usage counter measures: km for e-bikes, battery cycles for laptops, engine hours for farm machines. */
export const usageUnitSchema = z.enum(['km', 'battery_cycles', 'engine_hours']);
export type UsageUnit = z.infer<typeof usageUnitSchema>;

const countryCodeSchema = z.string().regex(/^[A-Z]{2}$/, 'two-letter country code, e.g. FI');

// ---------------------------------------------------------------------------
// data/assets.json: every physical item in the catalogue, new or with previous lives.
// ---------------------------------------------------------------------------

export const assetSchema = z.strictObject({
  id: z.string().min(1),
  category: assetCategorySchema,
  make: z.string().min(1),
  model: z.string().min(1),
  model_year: z.number().int(),
  serial_number: z.string().min(1),
  condition: assetConditionSchema,
  usage: z.strictObject({ unit: usageUnitSchema, value: z.number().int().nonnegative() }),
  /** How many lease contracts this item has already been through. */
  previous_lives: z.number().int().nonnegative(),
  status: assetStatusSchema,
});
export type Asset = z.infer<typeof assetSchema>;
export const assetsFileSchema = z.array(assetSchema);

// ---------------------------------------------------------------------------
// data/asset-attributes.json: fictional technical details per asset, for the catalogue's
// category filters (#72). Kept apart from assets.json so that file and its rows stay as they are.
// ---------------------------------------------------------------------------

export const ebikeMotorSchema = z.enum(['hub', 'mid_drive']);
export type EbikeMotor = z.infer<typeof ebikeMotorSchema>;
export const laptopGpuSchema = z.enum(['integrated', 'discrete']);
export type LaptopGpu = z.infer<typeof laptopGpuSchema>;
export const farmMachineTypeSchema = z.enum([
  'tractor',
  'combine',
  'seed_drill',
  'mower',
  'bale_wrapper',
  'milking_robot',
]);
export type FarmMachineType = z.infer<typeof farmMachineTypeSchema>;

const positiveInt = z.number().int().positive();

export const assetAttributesSchema = z.discriminatedUnion('category', [
  z.strictObject({
    asset_id: z.string().min(1),
    category: z.literal('e_bike'),
    motor: ebikeMotorSchema,
    motor_watts: positiveInt,
    battery_wh: positiveInt,
    /** Typical range on one charge, in km. */
    range_km: positiveInt,
    wheel_inches: positiveInt,
  }),
  z.strictObject({
    asset_id: z.string().min(1),
    category: z.literal('laptop'),
    gpu: laptopGpuSchema,
    gpu_model: z.string().min(1),
  }),
  z.strictObject({
    asset_id: z.string().min(1),
    category: z.literal('farm_machine'),
    machine_type: farmMachineTypeSchema,
    /** Engine power; null for machines without their own engine. */
    power_kw: positiveInt.nullable(),
    /** Working width in metres; null when the machine has none. */
    working_width_m: z.number().positive().nullable(),
  }),
]);
export type AssetAttributes = z.infer<typeof assetAttributesSchema>;
export const assetAttributesFileSchema = z.array(assetAttributesSchema).superRefine((rows, ctx) => {
  const seen = new Set<string>();
  for (const [index, row] of rows.entries()) {
    if (seen.has(row.asset_id))
      ctx.addIssue({
        code: 'custom',
        path: [index, 'asset_id'],
        message: `duplicate asset_id ${row.asset_id}`,
      });
    seen.add(row.asset_id);
  }
});

// ---------------------------------------------------------------------------
// data/price-lists.json: dated versions of the net list price of each asset.
// ---------------------------------------------------------------------------

export const priceListSchema = z.strictObject({
  version: z.number().int().positive(),
  valid_from: isoDateSchema,
  /** Last day this list applies (inclusive). `null` means "until a newer list replaces it". */
  valid_to: isoDateSchema.nullable(),
  note: z.string(),
  /** Asset id → net list price in cents. */
  prices: z.record(z.string(), centsSchema),
});
export type PriceList = z.infer<typeof priceListSchema>;

export const priceListsFileSchema = z.array(priceListSchema).superRefine((lists, ctx) => {
  // Lists must not overlap, so exactly one (or none) applies on any date.
  const sorted = [...lists].sort((a, b) => a.valid_from.localeCompare(b.valid_from));
  for (let i = 1; i < sorted.length; i++) {
    const previous = sorted[i - 1];
    const current = sorted[i];
    if (
      previous &&
      current &&
      (previous.valid_to === null || previous.valid_to >= current.valid_from)
    ) {
      ctx.addIssue({
        code: 'custom',
        message: `price list ${previous.version} overlaps price list ${current.version}`,
      });
    }
  }
});

// ---------------------------------------------------------------------------
// data/coefficient-table.json: monthly rent factor by financed amount (band) and term.
// monthly net rent = financed amount × factor.
// ---------------------------------------------------------------------------

export const coefficientBandSchema = z.strictObject({
  band: z.string().min(1),
  /** Smallest financed amount in this band (inclusive). */
  min_financed_cents: centsSchema,
  /** Largest financed amount in this band (inclusive). */
  max_financed_cents: centsSchema,
  annual_interest_percent: z.number().nonnegative(),
  /** Term in months ("12", "24", ...) → monthly factor. */
  monthly_factor_by_term: z.record(termMonthsKeySchema, z.number().positive()),
});
export type CoefficientBand = z.infer<typeof coefficientBandSchema>;

export const coefficientTableSchema = z
  .strictObject({
    id: z.string(),
    version: z.number().int().positive(),
    valid_from: isoDateSchema,
    currency: z.literal('EUR'),
    how_to_use: z.string(),
    /** Term in months → price to buy the item at the end, as a percent of the financed amount. */
    end_of_term_buyout_percent_of_financed: z.record(
      termMonthsKeySchema,
      z.number().min(0).max(100)
    ),
    /** Sorted from the smallest amounts up, with no gaps or overlaps. */
    bands: z.array(coefficientBandSchema).min(1),
  })
  .superRefine((table, ctx) => {
    table.bands.forEach((band, i) => {
      if (band.min_financed_cents > band.max_financed_cents) {
        ctx.addIssue({ code: 'custom', message: `band ${band.band}: min is above max` });
      }
      const previous = table.bands[i - 1];
      if (previous && band.min_financed_cents !== previous.max_financed_cents + 1) {
        ctx.addIssue({
          code: 'custom',
          message: `band ${band.band} must start 1 cent after band ${previous.band} ends`,
        });
      }
    });
  });
export type CoefficientTable = z.infer<typeof coefficientTableSchema>;

// ---------------------------------------------------------------------------
// data/residual-curves.json: what a used item is worth, by age, condition and usage.
// ---------------------------------------------------------------------------

/** `[age_months, percent_of_original_net_list_price]` */
export const residualCurvePointSchema = z.tuple([
  z.number().int().nonnegative(),
  z.number().min(0).max(100),
]);

export const usageAdjustmentSchema = z.strictObject({
  unit: usageUnitSchema,
  /** Value change per `step` units of usage, in percent (negative = loses value). */
  percent_per_step: z.number(),
  step: z.number().positive(),
  /** The adjustment never goes beyond this (negative) percent. */
  max_total_percent: z.number(),
});

export const residualCurvesSchema = z.strictObject({
  how_to_use: z.string(),
  curves: z.record(assetCategorySchema, z.array(residualCurvePointSchema).min(1)),
  condition_multiplier: z.record(assetConditionSchema, z.number().min(0)),
  usage_adjustment: z.record(assetCategorySchema, usageAdjustmentSchema),
});
export type ResidualCurves = z.infer<typeof residualCurvesSchema>;

// ---------------------------------------------------------------------------
// data/vat-rates.json: Finnish general VAT rate over time (one future change is fictional).
// ---------------------------------------------------------------------------

export const vatRateSchema = z.strictObject({
  rate_percent: z.number().min(0),
  valid_from: isoDateSchema,
  /** Inclusive. `null` means "still valid". */
  valid_to: isoDateSchema.nullable(),
  /** True for the made-up hackathon rate. */
  fictional: z.boolean().optional(),
});
export type VatRate = z.infer<typeof vatRateSchema>;

export const vatRatesSchema = z.strictObject({
  country: countryCodeSchema,
  note: z.string(),
  rates: z.array(vatRateSchema).min(1),
});
export type VatRates = z.infer<typeof vatRatesSchema>;

// ---------------------------------------------------------------------------
// data/questions.json: the application form, as data. Which question is asked depends on
// earlier answers and on the deal (see `ask_when`).
// ---------------------------------------------------------------------------

/** Text in all four app languages. */
export const translatedTextSchema = z.strictObject({
  en: z.string(),
  fi: z.string(),
  sv: z.string(),
  et: z.string(),
});

/** Text that is always in English and may have translations. */
export const localizedTextSchema = z.strictObject({
  en: z.string(),
  fi: z.string().optional(),
  sv: z.string().optional(),
  et: z.string().optional(),
});

/**
 * Which value a condition looks at: a deal field, or an earlier answer (`answers.<question id>`).
 */
export const conditionFieldSchema = z
  .string()
  .regex(
    /^(customer_type|category|financed_amount_cents|term_months|answers\.q_[a-z0-9_]+)$/,
    'unknown condition field'
  );

/** One condition in `ask_when`. A question is asked only when all its conditions hold. */
export const askWhenConditionSchema = z.discriminatedUnion('op', [
  z.strictObject({
    field: conditionFieldSchema,
    op: z.literal('in'),
    value: z.array(z.string()).min(1),
  }),
  z.strictObject({ field: conditionFieldSchema, op: z.literal('gte'), value: z.number() }),
  z.strictObject({ field: conditionFieldSchema, op: z.literal('lte'), value: z.number() }),
]);
export type AskWhenCondition = z.infer<typeof askWhenConditionSchema>;

/** An answer that stops the application (for example, applicant under 18). */
export const blockRuleSchema = z.discriminatedUnion('rule', [
  z.strictObject({ rule: z.literal('age_under'), value: z.number().int().positive() }),
  z.strictObject({ rule: z.literal('answer_in'), value: z.array(z.string()).min(1) }),
]);

export const questionTypeSchema = z.enum(['choice', 'text', 'date', 'email', 'money', 'list']);

export const questionSchema = z
  .strictObject({
    id: z.string().regex(/^q_[a-z0-9_]+$/),
    type: questionTypeSchema,
    text: translatedTextSchema,
    why_we_ask: localizedTextSchema,
    /** Empty list = always ask. */
    ask_when: z.array(askWhenConditionSchema),
    /** Allowed answers; only for `choice` questions. */
    options: z.array(z.string()).min(1).optional(),
    blocks_application_when: z.array(blockRuleSchema).optional(),
    validation: z
      .strictObject({ format: z.literal('finnish_business_id'), hint: z.string() })
      .optional(),
  })
  .refine((q) => (q.type === 'choice') === (q.options !== undefined), {
    message: 'choice questions need options, other questions must not have them',
  });
export type Question = z.infer<typeof questionSchema>;

export const eligibilityRuleSchema = z.strictObject({ id: z.string(), text: z.string() });
export type EligibilityRule = z.infer<typeof eligibilityRuleSchema>;

export const questionsFileSchema = z.strictObject({
  how_to_use: z.string(),
  eligibility_rules: z.array(eligibilityRuleSchema),
  questions: z.array(questionSchema).min(1),
});
export type QuestionsFile = z.infer<typeof questionsFileSchema>;

// ---------------------------------------------------------------------------
// data/customers.json: test applicants, each built to exercise one rule (read `story`).
// ---------------------------------------------------------------------------

const customerBase = {
  id: z.string().min(1),
  name: z.string().min(1),
  country: countryCodeSchema,
  city: z.string(),
  email: z.email(),
  is_pep: z.boolean(),
  /** Why this test customer exists. */
  story: z.string(),
};

export const employmentSchema = z.enum([
  'employed',
  'self_employed',
  'student',
  'retired',
  'unemployed',
]);

export const consumerSchema = z.strictObject({
  ...customerBase,
  type: z.literal('consumer'),
  birth_date: isoDateSchema,
  employment: employmentSchema,
  monthly_net_income_cents: centsSchema,
});

export const soleTraderSchema = z.strictObject({
  ...customerBase,
  type: z.literal('sole_trader'),
  /** Finnish business ID, `1234567-8`. The check digit is NOT validated here: that is your job. */
  business_id: z.string(),
  birth_date: isoDateSchema,
  vat_registered: z.boolean(),
});

export const companySchema = z.strictObject({
  ...customerBase,
  type: z.literal('company'),
  /** Finnish business ID, `1234567-8`. The check digit is NOT validated here: that is your job. */
  business_id: z.string(),
  vat_registered: z.boolean(),
  annual_revenue_cents: centsSchema,
  /** Whether the person applying may sign contracts for the company. */
  applicant_can_sign: z.boolean(),
  beneficial_owners: z.array(z.string()).optional(),
});

export const customerSchema = z.discriminatedUnion('type', [
  consumerSchema,
  soleTraderSchema,
  companySchema,
]);
export type Customer = z.infer<typeof customerSchema>;
export const customersFileSchema = z.array(customerSchema);

// ---------------------------------------------------------------------------
// data/second-life-demand.json: people waiting for a returned item.
// ---------------------------------------------------------------------------

export const secondLifeRequestSchema = z.strictObject({
  id: z.string().min(1),
  category: assetCategorySchema,
  max_monthly_net_rent_cents: centsSchema,
  /** Worst condition this person accepts. */
  min_condition: assetConditionSchema,
  preferred_term_months: z.number().int().positive(),
  needed_by: isoDateSchema,
  signed_up_on: isoDateSchema,
  who: z.string(),
});
export type SecondLifeRequest = z.infer<typeof secondLifeRequestSchema>;
export const secondLifeDemandFileSchema = z.array(secondLifeRequestSchema);

// ---------------------------------------------------------------------------
// data/refurbishment-costs.json: what it costs to get a returned item ready again.
// ---------------------------------------------------------------------------

export const fixedRefurbishmentCostSchema = z.strictObject({
  id: z.string().min(1),
  cost_cents: centsSchema,
  /** When it applies, in words (e.g. "always", "usage.value >= 15000 km"). Turning this into code is yours. */
  when: z.string(),
  /** Doing this sets the usage counter back to 0 (e.g. a new battery). */
  resets_usage: z.boolean().optional(),
  /** Must be done before the item is leased again. */
  mandatory_before_next_lease: z.boolean().optional(),
});

export const categoryRefurbishmentSchema = z.strictObject({
  /** `"from->to"` condition step (e.g. "fair->good") → cost in cents. */
  condition_upgrades: z.record(z.string().regex(/^[a-z_]+->[a-z_]+$/), centsSchema),
  fixed: z.array(fixedRefurbishmentCostSchema),
});

export const refurbishmentCostsSchema = z.strictObject({
  note: z.string(),
  e_bike: categoryRefurbishmentSchema,
  laptop: categoryRefurbishmentSchema,
  farm_machine: categoryRefurbishmentSchema,
});
export type RefurbishmentCosts = z.infer<typeof refurbishmentCostsSchema>;

// ---------------------------------------------------------------------------
// data/co2-factors.json: rough (fictional) CO2 numbers for showing the impact of reuse.
// ---------------------------------------------------------------------------

export const co2FactorsSchema = z.strictObject({
  note: z.string(),
  /** kg CO2e to manufacture one new item. */
  manufacturing_new_kg: z.record(assetCategorySchema, z.number().nonnegative()),
  /** Refurbishing costs this share (0..1) of the CO2 of making a new item. */
  refurbishment_share_of_new: z.number().min(0).max(1),
  avoided_by_reuse_formula_hint: z.string(),
  /** kg CO2e saved per km cycled instead of driven. */
  e_bike_avoided_car_km_kg_per_km: z.number().nonnegative(),
});
export type Co2Factors = z.infer<typeof co2FactorsSchema>;

// ---------------------------------------------------------------------------
// data/related-item-rules.json: the adjustable ruleset that ranks related items.
// Scores and weights are whole numbers so ranking stays exact integer maths.
// ---------------------------------------------------------------------------

/** A score from 0 (no match) to 100 (best match). */
const scoreSchema = z.number().int().min(0).max(100);

export const relatedItemRulesSchema = z
  .strictObject({
    version: z.number().int().positive(),
    note: z.string(),
    /** Share of the total score, in percent. The three must add up to 100. */
    weights: z.strictObject({ category: scoreSchema, price: scoreSchema, condition: scoreSchema }),
    /**
     * Viewed category → candidate category → affinity. A missing pair means 0: such
     * candidates are left out unless `zero_affinity_fallback` is above 0.
     */
    category_affinity: z.partialRecord(
      assetCategorySchema,
      z.partialRecord(assetCategorySchema, scoreSchema)
    ),
    /** Affinity used for unrelated categories. 0 = never recommend them. */
    zero_affinity_fallback: scoreSchema,
    price: z
      .strictObject({
        /** Every candidate is compared on this one basis, never list price against rent. */
        basis: z.literal('monthly_net_rent_same_term_no_down_payment'),
        /** Price difference (basis points of the viewed item's rent) that still scores 100. */
        full_score_within_bps: z.number().int().nonnegative(),
        /** From this difference on, the price score is 0. */
        zero_score_from_bps: z.number().int().positive(),
      })
      .refine((p) => p.full_score_within_bps < p.zero_score_from_bps, {
        message: 'full_score_within_bps must be below zero_score_from_bps',
      }),
    condition_score: z.record(assetConditionSchema, scoreSchema),
    /** How many related items to show at most. */
    limit: z.number().int().min(1).max(20),
  })
  .refine((r) => r.weights.category + r.weights.price + r.weights.condition === 100, {
    message: 'weights must add up to 100',
  });
export type RelatedItemRules = z.infer<typeof relatedItemRulesSchema>;

// ---------------------------------------------------------------------------
// data/bundle-offers.json: example provider bundle groupings (which assets belong together
// in one lease), added to the database by the seed. Bundles carry no prices or discounts.
// ---------------------------------------------------------------------------

export const bundleOfferSeedSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9-]{1,60}$/),
  name: z.string().min(1).max(80),
  description: z.string().max(400),
  asset_ids: z.array(z.string().min(1)).min(2),
  /** Terms in months the package can be leased for. */
  terms: z.array(z.number().int().positive()).min(1),
  published: z.boolean(),
});
export type BundleOfferSeed = z.infer<typeof bundleOfferSeedSchema>;
export const bundleOffersFileSchema = z.array(bundleOfferSeedSchema);

// ---------------------------------------------------------------------------
// data/dealer-locations.json: fictional dealer locations for the nearby-dealer map, and a
// small table of home cities. Privacy by shape: only a city or area name and coordinates
// with at most one decimal (0.1° ≈ 11 km north–south, ≈ 5 km east–west in Finland). There is
// no address field, and strictObject rejects one if somebody adds it.
// ---------------------------------------------------------------------------

/** True when `value` has at most one decimal, allowing for binary floating-point noise. */
function hasAtMostOneDecimal(value: number): boolean {
  return Math.abs(value * 10 - Math.round(value * 10)) < 1e-9;
}

const coarseLatSchema = z
  .number()
  .min(-90)
  .max(90)
  .refine(hasAtMostOneDecimal, { message: 'latitude must be rounded to 0.1°' });
const coarseLonSchema = z
  .number()
  .min(-180)
  .max(180)
  .refine(hasAtMostOneDecimal, { message: 'longitude must be rounded to 0.1°' });

export const dealerLocationSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9-]{1,60}$/),
  /** The demo provider (Provider.id) this location belongs to. */
  provider_id: z.string().min(1),
  name: z.string().min(1).max(80),
  /** City or area only: never a street address. */
  area: z.string().min(1).max(60),
  lat: coarseLatSchema,
  lon: coarseLonSchema,
});
export type DealerLocation = z.infer<typeof dealerLocationSchema>;

export const homeCitySchema = z.strictObject({
  name: z.string().min(1).max(60),
  lat: coarseLatSchema,
  lon: coarseLonSchema,
});
export type HomeCity = z.infer<typeof homeCitySchema>;

export const dealerLocationsFileSchema = z
  .strictObject({
    note: z.string(),
    dealers: z.array(dealerLocationSchema).min(1),
    cities: z.array(homeCitySchema).min(1),
  })
  .superRefine((file, ctx) => {
    const unique = (values: string[], what: string) => {
      if (new Set(values).size !== values.length)
        ctx.addIssue({ code: 'custom', message: `${what} must be unique` });
    };
    unique(
      file.dealers.map((d) => d.id),
      'dealer ids'
    );
    unique(
      file.cities.map((c) => c.name),
      'city names'
    );
  });
export type DealerLocationsFile = z.infer<typeof dealerLocationsFileSchema>;
