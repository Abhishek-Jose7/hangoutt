import { z } from 'zod';

export const submitBudgetSchema = z.object({
  groupId: z.string().uuid('Invalid group ID format'),
  maxBudget: z.number()
    .int('Budget must be a whole number')
    .min(50, 'Minimum budget is ₹50')
    .max(100000, 'Maximum budget is ₹100,000'),
});

export type SubmitBudgetInput = z.infer<typeof submitBudgetSchema>;
