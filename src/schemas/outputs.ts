import { z } from 'zod';

// ─────────────────────────────────────────────────────────────────────────────
// Shared Meta Schema - Guidance for LLM
// ─────────────────────────────────────────────────────────────────────────────

export const MetaSchema = z
  .object({
    nextSteps: z.array(z.string()).optional(),
    hints: z.array(z.string()).optional(),
    relatedTools: z.array(z.string()).optional(),
  })
  .strict();

// ─────────────────────────────────────────────────────────────────────────────
// Shared Error Schema - Structured errors with recovery hints
// ─────────────────────────────────────────────────────────────────────────────

export const StructuredErrorSchema = z
  .object({
    code: z.string(),
    message: z.string(),
    suggestions: z.array(z.string()).optional(),
    retryable: z.boolean().optional(),
  })
  .strict();

// ─────────────────────────────────────────────────────────────────────────────
// Shared Pagination Schema
// ─────────────────────────────────────────────────────────────────────────────

export const PaginationSchema = z
  .object({
    hasMore: z.boolean(),
    nextCursor: z.string().optional(),
    itemsReturned: z.number(),
    limit: z.number(),
  })
  .strict();

// Legacy PageInfo for backward compatibility
export const PageInfoSchema = z
  .object({
    cursor: z.string().optional(),
    nextCursor: z.string().optional(),
    limit: z.number().optional(),
    total: z.number().optional(),
  })
  .strict();

// ─────────────────────────────────────────────────────────────────────────────
// Issue Schemas
// ─────────────────────────────────────────────────────────────────────────────

export const IssueItemSchema = z
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
  .strict();

export const ListIssuesQuerySchema = z
  .object({
    filter: z.record(z.unknown()).optional(),
    teamId: z.string().optional(),
    projectId: z.string().optional(),
    assignedToMe: z.boolean().optional(),
    keywords: z.array(z.string()).optional(),
    matchMode: z.enum(['all', 'any']).optional(),
    includeArchived: z.boolean().optional(),
    orderBy: z.string().optional(),
    limit: z.number(),
  })
  .strict();

export const ListIssuesOutputSchema = z
  .object({
    query: ListIssuesQuerySchema.optional(),
    items: z.array(IssueItemSchema),
    pagination: PaginationSchema.optional(),
    meta: MetaSchema.optional(),
    // Legacy fields for backward compatibility
    cursor: z.string().optional(),
    nextCursor: z.string().optional(),
    limit: z.number().optional(),
  })
  .strict();
export type ListIssuesOutput = z.infer<typeof ListIssuesOutputSchema>;

export const GetIssueOutputSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    description: z.string().optional(),
    identifier: z.string().optional(),
    url: z.string().optional(),
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

export const GetIssuesResultSchema = z
  .object({
    requestedId: z.string(),
    success: z.boolean(),
    issue: GetIssueOutputSchema.optional(),
    error: StructuredErrorSchema.optional(),
  })
  .strict();

export const GetIssuesOutputSchema = z
  .object({
    results: z.array(GetIssuesResultSchema).min(1),
    summary: z.object({ succeeded: z.number(), failed: z.number() }).strict(),
    meta: MetaSchema.optional(),
  })
  .strict();
export type GetIssuesOutput = z.infer<typeof GetIssuesOutputSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Batch Result Schemas (Create/Update)
// ─────────────────────────────────────────────────────────────────────────────

export const BatchResultSchema = z
  .object({
    // Echo input for context
    input: z.record(z.unknown()).optional(),
    // Result
    success: z.boolean(),
    id: z.string().optional(),
    identifier: z.string().optional(),
    url: z.string().optional(),
    // Error details
    error: StructuredErrorSchema.optional(),
    // Legacy fields
    index: z.number().optional(),
    ok: z.boolean().optional(),
  })
  .strict();

export const BatchSummarySchema = z
  .object({
    total: z.number(),
    succeeded: z.number(),
    failed: z.number(),
    // Legacy fields
    ok: z.number().optional(),
  })
  .strict();

export const CreateIssuesOutputSchema = z
  .object({
    results: z.array(BatchResultSchema),
    summary: BatchSummarySchema,
    meta: MetaSchema.optional(),
  })
  .strict();
export type CreateIssuesOutput = z.infer<typeof CreateIssuesOutputSchema>;

export const UpdateIssuesOutputSchema = CreateIssuesOutputSchema;
export type UpdateIssuesOutput = z.infer<typeof UpdateIssuesOutputSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Project Schemas
// ─────────────────────────────────────────────────────────────────────────────

export const ProjectItemSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    state: z.string(),
    teamId: z.string().optional(),
    leadId: z.string().optional(),
    targetDate: z.string().optional(),
    description: z.string().optional(),
    url: z.string().optional(),
  })
  .strict();

export const ListProjectsQuerySchema = z
  .object({
    filter: z.record(z.unknown()).optional(),
    includeArchived: z.boolean().optional(),
    limit: z.number(),
  })
  .strict();

export const ListProjectsOutputSchema = z
  .object({
    query: ListProjectsQuerySchema.optional(),
    items: z.array(ProjectItemSchema),
    pagination: PaginationSchema.optional(),
    meta: MetaSchema.optional(),
    // Legacy
    cursor: z.string().optional(),
    nextCursor: z.string().optional(),
    limit: z.number().optional(),
  })
  .strict();
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
    url: z.string().optional(),
  })
  .strict();
export type GetProjectOutput = z.infer<typeof GetProjectOutputSchema>;

export const CreateProjectsOutputSchema = z
  .object({
    results: z.array(BatchResultSchema),
    summary: BatchSummarySchema,
    meta: MetaSchema.optional(),
  })
  .strict();
export type CreateProjectsOutput = z.infer<typeof CreateProjectsOutputSchema>;

export const UpdateProjectsOutputSchema = CreateProjectsOutputSchema;
export type UpdateProjectsOutput = z.infer<typeof UpdateProjectsOutputSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Cycle Schemas
// ─────────────────────────────────────────────────────────────────────────────

export const CycleItemSchema = z
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
  .strict();

export const ListCyclesQuerySchema = z
  .object({
    teamId: z.string(),
    includeArchived: z.boolean().optional(),
    orderBy: z.string().optional(),
    limit: z.number(),
  })
  .strict();

export const ListCyclesOutputSchema = z
  .object({
    query: ListCyclesQuerySchema.optional(),
    items: z.array(CycleItemSchema),
    pagination: PaginationSchema.optional(),
    meta: MetaSchema.optional(),
    // Legacy
    cursor: z.string().optional(),
    nextCursor: z.string().optional(),
    limit: z.number().optional(),
  })
  .strict();
export type ListCyclesOutput = z.infer<typeof ListCyclesOutputSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Team Schemas
// ─────────────────────────────────────────────────────────────────────────────

export const TeamItemSchema = z
  .object({
    id: z.string(),
    key: z.string().optional(),
    name: z.string(),
  })
  .strict();

export const ListTeamsOutputSchema = z
  .object({
    items: z.array(TeamItemSchema),
    pagination: PaginationSchema.optional(),
    meta: MetaSchema.optional(),
    // Legacy
    cursor: z.string().optional(),
    nextCursor: z.string().optional(),
    limit: z.number().optional(),
  })
  .strict();
export type ListTeamsOutput = z.infer<typeof ListTeamsOutputSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// User Schemas
// ─────────────────────────────────────────────────────────────────────────────

export const UserItemSchema = z
  .object({
    id: z.string(),
    name: z.string().optional(),
    email: z.string().optional(),
    displayName: z.string().optional(),
    avatarUrl: z.string().optional(),
  })
  .strict();

export const ListUsersOutputSchema = z
  .object({
    items: z.array(UserItemSchema),
    pagination: PaginationSchema.optional(),
    meta: MetaSchema.optional(),
    // Legacy
    cursor: z.string().optional(),
    nextCursor: z.string().optional(),
    limit: z.number().optional(),
  })
  .strict();
export type ListUsersOutput = z.infer<typeof ListUsersOutputSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Comment Schemas
// ─────────────────────────────────────────────────────────────────────────────

export const CommentItemSchema = z
  .object({
    id: z.string(),
    body: z.string().optional(),
    url: z.string().optional(),
    createdAt: z.string(),
    updatedAt: z.string().optional(),
    user: z.object({ id: z.string(), name: z.string().optional() }).optional(),
  })
  .strict();

export const ListCommentsQuerySchema = z
  .object({
    issueId: z.string(),
    limit: z.number(),
  })
  .strict();

export const ListCommentsOutputSchema = z
  .object({
    query: ListCommentsQuerySchema.optional(),
    items: z.array(CommentItemSchema),
    pagination: PaginationSchema.optional(),
    meta: MetaSchema.optional(),
    // Legacy
    cursor: z.string().optional(),
    nextCursor: z.string().optional(),
    limit: z.number().optional(),
  })
  .strict();
export type ListCommentsOutput = z.infer<typeof ListCommentsOutputSchema>;

export const AddCommentsOutputSchema = z
  .object({
    results: z.array(BatchResultSchema),
    summary: BatchSummarySchema,
    meta: MetaSchema.optional(),
  })
  .strict();
export type AddCommentsOutput = z.infer<typeof AddCommentsOutputSchema>;

export const UpdateCommentsOutputSchema = AddCommentsOutputSchema;
export type UpdateCommentsOutput = z.infer<typeof UpdateCommentsOutputSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Workspace Metadata (Account) Schema
// ─────────────────────────────────────────────────────────────────────────────

export const QuickLookupSchema = z
  .object({
    viewerId: z.string().optional(),
    viewerName: z.string().optional(),
    viewerEmail: z.string().optional(),
    teamIds: z.array(z.string()).optional(),
    teamByKey: z.record(z.string()).optional(),
    teamByName: z.record(z.string()).optional(),
    stateIdByName: z.record(z.string()).optional(),
    labelIdByName: z.record(z.string()).optional(),
    projectIdByName: z.record(z.string()).optional(),
  })
  .strict();

export const AccountOutputSchema = z
  .object({
    // Quick lookups for common operations
    quickLookup: QuickLookupSchema.optional(),
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
    meta: MetaSchema.optional(),
  })
  .strict();
export type AccountOutput = z.infer<typeof AccountOutputSchema>;
