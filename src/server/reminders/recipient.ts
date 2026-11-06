// Who the reminder inbox and settings belong to: the signed-in participant's stable id (from
// the demo sign-in name, issue #1). Earlier builds keyed reminders by the typed name, so
// "liv" and "Liv" lost each other's reminders; adoptNamedReminderRecipients converts those.
// When real sign-in replaces the demo name, only currentPrincipal changes.
import { ApiError } from '../api-response';
import { currentPrincipal } from '../current-principal';

export async function requireRecipient(): Promise<string> {
  const principal = await currentPrincipal();
  if (!principal) throw new ApiError(401, 'NO_DEMO_NAME', 'No demo name is set');
  return principal.id;
}
