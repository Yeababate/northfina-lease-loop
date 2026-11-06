'use client';

// The signed-in user's remembered answer sets in the browser (#52), and the calls that save
// and forget them through #51's API. After every change the sets are read back from the
// server, so what the page shows is what is stored, including answers the server forgot
// because they stopped applying (for example the signatory email after "I can sign: yes").
import { useCallback, useState } from 'react';
import type { AnswerValue } from '@/domain/answer-check';
import type { RememberedSetView } from '@/domain/remembered-answers';

export type RememberedAnswers = {
  /** False when signed out: nothing can be remembered and no controls are shown. */
  signedIn: boolean;
  /** Most recently changed first, as the API lists them. */
  sets: readonly RememberedSetView[];
  busy: boolean;
  /** The last change did not go through. */
  failed: boolean;
  /** Saves answers one by one, in the given order. True when all were saved. */
  save: (
    profileKey: string,
    entries: readonly (readonly [string, AnswerValue])[]
  ) => Promise<boolean>;
  forget: (profileKey: string, questionId: string) => Promise<boolean>;
  forgetAll: () => Promise<boolean>;
};

type Envelope<T> = { success: boolean; data?: T };

async function call<T>(url: string, init?: RequestInit): Promise<T | null> {
  try {
    const response = await fetch(url, init);
    const body = (await response.json()) as Envelope<T>;
    return body.success && body.data !== undefined ? body.data : null;
  } catch {
    return null;
  }
}

/** `initial` comes from the server page; null when signed out. */
export function useRememberedAnswers(
  initial: readonly RememberedSetView[] | null
): RememberedAnswers {
  const [sets, setSets] = useState<readonly RememberedSetView[]>(initial ?? []);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const signedIn = initial !== null;

  const run = useCallback(async (change: () => Promise<boolean>) => {
    setBusy(true);
    const ok = await change();
    const fresh = await call<{ profiles: RememberedSetView[] }>('/api/profile/answers');
    if (fresh) setSets(fresh.profiles);
    setFailed(!ok || !fresh);
    setBusy(false);
    return ok;
  }, []);

  const save = useCallback(
    (profileKey: string, entries: readonly (readonly [string, AnswerValue])[]) =>
      run(async () => {
        for (const [questionId, value] of entries) {
          const done = await call(`/api/profile/answers/${encodeURIComponent(questionId)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ profile: profileKey, value }),
          });
          if (!done) return false;
        }
        return true;
      }),
    [run]
  );

  const forget = useCallback(
    (profileKey: string, questionId: string) =>
      run(async () => {
        const query = new URLSearchParams({ profile: profileKey });
        const done = await call(`/api/profile/answers/${encodeURIComponent(questionId)}?${query}`, {
          method: 'DELETE',
        });
        return done !== null;
      }),
    [run]
  );

  const forgetAll = useCallback(
    () => run(async () => (await call('/api/profile/answers', { method: 'DELETE' })) !== null),
    [run]
  );

  return { signedIn, sets, busy, failed, save, forget, forgetAll };
}
