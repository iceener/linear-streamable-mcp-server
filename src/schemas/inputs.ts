import { z } from 'zod';

// Account/bootstrap
export const AccountInputSchema = z
  .object({
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
      .optional(),
    teamIds: z.array(z.string()).optional(),
    project_limit: z.number().int().min(1).max(100).optional(),
    label_limit: z.number().int().min(1).max(200).optional(),
  })
  .strict();
export type AccountInput = z.infer<typeof AccountInputSchema>;

// List patterns
const PaginationInput = z
  .object({
    limit: z.number().int().min(1).max(100).optional(),
    cursor: z.string().optional(),
  })
  .strict();

export const ListIssuesInputSchema = PaginationInput.extend({
  filter: z
    .record(z.any())
    .optional()
    .describe(
      "GraphQL-style IssueFilter. If you don't provide a date window, the CLIENT should default to the current week in the viewer's timezone (Mon 00:00 → Sun 23:59:59.999) using updatedAt. Compute the ISO range client-side using viewer.timezone from 'workspace_metadata'.",
    ),
  teamId: z.string().optional(),
  projectId: z.string().optional(),
  includeArchived: z.boolean().optional(),
  orderBy: z
    .enum(['updatedAt', 'createdAt', 'priority'])
    .optional()
    .describe("Default: 'updatedAt' (prefer recency)."),
  // Keyword helpers
  q: z
    .string()
    .optional()
    .describe(
      'Free-text query; splits into keywords and applies title.containsIgnoreCase per token',
    ),
  keywords: z
    .array(z.string())
    .optional()
    .describe('Explicit keywords; applies OR of title.containsIgnoreCase for each'),
  fullDescriptions: z
    .boolean()
    .optional()
    .describe(
      'If true, include full descriptions in the human-readable message block (structuredContent always includes full description).',
    ),
}).strict();
export type ListIssuesInput = z.infer<typeof ListIssuesInputSchema>;

export const GetIssueInputSchema = z.object({ id: z.string() }).strict();
export type GetIssueInput = z.infer<typeof GetIssueInputSchema>;

export const GetIssuesInputSchema = z
  .object({ ids: z.array(z.string()).min(1) })
  .strict();
export type GetIssuesInput = z.infer<typeof GetIssuesInputSchema>;

export const ListMyIssuesInputSchema = PaginationInput.extend({
  filter: z.record(z.any()).optional(),
  includeArchived: z.boolean().optional(),
  orderBy: z.enum(['updatedAt', 'createdAt', 'priority']).optional(),
  q: z.string().optional(),
  keywords: z.array(z.string()).optional(),
  fullDescriptions: z
    .boolean()
    .optional()
    .describe(
      'If true, include full descriptions in the human-readable message block (structuredContent always includes full description).',
    ),
}).strict();
export type ListMyIssuesInput = z.infer<typeof ListMyIssuesInputSchema>;

export const CreateIssuesInputSchema = z
  .object({
    items: z
      .array(
        z
          .object({
            teamId: z.string(),
            title: z.string().min(1),
            description: z.string().optional(),
            stateId: z.string().optional(),
            labelIds: z.array(z.string()).optional(),
            assigneeId: z.string().optional(),
            projectId: z.string().optional(),
            priority: z.enum(['0', '1', '2', '3', '4']).or(z.number()).optional(),
            estimate: z.number().optional(),
            allowZeroEstimate: z
              .boolean()
              .optional()
              .describe(
                'If true and estimate is 0, the tool will send estimate=0. By default, zero estimates are omitted to avoid team validation errors when zeros are disallowed.',
              ),
            dueDate: z.string().optional(),
            parentId: z.string().optional(),
          })
          .strict(),
      )
      .min(1),
    parallel: z.boolean().optional(),
    dry_run: z.boolean().optional(),
  })
  .strict();
export type CreateIssuesInput = z.infer<typeof CreateIssuesInputSchema>;

export const UpdateIssuesInputSchema = z
  .object({
    items: z
      .array(
        z
          .object({
            id: z.string(),
            title: z.string().optional(),
            description: z.string().optional(),
            stateId: z.string().optional(),
            labelIds: z.array(z.string()).optional(),
            addLabelIds: z.array(z.string()).optional(),
            removeLabelIds: z.array(z.string()).optional(),
            assigneeId: z.string().optional(),
            projectId: z.string().optional(),
            priority: z.enum(['0', '1', '2', '3', '4']).or(z.number()).optional(),
            estimate: z.number().optional(),
            allowZeroEstimate: z
              .boolean()
              .optional()
              .describe(
                'If true and estimate is 0, the tool will send estimate=0. By default, zero estimates are omitted to avoid team validation errors when zeros are disallowed.',
              ),
            dueDate: z.string().optional(),
            parentId: z.string().optional(),
            archived: z.boolean().optional(),
          })
          .strict(),
      )
      .min(1),
    parallel: z.boolean().optional(),
    dry_run: z.boolean().optional(),
  })
  .strict();
export type UpdateIssuesInput = z.infer<typeof UpdateIssuesInputSchema>;

export const ListProjectsInputSchema = PaginationInput.extend({
  filter: z
    .record(z.any())
    .optional()
    .describe(
      "GraphQL-style ProjectFilter. Examples: { id: { eq: 'PROJECT_ID' } }, { state: { eq: 'started' } }, { team: { id: { eq: 'TEAM_ID' } } }, { lead: { id: { eq: 'USER_ID' } } }, { targetDate: { lt: 'ISO', gt: 'ISO' } }. For a single project, set filter.id.eq and limit=1.",
    ),
  includeArchived: z
    .boolean()
    .optional()
    .describe('Include archived projects (hidden by default).'),
}).strict();
export type ListProjectsInput = z.infer<typeof ListProjectsInputSchema>;

export const GetProjectInputSchema = z.object({ id: z.string() }).strict();
export type GetProjectInput = z.infer<typeof GetProjectInputSchema>;

export const CreateProjectsInputSchema = z
  .object({
    items: z
      .array(
        z
          .object({
            name: z.string().min(1),
            teamId: z.string().optional(),
            leadId: z.string().optional(),
            description: z.string().optional(),
            targetDate: z.string().optional(),
            state: z.string().optional(),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();
export type CreateProjectsInput = z.infer<typeof CreateProjectsInputSchema>;

export const UpdateProjectsInputSchema = z
  .object({
    items: z
      .array(
        z
          .object({
            id: z.string(),
            name: z.string().optional(),
            description: z.string().optional(),
            targetDate: z.string().optional(),
            state: z.string().optional(),
            leadId: z.string().optional(),
            archived: z.boolean().optional(),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();
export type UpdateProjectsInput = z.infer<typeof UpdateProjectsInputSchema>;

// Teams & Users
export const ListTeamsInputSchema = PaginationInput;
export type ListTeamsInput = z.infer<typeof ListTeamsInputSchema>;

export const ListUsersInputSchema = PaginationInput;
export type ListUsersInput = z.infer<typeof ListUsersInputSchema>;

// Cycles
export const ListCyclesInputSchema = PaginationInput.extend({
  teamId: z.string(),
  includeArchived: z.boolean().optional(),
  orderBy: z.enum(['updatedAt', 'createdAt']).optional(),
}).strict();
export type ListCyclesInput = z.infer<typeof ListCyclesInputSchema>;

// Comments
export const ListCommentsInputSchema = PaginationInput.extend({
  issueId: z.string(),
}).strict();
export type ListCommentsInput = z.infer<typeof ListCommentsInputSchema>;

export const AddCommentsInputSchema = z
  .object({
    items: z
      .array(
        z
          .object({
            issueId: z.string(),
            body: z.string().min(1),
          })
          .strict(),
      )
      .min(1),
    parallel: z.boolean().optional(),
    dry_run: z.boolean().optional(),
  })
  .strict();
export type AddCommentsInput = z.infer<typeof AddCommentsInputSchema>;


