/**
 * Issue snapshot utilities for tracking state changes
 */

import type { LinearClient } from '@linear/sdk';
import type { IssueSnapshot } from './types.js';

/**
 * Capture a complete snapshot of an issue's current state
 */
export async function captureIssueSnapshot(
  client: LinearClient,
  issueId: string,
): Promise<IssueSnapshot | undefined> {
  try {
    const issue = await client.issue(issueId);
    if (!issue) {
      return undefined;
    }

    const [state, project, assignee, labelsConn] = await Promise.all([
      getState(issue),
      getProject(issue),
      getAssignee(issue),
      getLabels(issue),
    ]);

    const idf = (issue as unknown as { identifier?: string })?.identifier;
    const url = (issue as unknown as { url?: string })?.url;
    const dueDate = (issue as unknown as { dueDate?: string })?.dueDate;
    const priority = (issue as unknown as { priority?: number })?.priority;
    const estimate = (issue as unknown as { estimate?: number })?.estimate;
    const archivedAt = (issue as unknown as { archivedAt?: Date | string | null })
      ?.archivedAt;

    return {
      id: issue.id,
      identifier: idf,
      title: issue.title,
      url,
      stateId: (issue as unknown as { stateId?: string })?.stateId ?? '',
      stateName: state?.name,
      projectId: (issue as unknown as { projectId?: string })?.projectId,
      projectName: project?.name,
      assigneeId: (issue as unknown as { assigneeId?: string })?.assigneeId,
      assigneeName: assignee?.name,
      priority,
      estimate,
      dueDate,
      archivedAt: archivedAt ? String(archivedAt) : undefined,
      labels: labelsConn,
    };
  } catch {
    return undefined;
  }
}

/**
 * Get issue state information
 */
async function getState(
  issue: unknown,
): Promise<{ id?: string; name?: string } | undefined> {
  try {
    const state = await (issue as { state?: Promise<{ id?: string; name?: string }> })
      .state;
    return state;
  } catch {
    return undefined;
  }
}

/**
 * Get issue project information
 */
async function getProject(
  issue: unknown,
): Promise<{ id?: string; name?: string } | undefined> {
  try {
    const project = await (
      issue as { project?: Promise<{ id?: string; name?: string }> }
    ).project;
    return project;
  } catch {
    return undefined;
  }
}

/**
 * Get issue assignee information
 */
async function getAssignee(
  issue: unknown,
): Promise<{ id?: string; name?: string } | undefined> {
  try {
    const assignee = await (
      issue as { assignee?: Promise<{ id?: string; name?: string }> }
    ).assignee;
    return assignee;
  } catch {
    return undefined;
  }
}

/**
 * Get issue labels
 */
async function getLabels(issue: unknown): Promise<Array<{ id: string; name: string }>> {
  try {
    const labelsResponse = await (
      issue as {
        labels: () => Promise<{ nodes: Array<{ id: string; name: string }> }>;
      }
    ).labels();
    return labelsResponse.nodes.map((l) => ({ id: l.id, name: l.name }));
  } catch {
    return [];
  }
}

/**
 * Get state name from an issue object
 */
export async function getStateName(issue: unknown): Promise<string | undefined> {
  try {
    const s = await (issue as { state?: Promise<{ name?: string }> }).state;
    return s?.name;
  } catch {
    return undefined;
  }
}

/**
 * Get project name from an issue object
 */
export async function getProjectName(issue: unknown): Promise<string | undefined> {
  try {
    const p = await (issue as { project?: Promise<{ name?: string }> }).project;
    return p?.name;
  } catch {
    return undefined;
  }
}

/**
 * Get assignee name from an issue object
 */
export async function getAssigneeName(issue: unknown): Promise<string | undefined> {
  try {
    const a = await (issue as { assignee?: Promise<{ name?: string }> }).assignee;
    return a?.name;
  } catch {
    return undefined;
  }
}


























