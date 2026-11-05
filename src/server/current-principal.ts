// Server components: the participant for the visitor's demo sign-in name (see
// src/server/demo-session.ts). Replace this adapter with proper login later; consumers
// use stable participant IDs.
import { db } from './db';
import { readDemoName } from './demo-session';
import { principalForDemoName } from './mock-users';

export async function currentPrincipal() {
  return principalForDemoName(db, await readDemoName());
}
