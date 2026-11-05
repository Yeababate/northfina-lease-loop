import { describe, expect, it } from 'vitest';
import { previousQuestionId, progressOf, ruleForBlock } from './application-progress';
import type { FlowState } from './question-flow';

const flow = (answered: string[], remaining: number): FlowState => ({
  status: remaining > 0 ? 'in_progress' : 'complete',
  next: null,
  block: null,
  answers: {},
  answered,
  removed: [],
  remaining,
});

describe('progressOf', () => {
  it('counts the next question after the answered ones', () => {
    expect(progressOf(flow(['a', 'b'], 4), null)).toEqual({
      current: 3,
      aboutTotal: 6,
      minutesLeft: 2, // 4 questions × 20 s = 80 s → 2 minutes
    });
  });

  it('starts at question 1 of the questions known so far', () => {
    expect(progressOf(flow([], 3), null)).toEqual({ current: 1, aboutTotal: 3, minutesLeft: 1 });
  });

  it('shows the position of an earlier answer being changed', () => {
    expect(progressOf(flow(['a', 'b', 'c'], 2), 'b')).toMatchObject({ current: 2, aboutTotal: 5 });
  });

  it('treats an unknown editing id like no editing', () => {
    expect(progressOf(flow(['a'], 1), 'zzz')).toMatchObject({ current: 2, aboutTotal: 2 });
  });

  it('never goes past the total or below one question, and has no time left when done', () => {
    expect(progressOf(flow(['a', 'b'], 0), null)).toEqual({
      current: 2,
      aboutTotal: 2,
      minutesLeft: 0,
    });
    expect(progressOf(flow([], 0), null)).toEqual({ current: 1, aboutTotal: 1, minutesLeft: 0 });
  });
});

describe('previousQuestionId', () => {
  it('goes from a new question to the last answer', () => {
    expect(previousQuestionId(['a', 'b'], 'c')).toBe('b');
  });

  it('goes from an answer being changed to the one before it', () => {
    expect(previousQuestionId(['a', 'b', 'c'], 'b')).toBe('a');
  });

  it('has nowhere to go from the first question', () => {
    expect(previousQuestionId(['a', 'b'], 'a')).toBeNull();
    expect(previousQuestionId([], 'a')).toBeNull();
  });
});

describe('ruleForBlock', () => {
  it('explains an age block with the minimum age rule', () => {
    expect(ruleForBlock({ questionId: 'q_birth_date', rule: 'age_under' })).toBe('min_age');
  });

  it('explains a country block with the residency rule', () => {
    expect(ruleForBlock({ questionId: 'q_country', rule: 'answer_in' })).toBe('residency');
  });

  it('has no rule for other blocking answers', () => {
    expect(ruleForBlock({ questionId: 'q_other', rule: 'answer_in' })).toBeNull();
  });
});
