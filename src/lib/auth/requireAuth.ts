import { auth } from '@clerk/nextjs/server';
import { UnauthorizedError } from '../errors';

export async function requireAuth(): Promise<string> {
  const { userId } = await auth();
  if (!userId) {
    throw new UnauthorizedError();
  }
  return userId;
}
