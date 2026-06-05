import { auth } from '@clerk/nextjs/server';
import { userRepository, type User } from '../repositories/user.repository';
import { NotFoundError, UnauthorizedError } from '../errors';

export async function getCurrentUser(): Promise<User> {
  const { userId } = await auth();
  if (!userId) {
    throw new UnauthorizedError();
  }
  
  const user = await userRepository.findByClerkId(userId);
  if (!user) {
    throw new NotFoundError('User shadow record not found in the database. Ensure user sync webhook is running.');
  }
  
  return user;
}
