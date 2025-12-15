/**
 * Shared types for issue tools
 */

export interface IssueSnapshot {
  id: string;
  identifier?: string;
  title: string;
  url?: string;
  stateId: string;
  stateName?: string;
  projectId?: string;
  projectName?: string;
  assigneeId?: string;
  assigneeName?: string;
  priority?: number;
  estimate?: number;
  dueDate?: string;
  archivedAt?: string;
  labels: Array<{ id: string; name: string }>;
}

export type DetailLevel = 'minimal' | 'standard' | 'full';

export interface FormattingOptions {
  detail?: DetailLevel;
  fullDescriptions?: boolean;
  maxPreviewLength?: number;
  maxItems?: number;
}

export interface IssueListItem extends Record<string, unknown> {
  id: string;
  identifier?: string;
  title: string;
  description?: string;
  priority?: number;
  estimate?: number;
  stateId: string;
  stateName?: string;
  projectId?: string;
  projectName?: string;
  assigneeId?: string;
  assigneeName?: string;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
  dueDate?: string;
  url?: string;
  labels: Array<{ id: string; name: string }>;
}

export interface FieldChanges {
  title?: { before: string; after: string };
  state?: { before: string; after: string };
  assignee?: { before: string; after: string };
  project?: { before: string; after: string };
  priority?: { before: number | string; after: number | string };
  estimate?: { before: number | string; after: number | string };
  dueDate?: { before: string; after: string };
  labels?: {
    added: string[];
    removed: string[];
  };
  archived?: { before: boolean; after: boolean };
}

























