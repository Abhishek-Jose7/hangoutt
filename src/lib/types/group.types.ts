export interface GroupDetail {
  id: string;
  name: string;
  description: string | null;
  groupType: 'FRIENDS' | 'DATE' | 'FAMILY' | 'WORK' | 'CUSTOM';
  creatorId: string;
  inviteCode: string;
  status: 'ACTIVE' | 'ARCHIVED' | 'DELETED';
  maxMembers: number;
  createdAt: string;
  updatedAt: string;
  memberCount: number;
}
