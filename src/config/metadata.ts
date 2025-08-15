export const serverMetadata = {
  title: 'Linear',
  instructions: `Use these tools to list and manage Linear issues, projects, teams, and users.

Quick start
- Call 'workspace_metadata' first to fetch canonical identifiers you will reuse across tools. It will include your viewer id: use that as 'assigneeId' when you want to assign items to yourself.
- Then use 'list_issues' with teamId/projectId and filters (or q/keywords) to locate targets. Use 'list_issues' for both discovery and precise lookups (including by id/identifier) — prefer orderBy='updatedAt'.
- To modify, use 'update_issues' / 'update_projects', then verify with 'list_issues'.
- For teams with cycles enabled, use 'list_cycles' to browse planning cycles.

Default recency window
- If a date range is not provided when listing issues, default to the current week in the viewer's timezone (Mon 00:00 → Sun 23:59:59.999), using updatedAt for recency. Mention the timezone surfaced by the client in your reasoning and outputs.

Account identifiers (returned by 'workspace_metadata')
- viewer: { id, name, email, displayName, avatarUrl, timezone, createdAt }
- teams: Array<{ id, key, name, description?, defaultIssueEstimate? }>
- workflowStatesByTeam: Record<teamId, Array<{ id, name, type }>>
- labelsByTeam: Record<teamId, Array<{ id, name, color?, description? }>>
- projects: Array<{ id, name, state, teamId?, leadId?, targetDate?, createdAt }>

How to chain safely
- teamId: filter in 'list_issues'; pass to 'create_issues'; use workflowStatesByTeam[teamId] to find stateId for 'update_issues'.
- projectId: filter in 'list_issues'; pass to create/update issue payloads.
- stateId: set via 'update_issues'. Resolve by name → id using workflowStatesByTeam.
- labelIds: pass to create/update; resolve from labelsByTeam.

Handling assignees and failures
- To assign to yourself, prefer using your viewer id from 'workspace_metadata' as 'assigneeId'.
- If a create or update fails with 'assigneeId ... could not be found', either:
  - Re-run 'workspace_metadata' and verify the correct team/project and user id, or
  - Use 'list_users' to fetch users and pick the right id.

Filtering (list_issues)
  - 'filter' supports GraphQL-style comparators and relationship fields. Comparators: { eq, neq, lt, lte, gt, gte, in, nin, containsIgnoreCase, startsWith, endsWith, null }. Common examples:
  - Team/project: { team: { id: { eq: teamId } } } or { project: { id: { eq: projectId } } }
  - State type: { state: { type: { eq: "started" } } }
  - Assignee email: { assignee: { email: { eqIgnoreCase: "name@acme.com" } } }
  - Title case-insensitive contains: { title: { containsIgnoreCase: "search" } }
  - Labels: { labels: { name: { in: ["Bug", "Defect"] } } }
- Or use q/keywords to match title tokens automatically (case-insensitive OR of tokens).

Pagination
- List tools return { cursor, nextCursor, limit }. Pass nextCursor to fetch the next page.
- Prefer small limits and refine filters instead of broad scans.

Safety & writes
- Do not guess ids. Always take ids from 'workspace_metadata' or a read tool.
- Batch writes default to sequential; keep batches small and verify with 'list_issues'.
- 'update_issues' ignores empty strings (e.g., dueDate: ""): only valid fields are sent.
`,
} as const;

export const toolsMetadata = {
  workspace_metadata: {
    name: 'workspace_metadata',
    title: 'Discover IDs (Use First)',
    description:
      "Use this to discover workspace entities and canonical IDs (viewer, teams, workflow states, labels, projects, favorites). Use this FIRST whenever you don't know ids. Inputs: include? (profile|teams|workflow_states|labels|projects|favorites), teamIds?, project_limit?, label_limit?.\nReturns: viewer, teams[] (with estimation settings and cyclesEnabled), workflowStatesByTeam, labelsByTeam, projects[], favorites?. Next: Use teamId/projectId to filter 'list_issues'; use workflowStatesByTeam[teamId][].id as stateId for 'update_issues'; use labelsByTeam ids for label operations. If a team has cyclesEnabled=false, avoid cycle-related tools.",
  },

  list_issues: {
    name: 'list_issues',
    title: 'List Issues',
    description:
      'List issues in the workspace with powerful filtering and ordering. Inputs: teamId?, projectId?, filter? (IssueFilter), q?/keywords? for title tokens, includeArchived?, orderBy?(updatedAt|createdAt|priority), limit?, cursor?.\nDefaults: If no date filter is provided, default to the current week in the viewer\'s timezone (Mon 00:00 → Sun 23:59:59.999) using updatedAt for recency.\nTitle search: pass q: "payment timeout" (split into tokens with case-insensitive OR), or keywords: ["payment", "timeout"]. Filter is merged with these tokens.\nReturns: { items[], cursor?, nextCursor?, limit? }. Items include id, title, stateId, projectId?, assigneeId?, labels[]. Next: Use \'list_issues\' again to fetch details by id (UUID) or by number+team.key/team.id (limit=1); pass nextCursor to paginate; refine filters using comparators (eq/neq/lt/lte/gt/gte/in/nin, containsIgnoreCase, startsWith/endsWith, null) and relationship fields (e.g., assignee.email, labels.name). Use ids discovered via \'workspace_metadata\'.',
  },
  // removed get_issue (single); use get_issues (batch)
  get_issues: {
    name: 'get_issues',
    title: 'Get Issues (Batch)',
    description:
      "Fetch detailed issues in batch by ids (UUIDs or short ids like ENG-123). Inputs: { ids: string[] }.\nReturns: { results: Array<{ index, ok, id?, identifier?, issue? }>, summary }. Each issue includes assignee, state, project, labels, attachments, and branchName when available. Next: Call 'update_issues' to modify fields or 'list_issues' to discover more.",
  },
  list_my_issues: {
    name: 'list_my_issues',
    title: 'List My Issues',
    description:
      "List issues assigned to the current user with filtering and ordering. Inputs: filter?, q?/keywords?, includeArchived?, orderBy?, limit?, cursor?.\nDefaults: If you don't provide a date window, the CLIENT should default to the current week (Mon 00:00 → Sun 23:59:59.999) using updatedAt in the viewer's timezone.\nTitle search: pass q: \"text\" or keywords: [\"word1\", \"word2\"] (case-insensitive OR on title).\nReturns: Same shape as 'list_issues' for the current viewer's assigned issues. Next: Use 'list_issues' (by id or by number+team.key/team.id, limit=1) for details or 'update_issues' to change state/assignee.",
  },
  create_issues: {
    name: 'create_issues',
    title: 'Create Issues (Batch)',
    description:
      "Create multiple issues in one call. Inputs: { items: Array<{ teamId: string; title: string; description?; stateId?; labelIds?; assigneeId?; projectId?; priority?; estimate?; dueDate?; parentId?; allowZeroEstimate? }>; parallel?; dry_run? }.\nBehavior: Only send fields you intend to set. If 'assigneeId' is omitted, THIS TOOL DEFAULTS it to the current viewer id (from your authenticated context). Invalid numbers are ignored (priority<0 is dropped; estimate<=0 is dropped unless allowZeroEstimate=true or team allows zero estimates). Returns: per-item results with created id/identifier and a summary. Next: verify with 'list_issues' (filter by id or by number+team.key/team.id, limit=1).",
  },
  update_issues: {
    name: 'update_issues',
    title: 'Update Issues (Batch)',
    description:
      "Update issues in batch (state, labels, assignee, metadata). Inputs: { items: Array<{ id: string; title?; description?; stateId?; labelIds?; addLabelIds?; removeLabelIds?; assigneeId?; projectId?; priority?; estimate?; dueDate?; parentId?; archived?; allowZeroEstimate? }>; parallel?; dry_run? }.\nBehavior: Only send fields you intend to change. Empty strings are ignored; priority<0 is ignored; estimate<=0 is ignored unless allowZeroEstimate=true or the issue's team allows zero estimates (auto‑detected). add/removeLabelIds adjusts labels incrementally. This prevents common assignment failures (e.g., invalid estimate=0 when team disallows zero).\nExample: Reassign only → { items: [{ id: 'ISSUE_ID', assigneeId: 'VIEWER_ID' }] }. Returns: per-item results and a summary. Next: 'get_issues' for verification; 'list_issues' to confirm filters/states.",
  },
  list_projects: {
    name: 'list_projects',
    title: 'List Projects',
    description:
      "List projects with filtering and pagination. Inputs: filter? (ProjectFilter: id/state/team/lead/targetDate), includeArchived?, limit?, cursor?. For a single project, set filter.id.eq and limit=1.\nReturns: { items[], cursor?, nextCursor?, limit? } where items include id, name, state, leadId?, teamId?, targetDate?, description?. Next: Use 'update_projects' to modify or 'list_issues' with projectId to find issues.",
  },
  get_project: {
    name: 'get_project',
    title: 'Get Project',
    description:
      "Deprecated in favor of 'list_projects' with filter.id.eq and limit=1.",
  },
  create_projects: {
    name: 'create_projects',
    title: 'Create Projects (Batch)',
    description:
      'Create multiple projects in one call. Inputs: { items: Array<{ name: string; teamId?: string; leadId?: string; description?: string; targetDate?: string; state?: string }> }.\nNotes: team association uses teamIds internally; provide teamId to attach initially. Returns: per-item results and a summary.',
  },
  update_projects: {
    name: 'update_projects',
    title: 'Update Projects (Batch)',
    description:
      "Update multiple projects in one call. Inputs: { items: Array<{ id: string; name?: string; description?: string; targetDate?: string; state?: string; leadId?: string; archived?: boolean }> }.\nReturns: per-item results and a summary. Next: verify with 'list_projects' (filter.id.eq, limit=1); discover via 'list_projects'.",
  },
  list_teams: {
    name: 'list_teams',
    title: 'List Teams',
    description:
      "List teams in the workspace. Inputs: limit?, cursor?.\nReturns: { items: Array<{ id, key?, name }>, cursor?, nextCursor?, limit? }. Next: Use team ids with 'workspace_metadata' (workflowStatesByTeam) and 'list_issues'.",
  },
  list_users: {
    name: 'list_users',
    title: 'List Users',
    description:
      "List users in the workspace. Inputs: limit?, cursor?.\nReturns: { items: Array<{ id, name?, email?, displayName?, avatarUrl? }>, cursor?, nextCursor?, limit? }. Next: Use user ids in 'update_issues' (assigneeId).",
  },
  list_comments: {
    name: 'list_comments',
    title: 'List Comments',
    description:
      'List comments for an issue. Inputs: { issueId, limit?, cursor? }.\nReturns: { items[], cursor?, nextCursor?, limit? } where items include id, body, url?, createdAt, updatedAt?, user{id,name?}. Next: Use add_comments to add context or mention teammates.',
  },
  add_comments: {
    name: 'add_comments',
    title: 'Add Comments (Batch)',
    description:
      'Add one or more comments to issues. Inputs: { items: Array<{ issueId: string; body: string }>, parallel?, dry_run? }.\nReturns: per-item results and a summary. Next: Use list_comments to verify and retrieve the comment URLs.',
  },
  list_cycles: {
    name: 'list_cycles',
    title: 'List Cycles',
    description:
      "List cycles for a team (only if team.cyclesEnabled=true). Inputs: { teamId, includeArchived?, orderBy?(updatedAt|createdAt), limit?, cursor? }.\nReturns: { items[], cursor?, nextCursor?, limit? } where items include id, name?, number?, startsAt?, endsAt?, completedAt?, teamId, status?. Next: Use teamId from 'workspace_metadata' to target the right team; avoid this tool if cyclesEnabled=false.",
  },
} as const;
