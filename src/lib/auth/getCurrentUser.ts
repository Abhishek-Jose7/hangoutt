import { auth, clerkClient } from '@clerk/nextjs/server';
import { userRepository, type User } from '../repositories/user.repository';
import { UnauthorizedError } from '../errors';

export async function getCurrentUser(): Promise<User> {
  const { userId } = await auth();
  if (!userId) {
    throw new UnauthorizedError();
  }
  
  let user = await userRepository.findByClerkId(userId);
  if (!user) {
    try {
      // In local development, the Clerk webhook might not reach localhost.
      // So we dynamically fetch user details from Clerk and insert a shadow user record on the fly.
      const client = await clerkClient();
      const clerkUser = await client.users.getUser(userId);
      
      const email = clerkUser.emailAddresses[0]?.emailAddress || 'no-email@clerk.com';
      const name = [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(' ') || 'User';
      const imageUrl = clerkUser.imageUrl || null;
      
      const uuid = () => require('crypto').randomUUID();
      user = await userRepository.create({
        id: uuid(),
        clerkId: userId,
        email,
        name,
        imageUrl,
      });
    } catch (err) {
      console.error('Failed to auto-sync user from Clerk:', err);
      throw new Error('User shadow record not found in the database and auto-sync failed. Ensure user sync webhook is running.');
    }
  }
  
  return user;
}
