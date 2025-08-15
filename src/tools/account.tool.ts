import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { config } from '../config/env.ts';
import { toolsMetadata } from '../config/metadata.ts';
import { AccountInputSchema } from '../schemas/inputs.ts';
import { AccountOutputSchema } from '../schemas/outputs.ts';
import { getLinearClient } from '../services/linear-client.ts';
import { previewLinesFromItems, summarizeList } from '../utils/messages.ts';

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

export const accountTool = {
  name: toolsMetadata.workspace_metadata.name,
  title: toolsMetadata.workspace_metadata.title,
  description: toolsMetadata.workspace_metadata.description,
  inputSchema: AccountInputSchema.shape,
  handler: async (args: unknown): Promise<CallToolResult> => {
    const parsed = AccountInputSchema.safeParse(args);
    if (!parsed.success) {
      return {
        isError: true,
        content: [{ type: 'text', text: parsed.error.message }],
      };
    }
    const include = parsed.data.include ?? [
      'profile',
      'teams',
      'workflow_states',
      'labels',
      'projects',
    ];
    const teamIdsFilter = new Set(parsed.data.teamIds ?? []);

    const client = getLinearClient();

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
          } catch (_error) {
            // Non-fatal: continue collecting other teams
            // Consider exposing partial errors in structured content in the future
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
          cyclesEnabled: (t as Record<string, unknown>)?.cyclesEnabled as
            | boolean
            | undefined,
          issueEstimationAllowZero: (t as Record<string, unknown>)
            ?.issueEstimationAllowZero as boolean | undefined,
          issueEstimationExtended: (t as Record<string, unknown>)
            ?.issueEstimationExtended as boolean | undefined,
          issueEstimationType: (t as Record<string, unknown>)?.issueEstimationType as
            | string
            | undefined,
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
        statesByTeam[team.id] = states.nodes.map(
          (s: { id: string; name: string; type?: string }) => ({
            id: s.id,
            name: s.name,
            type: s.type,
          }),
        );
      }
      statesByTeamComputed = statesByTeam;
      result.workflowStatesByTeam = statesByTeam;
    }

    if (include.includes('labels')) {
      const labelLimit = parsed.data.label_limit ?? 50;
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
        labelsByTeam[team.id] = labels.nodes.map(
          (l: { id: string; name: string; color?: string; description?: string }) => ({
            id: l.id,
            name: l.name,
            color: l.color ?? undefined,
            description: l.description ?? undefined,
          }),
        );
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
            labelId?: string;
            userId?: string;
            predefinedViewTeamId?: string;
            customViewId?: string;
            folderName?: string;
          }>;
        };
        result.favorites = favConn.nodes.map((f) => ({
          id: f.id,
          type: (f as unknown as { type?: string }).type,
          url: (f as unknown as { url?: string }).url,
          projectId: (f as unknown as { projectId?: string }).projectId,
          issueId: (f as unknown as { issueId?: string }).issueId,
          labelId: (f as unknown as { labelId?: string }).labelId,
          userId: (f as unknown as { userId?: string }).userId,
          teamId: (f as unknown as { predefinedViewTeamId?: string })
            .predefinedViewTeamId,
          customViewId: (f as unknown as { customViewId?: string }).customViewId,
          folderName: (f as unknown as { folderName?: string }).folderName,
        }));
      } catch (_error) {
        // ignore favorites errors; not essential for bootstrap
      }
    }

    if (include.includes('projects')) {
      const limit = parsed.data.project_limit ?? 10;
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

    const structured = AccountOutputSchema.parse(result);
    const parts: Array<{ type: 'text'; text: string }> = [];
    const viewerBit = structured.viewer
      ? `${
          structured.viewer.displayName ??
          structured.viewer.name ??
          structured.viewer.id
        }`
      : `not requested (include 'profile' to fetch viewer)`;
    const viewerIdBit = structured.viewer?.id
      ? ` (viewer.id: ${structured.viewer.id})`
      : '';

    const teamPreview: string[] = Array.isArray(structured.teams)
      ? previewLinesFromItems(
          structured.teams as unknown as Record<string, unknown>[],
          (t) => {
            const id = String((t.id as string) ?? '');
            const key = (t.key as string | undefined) ?? undefined;
            const name = (t.name as string | undefined) ?? undefined;
            return `${key ? `${key} — ` : ''}${name ?? id} (${id})`;
          },
        )
      : [];

    const summaryLines: string[] = [];
    summaryLines.push(
      summarizeList({
        subject: 'Teams',
        count: teams.length as number,
        previewLines: teamPreview,
        nextSteps: ['Use team ids to list issues or workflow states (list_issues).'],
      }),
    );
    // Workflow states summary (first team preview)
    const statesByTeam = structured.workflowStatesByTeam as
      | Record<string, Array<{ id: string; name: string; type?: string }>>
      | undefined;
    if (statesByTeam && Object.keys(statesByTeam).length > 0) {
      const teamIds = Object.keys(statesByTeam);
      const totalStates = Object.values(statesByTeam).reduce(
        (acc, arr) => acc + (Array.isArray(arr) ? arr.length : 0),
        0,
      );
      const firstTeamId = teamIds[0] as string | undefined;
      const firstTeam = (structured.teams ?? []).find((t) => t.id === firstTeamId);
      const firstTeamLabel = firstTeam
        ? `${firstTeam.key ? `${firstTeam.key} — ` : ''}${firstTeam.name} (${
            firstTeam.id
          })`
        : (firstTeamId ?? '');
      const firstStates = firstTeamId ? (statesByTeam[firstTeamId] ?? []) : [];
      const findByType = (t: string) =>
        firstStates.find(
          (s: { type?: string; name: string }) => (s.type ?? '').toLowerCase() === t,
        );
      const started = findByType('started');
      const completed =
        findByType('completed') ||
        firstStates.find((s: { name: string }) => s.name.toLowerCase() === 'done');
      const backlog = findByType('backlog');
      const canceled = findByType('canceled');
      const keyBits: string[] = [];
      if (started) {
        keyBits.push(`Started: ${started.name} (${started.id})`);
      }
      if (completed) {
        keyBits.push(`Done: ${completed.name} (${completed.id})`);
      }
      if (backlog) {
        keyBits.push(`Backlog: ${backlog.name} (${backlog.id})`);
      }
      if (canceled) {
        keyBits.push(`Canceled: ${canceled.name} (${canceled.id})`);
      }
      const statePreview = keyBits.join(', ');
      summaryLines.push(
        `Workflow states: ${totalStates} across ${teamIds.length} team(s). ${
          statePreview ? `Key (${firstTeamLabel}): ${statePreview}.` : ''
        } Use workflowStatesByTeam[teamId] for the full list and to resolve stateId.`,
      );
    }
    // Labels summary (first team preview)
    const labelsByTeam = structured.labelsByTeam as
      | Record<
          string,
          Array<{
            id: string;
            name: string;
            color?: string;
            description?: string;
          }>
        >
      | undefined;
    if (labelsByTeam && Object.keys(labelsByTeam).length > 0) {
      const teamIds = Object.keys(labelsByTeam);
      const totalLabels = Object.values(labelsByTeam).reduce(
        (acc, arr) => acc + (Array.isArray(arr) ? arr.length : 0),
        0,
      );
      const firstTeamId = teamIds[0] as string | undefined;
      const firstTeam = teams.find((t) => t.id === firstTeamId);
      const firstTeamLabel = firstTeam
        ? `${firstTeam.key ? `${firstTeam.key} — ` : ''}${firstTeam.name} (${
            firstTeam.id
          })`
        : (firstTeamId ?? '');
      const firstLabels = firstTeamId ? (labelsByTeam[firstTeamId] ?? []) : [];
      const sample = firstLabels
        .slice(0, 10)
        .map((l) => l.name)
        .join(', ');
      summaryLines.push(
        `Labels: ${totalLabels} across ${teamIds.length} team(s). ${
          sample ? `Key (${firstTeamLabel}): ${sample}.` : ''
        } Use labelsByTeam[teamId] to resolve labelIds for create/update operations.`,
      );
    }
    if (Array.isArray(structured.projects)) {
      const projectPreview = previewLinesFromItems(
        structured.projects as unknown as Record<string, unknown>[],
        (p) => {
          const id = String((p.id as string) ?? '');
          const name = (p.name as string | undefined) ?? id;
          const state = (p.state as string | undefined) ?? '';
          const teamId = (p.teamId as string | undefined) ?? undefined;
          const target = (p.targetDate as string | undefined) ?? undefined;
          const parts: string[] = [`state ${state}`];
          if (teamId) {
            parts.push(`team ${teamId}`);
          }
          if (target) {
            parts.push(`target ${target}`);
          }
          return `${name} (${id}) — ${parts.join('; ')}`;
        },
      );
      summaryLines.push(
        summarizeList({
          subject: 'Projects',
          count: structured.projects.length,
          previewLines: projectPreview,
          nextSteps: [
            'Use ids with get_project or list_issues(projectId) to discover issues; use update_projects to modify.',
          ],
        }),
      );
    }
    if (Array.isArray((structured as unknown as Record<string, unknown>).favorites)) {
      summaryLines.push(
        `Favorites: ${
          ((structured as unknown as Record<string, unknown>).favorites as unknown[])
            .length
        }.`,
      );
    }

    parts.push({
      type: 'text',
      text: `Loaded workspace bootstrap for ${viewerBit}${viewerIdBit}. ${summaryLines.join(
        ' ',
      )}`,
    });
    if (config.LINEAR_MCP_INCLUDE_JSON_IN_CONTENT) {
      parts.push({ type: 'text', text: JSON.stringify(structured) });
    }

    return { content: parts, structuredContent: structured };
  },
};
