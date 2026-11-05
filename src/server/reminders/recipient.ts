// Who the reminder inbox and settings belong to: main's demo sign-in name (issue #1),
// read from its session cookie. When real sign-in replaces it, only this adapter changes.
import { ApiError } from '../api-response';
import { readDemoName } from '../demo-session';

export async function requireRecipient(): Promise<string> {
  const name = await readDemoName();
  if (!name) throw new ApiError(401, 'NO_DEMO_NAME', 'No demo name is set');
  return name;
}
