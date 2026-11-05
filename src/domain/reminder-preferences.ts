// A renter's lease-end reminder settings for one lease: which days before the end, at
// which local clock time, through which channels, in which saved time zone. These are
// mutable settings, kept apart from the signed financial terms.
import { isClockTime, isValidTimeZone } from './local-time';

export const REMINDER_CHANNELS = ['in_app', 'email'] as const;
export type ReminderChannel = (typeof REMINDER_CHANNELS)[number];

export const DEFAULT_REMINDER_DAYS = [30, 7, 1] as const;
export const DEFAULT_REMINDER_TIME = '09:00';
export const MAX_REMINDER_RULES = 10;
/** About ten years: longer than any lease term we sell. */
export const MAX_DAYS_BEFORE = 3650;

export type ReminderRule = {
  /** Stable logical ID: editing the clock time keeps it, so a delivery is never repeated. */
  id: string;
  daysBefore: number;
  /** Local wall-clock time `HH:MM` in the preference's time zone. */
  time: string;
  channels: ReminderChannel[];
  enabled: boolean;
};

export type ReminderPreferences = {
  /** `false` opts out of every reminder for this lease. */
  enabled: boolean;
  /** Saved IANA zone, e.g. `Europe/Tallinn`. */
  timeZone: string;
  rules: ReminderRule[];
};

/** 30, 7 and 1 day before the end at 09:00, in-app and simulated email. */
export function defaultReminderRules(): ReminderRule[] {
  return DEFAULT_REMINDER_DAYS.map((days) => ({
    id: `d${days}`,
    daysBefore: days,
    time: DEFAULT_REMINDER_TIME,
    channels: [...REMINDER_CHANNELS],
    enabled: true,
  }));
}

export function defaultReminderPreferences(timeZone: string): ReminderPreferences {
  return { enabled: true, timeZone, rules: defaultReminderRules() };
}

export type PreferenceProblem = {
  ruleId?: string;
  reason:
    | 'invalid_time_zone'
    | 'too_many_rules'
    | 'invalid_rule_id'
    | 'duplicate_rule_id'
    | 'invalid_days'
    | 'invalid_time'
    | 'no_channel'
    | 'duplicate_timing';
};

export type PreferenceCheck =
  { ok: true; preferences: ReminderPreferences } | { ok: false; problems: PreferenceProblem[] };

const RULE_ID = /^[a-z0-9-]{1,40}$/;

/**
 * Checks the shape of the settings and normalises channel order. An enabled rule needs
 * at least one channel; a disabled rule may have none. Two enabled rules may not share
 * the same day and time. Timing against the actual lease end is checked by the schedule.
 */
export function checkPreferences(input: ReminderPreferences): PreferenceCheck {
  const problems: PreferenceProblem[] = [];
  if (!isValidTimeZone(input.timeZone)) problems.push({ reason: 'invalid_time_zone' });
  if (input.rules.length > MAX_REMINDER_RULES) problems.push({ reason: 'too_many_rules' });
  const ids = new Set<string>();
  const timings = new Set<string>();
  for (const rule of input.rules) {
    if (!RULE_ID.test(rule.id)) problems.push({ ruleId: rule.id, reason: 'invalid_rule_id' });
    else if (ids.has(rule.id)) problems.push({ ruleId: rule.id, reason: 'duplicate_rule_id' });
    ids.add(rule.id);
    if (!Number.isInteger(rule.daysBefore) || rule.daysBefore < 0)
      problems.push({ ruleId: rule.id, reason: 'invalid_days' });
    else if (rule.daysBefore > MAX_DAYS_BEFORE)
      problems.push({ ruleId: rule.id, reason: 'invalid_days' });
    if (!isClockTime(rule.time)) problems.push({ ruleId: rule.id, reason: 'invalid_time' });
    if (rule.enabled && rule.channels.length === 0)
      problems.push({ ruleId: rule.id, reason: 'no_channel' });
    const timing = `${rule.daysBefore}@${rule.time}`;
    if (rule.enabled && timings.has(timing))
      problems.push({ ruleId: rule.id, reason: 'duplicate_timing' });
    if (rule.enabled) timings.add(timing);
  }
  if (problems.length > 0) return { ok: false, problems };
  return {
    ok: true,
    preferences: {
      enabled: input.enabled,
      timeZone: input.timeZone,
      rules: input.rules.map((rule) => ({
        ...rule,
        channels: REMINDER_CHANNELS.filter((channel) => rule.channels.includes(channel)),
      })),
    },
  };
}

/** The rules that produce reminders: none when the whole set is switched off. */
export function activeRules(preferences: ReminderPreferences): ReminderRule[] {
  return preferences.enabled ? preferences.rules.filter((rule) => rule.enabled) : [];
}

/** A new rule ID that does not clash with the existing ones (`r1`, `r2`, ...). */
export function nextRuleId(rules: readonly ReminderRule[]): string {
  const taken = new Set(rules.map((rule) => rule.id));
  let n = 1;
  while (taken.has(`r${n}`)) n += 1;
  return `r${n}`;
}
