'use client';

// Sends one returns-console command (inspect, work, relist, assign) and refreshes the page,
// so the next state and its blockers are always re-derived by the server.
import { useRouter } from 'next/navigation';
import { useState } from 'react';

export type ReturnStep = 'inspection' | 'work' | 'relist' | 'assign';
/** The refused step, so the message can be shown next to the button that was pressed. */
export type ActionProblem = { step: ReturnStep; code: string } | null;

export function useReturnAction(intakeId: string) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<ActionProblem>(null);

  async function send(step: ReturnStep, body: object) {
    setBusy(true);
    setProblem(null);
    try {
      const response = await fetch(`/api/returns/${encodeURIComponent(intakeId)}/${step}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (response.ok) {
        router.refresh();
        return true;
      }
      setProblem({ step, code: await errorCode(response) });
    } catch {
      setProblem({ step, code: 'NETWORK' });
    } finally {
      setBusy(false);
    }
    return false;
  }

  return { busy, problem, send };
}

async function errorCode(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json();
    if (
      typeof body === 'object' &&
      body !== null &&
      'error' in body &&
      typeof body.error === 'object' &&
      body.error !== null &&
      'code' in body.error &&
      typeof body.error.code === 'string'
    )
      return body.error.code;
  } catch {
    // Not JSON: fall through to the generic code.
  }
  return 'UNKNOWN';
}
