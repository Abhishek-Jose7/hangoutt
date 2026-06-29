import { Webhook } from 'svix';
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { WebhookEvent } from '@clerk/nextjs/server';
import { userRepository } from '@/lib/repositories/user.repository';

export async function POST(req: Request) {
  const WEBHOOK_SECRET = process.env.CLERK_WEBHOOK_SECRET;

  if (!WEBHOOK_SECRET) {
    console.error('CLERK_WEBHOOK_SECRET is not set in environment variables.');
    return new NextResponse('Internal Server Error: Missing webhook secret', { status: 500 });
  }

  // Get headers
  const headerPayload = await headers();
  const svix_id = headerPayload.get('svix-id');
  const svix_timestamp = headerPayload.get('svix-timestamp');
  const svix_signature = headerPayload.get('svix-signature');

  // If there are no headers, error out
  if (!svix_id || !svix_timestamp || !svix_signature) {
    return new NextResponse('Error occurred -- no svix headers', { status: 400 });
  }

  // Get body
  const payload = await req.json();
  const body = JSON.stringify(payload);

  // Create a new Svix instance with secret
  const wh = new Webhook(WEBHOOK_SECRET);

  let evt: WebhookEvent;

  // Verify signature
  try {
    evt = wh.verify(body, {
      'svix-id': svix_id,
      'svix-timestamp': svix_timestamp,
      'svix-signature': svix_signature,
    }) as WebhookEvent;
  } catch (err) {
    console.error('Error verifying webhook signature:', err);
    return new NextResponse('Error occurred -- signature verification failed', { status: 401 });
  }

  const { id: clerkId } = evt.data;
  const eventType = evt.type;

  if (eventType === 'user.created' || eventType === 'user.updated') {
    const data = evt.data as any;

    // Extract email
    const email = data.email_addresses?.[0]?.email_address || '';
    // Extract name
    const firstName = data.first_name || '';
    const lastName = data.last_name || '';
    const name = `${firstName} ${lastName}`.trim() || email.split('@')[0] || 'User';
    // Extract avatar url
    const imageUrl = data.image_url || null;

    if (!clerkId) {
      return new NextResponse('Error occurred -- missing Clerk user ID', { status: 400 });
    }

    try {
      const existingUser = await userRepository.findByClerkId(clerkId);

      if (existingUser) {
        // Update user properties
        await userRepository.update(existingUser.id, {
          email,
          name,
          imageUrl,
        });
        console.log(`Synced user update for clerkId: ${clerkId}`);
      } else {
        // Create user record
        const uuid = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : require('crypto').randomUUID();

        await userRepository.create({
          id: uuid,
          clerkId,
          email,
          name,
          imageUrl,
        });
        console.log(`Synced user creation for clerkId: ${clerkId}`);
      }
    } catch (err) {
      console.error('Error synchronizing user record:', err);
      return new NextResponse('Database write failure during synchronization', { status: 500 });
    }
  } else if (eventType === 'user.deleted') {
    if (!clerkId) {
      return new NextResponse('Error occurred -- missing Clerk user ID', { status: 400 });
    }

    try {
      // Cascade deletes (groupMembers, budgets, locations, votes) are configured on the FK.
      // Note: groups.creator_id has no cascade — created groups will keep a dangling reference.
      await userRepository.deleteByClerkId(clerkId);
      console.log(`Deleted user record for clerkId: ${clerkId}`);
    } catch (err) {
      console.error('Error deleting user record:', err);
      return new NextResponse('Database delete failure during user removal', { status: 500 });
    }
  }

  return NextResponse.json({ success: true });
}
