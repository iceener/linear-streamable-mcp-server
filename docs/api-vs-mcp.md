# Linear MCP vs Linear Native API Comparison

Note: This document was generated based on src/ and linear-sdk.

This document compares the capabilities of the Linear MCP tools against the native Linear API/SDK.

## Quick Reference: MCP Tools

| Tool | Type | Description |
|------|------|-------------|
| `workspace_metadata` | Read | Discover IDs, teams, states, labels, projects |
| `list_issues` | Read | Search/filter issues with GraphQL filters (use `assignedToMe: true` for your issues) |
| `get_issues` | Read | Batch fetch issues by ID/identifier |
| `create_issues` | Write | Batch create issues |
| `update_issues` | Write | Batch update issues |
| `list_teams` | Read | List workspace teams |
| `list_users` | Read | List workspace users |
| `list_comments` | Read | List comments on an issue |
| `add_comments` | Write | Batch add comments |
| `update_comments` | Write | Batch update comments |
| `list_cycles` | Read | List team cycles |
| `list_projects` | Read | List projects with filtering |
| `create_projects` | Write | Batch create projects |
| `update_projects` | Write | Batch update projects |

---

## 1. Actions Comparison: Linear API vs MCP

### Issues

| Action | Linear Native SDK | MCP Tool | Notes |
|--------|-------------------|----------|-------|
| Create issue | `createIssue()` | `create_issues` | MCP adds batch support (up to 50), dry_run, human-readable inputs (stateName, labelNames, assigneeName) |
| Update issue | `updateIssue()` | `update_issues` | MCP adds batch support, incremental label ops (addLabelNames, removeLabelNames), dry_run |
| Update issues batch | `updateIssueBatch()` | `update_issues` | MCP wraps this with enhanced UX |
| Delete issue | `deleteIssue()` | ❌ Not implemented | Safety concern - intentionally omitted |
| Archive issue | `archiveIssue()` | `update_issues { archived: true }` | Wrapped in update_issues |
| Unarchive issue | `unarchiveIssue()` | `update_issues { archived: false }` | Wrapped in update_issues |
| Get issue | `issue()` | `get_issues` | MCP adds batch lookup by UUID or identifier (ENG-123) |
| List issues | `issues()` | `list_issues` | MCP adds keyword search (q/keywords), detail levels, assignedToMe shortcut, GraphQL filter validation |
| List my issues | `issues({ filter: assignee })` | `list_issues { assignedToMe: true }` | Use `assignedToMe: true` parameter |
| Add label to issue | `issueAddLabel()` | `update_issues { addLabelIds }` | Wrapped in update_issues |
| Remove label from issue | `issueRemoveLabel()` | `update_issues { removeLabelIds }` | Wrapped in update_issues |
| Subscribe to issue | `issueSubscribe()` | ❌ Not implemented | |
| Unsubscribe from issue | `issueUnsubscribe()` | ❌ Not implemented | |
| Set issue reminder | `issueReminder()` | ❌ Not implemented | |

### Comments

| Action | Linear Native SDK | MCP Tool | Notes |
|--------|-------------------|----------|-------|
| Create comment | `createComment()` | `add_comments` | MCP adds batch support |
| Update comment | `updateComment()` | `update_comments` | MCP adds batch support |
| Delete comment | `deleteComment()` | ❌ Not implemented | Safety concern |
| List comments | `issue.comments()` | `list_comments` | |

### Projects

| Action | Linear Native SDK | MCP Tool | Notes |
|--------|-------------------|----------|-------|
| Create project | `createProject()` | `create_projects` | MCP adds batch support |
| Update project | `updateProject()` | `update_projects` | MCP adds batch support |
| Delete project | `deleteProject()` | ❌ Not implemented | Safety concern |
| Archive project | `archiveProject()` | `update_projects { archived: true }` | Wrapped in update_projects |
| Unarchive project | `unarchiveProject()` | `update_projects { archived: false }` | Wrapped in update_projects |
| List projects | `projects()` | `list_projects` | |
| Add label to project | `projectAddLabel()` | ❌ Not implemented | |
| Remove label from project | `projectRemoveLabel()` | ❌ Not implemented | |

### Project Milestones

| Action | Linear Native SDK | MCP Tool | Notes |
|--------|-------------------|----------|-------|
| Create milestone | `createProjectMilestone()` | ❌ Not implemented | |
| Update milestone | `updateProjectMilestone()` | ❌ Not implemented | |
| Delete milestone | `deleteProjectMilestone()` | ❌ Not implemented | |

### Project Updates (Status Updates)

| Action | Linear Native SDK | MCP Tool | Notes |
|--------|-------------------|----------|-------|
| Create project update | `createProjectUpdate()` | ❌ Not implemented | |
| Update project update | `updateProjectUpdate()` | ❌ Not implemented | |
| Delete project update | `deleteProjectUpdate()` | ❌ Not implemented | |
| Archive project update | `archiveProjectUpdate()` | ❌ Not implemented | |

### Cycles

| Action | Linear Native SDK | MCP Tool | Notes |
|--------|-------------------|----------|-------|
| Create cycle | `createCycle()` | ❌ Not implemented | |
| Update cycle | `updateCycle()` | ❌ Not implemented | |
| List cycles | `team.cycles()` | `list_cycles` | MCP checks if cycles are enabled for team |

### Teams

| Action | Linear Native SDK | MCP Tool | Notes |
|--------|-------------------|----------|-------|
| Create team | `createTeam()` | ❌ Not implemented | Admin operation |
| Update team | `updateTeam()` | ❌ Not implemented | Admin operation |
| Delete team | `deleteTeam()` | ❌ Not implemented | Admin operation |
| List teams | `teams()` | `list_teams` | |

### Users

| Action | Linear Native SDK | MCP Tool | Notes |
|--------|-------------------|----------|-------|
| Get viewer | `viewer` | `workspace_metadata` | Included in workspace_metadata response |
| List users | `users()` | `list_users` | |
| Update user | `updateUser()` | ❌ Not implemented | |

### Labels (Issue Labels)

| Action | Linear Native SDK | MCP Tool | Notes |
|--------|-------------------|----------|-------|
| Create label | `createIssueLabel()` | ❌ Not implemented | |
| Update label | `updateIssueLabel()` | ❌ Not implemented | |
| Delete label | `deleteIssueLabel()` | ❌ Not implemented | |
| Merge labels | `issueLabelsMerge()` | ❌ Not implemented | |
| List labels | `issueLabels()` | `workspace_metadata` | Returned in labelsByTeam |

### Workflow States

| Action | Linear Native SDK | MCP Tool | Notes |
|--------|-------------------|----------|-------|
| Create state | `createWorkflowState()` | ❌ Not implemented | |
| Update state | `updateWorkflowState()` | ❌ Not implemented | |
| Delete state | `deleteWorkflowState()` | ❌ Not implemented | |
| Archive state | `archiveWorkflowState()` | ❌ Not implemented | |
| List states | `workflowStates()` | `workspace_metadata` | Returned in workflowStatesByTeam |

### Issue Relations

| Action | Linear Native SDK | MCP Tool | Notes |
|--------|-------------------|----------|-------|
| Create relation | `createIssueRelation()` | ❌ Not implemented | |
| Update relation | `updateIssueRelation()` | ❌ Not implemented | |
| Delete relation | `deleteIssueRelation()` | ❌ Not implemented | |

### Attachments

| Action | Linear Native SDK | MCP Tool | Notes |
|--------|-------------------|----------|-------|
| Create attachment | `createAttachment()` | ❌ Not implemented | |
| Update attachment | `updateAttachment()` | ❌ Not implemented | |
| Delete attachment | `deleteAttachment()` | ❌ Not implemented | |

### Roadmaps

| Action | Linear Native SDK | MCP Tool | Notes |
|--------|-------------------|----------|-------|
| Create roadmap | `createRoadmap()` | ❌ Not implemented | |
| Update roadmap | `updateRoadmap()` | ❌ Not implemented | |
| Delete roadmap | `deleteRoadmap()` | ❌ Not implemented | |
| Archive roadmap | `archiveRoadmap()` | ❌ Not implemented | |

### Notifications

| Action | Linear Native SDK | MCP Tool | Notes |
|--------|-------------------|----------|-------|
| Update notification | `updateNotification()` | ❌ Not implemented | |
| Archive notification | `archiveNotification()` | ❌ Not implemented | |
| Create subscription | `createNotificationSubscription()` | ❌ Not implemented | |

---

## 2. Request Payloads: Linear Native vs MCP

### Create Issue

LLM-focused differences: MCP uses batch `items[]` (up to 50) and supports `dry_run` so the agent can validate without writing. MCP accepts human-friendly fields (`stateName`/`stateType`, `labelNames`, `assigneeName`/`assigneeEmail`, `projectName`, priority strings) and resolves them to IDs/integers. If `assignee*` is omitted, it defaults to the current viewer. MCP intentionally omits many native-only fields (e.g. `descriptionData`, `createAsUser`, `cycleId`) to keep the schema small.

**Linear Native SDK (`IssueCreateInput`):**
```typescript
{
  teamId: string;          // Required
  title?: string;
  description?: string;
  assigneeId?: string;
  stateId?: string;
  priority?: number;       // 0-4 only
  estimate?: number;
  labelIds?: string[];
  removedLabelIds?: string[];
  projectId?: string;
  cycleId?: string;
  parentId?: string;
  dueDate?: string;
  // Additional fields:
  completedAt?: DateTime;
  createdAt?: DateTime;
  delegateId?: string;
  descriptionData?: JSON;  // Prosemirror format
  displayIconUrl?: string;
  id?: string;             // UUID v4 for custom ID
  lastAppliedTemplateId?: string;
  createAsUser?: string;   // OAuth app mode
}
```

**MCP Tool (`create_issues`):**
```typescript
{
  items: Array<{
    teamId: string;        // Required
    title: string;         // Required
    description?: string;
    // State - multiple resolution options
    stateId?: string;
    stateName?: string;    // ✨ Human-readable (e.g., "In Progress")
    stateType?: "backlog" | "unstarted" | "started" | "completed" | "canceled";  // ✨ Generic type
    // Labels - multiple resolution options
    labelIds?: string[];
    labelNames?: string[]; // ✨ Human-readable (e.g., ["Bug", "Urgent"])
    // Assignee - multiple resolution options
    assigneeId?: string;
    assigneeName?: string; // ✨ Fuzzy match (e.g., "john")
    assigneeEmail?: string;// ✨ Exact match
    // Project - multiple resolution options
    projectId?: string;
    projectName?: string;  // ✨ Human-readable
    // Priority - multiple formats
    priority?: number | "None" | "Urgent" | "High" | "Medium" | "Low";  // ✨ String support
    estimate?: number;
    allowZeroEstimate?: boolean;  // ✨ Explicit zero handling
    dueDate?: string;
    parentId?: string;
  }>;
  parallel?: boolean;      // ✨ Batch execution mode
  dry_run?: boolean;       // ✨ Validation without mutation
}
```

### Update Issue

LLM-focused differences: MCP batches via `items[]` and accepts UUID or identifier for `id`. MCP supports name-based resolution for state/labels/assignee/project and adds incremental label ops (`addLabelNames`/`removeLabelNames`) in addition to replace-all. MCP supports `archived` to archive/unarchive and `dry_run` to validate without writes. MCP intentionally omits many native-only fields to keep the schema small.

**Linear Native SDK (`IssueUpdateInput`):**
```typescript
{
  title?: string;
  description?: string;
  assigneeId?: string;
  stateId?: string;
  priority?: number;
  estimate?: number;
  labelIds?: string[];      // Replace all labels
  addedLabelIds?: string[]; // Incremental add
  projectId?: string;
  cycleId?: string;
  parentId?: string;
  dueDate?: string;
  descriptionData?: JSON;
  delegateId?: string;
  lastAppliedTemplateId?: string;
  autoClosedByParentClosing?: boolean;
  prioritySortOrder?: number;
}
```

**MCP Tool (`update_issues`):**
```typescript
{
  items: Array<{
    id: string;            // Required - UUID or identifier (e.g., "ENG-123")
    title?: string;
    description?: string;
    // State - multiple resolution options
    stateId?: string;
    stateName?: string;    // ✨ Human-readable
    stateType?: "backlog" | "unstarted" | "started" | "completed" | "canceled";
    // Labels - multiple resolution options + incremental ops
    labelIds?: string[];        // Replace all
    labelNames?: string[];      // ✨ Replace all by name
    addLabelIds?: string[];     // Incremental add
    addLabelNames?: string[];   // ✨ Incremental add by name
    removeLabelIds?: string[];  // ✨ Incremental remove
    removeLabelNames?: string[];// ✨ Incremental remove by name
    // Assignee - multiple resolution options
    assigneeId?: string;
    assigneeName?: string;
    assigneeEmail?: string;
    // Project - multiple resolution options
    projectId?: string;
    projectName?: string;
    // Priority - multiple formats
    priority?: number | "None" | "Urgent" | "High" | "Medium" | "Low";
    estimate?: number;
    allowZeroEstimate?: boolean;
    dueDate?: string;
    parentId?: string;
    archived?: boolean;    // ✨ Archive/unarchive in single call
  }>;
  parallel?: boolean;
  dry_run?: boolean;
}
```

### Create Comment

LLM-focused differences: MCP uses a minimal payload (`issueId`, `body`) and batches via `items[]` (optionally `parallel`) so the agent can post multiple comments at once. MCP intentionally omits advanced/native-only fields (e.g. Prosemirror `bodyData`, cross-entity associations, `createAsUser`) to keep inputs simple.

**Linear Native SDK (`CommentCreateInput`):**
```typescript
{
  issueId?: string;
  body?: string;
  bodyData?: JSON;
  parentId?: string;
  createAsUser?: string;
  createdAt?: DateTime;
  displayIconUrl?: string;
  doNotSubscribeToIssue?: boolean;
  documentContentId?: string;
  projectUpdateId?: string;
  initiativeUpdateId?: string;
  postId?: string;
  quotedText?: string;
  createOnSyncedSlackThread?: boolean;
  id?: string;
}
```

**MCP Tool (`add_comments`):**
```typescript
{
  items: Array<{
    issueId: string;  // Required
    body: string;     // Required
  }>;
  parallel?: boolean;
}
```

### Create Project

LLM-focused differences: MCP batches via `items[]` and keeps the payload small (name/description/teamId/leadId/targetDate). MCP uses `teamId` (single) and maps it to the native `teamIds` array internally. MCP omits many optional native fields (labels, members, content, status, sorting) so the agent doesn’t need to learn Linear’s full project model to be productive.

**Linear Native SDK (`ProjectCreateInput`):**
```typescript
{
  name: string;           // Required
  teamIds: string[];      // Required
  description?: string;
  leadId?: string;
  targetDate?: string;
  startDate?: string;
  color?: string;
  icon?: string;
  content?: string;
  priority?: number;
  prioritySortOrder?: number;
  sortOrder?: number;
  statusId?: string;
  labelIds?: string[];
  memberIds?: string[];
  convertedFromIssueId?: string;
  lastAppliedTemplateId?: string;
  startDateResolution?: DateResolutionType;
  targetDateResolution?: DateResolutionType;
  id?: string;
}
```

**MCP Tool (`create_projects`):**
```typescript
{
  items: Array<{
    name: string;         // Required
    teamId?: string;      // ✨ Simplified - single team
    description?: string;
    leadId?: string;
    targetDate?: string;
  }>;
}

Note: Unlike issue tools, project tools do not currently support `parallel` or `dry_run`.
```

### Create Cycle

LLM-focused differences: MCP intentionally does not expose cycle create/update (only read via `list_cycles`) to keep the surface area small and avoid planning-model writes. If you add it later, prefer the same patterns: batch `items[]`, human-friendly defaults, and a small schema.

**Linear Native SDK (`CycleCreateInput`):**
```typescript
{
  teamId: string;         // Required
  startsAt: DateTime;     // Required
  endsAt: DateTime;       // Required
  name?: string;
  description?: string;
  completedAt?: DateTime;
  id?: string;
}
```

**MCP Tool:** ❌ Not implemented (read-only via `list_cycles`)

---

## 3. Response Formats: Linear Native vs MCP

### List Issues Response

**Linear Native SDK:**
```typescript
{
  nodes: Array<Issue>;  // Lazy-loaded objects
  pageInfo: {
    hasNextPage: boolean;
    endCursor?: string;
  };
}
// Note: Related entities (state, project, assignee, labels) require additional async calls
```

**MCP Tool (`list_issues`):**
```typescript
{
  // Structured content
  structuredContent: {
    query: {                    // ✨ Echo of input params
      filter?: object;
      teamId?: string;
      projectId?: string;
      assignedToMe?: boolean;
      keywords?: string[];
      matchMode: "all" | "any";
      includeArchived?: boolean;
      orderBy?: string;
      limit: number;
    };
    items: Array<{
      id: string;
      identifier: string;       // ✨ Human-readable (e.g., "ENG-123")
      title: string;
      description?: string;
      priority?: number;
      estimate?: number;
      stateId: string;
      stateName?: string;       // ✨ Pre-resolved
      projectId?: string;
      projectName?: string;     // ✨ Pre-resolved
      assigneeId?: string;
      assigneeName?: string;    // ✨ Pre-resolved
      createdAt: string;
      updatedAt: string;
      archivedAt?: string;
      dueDate?: string;
      url?: string;
      labels: Array<{ id: string; name: string }>;  // ✨ Pre-resolved
    }>;
    pagination: {
      hasMore: boolean;
      nextCursor?: string;
      itemsReturned: number;
      limit: number;
    };
    meta: {                     // ✨ LLM guidance
      nextSteps: string[];      // e.g. ["Call again with cursor=\"abc\" to fetch more results.", "Use get_issues with specific IDs for detailed info.", "Use update_issues to modify state, assignee, or labels."]
      hints?: string[];         // e.g. ["Verify teamId exists using workspace_metadata.", "Try different keywords or remove the keyword filter."] (typically only when items=[]/0)
      relatedTools: string[];   // e.g. ["get_issues", "update_issues", "add_comments"]
    };
  };
  // Human-readable content
  content: [{
    type: "text";
    text: string;               // ✨ Formatted summary with markdown links
  }];
}
```

Hint generation: `meta.hints` is only populated when the list returns **zero items**. `list_issues` computes it via `getZeroResultHints(...)` based on which filters were present (state/date/team/assignee/project/keywords), and the same hints are included in the human summary text.

#### Example: `list_issues` (non-empty results)

```ts
// Example ToolResult returned by MCP
{
  content: [
    {
      type: "text",
      text:
        "Issues: 2 (limit 2), more available. Preview:\n" +
        "- [ENG-123 — Fix login redirect](https://linear.app/acme/issue/ENG-123) — state In Progress; priority High; project Auth; due 2025-12-20; assignee Alice\n" +
        "- [ENG-124 — Add SSO callback tests](https://linear.app/acme/issue/ENG-124) — state Backlog; priority Medium; project Auth; assignee Alice " +
        "Suggested next steps: Pass cursor 'cursor_123' to fetch more.",
    },
  ],
  structuredContent: {
    query: {
      assignedToMe: true,
      keywords: ["login", "redirect"],
      matchMode: "all",
      orderBy: "updatedAt",
      limit: 2,
    },
    items: [
      {
        id: "uuid_issue_1",
        identifier: "ENG-123",
        title: "Fix login redirect",
        priority: 2,
        stateId: "uuid_state_in_progress",
        stateName: "In Progress",
        projectId: "uuid_project_auth",
        projectName: "Auth",
        assigneeId: "uuid_user_alice",
        assigneeName: "Alice",
        createdAt: "2025-12-10T12:00:00.000Z",
        updatedAt: "2025-12-16T10:00:00.000Z",
        dueDate: "2025-12-20",
        url: "https://linear.app/acme/issue/ENG-123",
        labels: [{ id: "uuid_label_bug", name: "Bug" }],
      },
      {
        id: "uuid_issue_2",
        identifier: "ENG-124",
        title: "Add SSO callback tests",
        priority: 3,
        stateId: "uuid_state_backlog",
        stateName: "Backlog",
        projectId: "uuid_project_auth",
        projectName: "Auth",
        assigneeId: "uuid_user_alice",
        assigneeName: "Alice",
        createdAt: "2025-12-11T09:00:00.000Z",
        updatedAt: "2025-12-16T09:40:00.000Z",
        url: "https://linear.app/acme/issue/ENG-124",
        labels: [],
      },
    ],
    pagination: {
      hasMore: true,
      nextCursor: "cursor_123",
      itemsReturned: 2,
      limit: 2,
    },
    meta: {
      nextSteps: [
        "Call again with cursor=\"cursor_123\" to fetch more results.",
        "Use get_issues with specific IDs for detailed info.",
        "Use update_issues to modify state, assignee, or labels.",
      ],
      relatedTools: ["get_issues", "update_issues", "add_comments"],
    },
  },
}
```

#### Example: `list_issues` (zero results + hints)

```ts
{
  content: [
    {
      type: "text",
      text:
        "Issues: 0 (limit 25). " +
        "No results. Try: Verify teamId exists using workspace_metadata; Try different keywords or remove the keyword filter.",
    },
  ],
  structuredContent: {
    query: {
      teamId: "uuid_team_eng",
      keywords: ["nonexistent", "query"],
      matchMode: "all",
      orderBy: "updatedAt",
      limit: 25,
    },
    items: [],
    pagination: {
      hasMore: false,
      itemsReturned: 0,
      limit: 25,
    },
    meta: {
      nextSteps: [
        "Use get_issues with specific IDs for detailed info.",
        "Use update_issues to modify state, assignee, or labels.",
      ],
      hints: [
        "Verify teamId exists using workspace_metadata.",
        "Try different keywords or remove the keyword filter.",
      ],
      relatedTools: ["get_issues", "update_issues", "add_comments"],
    },
  },
}
```

### Get/Create/Update Issues Response

**Linear Native SDK:**
```typescript
// IssuePayload
{
  success: boolean;
  issue?: Issue;        // Lazy-loaded object
  lastSyncId: number;
}
```

**MCP Tool (`create_issues` / `update_issues`):**
```typescript
{
  structuredContent: {
    results: Array<{
      input: object;            // ✨ Echo of input for context
      success: boolean;
      id?: string;
      identifier?: string;
      url?: string;
      error?: {                 // ✨ Structured error
        code: string;
        message: string;
        suggestions: string[];  // ✨ Recovery hints
        retryable?: boolean;
      };
    }>;
    summary: {
      total: number;
      succeeded: number;
      failed: number;
    };
    meta: {
      nextSteps: string[];      // e.g. ["Use list_issues or get_issues to verify changes."]
      relatedTools: string[];   // e.g. ["list_issues", "get_issues", "add_comments"]
    };
  };
  content: [{
    type: "text";
    text: string;               // ✨ Human-readable summary with diff for updates
  }];
}
```

#### Example: `update_issues` (human-readable diff + structured meta)

```ts
{
  content: [
    {
      type: "text",
      text:
        "Updated issues: 1 / 1. OK: ENG-123.\n\n" +
        "- [ENG-123 — Fix login redirect](https://linear.app/acme/issue/ENG-123) (id uuid_issue_1)\n" +
        "  State: In Progress → Done\n" +
        "  Labels: +Bug\n\n" +
        "Tip: Use list_issues to verify changes.",
    },
  ],
  structuredContent: {
    results: [
      {
        input: { id: "ENG-123", stateType: "completed", addLabelNames: ["Bug"] },
        success: true,
        id: "uuid_issue_1",
        identifier: "ENG-123",
        url: "https://linear.app/acme/issue/ENG-123",
      },
    ],
    summary: { total: 1, succeeded: 1, failed: 0 },
    meta: {
      nextSteps: ["Use list_issues or get_issues to verify changes."],
      relatedTools: ["list_issues", "get_issues", "add_comments"],
    },
  },
}
```

**MCP Tool (`get_issues`):**
```typescript
{
  structuredContent: {
    results: Array<{
      requestedId: string;      // ✨ Original ID requested
      success: boolean;
      issue?: {
        id: string;
        identifier: string;
        title: string;
        description?: string;
        url?: string;
        assignee?: { id: string; name?: string };
        state?: { id: string; name: string; type?: string };
        project?: { id: string; name?: string };
        labels: Array<{ id: string; name: string }>;
        branchName?: string;    // ✨ Git branch name
        attachments: Array<{    // ✨ Issue attachments
          id: string;
          title?: string;
          url?: string;
          sourceType?: string;
        }>;
      };
      error?: {
        code: string;
        message: string;
        suggestions: string[];
      };
    }>;
    summary: {
      succeeded: number;
      failed: number;
    };
    meta: {
      nextSteps: string[];
      relatedTools: string[];
    };
  };
  content: [{
    type: "text";
    text: string;
  }];
}
```

### Workspace Metadata

**Linear Native SDK:** No equivalent single call - requires multiple queries:
```typescript
// viewer query
const viewer = await client.viewer;
// teams query
const teams = await client.teams();
// workflowStates query per team
const states = await team.states();
// issueLabels query per team
const labels = await team.labels();
// projects query
const projects = await client.projects();
```

**MCP Tool Input (`workspace_metadata`):**
```typescript
{
  include?: Array<"profile" | "teams" | "workflow_states" | "labels" | "projects" | "favorites">;
  // ✨ Defaults to all except favorites
  teamIds?: string[];      // ✨ Filter to specific teams
  project_limit?: number;  // ✨ Max projects per team (default: 10)
  label_limit?: number;    // ✨ Max labels per team (default: 50)
}
```

**MCP Tool Response (`workspace_metadata`):**
```typescript
{
  structuredContent: {
    viewer: {
      id: string;
      name?: string;
      email?: string;
      displayName?: string;
      avatarUrl?: string;
      timezone?: string;
      createdAt?: string;
    };
    teams: Array<{
      id: string;
      key?: string;
      name: string;
      description?: string;
      defaultIssueEstimate?: number;
      cyclesEnabled?: boolean;              // ✨ Check before using list_cycles
      issueEstimationAllowZero?: boolean;   // ✨ Team estimation settings
      issueEstimationExtended?: boolean;
      issueEstimationType?: string;
    }>;
    workflowStatesByTeam: Record<string, Array<{
      id: string;
      name: string;
      type: string;
    }>>;
    labelsByTeam: Record<string, Array<{
      id: string;
      name: string;
      color?: string;
      description?: string;
    }>>;
    projects: Array<{
      id: string;
      name: string;
      state: string;
      teamId?: string;
      leadId?: string;
      targetDate?: string;
      createdAt?: string;
    }>;
    favorites?: Array<{
      id: string;
      type?: string;
      url?: string;
      projectId?: string;
      issueId?: string;
    }>;
    summary: {                              // ✨ Quick counts
      teamCount: number;
      stateCount: number;
      labelCount: number;
      projectCount: number;
    };
    quickLookup: {                          // ✨ Fast ID resolution maps
      viewerId?: string;
      viewerName?: string;
      viewerEmail?: string;
      teamIds?: string[];
      teamByKey?: Record<string, string>;   // e.g., { "ENG": "uuid" }
      teamByName?: Record<string, string>;  // e.g., { "Engineering": "uuid" }
      stateIdByName?: Record<string, string>;
      labelIdByName?: Record<string, string>;
      projectIdByName?: Record<string, string>;
    };
    meta: {
      nextSteps: string[];
      relatedTools: string[];
    };
  };
  content: [{
    type: "text";
    text: string;
  }];
}
```

---

## 4. Additional MCP Features

### Detail Levels (list_issues)

MCP tools support configurable response verbosity:

| Level | Fields Included |
|-------|-----------------|
| `minimal` | id, identifier, title, state (id, name) |
| `standard` | + priority, estimate, assignee, project, dueDate, url |
| `full` | + labels, description |

### Tool Annotations (MCP Spec)

All MCP tools include behavior hints for clients:

| Tool | readOnlyHint | destructiveHint |
|------|--------------|-----------------|
| `workspace_metadata` | ✅ true | ❌ false |
| `list_issues` | ✅ true | ❌ false |
| `get_issues` | ✅ true | ❌ false |
| `create_issues` | ❌ false | ❌ false |
| `update_issues` | ❌ false | ❌ false |
| `list_teams` | ✅ true | ❌ false |
| `list_users` | ✅ true | ❌ false |
| `list_comments` | ✅ true | ❌ false |
| `add_comments` | ❌ false | ❌ false |
| `update_comments` | ❌ false | ❌ false |
| `list_cycles` | ✅ true | ❌ false |
| `list_projects` | ✅ true | ❌ false |
| `create_projects` | ❌ false | ❌ false |
| `update_projects` | ❌ false | ❌ false |

### Consistent Pagination

All list tools use the same pagination pattern:

```typescript
// Input
{
  limit?: number;   // Default varies by tool (10-50)
  cursor?: string;  // From previous response's nextCursor
}

// Output
{
  pagination: {
    hasMore: boolean;
    nextCursor?: string;
    itemsReturned: number;
    limit: number;
  }
}
```

### Rate Limiting & Concurrency

MCP tools include built-in protections:

- **Concurrency gate**: Limits parallel API calls (configurable via `CONCURRENCY_LIMIT`)
- **Retry with backoff**: Automatic retries (3 attempts, 500ms base delay)
- **Inter-request delay**: 100ms between sequential batch items
- **Batch limits**: Max 50 items per batch operation

### Filtering Capabilities (list_issues)

MCP supports full GraphQL-style filtering with comparators:

| Comparator | Description | Example |
|------------|-------------|---------|
| `eq` | Equals | `{ state: { type: { eq: "started" } } }` |
| `neq` | Not equals | `{ state: { type: { neq: "completed" } } }` |
| `in` | In array | `{ labels: { name: { in: ["Bug", "Urgent"] } } }` |
| `nin` | Not in array | `{ priority: { nin: [3, 4] } }` |
| `lt` / `lte` | Less than | `{ priority: { lte: 2 } }` (High priority) |
| `gt` / `gte` | Greater than | `{ createdAt: { gte: "2024-01-01" } }` |
| `containsIgnoreCase` | Contains text | `{ title: { containsIgnoreCase: "bug" } }` |
| `eqIgnoreCase` | Case-insensitive equals | `{ assignee: { email: { eqIgnoreCase: "USER@example.com" } } }` |
| `startsWith` / `endsWith` | Text match | `{ identifier: { startsWith: "ENG-" } }` |
| `null` | Is null check | `{ assignee: { null: true } }` |

**Relationship filtering:**
```typescript
// Filter by team
{ team: { id: { eq: "team-uuid" } } }

// Filter by assignee email
{ assignee: { email: { eqIgnoreCase: "user@example.com" } } }

// Filter by project
{ project: { id: { eq: "project-uuid" } } }

// Combine with AND/OR
{ and: [{ state: { type: { eq: "started" } } }, { priority: { lte: 2 } }] }
```

---

## Summary

### MCP Advantages

1. **Batch Operations** - All mutation tools support batch operations (up to 50 items)
2. **Human-Readable Inputs** - Support for names instead of UUIDs (stateName, labelNames, assigneeName, projectName)
3. **Flexible ID Resolution** - Accept both UUIDs and short identifiers (e.g., `ENG-123`)
4. **Priority Strings** - Accept "Urgent", "High", "Medium", "Low" instead of just numbers
5. **Dry Run Mode** - Validate without executing (create_issues, update_issues)
6. **Pre-resolved Relations** - No N+1 queries; related entities included in response
7. **Structured Errors** - Error codes, messages, and recovery suggestions
8. **LLM Guidance** - nextSteps, relatedTools, and hints in responses
9. **Zero-Result Hints** - Context-aware suggestions when no results found
10. **Incremental Label Operations** - addLabelNames, removeLabelNames for partial updates
11. **Detail Levels** - minimal/standard/full to control response verbosity
12. **Keyword Search** - Built-in q/keywords with matchMode (all/any)
13. **Quick Lookup Maps** - workspace_metadata returns pre-built ID lookup dictionaries
14. **Update Diffs** - update_issues shows before/after changes in human-readable format
15. **Rate Limit Protection** - Built-in concurrency control and retry logic

### Not Implemented (By Design)

- **Delete operations** - Safety concern; use archive instead
- **Admin operations** - Team/org management
- **Advanced features** - Roadmaps, integrations, webhooks, notifications
- **Cycles**: create/update (only list_cycles available)
- **Project Milestones**: CRUD operations
- **Project Updates**: Status reports/health updates
- **Issue Relations**: blocks/blocked-by/duplicates links
- **Attachments**: Upload/manage issue attachments
- **Labels CRUD**: Create/update/delete labels (only read via workspace_metadata)
- **Workflow States CRUD**: Manage workflow states (only read via workspace_metadata)
- **Custom Views**: Save/manage filtered views
- **Webhooks**: Create/manage webhook subscriptions
- **Integrations**: Third-party integration management

### Linear SDK Features Not Exposed

Some SDK features are intentionally not exposed for simplicity or safety:

| Feature | Reason |
|---------|--------|
| `descriptionData` (Prosemirror) | Complex internal format; use markdown `description` instead |
| `createAsUser` | OAuth app-only feature |
| `prioritySortOrder` | Internal ordering; use `priority` instead |
| `lastAppliedTemplateId` | Template management not exposed |
| `cycleId` on issues | Use Linear UI for cycle management |
| `delegateId` | Agent delegation not exposed |

