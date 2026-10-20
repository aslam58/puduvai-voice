export const categories = ['electricity', 'water', 'drainage', 'roads', 'waste', 'traffic', 'accidents'] as const;
export type Category = typeof categories[number];
export type Locale = 'en' | 'ta' | 'hi';
export type IssueStatus = 'reported' | 'under_review' | 'verified' | 'resolved' | 'closed';
export type Engagement = 'not_forwarded' | 'forwarded' | 'acknowledged' | 'work_reported';
export type Role = 'resident' | 'moderator' | 'administrator';
// Publication and resolution require a human moderator. AI outputs are suggestions only.
export const canModerate = (role: Role) => role === 'moderator' || role === 'administrator';
