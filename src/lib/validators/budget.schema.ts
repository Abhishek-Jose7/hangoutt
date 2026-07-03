import { z } from 'zod';

export const submitBudgetSchema = z.object({
  groupId: z.string().uuid('Invalid group ID format'),
  maxBudget: z.number()
    .int('Budget must be a whole number')
    .min(200, 'The budget you entered is too less. Kindly reconsider for a better experience.')
    .max(100000, 'Maximum budget is ₹100,000'),
  travelIncluded: z.boolean()
    .optional()
    .default(true),
});

export type SubmitBudgetInput = z.infer<typeof submitBudgetSchema>;
