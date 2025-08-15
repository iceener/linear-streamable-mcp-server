import { z } from 'zod';

// Shared list output shape
export const PageInfoSchema = z
  .object({
    cursor: z.string().optional(),
    nextCursor: z.string().optional(),
    limit: z.number().optional(),
    total: z.number().optional(),
  })
  .strict();

export const ListIssuesOutputSchema = z
  .object({
    items: z.array(
      z
        .object({
          id: z.string(),
          identifier: z.string().optional(),
          title: z.string(),
          description: z.string().optional(),
          priority: z.number().optional(),
          estimate: z.number().optional(),
          stateId: z.string(),
          stateName: z.string().optional(),
          projectId: z.string().optional(),
          projectName: z.string().optional(),
          assigneeId: z.string().optional(),
          assigneeName: z.string().optional(),
          createdAt: z.string(),
          updatedAt: z.string(),
          archivedAt: z.string().optional(),
          dueDate: z.string().optional(),
          url: z.string().optional(),
          labels: z.array(z.object({ id: z.string(), name: z.string() })).default([]),
        })
        .strict(),
    ),
  })
  .merge(PageInfoSchema);
export type ListIssuesOutput = z.infer<typeof ListIssuesOutputSchema>;

export const GetIssueOutputSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    description: z.string().optional(),
    identifier: z.string().optional(),
    assignee: z.object({ id: z.string(), name: z.string().optional() }).optional(),
    state: z
      .object({ id: z.string(), name: z.string(), type: z.string().optional() })
      .optional(),
    project: z.object({ id: z.string(), name: z.string().optional() }).optional(),
    labels: z.array(z.object({ id: z.string(), name: z.string() })).default([]),
    branchName: z.string().optional(),
    attachments: z.array(z.unknown()).optional(),
  })
  .strict();
export type GetIssueOutput = z.infer<typeof GetIssueOutputSchema>;

export const GetIssuesOutputSchema = z
  .object({
    results: z
      .array(
        z
          .object({
            index: z.number(),
            ok: z.boolean(),
            id: z.string().optional(),
            identifier: z.string().optional(),
            error: z.string().optional(),
            code: z.string().optional(),
            issue: GetIssueOutputSchema.optional(),
          })
          .strict(),
      )
      .min(1),
    summary: z.object({ ok: z.number(), failed: z.number() }).strict(),
  })
  .strict();
export type GetIssuesOutput = z.infer<typeof GetIssuesOutputSchema>;

export const BatchResultSchema = z
  .object({
    index: z.number(),
    ok: z.boolean(),
    id: z.string().optional(),
    identifier: z.string().optional(),
    error: z.string().optional(),
    code: z.string().optional(),
  })
  .strict();

export const BatchSummarySchema = z
  .object({ ok: z.number(), failed: z.number() })
  .strict();

export const CreateIssuesOutputSchema = z
  .object({ results: z.array(BatchResultSchema), summary: BatchSummarySchema })
  .strict();
export type CreateIssuesOutput = z.infer<typeof CreateIssuesOutputSchema>;

export const UpdateIssuesOutputSchema = CreateIssuesOutputSchema;
export type UpdateIssuesOutput = z.infer<typeof UpdateIssuesOutputSchema>;

export const ListProjectsOutputSchema = z
  .object({
    items: z.array(
      z
        .object({
          id: z.string(),
          name: z.string(),
          state: z.string(),
          teamId: z.string().optional(),
          leadId: z.string().optional(),
          targetDate: z.string().optional(),
          description: z.string().optional(),
        })
        .strict(),
    ),
  })
  .merge(PageInfoSchema);
export type ListProjectsOutput = z.infer<typeof ListProjectsOutputSchema>;

export const GetProjectOutputSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    description: z.string().optional(),
    state: z.string(),
    teamId: z.string().optional(),
    leadId: z.string().optional(),
    targetDate: z.string().optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .strict();
export type GetProjectOutput = z.infer<typeof GetProjectOutputSchema>;

export const CreateProjectsOutputSchema = z
  .object({ results: z.array(BatchResultSchema), summary: BatchSummarySchema })
  .strict();
export type CreateProjectsOutput = z.infer<typeof CreateProjectsOutputSchema>;

export const UpdateProjectsOutputSchema = CreateProjectsOutputSchema;
export type UpdateProjectsOutput = z.infer<typeof UpdateProjectsOutputSchema>;

export const ListCyclesOutputSchema = z
  .object({
    items: z.array(
      z
        .object({
          id: z.string(),
          name: z.string().optional(),
          number: z.number().optional(),
          startsAt: z.string().optional(),
          endsAt: z.string().optional(),
          completedAt: z.string().optional(),
          teamId: z.string(),
          status: z.string().optional(),
        })
        .strict(),
    ),
  })
  .merge(PageInfoSchema);
export type ListCyclesOutput = z.infer<typeof ListCyclesOutputSchema>;

export const ListTeamsOutputSchema = z
  .object({
    items: z.array(
      z
        .object({
          id: z.string(),
          key: z.string().optional(),
          name: z.string(),
        })
        .strict(),
    ),
  })
  .merge(PageInfoSchema);
export type ListTeamsOutput = z.infer<typeof ListTeamsOutputSchema>;

export const ListUsersOutputSchema = z
  .object({
    items: z.array(
      z
        .object({
          id: z.string(),
          name: z.string().optional(),
          email: z.string().optional(),
          displayName: z.string().optional(),
          avatarUrl: z.string().optional(),
        })
        .strict(),
    ),
  })
  .merge(PageInfoSchema);
export type ListUsersOutput = z.infer<typeof ListUsersOutputSchema>;

export const AccountOutputSchema = z
  .object({
    viewer: z
      .object({
        id: z.string(),
        name: z.string().optional(),
        email: z.string().optional(),
        displayName: z.string().optional(),
        avatarUrl: z.string().optional(),
        timezone: z.string().optional(),
        createdAt: z.string().optional(),
      })
      .strict()
      .optional(),
    teams: z
      .array(
        z
          .object({
            id: z.string(),
            key: z.string().optional(),
            name: z.string(),
            description: z.string().optional(),
            defaultIssueEstimate: z.number().optional(),
            cyclesEnabled: z.boolean().optional(),
            issueEstimationAllowZero: z.boolean().optional(),
            issueEstimationExtended: z.boolean().optional(),
            issueEstimationType: z.string().optional(),
          })
          .strict(),
      )
      .optional(),
    workflowStatesByTeam: z
      .record(
        z.array(
          z.object({ id: z.string(), name: z.string(), type: z.string() }).strict(),
        ),
      )
      .optional(),
    labelsByTeam: z
      .record(
        z.array(
          z
            .object({
              id: z.string(),
              name: z.string(),
              color: z.string().optional(),
              description: z.string().optional(),
            })
            .strict(),
        ),
      )
      .optional(),
    projects: z
      .array(
        z
          .object({
            id: z.string(),
            name: z.string(),
            state: z.string(),
            leadId: z.string().optional(),
            teamId: z.string().optional(),
            targetDate: z.string().optional(),
            createdAt: z.string().optional(),
          })
          .strict(),
      )
      .optional(),
    favorites: z.unknown().optional(),
    summary: z
      .object({
        teamCount: z.number(),
        stateCount: z.number(),
        labelCount: z.number(),
        projectCount: z.number(),
      })
      .strict(),
  })
  .strict();
export type AccountOutput = z.infer<typeof AccountOutputSchema>;

export const ListCommentsOutputSchema = z
  .object({
    items: z.array(
      z
        .object({
          id: z.string(),
          body: z.string().optional(),
          url: z.string().optional(),
          createdAt: z.string(),
          updatedAt: z.string().optional(),
          user: z.object({ id: z.string(), name: z.string().optional() }).optional(),
        })
        .strict(),
    ),
  })
  .merge(PageInfoSchema);
export type ListCommentsOutput = z.infer<typeof ListCommentsOutputSchema>;

export const AddCommentsOutputSchema = z
  .object({ results: z.array(BatchResultSchema), summary: BatchSummarySchema })
  .strict();
export type AddCommentsOutput = z.infer<typeof AddCommentsOutputSchema>;
