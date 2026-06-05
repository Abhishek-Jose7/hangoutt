import { z } from 'zod';

export const groupTypeEnum = z.enum(['FRIENDS', 'DATE', 'FAMILY', 'WORK', 'CUSTOM']);

export const createGroupSchema = z.object({
  name: z.string()
    .min(3, 'Group name must be at least 3 characters long')
    .max(60, 'Group name must be at most 60 characters long')
    .transform(val => val.trim()),
  groupType: groupTypeEnum,
  description: z.string()
    .max(300, 'Description must not exceed 300 characters')
    .optional()
    .nullable()
    .transform(val => val ? val.trim() : null),
});

export const updateGroupSchema = createGroupSchema.partial().extend({
  groupId: z.string().uuid('Invalid group ID format'),
});

export type CreateGroupInput = z.infer<typeof createGroupSchema>;
export type UpdateGroupInput = z.infer<typeof updateGroupSchema>;
