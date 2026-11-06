// An item's passport (#41): its history across lives, oldest first, from what Lease Loop has
// recorded (leases, returns, inspections, work, relistings) plus the data pack's count of
// earlier leases, which happened before our records and are shown as a count only.

export type PassportEvent = {
  type: string;
  on: string;
  details: unknown;
};

export type PassportLease = { startOn: string; termMonths: number };

export type PassportEntry =
  | { kind: 'made'; year: number }
  | { kind: 'earlier_lives'; count: number }
  | { kind: 'leased'; on: string; termMonths: number }
  | { kind: 'returned'; on: string }
  | { kind: 'inspected'; on: string; condition: string | null }
  | { kind: 'work'; on: string; actionId: string }
  | { kind: 'relisted'; on: string; priceCents: number | null };

export type Passport = {
  /** The life it is in now (or about to start): earlier lives + 1. */
  lifeNumber: number;
  entries: PassportEntry[];
};

export function buildPassport(input: {
  modelYear: number;
  /** From the asset: completed leases, including ones we recorded. */
  previousLives: number;
  leases: readonly PassportLease[];
  events: readonly PassportEvent[];
}): Passport {
  const recordedLives = input.events.filter((event) => event.type === 'life_completed').length;
  const before = Math.max(0, input.previousLives - recordedLives);
  const dated: Extract<PassportEntry, { on: string }>[] = [
    ...input.events.flatMap((event): Extract<PassportEntry, { on: string }>[] => {
      const d = isRecord(event.details) ? event.details : {};
      switch (event.type) {
        case 'received':
          return [{ kind: 'returned', on: event.on }];
        case 'inspected':
          return [
            {
              kind: 'inspected',
              on: event.on,
              condition: typeof d.condition === 'string' ? d.condition : null,
            },
          ];
        case 'work_recorded':
          return typeof d.actionId === 'string'
            ? [{ kind: 'work', on: event.on, actionId: d.actionId }]
            : [];
        case 'relisted':
          return [
            {
              kind: 'relisted',
              on: event.on,
              priceCents:
                typeof d.priceCents === 'number' && Number.isSafeInteger(d.priceCents)
                  ? d.priceCents
                  : null,
            },
          ];
        default:
          return [];
      }
    }),
    // After the events, so on a relisting day the checks and work come before the new lease.
    ...input.leases.map((lease) => ({
      kind: 'leased' as const,
      on: lease.startOn,
      termMonths: lease.termMonths,
    })),
  ];
  // Stable: entries on the same day keep the order they were recorded in.
  const ordered = dated
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => a.entry.on.localeCompare(b.entry.on) || a.index - b.index)
    .map(({ entry }) => entry);

  return {
    lifeNumber: input.previousLives + 1,
    entries: [
      { kind: 'made', year: input.modelYear },
      ...(before > 0 ? [{ kind: 'earlier_lives' as const, count: before }] : []),
      ...ordered,
    ],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
