// The server views the returns console renders, typed from the functions that build them.
import type { getReturn } from '@/server/next-life-reads';
import type { getWaitingListMatches } from '@/server/waiting-list';

export type ReturnView = Awaited<ReturnType<typeof getReturn>>;
export type MatchesView = Awaited<ReturnType<typeof getWaitingListMatches>>;
