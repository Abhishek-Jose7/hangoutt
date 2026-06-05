import { z } from 'zod';

export const createVoteSchema = z.object({
  groupId: z.string().uuid('Invalid group ID format'),
  planId: z.string().uuid('Invalid plan ID format'),
});

export const joinGroupSchema = z.object({
  inviteCode: z.string()
    .length(8, 'Invite code must be exactly 8 characters')
    .regex(/^[a-zA-Z0-9]+$/, 'Invite code must be alphanumeric'),
});

export type CreateVoteInput = z.infer<typeof createVoteSchema>;
export type JoinGroupInput = z.infer<typeof joinGroupSchema>;
