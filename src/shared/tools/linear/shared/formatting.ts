/**
 * Shared formatting utilities for issue tools
 */

import type { FormattingOptions, IssueListItem } from './types.js';

/**
 * Format a single issue as a preview line with key metadata
 */
export function formatIssuePreviewLine(issue: IssueListItem): string {
  const idf = issue.identifier ?? issue.id;
  const title = issue.url
    ? `[${idf} — ${issue.title}](${issue.url})`
    : `${idf} '${issue.title}'`;

  const parts: string[] = [];
  const state = issue.stateName ?? issue.stateId;
  parts.push(`state ${state}`);

  if (issue.projectName) {
    parts.push(`project ${issue.projectName}`);
  }

  const labels = issue.labels
    .map((l) => l.name)
    .slice(0, 5)
    .join(', ');
  if (labels) {
    parts.push(`labels ${labels}`);
  }

  if (issue.dueDate) {
    parts.push(`due ${issue.dueDate}`);
  }

  if (issue.assigneeName ?? issue.assigneeId) {
    const assignee = issue.assigneeName ?? issue.assigneeId;
    parts.push(`assignee ${assignee}`);
  }

  return `${title} — ${parts.join('; ')}`.trim();
}

/**
 * Format issue details with structured metadata
 */
export function formatIssueDetails(
  issue: IssueListItem,
  options: FormattingOptions = {},
): string {
  const idf = issue.identifier ?? issue.id;
  const state = issue.stateName ?? issue.stateId;
  const labels = issue.labels.map((l) => l.name).join(', ');

  const proj = issue.projectName
    ? `\n  project: ${issue.projectName} (${issue.projectId ?? ''})`
    : '';

  const asg = issue.assigneeName
    ? `\n  assignee: ${issue.assigneeName} (${issue.assigneeId ?? ''})`
    : '';

  const due = issue.dueDate ? `\n  due: ${issue.dueDate}` : '';
  const lab = labels ? `\n  labels: ${labels}` : '';

  const desc = formatDescription(issue.description, options);

  const header = issue.url
    ? `- [${idf} — ${issue.title}](${issue.url})`
    : `- ${idf} — ${issue.title}`;

  return `<ove id="${issue.id}" identifier="${idf}">
${header}
  state: ${state} (${issue.stateId})${proj}${asg}${due}${lab}${desc}
</ove>`;
}

/**
 * Format description based on options (full or snippet)
 */
function formatDescription(
  description: string | undefined,
  options: FormattingOptions,
): string {
  if (!description) {
    return '';
  }

  if (options.fullDescriptions === true) {
    return `\n  description: ${description}`;
  }

  const maxLength = options.maxPreviewLength ?? 200;
  const singleLine = description.replace(/\s+/g, ' ').trim();
  const snippet =
    singleLine.length > maxLength ? `${singleLine.slice(0, maxLength)}…` : singleLine;

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















