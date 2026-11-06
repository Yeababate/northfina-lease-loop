// Remembered application answers (#51). Every write is audited, but the audit row names the
// question only: the value is personal data and stays in SavedAnswer.
import { randomUUID } from 'node:crypto';
import type { Question } from '@/data/schemas';
import { checkAnswer, type Answers, type AnswerValue } from '@/domain/answer-check';
import {
  impliedAnswers,
  isImpliedByKey,
  isRememberable,
  parseProfileKey,
  pruneProfileAnswers,
  type ProfileKey,
} from '@/domain/answer-scope';
import { profileFlags, type ProfileFlag } from '@/domain/profile-flags';
import { ApiError } from './api-response';
import { withAudit, type TransactionClient } from './audit';
import type { PrismaClient } from './prisma-client';

export type SavedProfile = {
  profileKey: string;
  /** Remembered answers, without the ones the key implies. */
  answers: Record<string, AnswerValue>;
  /** The ISO day each answer was given. */
  answeredOn: Record<string, string>;
  flags: ProfileFlag[];
  /** Newest change in the set, for picking the default set. */
  updatedAt: string;
};

type Row = {
  profileKey: string;
  questionId: string;
  valueJson: string;
  answeredOn: string;
  updatedAt: Date;
};

export function requireProfileKey(input: string | null): ProfileKey {
  const key = input === null ? null : parseProfileKey(input);
  if (!key) {
    throw new ApiError(
      422,
      'INVALID_PROFILE',
      'profile must be consumer, sole_trader or company:<valid business id>'
    );
  }
  return key;
}

function group(rows: readonly Row[], questions: readonly Question[], today: string) {
  const sets = new Map<string, Row[]>();
  for (const row of rows) sets.set(row.profileKey, [...(sets.get(row.profileKey) ?? []), row]);
  const profiles: SavedProfile[] = [];
  for (const [profileKey, setRows] of sets) {
    const key = parseProfileKey(profileKey);
    if (!key) continue;
    const answers: Record<string, AnswerValue> = {};
    const answeredOn: Record<string, string> = {};
    for (const row of setRows) {
      answers[row.questionId] = JSON.parse(row.valueJson) as AnswerValue;
      answeredOn[row.questionId] = row.answeredOn;
    }
    const all = { ...answers, ...impliedAnswers(key) };
    const updatedAt = setRows.reduce((a, r) => (r.updatedAt > a ? r.updatedAt : a), new Date(0));
    profiles.push({
      profileKey,
      answers,
      answeredOn,
      flags: profileFlags(key, all, questions, today),
      updatedAt: updatedAt.toISOString(),
    });
  }
  return profiles.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** All remembered sets of one user, the most recently changed first. */
export async function listSavedProfiles(
  db: PrismaClient | TransactionClient,
  userId: string,
  questions: readonly Question[],
  today: string
): Promise<SavedProfile[]> {
  const rows = await db.savedAnswer.findMany({ where: { userId }, orderBy: { questionId: 'asc' } });
  return group(rows, questions, today);
}

/**
 * The answers to evaluate for readiness: the requested set, or else the most recently
 * changed one, with the answers its key implies. `null` when the user has no set.
 */
export async function savedAnswersFor(
  db: PrismaClient,
  userId: string,
  profileKey: ProfileKey | null,
  questions: readonly Question[],
  today: string
): Promise<{ profileKey: string; answers: Answers } | null> {
  const profiles = await listSavedProfiles(db, userId, questions, today);
  const chosen = profileKey ? profiles.find((p) => p.profileKey === profileKey.key) : profiles[0];
  const key = profileKey ?? (chosen ? parseProfileKey(chosen.profileKey) : null);
  if (!key) return null;
  return { profileKey: key.key, answers: { ...(chosen?.answers ?? {}), ...impliedAnswers(key) } };
}

async function setAnswers(tx: TransactionClient, userId: string, key: ProfileKey) {
  const rows = await tx.savedAnswer.findMany({ where: { userId, profileKey: key.key } });
  const answers: Record<string, AnswerValue> = {};
  for (const row of rows) answers[row.questionId] = JSON.parse(row.valueJson) as AnswerValue;
  return answers;
}

/** Deletes answers that stopped applying; returns their ids for the response and audit. */
async function dropRemoved(
  tx: TransactionClient,
  userId: string,
  key: ProfileKey,
  questions: readonly Question[],
  answers: Answers
): Promise<string[]> {
  const { removed } = pruneProfileAnswers(questions, key, answers);
  if (removed.length > 0) {
    await tx.savedAnswer.deleteMany({
      where: { userId, profileKey: key.key, questionId: { in: removed } },
    });
  }
  return removed;
}

export type SaveAnswerInput = {
  userId: string;
  profileKey: ProfileKey;
  questionId: string;
  value: AnswerValue;
  today: string;
};

/**
 * Remembers one answer. It must be a profile-level question that the key does not already
 * fix, and a valid answer (`checkAnswer`, the same check the application uses). Answers that
 * no longer apply after the change are forgotten in the same transaction.
 */
export async function saveAnswer(
  db: PrismaClient,
  input: SaveAnswerInput,
  questions: readonly Question[]
): Promise<{ removed: string[] }> {
  const { userId, profileKey: key, questionId, value, today } = input;
  const question = questions.find((q) => q.id === questionId);
  if (!question || !isRememberable(questionId)) {
    throw new ApiError(422, 'NOT_REMEMBERABLE', 'This question cannot be remembered');
  }
  if (isImpliedByKey(key, questionId)) {
    throw new ApiError(422, 'IMPLIED_BY_PROFILE', 'The profile already gives this answer');
  }
  const check = checkAnswer(question, value);
  if (!check.ok)
    throw new ApiError(422, 'INVALID_ANSWER', 'The answer is not valid', check.problem);

  return withAudit(
    db,
    {
      actor: userId,
      action: 'saved_answer.saved',
      entityType: 'saved_answer',
      entityId: `${userId}:${key.key}:${questionId}`,
      details: { profileKey: key.key, questionId },
    },
    async (tx) => {
      const valueJson = JSON.stringify(value);
      await tx.savedAnswer.upsert({
        where: { userId_profileKey_questionId: { userId, profileKey: key.key, questionId } },
        create: {
          id: randomUUID(),
          userId,
          profileKey: key.key,
          questionId,
          valueJson,
          answeredOn: today,
        },
        update: { valueJson, answeredOn: today },
      });
      const answers = { ...(await setAnswers(tx, userId, key)), [questionId]: value };
      return { removed: await dropRemoved(tx, userId, key, questions, answers) };
    }
  );
}

/** Forgets one answer, and any answer that only applied because of it. */
export async function forgetAnswer(
  db: PrismaClient,
  userId: string,
  key: ProfileKey,
  questionId: string,
  questions: readonly Question[]
): Promise<{ removed: string[] }> {
  return withAudit(
    db,
    {
      actor: userId,
      action: 'saved_answer.forgotten',
      entityType: 'saved_answer',
      entityId: `${userId}:${key.key}:${questionId}`,
      details: { profileKey: key.key, questionId },
    },
    async (tx) => {
      const deleted = await tx.savedAnswer.deleteMany({
        where: { userId, profileKey: key.key, questionId },
      });
      const dependants = await dropRemoved(
        tx,
        userId,
        key,
        questions,
        await setAnswers(tx, userId, key)
      );
      return { removed: deleted.count > 0 ? [questionId, ...dependants] : dependants };
    }
  );
}

/** Forgets every remembered answer of the user, or of one set when `key` is given. */
export async function forgetAll(
  db: PrismaClient,
  userId: string,
  key: ProfileKey | null
): Promise<{ count: number }> {
  return withAudit(
    db,
    {
      actor: userId,
      action: 'saved_answer.all_forgotten',
      entityType: 'saved_answer',
      entityId: key ? `${userId}:${key.key}` : userId,
      details: { profileKey: key?.key ?? null },
    },
    async (tx) => {
      const deleted = await tx.savedAnswer.deleteMany({
        where: { userId, ...(key ? { profileKey: key.key } : {}) },
      });
      return { count: deleted.count };
    }
  );
}
