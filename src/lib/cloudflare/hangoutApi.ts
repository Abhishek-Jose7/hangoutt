import { auth, clerkClient } from '@clerk/nextjs/server';
import { UnauthorizedError } from '@/lib/errors';

export type ApiUser = {
  clerkId: string;
  email: string;
  name: string;
  imageUrl: string | null;
};

export type ApiCurrentUser = ApiUser & {
  id?: string;
};

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PATCH';
  body?: unknown;
};

export function isHangoutApiConfigured() {
  return Boolean(process.env.HANGOUT_API_URL && process.env.HANGOUT_API_SECRET);
}

function apiUrl(path: string) {
  const base = process.env.HANGOUT_API_URL;
  if (!base) {
    throw new Error('HANGOUT_API_URL is not configured.');
  }

  return `${base.replace(/\/$/, '')}${path}`;
}

export async function hangoutApi<T>(path: string, options: RequestOptions = {}) {
  const secret = process.env.HANGOUT_API_SECRET;
  if (!secret) {
    throw new Error('HANGOUT_API_SECRET is not configured.');
  }

  const response = await fetch(apiUrl(path), {
    method: options.method || 'GET',
    headers: {
      Authorization: `Bearer ${secret}`,
      'Content-Type': 'application/json',
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    cache: 'no-store',
  });

  const payload = await response.json().catch(() => null);
  if (!payload) {
    throw new Error(`Hangout API returned ${response.status}.`);
  }

  return payload as T;
}

export async function getCurrentApiUser(): Promise<ApiCurrentUser> {
  const { userId } = await auth();
  if (!userId) {
    throw new UnauthorizedError();
  }

  const client = await clerkClient();
  const clerkUser = await client.users.getUser(userId);

  return {
    clerkId: userId,
    email: clerkUser.emailAddresses[0]?.emailAddress || 'no-email@clerk.com',
    name: [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(' ') || 'User',
    imageUrl: clerkUser.imageUrl || null,
  };
}
