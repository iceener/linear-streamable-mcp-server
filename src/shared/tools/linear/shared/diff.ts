/**
 * Diff computation and formatting for issue updates
 */

import type { FieldChanges, IssueSnapshot } from './types.js';

/**
 * Compute field changes between before and after snapshots
 */
export function computeFieldChanges(
  before: IssueSnapshot | undefined,
  after: IssueSnapshot,
  requestedFields: Set<string>,
): FieldChanges {
  const changes: FieldChanges = {};

  // Title
  if (requestedFields.has('title') && before?.title !== after.title) {
    changes.title = {
      before: before?.title ?? '—',
      after: after.title ?? '—',
    };
  }

  // State
  if (
    requestedFields.has('stateId') &&
    (before?.stateName ?? '') !== (after.stateName ?? '')
  ) {
    changes.state = {
      before: before?.stateName ?? '—',
      after: after.stateName ?? '—',
    };
  }

  // Assignee
  if (
    requestedFields.has('assigneeId') &&
    (before?.assigneeName ?? '') !== (after.assigneeName ?? '')
  ) {
    changes.assignee = {
      before: before?.assigneeName ?? '—',
      after: after.assigneeName ?? '—',
    };
  }

  // Project
  if (
    requestedFields.has('projectId') &&
    (before?.projectName ?? '') !== (after.projectName ?? '')
  ) {
    changes.project = {
      before: before?.projectName ?? '—',
      after: after.projectName ?? '—',
    };
  }

  // Priority
  if (
    requestedFields.has('priority') &&
    (before?.priority ?? '—') !== (after.priority ?? '—')
  ) {
    changes.priority = {
      before: before?.priority ?? '—',
      after: after.priority ?? '—',
    };
  }

  // Estimate
  if (
    requestedFields.has('estimate') &&
    (before?.estimate ?? '—') !== (after.estimate ?? '—')
  ) {
    changes.estimate = {
      before: before?.estimate ?? '—',
      after: after.estimate ?? '—',
    };
  }

  // Due date
  if (
    requestedFields.has('dueDate') &&
    (before?.dueDate ?? '—') !== (after.dueDate ?? '—')
  ) {
    changes.dueDate = {
      before: before?.dueDate ?? '—',
      after: after.dueDate ?? '—',
    };
  }

  // Labels
  if (
    requestedFields.has('labelIds') ||
    requestedFields.has('addLabelIds') ||
    requestedFields.has('removeLabelIds')
  ) {
    const labelsDiff = computeLabelsDiff(before?.labels ?? [], after.labels);
    if (labelsDiff.added.length > 0 || labelsDiff.removed.length > 0) {
      changes.labels = labelsDiff;
    }
  }

  // Archive status
  if (requestedFields.has('archived')) {
    const beforeArchived = Boolean(before?.archivedAt);
    const afterArchived = Boolean(after.archivedAt);
    if (beforeArchived !== afterArchived) {
      changes.archived = {
        before: beforeArchived,
        after: afterArchived,
      };
    }
  }

  return changes;
}

/**
 * Compute labels diff (added/removed)
 */
function computeLabelsDiff(
  before: Array<{ id: string; name: string }>,
  after: Array<{ id: string; name: string }>,
): { added: string[]; removed: string[] } {
  const beforeNames = new Set(before.map((l) => l.name));
  const afterNames = new Set(after.map((l) => l.name));

  const added: string[] = [];
  const removed: string[] = [];

  for (const name of afterNames) {
    if (!beforeNames.has(name)) {
      added.push(name);
    }
  }

  for (const name of beforeNames) {
    if (!afterNames.has(name)) {
      removed.push(name);
    }
  }

  return { added, removed };
}

/**
 * Format a diff line for an issue update
 */
export function formatDiffLine(issue: IssueSnapshot, changes: FieldChanges): string {
  const idf = issue.identifier ?? issue.id;
  const title = issue.url
    ? `[${idf} — ${issue.title}](${issue.url})`
    : `${idf} — ${issue.title}`;

  const header = `- ${title} (id ${issue.id})`;

  const changeParts: string[] = [];

  if (changes.title) {
    changeParts.push(`Title: ${changes.title.before} → ${changes.title.after}`);
  }

  if (changes.state) {
    changeParts.push(`State: ${changes.state.before} → ${changes.state.after}`);
  }

  if (changes.assignee) {
    changeParts.push(
      `Assignee: ${changes.assignee.before} → ${changes.assignee.after}`,
    );
  }

  if (changes.project) {
    changeParts.push(`Project: ${changes.project.before} → ${changes.project.after}`);
  }

  if (changes.priority) {
    changeParts.push(
      `Priority: ${changes.priority.before} → ${changes.priority.after}`,
    );
  }

  if (changes.estimate) {
    changeParts.push(
      `Estimate: ${changes.estimate.before} → ${changes.estimate.after}`,
    );
  }

  if (changes.dueDate) {
    changeParts.push(`Due date: ${changes.dueDate.before} → ${changes.dueDate.after}`);
  }

  if (changes.labels) {
    const parts: string[] = [];
    if (changes.labels.added.length > 0) {
      parts.push(`+${changes.labels.added.join(', ')}`);
    }
    if (changes.labels.removed.length > 0) {
      parts.push(`−${changes.labels.removed.join(', ')}`);
    }
    if (parts.length > 0) {
      changeParts.push(`Labels: ${parts.join('; ')}`);
    }
  }

  if (changes.archived) {
    changeParts.push(
      `Archived: ${changes.archived.before ? 'Yes' : 'No'} → ${
        changes.archived.after ? 'Yes' : 'No'
      }`,
    );
  }

  if (changeParts.length === 0) {
    return header;
  }

  return `${header}\n  ${changeParts.join('\n  ')}`;
}















