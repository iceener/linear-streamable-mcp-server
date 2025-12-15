/**
 * Workspace Metadata tool - discover IDs, teams, workflow states, labels, projects.
 */

import { z } from 'zod';
import { toolsMetadata } from '../../../config/metadata.js';
import { AccountOutputSchema } from '../../../schemas/outputs.js';
import { getLinearClient } from '../../../services/linear/client.js';
import { previewLinesFromItems, summarizeList } from '../../../utils/messages.js';
import { defineTool, type ToolContext, type ToolResult } from '../types.js';
import { config } from '../../../config/env.js';

const InputSchema = z.object({
  include: z
    .array(
      z.enum([
        'profile',
        'teams',
        'workflow_states',
        'labels',
        'projects',
        'favorites',
      ]),
    )
    .optional()
    .describe(
      "What to include. Defaults to ['profile','teams','workflow_states','labels','projects']. " +
        "'profile' returns viewer (id, name, email, timezone). " +
        "'teams' returns team list with cyclesEnabled flag. " +
        "'workflow_states' returns workflowStatesByTeam[teamId] with state id/name/type. " +
        "'labels' returns labelsByTeam[teamId]. " +
        "'projects' returns project list. " +
        "'favorites' returns user favorites.",
    ),
  teamIds: z
    .array(z.string())
    .optional()
    .describe('Filter to specific team UUIDs. If omitted, fetches all teams.'),
  project_limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe('Max projects per team. Default: 10.'),
  label_limit: z
    .number()
    .int()
    .min(1)
    .max(200)
    .optional()
    .describe('Max labels per team. Default: 50.'),
});

type TeamLike = {
  id: string;
  key?: string;
  name: string;
  description?: string;
  defaultIssueEstimate?: number;
  cyclesEnabled?: boolean;
  issueEstimationAllowZero?: boolean;
  issueEstimationExtended?: boolean;
  issueEstimationType?: string;
  states: () => Promise<{
    nodes: Array<{ id: string; name: string; type?: string }>;
  }>;
  labels: (args: { first: number }) => Promise<{
    nodes: Array<{
      id: string;
      name: string;
      color?: string;
      description?: string;
    }>;
  }>;
  projects: (args: { first: number }) => Promise<{
    nodes: Array<{
      id: string;
      name: string;
      state?: string;
      lead?: { id?: string };
      targetDate?: string;
      createdAt?: Date | string;
    }>;
  }>;
};

export const workspaceMetadataTool = defineTool({
  name: toolsMetadata.workspace_metadata.name,
  title: toolsMetadata.workspace_metadata.title,
  description: toolsMetadata.workspace_metadata.description,
  inputSchema: InputSchema,
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
  },

  handler: async (args, context: ToolContext): Promise<ToolResult> => {
    const include = args.include ?? [
      'profile',
      'teams',
      'workflow_states',
      'labels',
      'projects',
    ];
    const teamIdsFilter = new Set(args.teamIds ?? []);

    const client = await getLinearClient(context);
    const result: Record<string, unknown> = {};

    if (include.includes('profile')) {
      const viewer = await client.viewer;
      result.viewer = {
        id: viewer.id,
        name: viewer.name ?? undefined,
        email: viewer.email ?? undefined,
        displayName: viewer.displayName ?? undefined,
        avatarUrl: viewer.avatarUrl ?? undefined,
        timezone: viewer.timezone ?? undefined,
        createdAt: viewer.createdAt?.toString(),
      };
    }

    let teams: TeamLike[] = [];
    let statesByTeamComputed: Record<
      string,
      Array<{ id: string; name: string; type?: string }>
    > = {};
    let labelsByTeamComputed: Record<
      string,
      Array<{ id: string; name: string; color?: string; description?: string }>
    > = {};
    let projectsLocalCount = 0;

    if (
      include.includes('teams') ||
      include.includes('workflow_states') ||
      include.includes('labels') ||
      include.includes('projects')
    ) {
      if (teamIdsFilter.size) {
        const ids = Array.from(teamIdsFilter);
        const fetched: TeamLike[] = [];
        for (const id of ids) {
          try {
            const t = (await client.team(id)) as unknown as TeamLike;
            fetched.push(t);
          } catch {
            // Non-fatal: continue collecting other teams
          }
        }
        teams = fetched;
      } else {
        const teamConn = (await client.teams({ first: 100 })) as unknown as {
          nodes: TeamLike[];
        };
        teams = teamConn.nodes as TeamLike[];
      }

      if (include.includes('teams')) {
        result.teams = teams.map((t) => ({
          id: t.id,
          key: t.key ?? undefined,
          name: t.name,
          description: t.description ?? undefined,
          defaultIssueEstimate: t.defaultIssueEstimate ?? undefined,
          cyclesEnabled: t.cyclesEnabled,
          issueEstimationAllowZero: t.issueEstimationAllowZero,
          issueEstimationExtended: t.issueEstimationExtended,
          issueEstimationType: t.issueEstimationType,
        }));
      }
    }

    if (include.includes('workflow_states')) {
      const statesByTeam: Record<
        string,
        Array<{ id: string; name: string; type?: string }>
      > = {};
      for (const team of teams) {
        const states = await team.states();
        statesByTeam[team.id] = states.nodes.map((s) => ({
          id: s.id,
          name: s.name,
          type: s.type,
        }));
      }
      statesByTeamComputed = statesByTeam;
      result.workflowStatesByTeam = statesByTeam;
    }

    if (include.includes('labels')) {
      const labelLimit = args.label_limit ?? 50;
      const labelsByTeam: Record<
        string,
        Array<{
          id: string;
          name: string;
          color?: string;
          description?: string;
        }>
      > = {};
      for (const team of teams) {
        const labels = await team.labels({ first: labelLimit });
        labelsByTeam[team.id] = labels.nodes.map((l) => ({
          id: l.id,
          name: l.name,
          color: l.color ?? undefined,
          description: l.description ?? undefined,
        }));
      }
      labelsByTeamComputed = labelsByTeam;
      result.labelsByTeam = labelsByTeam;
    }

    if (include.includes('favorites')) {
      try {
        const favConn = (await client.favorites({ first: 100 })) as unknown as {
          nodes: Array<{
            id: string;
            type?: string;
            url?: string;
            projectId?: string;
            issueId?: string;
          }>;
        };
        result.favorites = favConn.nodes.map((f) => ({
          id: f.id,
          type: f.type,
          url: f.url,
          projectId: f.projectId,
          issueId: f.issueId,
        }));
      } catch {
        // ignore favorites errors; not essential
      }
    }

    if (include.includes('projects')) {
      const limit = args.project_limit ?? 10;
      const projects: Array<Record<string, unknown>> = [];
      for (const team of teams) {
        const conn = await team.projects({ first: limit });
        for (const p of conn.nodes) {
          projects.push({
            id: p.id,
            name: p.name,
            state: p.state,
            leadId: p.lead?.id ?? undefined,
            teamId: team.id,
            targetDate: p.targetDate ?? undefined,
            createdAt: p.createdAt?.toString(),
          });
        }
      }
      result.projects = projects;
      projectsLocalCount = projects.length;
    }

    const summary = {
      teamCount: teams.length,
      stateCount: Object.values(statesByTeamComputed).reduce(
        (acc, arr) => acc + (Array.isArray(arr) ? arr.length : 0),
        0,
      ),
      labelCount: Object.values(labelsByTeamComputed).reduce(
        (acc, arr) => acc + (Array.isArray(arr) ? arr.length : 0),
        0,
      ),
      projectCount: projectsLocalCount,
    };
    result.summary = summary;

    // Build quickLookup for easy access
    const quickLookup: Record<string, unknown> = {};
    if (result.viewer) {
      quickLookup.viewerId = result.viewer.id;
      quickLookup.viewerName = result.viewer.name;
      quickLookup.viewerEmail = result.viewer.email;
    }
    if (teams.length > 0) {
      quickLookup.teamIds = teams.map((t) => t.id);
      quickLookup.teamByKey = Object.fromEntries(
        teams.filter((t) => t.key).map((t) => [t.key, t.id]),
      );
      quickLookup.teamByName = Object.fromEntries(
        teams.map((t) => [t.name, t.id]),
      );
    }
    if (Object.keys(statesByTeamComputed).length > 0) {
      // Flatten all states into a single lookup by name
      const stateIdByName: Record<string, string> = {};
      for (const states of Object.values(statesByTeamComputed)) {
        for (const s of states) {
          stateIdByName[s.name] = s.id;
        }
      }
      quickLookup.stateIdByName = stateIdByName;
    }
    if (Object.keys(labelsByTeamComputed).length > 0) {
      // Flatten all labels into a single lookup by name
      const labelIdByName: Record<string, string> = {};
      for (const labels of Object.values(labelsByTeamComputed)) {
        for (const l of labels) {
          labelIdByName[l.name] = l.id;
        }
      }
      quickLookup.labelIdByName = labelIdByName;
    }
    if (result.projects && Array.isArray(result.projects)) {
      quickLookup.projectIdByName = Object.fromEntries(
        result.projects.map((p: { name: string; id: string }) => [p.name, p.id]),
      );
    }
    result.quickLookup = quickLookup;

    // Build meta
    const meta = {
      nextSteps: [
        'Use quickLookup for fast ID resolution.',
        'Use team IDs with list_issues to fetch issues.',
        'Use stateIdByName to update issue states.',
        'Use labelIdByName for label operations.',
      ],
      relatedTools: ['list_issues', 'create_issues', 'update_issues', 'list_projects'],
    };
    result.meta = meta;

    const structured = AccountOutputSchema.parse(result);
    const parts: Array<{ type: 'text'; text: string }> = [];

    const viewerBit = structured.viewer
      ? `${structured.viewer.displayName ?? structured.viewer.name ?? structured.viewer.id}`
      : `not requested (include 'profile' to fetch viewer)`;
    const viewerIdBit = structured.viewer?.id
      ? ` (viewer.id: ${structured.viewer.id})`
      : '';

    const teamPreview: string[] = Array.isArray(structured.teams)
      ? previewLinesFromItems(
          structured.teams as unknown as Record<string, unknown>[],
          (t) => {
            const id = String(t.id ?? '');
            const key = t.key as string | undefined;
            const name = t.name as string | undefined;
            return `${key ? `${key} — ` : ''}${name ?? id} (${id})`;
          },
        )
      : [];

    const summaryLines: string[] = [];
    summaryLines.push(
      summarizeList({
        subject: 'Teams',
        count: teams.length,
        previewLines: teamPreview,
        nextSteps: ['Use team ids to list issues or workflow states (list_issues).'],
      }),
    );

    if (include.includes('workflow_states') && Object.keys(statesByTeamComputed).length > 0) {
      const statePreviewLines: string[] = [];
      for (const [teamId, states] of Object.entries(statesByTeamComputed)) {
        const team = teams.find((t) => t.id === teamId);
        const teamLabel = team?.key ?? team?.name ?? teamId;
        const statesList = states.map((s) => `${s.name} [${s.type}] → ${s.id}`).join(', ');
        statePreviewLines.push(`${teamLabel}: ${statesList}`);
      }
      summaryLines.push(
        summarizeList({
          subject: 'Workflow States',
          count: summary.stateCount,
          previewLines: statePreviewLines,
        }),
      );
    }

    if (include.includes('projects') && Array.isArray(structured.projects) && structured.projects.length > 0) {
      const projectPreviewLines = (structured.projects as Array<{ id: string; name: string; state?: string }>).map(
        (p) => `${p.name} [${p.state ?? 'unknown'}] → ${p.id}`,
      );
      summaryLines.push(
        summarizeList({
          subject: 'Projects',
          count: structured.projects.length,
          previewLines: projectPreviewLines,
        }),
      );
    }

    parts.push({
      type: 'text',
      text: `Loaded workspace bootstrap for ${viewerBit}${viewerIdBit}. ${summaryLines.join(' ')}`,
    });

    if (config.LINEAR_MCP_INCLUDE_JSON_IN_CONTENT) {
      parts.push({ type: 'text', text: JSON.stringify(structured) });
    }

    return { content: parts, structuredContent: structured };
  },
});







