import { budgetRepository } from '../repositories/budget.repository';
import { memberRepository } from '../repositories/member.repository';
import { groupService } from './group.service';
import { submitBudgetSchema } from '../validators/budget.schema';
import { ForbiddenError, ValidationError, NotFoundError } from '../errors';

export const budgetService = {
  async submitBudget(userId: string, groupId: string, maxBudget: number, travelIncluded?: boolean) {
    // 1. Verify user is member of the group
    const member = await memberRepository.getMember(groupId, userId);
    if (!member) {
      throw new ForbiddenError('You are not a member of this planning group.');
    }

    // 2. Validate input constraints via Zod
    const parsed = submitBudgetSchema.safeParse({ groupId, maxBudget, travelIncluded });
    if (!parsed.success) {
      throw new ValidationError('Invalid budget value', parsed.error.flatten());
    }

    const uuid = () => {
      if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
      }
      return require('crypto').randomUUID();
    };

    // 3. Upsert budget
    const result = await budgetRepository.upsertBudget({
      id: uuid(),
      groupId,
      userId,
      maxBudget: parsed.data.maxBudget,
      travelIncluded: parsed.data.travelIncluded,
    });

    // 4. Trigger readiness check
    await groupService.checkGroupReadiness(groupId);

    return result;
  },

  async getGroupBudgetSummary(userId: string, groupId: string) {
    // 1. Verify caller membership
    const member = await memberRepository.getMember(groupId, userId);
    if (!member) {
      throw new ForbiddenError('You are not authorized to view this group budget.');
    }

    // 2. Fetch aggregate values (repository doesn't query individual names or details)
    const summary = await budgetRepository.getGroupBudgetSummary(groupId);
    if (!summary) {
      throw new NotFoundError('Failed to fetch budget summary.');
    }

    return summary;
  },
};

export type BudgetService = typeof budgetService;
