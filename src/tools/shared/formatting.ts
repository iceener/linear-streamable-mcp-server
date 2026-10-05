/**
 * Shared formatting utilities for issue tools
 */

import type { DetailLevel, FormattingOptions, IssueListItem } from './types';

/**
 * Format priority as human-readable label
 * Linear priorities: 0=None, 1=Urgent, 2=High, 3=Medium, 4=Low
 */
function formatPriority(priority: number | undefined): string | undefined {
  if (priority === undefined || priority === null) return undefined;
  const labels: Record<number, string> = {
    0: 'None',
    1: 'Urgent',
    2: 'High',
    3: 'Medium',
    4: 'Low',
  };
  return labels[priority] ?? `P${priority}`;
}

/**
 * Format a single issue as a preview line with key metadata
 * Respects detail level:
 * - minimal: identifier, title, state, url
 * - standard: + priority, assignee, project, dueDate
 * - full: + labels
 */
export function formatIssuePreviewLine(
  issue: IssueListItem,
  detail: DetailLevel = 'standard',
): string {
  const idf = issue.identifier ?? issue.id;
  const title = issue.url ? `[${idf} — ${issue.title}](${issue.url})` : `${idf} '${issue.title}'`;

  const parts: string[] = [];
  const state = issue.stateName ?? issue.stateId;
  parts.push(`state ${state}`);

  // Minimal: stop here
  if (detail === 'minimal') {
    return `${title} — ${parts.join('; ')}`.trim();
  }

  // Standard: add priority, project, dueDate, assignee
  if (issue.priority !== undefined && issue.priority > 0) {
    const priorityLabel = formatPriority(issue.priority);
    if (priorityLabel) parts.push(`priority ${priorityLabel}`);
  }

  if (issue.projectName) {
    parts.push(`project ${issue.projectName}`);
  }

  if (issue.dueDate) {
    parts.push(`due ${issue.dueDate}`);
  }

  if (issue.assigneeName ?? issue.assigneeId) {
    const assignee = issue.assigneeName ?? issue.assigneeId;
    parts.push(`assignee ${assignee}`);
  }

  // Full: add labels
  if (detail === 'full') {
    const labels = issue.labels
      .map((l) => l.name)
      .slice(0, 5)
      .join(', ');
    if (labels) {
      parts.push(`labels ${labels}`);
    }
  }

  return `${title} — ${parts.join('; ')}`.trim();
}

/**
 * Format description based on options (full or snippet)
 */
function _formatDescription(description: string | undefined, options: FormattingOptions): string {
  if (!description) {
    return '';
  }

  if (options.fullDescriptions === true) {
    return `\n  description: ${description}`;
  }

  const maxLength = options.maxPreviewLength ?? 200;
  const singleLine = description.replace(/\s+/g, ' ').trim();
  const snippet = singleLine.length > maxLength ? `${singleLine.slice(0, maxLength)}…` : singleLine;

  return snippet ? `\n  description: ${snippet}` : '';
}

/**
 * Generate preview lines from a list of items
 */
export function previewLinesFromItems<T extends Record<string, unknown>>(
  items: T[],
  formatter: (item: T) => string,
): string[] {
  return items.map(formatter);
}
