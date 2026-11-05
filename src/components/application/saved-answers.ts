'use client';

// Application answers kept in this browser tab (sessionStorage), shared by the application
// page and the Review and sign page. Never in the URL: answers are personal data.
// The storage key lives in ./storage-key.ts, so server pages can build it too.
import { useMemo, useSyncExternalStore } from 'react';
import type { Answers } from '@/domain/answer-check';

/**
 * The saved answers for `key`: `{}` on the server and before the page is interactive, so
 * server and browser render the same first, then the saved answers appear.
 */
export function useSavedAnswers(key: string): Answers {
  const saved = useSyncExternalStore(
    noSubscription,
    () => read(key),
    () => null
  );
  return useMemo(() => parseAnswers(saved), [saved]);
}

/** False on the server and during hydration, true once saved answers can be read. */
export function useCanReadAnswers(): boolean {
  return useSyncExternalStore(
    noSubscription,
    () => true,
    () => false
  );
}

export function saveAnswers(key: string, answers: Answers): void {
  try {
    sessionStorage.setItem(key, JSON.stringify(answers));
  } catch {
    // Private mode or storage switched off: it still works, it just won't survive a reload.
  }
}

export function clearAnswers(key: string): void {
  try {
    sessionStorage.removeItem(key);
  } catch {
    // Nothing to clear.
  }
}

function noSubscription() {
  return () => {};
}

function read(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Saved text back into answers. Anything unexpected is ignored; the flow re-checks the rest. */
function parseAnswers(text: string | null): Answers {
  if (!text) return {};
  try {
    const value: unknown = JSON.parse(text);
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Answers) : {};
  } catch {
    return {};
  }
}
