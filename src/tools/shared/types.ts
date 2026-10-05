/**
 * Shared types for issue tools
 */

export interface IssueSnapshot {
  id: string;
  identifier?: string | undefined;
  title: string;
  url?: string | undefined;
  stateId: string;
  stateName?: string | undefined;
  projectId?: string | undefined;
  projectName?: string | undefined;
  assigneeId?: string | undefined;
  assigneeName?: string | undefined;
  priority?: number | undefined;
  estimate?: number | undefined;
  dueDate?: string | undefined;
  archivedAt?: string | undefined;
  labels: Array<{ id: string; name: string }>;
}

export type DetailLevel = 'minimal' | 'standard' | 'full';

export interface FormattingOptions {
  detail?: DetailLevel | undefined;
  fullDescriptions?: boolean | undefined;
  maxPreviewLength?: number | undefined;
  maxItems?: number | undefined;
}

export interface IssueListItem extends Record<string, unknown> {
  id: string;
  identifier?: string | undefined;
  title: string;
  description?: string | undefined;
  priority?: number | undefined;
  estimate?: number | undefined;
  stateId: string;
  stateName?: string | undefined;
  projectId?: string | undefined;
  projectName?: string | undefined;
  assigneeId?: string | undefined;
  assigneeName?: string | undefined;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string | undefined;
  dueDate?: string | undefined;
  url?: string | undefined;
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
