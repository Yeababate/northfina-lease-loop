import { describe, expect, it } from 'vitest';
import {
  activeRules,
  checkPreferences,
  defaultReminderPreferences,
  defaultReminderRules,
  MAX_REMINDER_RULES,
  nextRuleId,
  type ReminderPreferences,
  type ReminderRule,
} from './reminder-preferences';

const rule = (overrides: Partial<ReminderRule> = {}): ReminderRule => ({
  id: 'd7',
  daysBefore: 7,
  time: '09:00',
  channels: ['in_app'],
  enabled: true,
  ...overrides,
});
const prefs = (rules: ReminderRule[], extra: Partial<ReminderPreferences> = {}) => ({
  enabled: true,
  timeZone: 'Europe/Helsinki',
  rules,
  ...extra,
});

describe('defaults', () => {
  it('are 30, 7 and 1 day before at 09:00 through both channels', () => {
    expect(defaultReminderRules()).toEqual([
      { id: 'd30', daysBefore: 30, time: '09:00', channels: ['in_app', 'email'], enabled: true },
      { id: 'd7', daysBefore: 7, time: '09:00', channels: ['in_app', 'email'], enabled: true },
      { id: 'd1', daysBefore: 1, time: '09:00', channels: ['in_app', 'email'], enabled: true },
    ]);
    const defaults = defaultReminderPreferences('Europe/Tallinn');
    expect(defaults.timeZone).toBe('Europe/Tallinn');
    expect(checkPreferences(defaults).ok).toBe(true);
  });
});

describe('checkPreferences', () => {
  it('accepts zero days, an empty rule list and a disabled rule without channels', () => {
    expect(checkPreferences(prefs([rule({ daysBefore: 0 })])).ok).toBe(true);
    expect(checkPreferences(prefs([])).ok).toBe(true);
    expect(checkPreferences(prefs([rule({ channels: [], enabled: false })])).ok).toBe(true);
  });
  it('orders channels the same way every time', () => {
    const result = checkPreferences(prefs([rule({ channels: ['email', 'in_app'] })]));
    expect(result.ok && result.preferences.rules[0]!.channels).toEqual(['in_app', 'email']);
  });
  it('reports every problem with the rule it belongs to', () => {
    const result = checkPreferences(
      prefs(
        [
          rule({ id: 'Bad ID' }),
          rule({ id: 'a', daysBefore: -1 }),
          rule({ id: 'b', daysBefore: 1.5 }),
          rule({ id: 'c', daysBefore: 4000 }),
          rule({ id: 'd', time: '25:00' }),
          rule({ id: 'e', channels: [] }),
          rule({ id: 'e', daysBefore: 3 }),
        ],
        { timeZone: '+02:00' }
      )
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems).toEqual(
      expect.arrayContaining([
        { reason: 'invalid_time_zone' },
        { ruleId: 'Bad ID', reason: 'invalid_rule_id' },
        { ruleId: 'a', reason: 'invalid_days' },
        { ruleId: 'b', reason: 'invalid_days' },
        { ruleId: 'c', reason: 'invalid_days' },
        { ruleId: 'd', reason: 'invalid_time' },
        { ruleId: 'e', reason: 'no_channel' },
        { ruleId: 'e', reason: 'duplicate_rule_id' },
      ])
    );
  });
  it('rejects two enabled rules at the same day and time, but not a disabled twin', () => {
    const twins = [rule({ id: 'a' }), rule({ id: 'b' })];
    expect(checkPreferences(prefs(twins))).toEqual({
      ok: false,
      problems: [{ ruleId: 'b', reason: 'duplicate_timing' }],
    });
    expect(checkPreferences(prefs([twins[0]!, { ...twins[1]!, enabled: false }])).ok).toBe(true);
  });
  it('limits the number of rules', () => {
    const many = Array.from({ length: MAX_REMINDER_RULES + 1 }, (_, i) =>
      rule({ id: `r${i}`, daysBefore: i })
    );
    expect(checkPreferences(prefs(many))).toEqual({
      ok: false,
      problems: [{ reason: 'too_many_rules' }],
    });
  });
});

describe('activeRules and nextRuleId', () => {
  it('drops disabled rules and everything when switched off', () => {
    const rules = [rule({ id: 'a' }), rule({ id: 'b', enabled: false })];
    expect(activeRules(prefs(rules)).map((r) => r.id)).toEqual(['a']);
    expect(activeRules(prefs(rules, { enabled: false }))).toEqual([]);
  });
  it('picks the first free r-number', () => {
    expect(nextRuleId([])).toBe('r1');
    expect(nextRuleId([rule({ id: 'r1' }), rule({ id: 'r3' })])).toBe('r2');
  });
});
