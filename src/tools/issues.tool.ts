import { LinearDocument } from "@linear/sdk";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { config } from "../config/env.ts";
import { toolsMetadata } from "../config/metadata.ts";
import { getCurrentAbortSignal } from "../core/context.ts";
import {
  CreateIssuesInputSchema,
  GetIssuesInputSchema,
  ListIssuesInputSchema,
  ListMyIssuesInputSchema,
  UpdateIssuesInputSchema,
} from "../schemas/inputs.ts";
import {
  CreateIssuesOutputSchema,
  GetIssueOutputSchema,
  GetIssuesOutputSchema,
  ListIssuesOutputSchema,
  UpdateIssuesOutputSchema,
} from "../schemas/outputs.ts";
import { getLinearClient } from "../services/linear-client.ts";
import { normalizeIssueFilter } from "../utils/filters.ts";
import { makeConcurrencyGate } from "../utils/limits.ts";
import { logger } from "../utils/logger.ts";
import { mapIssueNodeToListItem } from "../utils/mappers.ts";
import {
  previewLinesFromItems,
  summarizeBatch,
  summarizeList,
} from "../utils/messages.ts";

export const listIssuesTool = {
  name: toolsMetadata.list_issues.name,
  title: toolsMetadata.list_issues.title,
  description: toolsMetadata.list_issues.description,
  inputSchema: ListIssuesInputSchema.shape,
  handler: async (args: unknown): Promise<CallToolResult> => {
    const parsed = ListIssuesInputSchema.safeParse(args);
    if (!parsed.success) {
      return {
        isError: true,
        content: [{ type: "text", text: parsed.error.message }],
      };
    }
    const client = getLinearClient();
    const first = parsed.data.limit ?? 20;
    const after =
      parsed.data.cursor && parsed.data.cursor.trim() !== ""
        ? parsed.data.cursor
        : undefined;
    const orderBy =
      parsed.data.orderBy === "updatedAt"
        ? LinearDocument.PaginationOrderBy.UpdatedAt
        : parsed.data.orderBy === "createdAt"
        ? LinearDocument.PaginationOrderBy.CreatedAt
        : undefined;

    let conn: {
      nodes: Array<{
        id: string;
        title: string;
        description?: string | null;
        priority?: number | null;
        estimate?: number | null;
        stateId?: string | null;
        projectId?: string | null;
        assigneeId?: string | null;
        createdAt?: Date | string | null;
        updatedAt?: Date | string | null;
        archivedAt?: Date | string | null;
        labels: () => Promise<{ nodes: Array<{ id: string; name: string }> }>;
      }>;
      pageInfo?: { endCursor?: string };
    };
    try {
      // Build keyword-aware filter
      const keywordTokens = [
        ...(parsed.data.keywords ?? []),
        ...(parsed.data.q ?? "")
          .split(/\s+/)
          .map((s) => s.trim())
          .filter(Boolean),
      ];
      const keywordOr = keywordTokens.length
        ? {
            or: keywordTokens.map((t) => ({
              title: { containsIgnoreCase: t },
            })),
          }
        : undefined;
      const baseFilter =
        normalizeIssueFilter(
          (parsed.data.filter as Record<string, unknown> | undefined) ??
            undefined
        ) ?? {};
      const mergedFilter = keywordOr
        ? { ...(baseFilter as object), ...(keywordOr as object) }
        : baseFilter;
      if (parsed.data.projectId) {
        const project = await client.project(parsed.data.projectId);
        conn = await project.issues({
          first,
          after,
          filter: mergedFilter as Record<string, unknown>,
          includeArchived: parsed.data.includeArchived,
          orderBy,
        });
      } else if (parsed.data.teamId) {
        const team = await client.team(parsed.data.teamId);
        conn = await team.issues({
          first,
          after,
          filter: mergedFilter as Record<string, unknown>,
          includeArchived: parsed.data.includeArchived,
          orderBy,
        });
      } else {
        conn = await client.issues({
          first,
          after,
          filter: mergedFilter as Record<string, unknown>,
          includeArchived: parsed.data.includeArchived,
          orderBy,
        });
      }
    } catch (error) {
      return {
        isError: true,
        content: [{ type: "text", text: (error as Error).message }],
      };
    }
    const items = [] as Array<{
      id: string;
      identifier?: string;
      title: string;
      description?: string;
      priority?: number;
      estimate?: number;
      stateId: string;
      stateName?: string;
      projectId?: string;
      projectName?: string;
      assigneeId?: string;
      assigneeName?: string;
      createdAt: string;
      updatedAt: string;
      archivedAt?: string;
      dueDate?: string;
      url?: string;
      labels: Array<{ id: string; name: string }>;
    }>;
    for (const node of conn.nodes) {
      items.push(await mapIssueNodeToListItem(node));
    }
    const structured = ListIssuesOutputSchema.parse({
      items,
      cursor: parsed.data.cursor,
      nextCursor: conn.pageInfo?.endCursor ?? undefined,
      limit: first,
    });
    const preview = previewLinesFromItems(
      items as unknown as Record<string, unknown>[],
      (i) => {
        const idf = (i.identifier as string | undefined) ?? (i.id as string);
        const ttl = String((i.title as string) ?? "");
        const st = (i.stateName as string | undefined) ?? (i.stateId as string);
        const proj = (i.projectName as string | undefined) ?? undefined;
        const asg =
          (i.assigneeName as string | undefined) ??
          (i.assigneeId as string | undefined);
        const due = (i.dueDate as string | undefined) ?? undefined;
        const url = (i.url as string | undefined) ?? undefined;
        const labels = Array.isArray(i.labels)
          ? (i.labels as Array<{ id: string; name: string }>)
              .map((l) => l.name)
              .slice(0, 5)
              .join(", ")
          : undefined;
        const title = url ? `[${idf} — ${ttl}](${url})` : `${idf} '${ttl}'`;
        const parts: string[] = [`state ${st}`];
        if (proj) {
          parts.push(`project ${proj}`);
        }
        if (labels) {
          parts.push(`labels ${labels}`);
        }
        if (due) {
          parts.push(`due ${due}`);
        }
        if (asg) {
          parts.push(`assignee ${asg}`);
        }
        return `${title} — ${parts.join("; ")}`.trim();
      }
    );
    const filterHints: string[] = [];
    if (parsed.data.orderBy) {
      filterHints.push(`orderBy=${parsed.data.orderBy}`);
    }
    if (parsed.data.teamId) {
      filterHints.push(`teamId=${parsed.data.teamId}`);
    }
    if (parsed.data.projectId) {
      filterHints.push(`projectId=${parsed.data.projectId}`);
    }
    const nextSteps: string[] = [];
    if (items.length > 0) {
      nextSteps.push(
        "Use list_issues to fetch details by id (UUID) or by number+team.key/team.id (limit=1); pass cursor to fetch next page; use q/keywords for title search; refine filters using comparators (eq/neq/lt/lte/gt/gte/in/nin, containsIgnoreCase, startsWith/endsWith, null) and relationship fields (e.g., assignee.email, labels.name)."
      );
    } else {
      nextSteps.push(
        "Refine filters: try state.type 'started' (alias: active), remove archived, or search by q/keywords."
      );
    }
    const message = summarizeList({
      subject: "Issues",
      count: items.length,
      limit: first,
      nextCursor: structured.nextCursor,
      filterHints,
      previewLines: preview,
      nextSteps,
    });
    const details = items
      .slice(0, 5)
      .map((i) => {
        const idf = (i.identifier ?? i.id) as string;
        const state = (i.stateName ?? i.stateId) as string;
        const labels = i.labels.map((l) => l.name).join(", ");
        const proj = i.projectName
          ? `\n  project: ${i.projectName} (${i.projectId ?? ""})`
          : "";
        const asg = i.assigneeName
          ? `\n  assignee: ${i.assigneeName} (${i.assigneeId ?? ""})`
          : "";
        const due = i.dueDate ? `\n  due: ${i.dueDate}` : "";
        const lab = labels ? `\n  labels: ${labels}` : "";
        const url = i.url ?? undefined;
        const header = url
          ? `- [${idf} — ${i.title}](${url})`
          : `- ${idf} — ${i.title}`;
        return `<ove id="${i.id}" identifier="${idf}">\n${header}\n  state: ${state} (${i.stateId})${proj}${asg}${due}${lab}\n</ove>`;
      })
      .join("\n");
    const full = details ? `${message}\n\n${details}` : message;
    const parts: Array<{ type: "text"; text: string }> = [
      { type: "text", text: full },
    ];
    if (config.LINEAR_MCP_INCLUDE_JSON_IN_CONTENT) {
      parts.push({ type: "text", text: JSON.stringify(structured) });
    }
    return { content: parts, structuredContent: structured };
  },
};

// Removed singular get_issue; use get_issues for batch retrieval.

export const getIssuesTool = {
  name: "get_issues",
  title: "Get Issues (Batch)",
  description:
    "Fetch multiple issues by id (UUID or short ID like ENG-123) and return per-item results plus a summary.",
  inputSchema: GetIssuesInputSchema.shape,
  handler: async (args: unknown): Promise<CallToolResult> => {
    const parsed = GetIssuesInputSchema.safeParse(args);
    if (!parsed.success) {
      return {
        isError: true,
        content: [{ type: "text", text: parsed.error.message }],
      };
    }
    const client = getLinearClient();
    const gate = makeConcurrencyGate(3);
    const ids = parsed.data.ids;
    const results: Array<{
      index: number;
      ok: boolean;
      id?: string;
      identifier?: string;
      error?: string;
      code?: string;
      issue?: ReturnType<typeof GetIssueOutputSchema.parse>;
    }> = [];
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i] as string;
      try {
        const issue = await gate(() => client.issue(id));
        const labels = (await issue.labels()).nodes.map((l) => ({
          id: l.id,
          name: l.name,
        }));
        const structured = GetIssueOutputSchema.parse({
          id: issue.id,
          title: issue.title,
          description: issue.description ?? undefined,
          identifier: issue.identifier ?? undefined,
          assignee: issue.assignee
            ? {
                id:
                  (issue.assignee as unknown as { id?: string })?.id ??
                  undefined,
                name:
                  (issue.assignee as unknown as { name?: string })?.name ??
                  undefined,
              }
            : undefined,
          state: issue.state
            ? {
                id: (issue.state as unknown as { id?: string })?.id ?? "",
                name: (issue.state as unknown as { name?: string })?.name ?? "",
                type: (issue.state as unknown as { type?: string })?.type,
              }
            : undefined,
          project: issue.project
            ? {
                id: (issue.project as unknown as { id?: string })?.id ?? "",
                name:
                  (issue.project as unknown as { name?: string })?.name ??
                  undefined,
              }
            : undefined,
          labels,
          branchName: issue.branchName ?? undefined,
          attachments: (await issue.attachments()).nodes,
        });
        results.push({
          index: i,
          ok: true,
          id: structured.id,
          identifier: structured.identifier,
          issue: structured,
        });
      } catch (error) {
        await logger.error("get_issues", {
          message: "Failed to fetch issue",
          id,
          error: (error as Error).message,
        });
        results.push({
          index: i,
          ok: false,
          error: (error as Error).message,
          code: "LINEAR_FETCH_ERROR",
        });
      }
    }
    const summary = {
      ok: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).length,
    };
    const structuredBatch = GetIssuesOutputSchema.parse({ results, summary });
    const okIds = results
      .filter((r) => r.ok)
      .map((r) => r.identifier ?? r.id ?? `item[${r.index}]`);
    const messageBase = summarizeBatch({
      action: "Fetched issues",
      ok: summary.ok,
      total: ids.length,
      okIdentifiers: okIds as string[],
      failures: results
        .filter((r) => !r.ok)
        .map((r) => ({ index: r.index, id: undefined, error: r.error ?? "" })),
      nextSteps: [
        "Call update_issues to modify fields, or list_issues to discover more.",
      ],
    });
    const previewLines = results
      .filter((r) => r.ok && r.issue)
      .slice(0, 5)
      .map((r) => {
        const it = r.issue as unknown as {
          identifier?: string;
          id: string;
          state?: { name?: string };
          assignee?: { name?: string };
          title: string;
        };
        const stateNm = it.state?.name as string | undefined;
        const assNm = it.assignee?.name as string | undefined;
        return `${it.identifier ?? it.id} '${it.title}'${
          stateNm ? ` — state ${stateNm}` : ""
        }${assNm ? `, assignee ${assNm}` : ""}`;
      });
    const fullMessage =
      previewLines.length > 0
        ? `${messageBase} Preview:\n${previewLines
            .map((l) => `- ${l}`)
            .join("\n")}`
        : messageBase;
    const parts: Array<{ type: "text"; text: string }> = [
      { type: "text", text: fullMessage },
    ];
    if (config.LINEAR_MCP_INCLUDE_JSON_IN_CONTENT) {
      parts.push({ type: "text", text: JSON.stringify(structuredBatch) });
    }
    return { content: parts, structuredContent: structuredBatch };
  },
};
export const listMyIssuesTool = {
  name: toolsMetadata.list_my_issues.name,
  title: toolsMetadata.list_my_issues.title,
  description: toolsMetadata.list_my_issues.description,
  inputSchema: ListMyIssuesInputSchema.shape,
  handler: async (args: unknown): Promise<CallToolResult> => {
    const parsed = ListMyIssuesInputSchema.safeParse(args);
    if (!parsed.success) {
      return {
        isError: true,
        content: [{ type: "text", text: parsed.error.message }],
      };
    }
    const client = getLinearClient();
    const me = await client.viewer;
    const first = parsed.data.limit ?? 20;
    const after =
      parsed.data.cursor && parsed.data.cursor.trim() !== ""
        ? parsed.data.cursor
        : undefined;
    const orderBy =
      parsed.data.orderBy === "updatedAt"
        ? LinearDocument.PaginationOrderBy.UpdatedAt
        : parsed.data.orderBy === "createdAt"
        ? LinearDocument.PaginationOrderBy.CreatedAt
        : undefined;
    // Build keyword-aware filter for assigned issues
    const keywordTokens = [
      ...(parsed.data.keywords ?? []),
      ...(parsed.data.q ?? "")
        .split(/\s+/)
        .map((s) => s.trim())
        .filter(Boolean),
    ];
    const keywordOr = keywordTokens.length
      ? { or: keywordTokens.map((t) => ({ title: { containsIgnoreCase: t } })) }
      : undefined;
    const baseFilter =
      normalizeIssueFilter(
        (parsed.data.filter as Record<string, unknown> | undefined) ?? undefined
      ) ?? {};
    const mergedFilter = keywordOr
      ? { ...(baseFilter as object), ...(keywordOr as object) }
      : baseFilter;

    const conn = await me.assignedIssues({
      first,
      after,
      filter: mergedFilter as Record<string, unknown>,
      includeArchived: parsed.data.includeArchived,
      orderBy,
    });
    const items = await Promise.all(
      conn.nodes.map(async (i) => {
        let stateName: string | undefined;
        let projectName: string | undefined;
        let assigneeName: string | undefined;
        try {
          const s = await (
            i as unknown as { state?: Promise<{ name?: string }> }
          ).state;
          stateName = s?.name ?? undefined;
        } catch {}
        try {
          const p = await (
            i as unknown as { project?: Promise<{ name?: string }> }
          ).project;
          projectName = p?.name ?? undefined;
        } catch {}
        try {
          const a = await (
            i as unknown as { assignee?: Promise<{ name?: string }> }
          ).assignee;
          assigneeName = a?.name ?? undefined;
        } catch {}
        const labels = (await i.labels()).nodes.map((l) => ({
          id: l.id,
          name: l.name,
        }));
        return {
          id: i.id,
          identifier:
            (i as unknown as { identifier?: string })?.identifier ?? undefined,
          title: i.title,
          description: i.description ?? undefined,
          priority: i.priority ?? undefined,
          estimate: i.estimate ?? undefined,
          stateId: i.stateId ?? "",
          stateName,
          projectId: i.projectId ?? undefined,
          projectName,
          assigneeId: i.assigneeId ?? undefined,
          assigneeName,
          createdAt: i.createdAt?.toString() ?? "",
          updatedAt: i.updatedAt?.toString() ?? "",
          archivedAt: i.archivedAt?.toString() ?? undefined,
          dueDate: (i as unknown as { dueDate?: string })?.dueDate ?? undefined,
          url: (i as unknown as { url?: string })?.url ?? undefined,
          labels,
        };
      })
    );
    const structured = ListIssuesOutputSchema.parse({
      items,
      cursor: parsed.data.cursor,
      nextCursor: conn.pageInfo?.endCursor ?? undefined,
      limit: first,
    });
    const preview = previewLinesFromItems(
      items as unknown as Record<string, unknown>[],
      (i) => {
        const idf = (i.identifier as string | undefined) ?? (i.id as string);
        const ttl = String((i.title as string) ?? "");
        const st = (i.stateName as string | undefined) ?? (i.stateId as string);
        const proj = (i.projectName as string | undefined) ?? undefined;
        const asg =
          (i.assigneeName as string | undefined) ??
          (i.assigneeId as string | undefined);
        const due = (i.dueDate as string | undefined) ?? undefined;
        const url = (i.url as string | undefined) ?? undefined;
        const labels = Array.isArray(i.labels)
          ? (i.labels as Array<{ id: string; name: string }>)
              .map((l) => l.name)
              .slice(0, 5)
              .join(", ")
          : undefined;
        const title = url ? `[${idf} — ${ttl}](${url})` : `${idf} '${ttl}'`;
        const parts: string[] = [`state ${st}`];
        if (proj) {
          parts.push(`project ${proj}`);
        }
        if (labels) {
          parts.push(`labels ${labels}`);
        }
        if (due) {
          parts.push(`due ${due}`);
        }
        if (asg) {
          parts.push(`assignee ${asg}`);
        }
        return `${title} — ${parts.join("; ")}`.trim();
      }
    );
    const nextSteps2: string[] = [];
    if (items.length > 0) {
      nextSteps2.push(
        "Use list_issues (by id or by number+team.key/team.id, limit=1) for details, or update_issues to change state/assignee. Prefer list_issues with q/keywords for workspace search."
      );
    } else {
      nextSteps2.push(
        "Refine filters: try state.type 'started' (alias: active), clear q/keywords or try different keywords."
      );
    }
    const message = summarizeList({
      subject: "My issues",
      count: items.length,
      limit: first,
      nextCursor: structured.nextCursor,
      previewLines: preview,
      nextSteps: nextSteps2,
    });
    const details = items
      .slice(0, 5)
      .map((i) => {
        const idf = (i.identifier ?? i.id) as string;
        const state = (i.stateName ?? i.stateId) as string;
        const labels = i.labels.map((l) => l.name).join(", ");
        const proj = i.projectName
          ? `\n  project: ${i.projectName} (${i.projectId ?? ""})`
          : "";
        const asg = i.assigneeName
          ? `\n  assignee: ${i.assigneeName} (${i.assigneeId ?? ""})`
          : "";
        const due = i.dueDate ? `\n  due: ${i.dueDate}` : "";
        const url = (i.url as string | undefined) ?? undefined;
        const lab = labels ? `\n  labels: ${labels}` : "";
        const header = url
          ? `- [${idf} — ${i.title}](${url})`
          : `- ${idf} — ${i.title}`;
        return `${header}\n  state: ${state} (${i.stateId})${proj}${asg}${due}${lab}`;
      })
      .join("\n");
    const full = details ? `${message}\n\n${details}` : message;
    const parts: Array<{ type: "text"; text: string }> = [
      { type: "text", text: full },
    ];
    if (config.LINEAR_MCP_INCLUDE_JSON_IN_CONTENT) {
      parts.push({ type: "text", text: JSON.stringify(structured) });
    }
    return { content: parts, structuredContent: structured };
  },
};

export const createIssuesTool = {
  name: toolsMetadata.create_issues.name,
  title: toolsMetadata.create_issues.title,
  description: toolsMetadata.create_issues.description,
  inputSchema: CreateIssuesInputSchema.shape,
  handler: async (args: unknown): Promise<CallToolResult> => {
    const parsed = CreateIssuesInputSchema.safeParse(args);
    if (!parsed.success) {
      return {
        isError: true,
        content: [{ type: "text", text: parsed.error.message }],
      };
    }
    const client = getLinearClient();
    const gate = makeConcurrencyGate(config.CONCURRENCY_LIMIT);
    const { items } = parsed.data;
    const teamAllowZeroCache = new Map<string, boolean>();
    const results: {
      index: number;
      ok: boolean;
      id?: string;
      identifier?: string;
      error?: string;
      code?: string;
    }[] = [];
    const abort = getCurrentAbortSignal();
    for (let i = 0; i < items.length; i++) {
      const it = items[i] as (typeof items)[number];
      try {
        const payloadInput: Record<string, unknown> = {
          teamId: it.teamId,
          title: it.title,
        };
        if (
          typeof it.description === "string" &&
          it.description.trim() !== ""
        ) {
          payloadInput.description = it.description;
        }
        if (typeof it.stateId === "string" && it.stateId) {
          payloadInput.stateId = it.stateId;
        }
        if (Array.isArray(it.labelIds) && it.labelIds.length > 0) {
          payloadInput.labelIds = it.labelIds;
        }
        if (typeof it.assigneeId === "string" && it.assigneeId) {
          payloadInput.assigneeId = it.assigneeId;
        } else {
          try {
            const me = await client.viewer;
            const meId = (me as unknown as { id?: string })?.id;
            if (meId) {
              payloadInput.assigneeId = meId;
            }
          } catch {}
        }
        if (typeof it.projectId === "string" && it.projectId) {
          payloadInput.projectId = it.projectId;
        }
        if (typeof it.priority !== "undefined") {
          const n =
            typeof it.priority === "string" ? Number(it.priority) : it.priority;
          if (Number.isFinite(n) && (n as number) >= 0) {
            payloadInput.priority = n;
          }
        }
        if (typeof it.estimate === "number") {
          if (it.estimate > 0) {
            payloadInput.estimate = it.estimate;
          } else if (it.estimate === 0) {
            let allowZero =
              (it as unknown as { allowZeroEstimate?: boolean })
                .allowZeroEstimate === true;
            if (!allowZero && typeof it.teamId === "string" && it.teamId) {
              if (teamAllowZeroCache.has(it.teamId)) {
                allowZero = teamAllowZeroCache.get(it.teamId) === true;
              } else {
                try {
                  const team = await client.team(it.teamId);
                  allowZero =
                    ((team as unknown as { issueEstimationAllowZero?: boolean })
                      .issueEstimationAllowZero ?? false) === true;
                  teamAllowZeroCache.set(it.teamId, allowZero);
                } catch {
                  allowZero = false;
                }
              }
            }
            if (allowZero) {
              payloadInput.estimate = 0;
            }
          }
        }
        if (typeof it.dueDate === "string" && it.dueDate.trim() !== "") {
          payloadInput.dueDate = it.dueDate;
        }
        if (typeof it.parentId === "string" && it.parentId) {
          payloadInput.parentId = it.parentId;
        }

        if (abort?.aborted) {
          throw new Error("Operation aborted");
        }
        const call = () =>
          client.createIssue(
            payloadInput as unknown as {
              teamId: string;
              title: string;
              description?: string;
              stateId?: string;
              labelIds?: string[];
              assigneeId?: string;
              projectId?: string;
              priority?: number;
              estimate?: number;
              dueDate?: string;
              parentId?: string;
            }
          );
        const payload =
          parsed.data.parallel === true ? await call() : await gate(call);
        results.push({
          index: i,
          ok: payload.success ?? true,
          id: (payload.issue as unknown as { id?: string })?.id,
          identifier: (payload.issue as unknown as { identifier?: string })
            ?.identifier,
        });
      } catch (error) {
        await logger.error("create_issues", {
          message: "Failed to create issue",
          index: i,
          error: (error as Error).message,
        });
        results.push({
          index: i,
          ok: false,
          error: (error as Error).message,
          code: "LINEAR_CREATE_ERROR",
        });
      }
    }
    const summary = {
      ok: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).length,
    };
    const structured = CreateIssuesOutputSchema.parse({ results, summary });
    const okIds = results
      .filter((r) => r.ok)
      .map(
        (r) => r.identifier ?? r.id ?? `item[${String(r.index)}]`
      ) as string[];
    const failures = results
      .filter((r) => !r.ok)
      .map((r) => ({ index: r.index, error: r.error ?? "", code: undefined }));
    // Compose a richer message with links for created items
    const failureHints: string[] = [];
    if (summary.failed > 0) {
      // Provide actionable hints for common causes like invalid assigneeId
      failureHints.push(
        "If 'assigneeId' was invalid, fetch viewer id via 'workspace_metadata' (include: ['profile']) and use it to assign to yourself."
      );
      failureHints.push(
        "Alternatively use 'list_users' to find the correct user id, or omit 'assigneeId' and assign later with 'update_issues'."
      );
    }
    const summaryText = summarizeBatch({
      action: "Created issues",
      ok: summary.ok,
      total: items.length,
      okIdentifiers: okIds,
      failures,
      nextSteps: [
        "Use list_issues (filter by id or by number+team.key/team.id, limit=1) to verify details, or update_issues to modify.",
        ...failureHints,
      ],
    });
    const detailLines: string[] = [];
    for (const r of results.filter((r) => r.ok)) {
      try {
        const issue = await getLinearClient().issue(
          r.id ?? (r.identifier as string)
        );
        const idf =
          (issue as unknown as { identifier?: string })?.identifier ?? issue.id;
        const url = (issue as unknown as { url?: string })?.url as
          | string
          | undefined;
        const title = issue.title;
        let stateName: string | undefined;
        let projectName: string | undefined;
        let assigneeName: string | undefined;
        try {
          const s = await (
            issue as unknown as { state?: Promise<{ name?: string }> }
          ).state;
          stateName = s?.name ?? undefined;
        } catch {}
        try {
          const p = await (
            issue as unknown as { project?: Promise<{ name?: string }> }
          ).project;
          projectName = p?.name ?? undefined;
        } catch {}
        try {
          const a = await (
            issue as unknown as { assignee?: Promise<{ name?: string }> }
          ).assignee;
          assigneeName = a?.name ?? undefined;
        } catch {}
        let labelsList = "";
        try {
          labelsList = (await issue.labels()).nodes
            .map((l) => l.name)
            .slice(0, 5)
            .join(", ");
        } catch {}
        const dueDate = (issue as unknown as { dueDate?: string })?.dueDate;
        const priority = (issue as unknown as { priority?: number })?.priority;
        const header = url
          ? `[${idf} — ${title}](${url})`
          : `${idf} — ${title}`;
        const partsLine: string[] = [];
        if (stateName) {
          partsLine.push(`state ${stateName}`);
        }
        if (projectName) {
          partsLine.push(`project ${projectName}`);
        }
        if (labelsList) {
          partsLine.push(`labels ${labelsList}`);
        }
        if (typeof priority === "number") {
          partsLine.push(`priority ${priority}`);
        }
        if (dueDate) {
          partsLine.push(`due ${dueDate}`);
        }
        if (assigneeName) {
          partsLine.push(`assignee ${assigneeName}`);
        }
        const line =
          partsLine.length > 0 ? `${header} — ${partsLine.join("; ")}` : header;
        detailLines.push(`- ${line}`);
      } catch {}
    }
    const text =
      detailLines.length > 0
        ? `${summaryText}\n\n${detailLines.join("\n")}`
        : summaryText;
    const parts: Array<{ type: "text"; text: string }> = [
      { type: "text", text },
    ];
    if (config.LINEAR_MCP_INCLUDE_JSON_IN_CONTENT) {
      parts.push({ type: "text", text: JSON.stringify(structured) });
    }
    return { content: parts, structuredContent: structured };
  },
};

export const updateIssuesTool = {
  name: toolsMetadata.update_issues.name,
  title: toolsMetadata.update_issues.title,
  description: toolsMetadata.update_issues.description,
  inputSchema: UpdateIssuesInputSchema.shape,
  handler: async (args: unknown): Promise<CallToolResult> => {
    const parsed = UpdateIssuesInputSchema.safeParse(args);
    if (!parsed.success) {
      return {
        isError: true,
        content: [{ type: "text", text: parsed.error.message }],
      };
    }
    const client = getLinearClient();
    const gate = makeConcurrencyGate(config.CONCURRENCY_LIMIT);
    const { items } = parsed.data;
    const results: {
      index: number;
      ok: boolean;
      id?: string;
      error?: string;
      code?: string;
    }[] = [];
    const teamAllowZeroCache = new Map<string, boolean>();
    const diffLines: string[] = [];
    const abort = getCurrentAbortSignal();
    for (let i = 0; i < items.length; i++) {
      const it = items[i] as (typeof items)[number];
      try {
        // Snapshot BEFORE
        const beforeIssue = await gate(() => client.issue(it.id)).catch(
          () => undefined
        );
        const beforeSnapshot = await (async () => {
          if (!beforeIssue) {
            return undefined;
          }
          try {
            const s = await (
              beforeIssue as unknown as {
                state?: Promise<{ id?: string; name?: string }>;
              }
            ).state;
            const p = await (
              beforeIssue as unknown as {
                project?: Promise<{ id?: string; name?: string }>;
              }
            ).project;
            const a = await (
              beforeIssue as unknown as {
                assignee?: Promise<{ id?: string; name?: string }>;
              }
            ).assignee;
            const labels = await beforeIssue
              .labels()
              .then((r) => r.nodes.map((l) => ({ id: l.id, name: l.name })))
              .catch(() => [] as Array<{ id: string; name: string }>);
            const idf = (beforeIssue as unknown as { identifier?: string })
              ?.identifier;
            const url = (beforeIssue as unknown as { url?: string })?.url as
              | string
              | undefined;
            const dueDate = (beforeIssue as unknown as { dueDate?: string })
              ?.dueDate as string | undefined;
            const priority = (beforeIssue as unknown as { priority?: number })
              ?.priority as number | undefined;
            const estimate = (beforeIssue as unknown as { estimate?: number })
              ?.estimate as number | undefined;
            const archivedAt = (
              beforeIssue as unknown as { archivedAt?: Date | string | null }
            )?.archivedAt;
            return {
              id: beforeIssue.id as string,
              identifier: idf as string | undefined,
              title: beforeIssue.title as string,
              url,
              stateId:
                (beforeIssue as unknown as { stateId?: string })?.stateId ?? "",
              stateName: s?.name ?? undefined,
              projectId: (beforeIssue as unknown as { projectId?: string })
                ?.projectId,
              projectName: p?.name ?? undefined,
              assigneeId: (beforeIssue as unknown as { assigneeId?: string })
                ?.assigneeId,
              assigneeName: a?.name ?? undefined,
              priority,
              estimate,
              dueDate,
              labels,
              archivedAt: archivedAt ? String(archivedAt) : undefined,
            };
          } catch {
            return undefined;
          }
        })();

        const payloadInput: Record<string, unknown> = {};
        if (typeof it.title === "string" && it.title.trim() !== "") {
          payloadInput.title = it.title;
        }
        if (
          typeof it.description === "string" &&
          it.description.trim() !== ""
        ) {
          payloadInput.description = it.description;
        }
        if (typeof it.stateId === "string" && it.stateId) {
          payloadInput.stateId = it.stateId;
        }
        if (Array.isArray(it.labelIds) && it.labelIds.length > 0) {
          payloadInput.labelIds = it.labelIds;
        }
        if (typeof it.assigneeId === "string" && it.assigneeId) {
          payloadInput.assigneeId = it.assigneeId;
        }
        if (typeof it.projectId === "string" && it.projectId) {
          payloadInput.projectId = it.projectId;
        }
        if (typeof it.priority !== "undefined") {
          const n =
            typeof it.priority === "string" ? Number(it.priority) : it.priority;
          if (Number.isFinite(n) && (n as number) >= 0) {
            payloadInput.priority = n;
          }
        }
        if (typeof it.estimate === "number") {
          if (it.estimate > 0) {
            payloadInput.estimate = it.estimate;
          } else if (it.estimate === 0) {
            let allowZero =
              (it as unknown as { allowZeroEstimate?: boolean })
                .allowZeroEstimate === true;
            if (!allowZero) {
              // Try to infer the team from the issue itself
              try {
                const issue = await client.issue(it.id);
                const teamId = (issue as unknown as { teamId?: string })
                  ?.teamId;
                if (teamId) {
                  if (teamAllowZeroCache.has(teamId)) {
                    allowZero = teamAllowZeroCache.get(teamId) === true;
                  } else {
                    const team = await client.team(teamId);
                    allowZero =
                      ((
                        team as unknown as {
                          issueEstimationAllowZero?: boolean;
                        }
                      ).issueEstimationAllowZero ?? false) === true;
                    teamAllowZeroCache.set(teamId, allowZero);
                  }
                }
              } catch {
                // ignore; fall back to not allowing zero
              }
            }
            if (allowZero) {
              payloadInput.estimate = 0;
            }
          }
        }
        if (typeof it.dueDate === "string" && it.dueDate.trim() !== "") {
          payloadInput.dueDate = it.dueDate;
        }
        if (typeof it.parentId === "string" && it.parentId) {
          payloadInput.parentId = it.parentId;
        }

        if (abort?.aborted) {
          throw new Error("Operation aborted");
        }
        const payload =
          parsed.data.parallel === true
            ? await client.updateIssue(it.id, payloadInput)
            : await gate(() => client.updateIssue(it.id, payloadInput));
        if (it.addLabelIds?.length || it.removeLabelIds?.length) {
          const issue = await gate(() => client.issue(it.id));
          const current = new Set(
            (await issue.labels()).nodes.map((l) => l.id)
          );
          it.addLabelIds?.forEach((id) => current.add(id));
          it.removeLabelIds?.forEach((id) => current.delete(id));
          await (parsed.data.parallel === true
            ? client.updateIssue(it.id, { labelIds: Array.from(current) })
            : gate(() =>
                client.updateIssue(it.id, { labelIds: Array.from(current) })
              ));
        }
        // Handle archive/unarchive using SDK helpers
        if (typeof (it as { archived?: boolean }).archived === "boolean") {
          try {
            const targetArchived =
              (it as { archived?: boolean }).archived === true;
            if (targetArchived) {
              const anyClient = client as unknown as {
                archiveIssue?: (id: string) => Promise<unknown>;
              };
              if (typeof anyClient.archiveIssue === "function") {
                await (parsed.data.parallel === true
                  ? anyClient.archiveIssue?.(it.id)
                  : gate(
                      () => anyClient.archiveIssue?.(it.id) as Promise<unknown>
                    ));
              }
            } else {
              const anyClient = client as unknown as {
                unarchiveIssue?: (id: string) => Promise<unknown>;
              };
              if (typeof anyClient.unarchiveIssue === "function") {
                await (parsed.data.parallel === true
                  ? anyClient.unarchiveIssue?.(it.id)
                  : gate(
                      () =>
                        anyClient.unarchiveIssue?.(it.id) as Promise<unknown>
                    ));
              }
            }
          } catch {
            // ignore archive errors to preserve other updates; surfaced by verification
          }
        }
        results.push({ index: i, ok: payload.success ?? true, id: it.id });

        // Snapshot AFTER
        const afterIssue = await gate(() => client.issue(it.id)).catch(
          () => undefined
        );
        const afterSnapshot = await (async () => {
          if (!afterIssue) {
            return undefined;
          }
          try {
            const s = await (
              afterIssue as unknown as {
                state?: Promise<{ id?: string; name?: string }>;
              }
            ).state;
            const p = await (
              afterIssue as unknown as {
                project?: Promise<{ id?: string; name?: string }>;
              }
            ).project;
            const a = await (
              afterIssue as unknown as {
                assignee?: Promise<{ id?: string; name?: string }>;
              }
            ).assignee;
            const labels = await afterIssue
              .labels()
              .then((r) => r.nodes.map((l) => ({ id: l.id, name: l.name })))
              .catch(() => [] as Array<{ id: string; name: string }>);
            const idf = (afterIssue as unknown as { identifier?: string })
              ?.identifier;
            const url = (afterIssue as unknown as { url?: string })?.url as
              | string
              | undefined;
            const dueDate = (afterIssue as unknown as { dueDate?: string })
              ?.dueDate as string | undefined;
            const priority = (afterIssue as unknown as { priority?: number })
              ?.priority as number | undefined;
            const estimate = (afterIssue as unknown as { estimate?: number })
              ?.estimate as number | undefined;
            const archivedAt = (
              afterIssue as unknown as { archivedAt?: Date | string | null }
            )?.archivedAt;
            return {
              id: afterIssue.id as string,
              identifier: idf as string | undefined,
              title: afterIssue.title as string,
              url,
              stateId:
                (afterIssue as unknown as { stateId?: string })?.stateId ?? "",
              stateName: s?.name ?? undefined,
              projectId: (afterIssue as unknown as { projectId?: string })
                ?.projectId,
              projectName: p?.name ?? undefined,
              assigneeId: (afterIssue as unknown as { assigneeId?: string })
                ?.assigneeId,
              assigneeName: a?.name ?? undefined,
              priority,
              estimate,
              dueDate,
              labels,
              archivedAt: archivedAt ? String(archivedAt) : undefined,
            };
          } catch {
            return undefined;
          }
        })();

        // Compose compact change summary if we have snapshots
        if (afterSnapshot) {
          const header = (() => {
            const title = afterSnapshot.url
              ? `[${
                  (afterSnapshot.identifier ?? afterSnapshot.id) as string
                } — ${afterSnapshot.title}](${afterSnapshot.url})`
              : `${
                  (afterSnapshot.identifier ?? afterSnapshot.id) as string
                } — ${afterSnapshot.title}`;
            return `- ${title} (id ${afterSnapshot.id})`;
          })();
          const changes: string[] = [];
          // Derive before values (names preferred) when available
          const b = beforeSnapshot;
          const a = afterSnapshot;
          // Only report diffs for fields that were requested
          if (Object.hasOwn(it, "title")) {
            if (b?.title !== a.title) {
              changes.push(`Title: ${b?.title ?? "—"} → ${a.title ?? "—"}`);
            }
          }
          if (Object.hasOwn(it, "stateId")) {
            if ((b?.stateName ?? "") !== (a.stateName ?? "")) {
              changes.push(
                `State: ${b?.stateName ?? "—"} → ${a.stateName ?? "—"}`
              );
            }
          }
          if (Object.hasOwn(it, "assigneeId")) {
            if ((b?.assigneeName ?? "") !== (a.assigneeName ?? "")) {
              changes.push(
                `Assignee: ${b?.assigneeName ?? "—"} → ${a.assigneeName ?? "—"}`
              );
            }
          }
          if (Object.hasOwn(it, "projectId")) {
            if ((b?.projectName ?? "") !== (a.projectName ?? "")) {
              changes.push(
                `Project: ${b?.projectName ?? "—"} → ${a.projectName ?? "—"}`
              );
            }
          }
          if (Object.hasOwn(it, "priority")) {
            if ((b?.priority ?? "—") !== (a.priority ?? "—")) {
              changes.push(
                `Priority: ${b?.priority ?? "—"} → ${a.priority ?? "—"}`
              );
            }
          }
          if (Object.hasOwn(it, "estimate")) {
            if ((b?.estimate ?? "—") !== (a.estimate ?? "—")) {
              changes.push(
                `Estimate: ${b?.estimate ?? "—"} → ${a.estimate ?? "—"}`
              );
            }
          }
          if (Object.hasOwn(it, "dueDate")) {
            if ((b?.dueDate ?? "—") !== (a.dueDate ?? "—")) {
              changes.push(
                `Due date: ${b?.dueDate ?? "—"} → ${a.dueDate ?? "—"}`
              );
            }
          }
          // Labels diff if labelIds/add/remove were provided
          if (
            Object.hasOwn(it, "labelIds") ||
            Object.hasOwn(it, "addLabelIds") ||
            Object.hasOwn(it, "removeLabelIds")
          ) {
            const beforeNames = new Set((b?.labels ?? []).map((l) => l.name));
            const afterNames = new Set((a.labels ?? []).map((l) => l.name));
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
            const parts: string[] = [];
            if (added.length) {
              parts.push(`+${added.join(", ")}`);
            }
            if (removed.length) {
              parts.push(`−${removed.join(", ")}`);
            }
            if (parts.length) {
              changes.push(`Labels: ${parts.join("; ")}`);
            }
          }
          // Archive status diff if requested
          if (Object.hasOwn(it, "archived")) {
            const beforeArchived = Boolean(b?.archivedAt);
            const afterArchived = Boolean(a.archivedAt);
            if (beforeArchived !== afterArchived) {
              changes.push(
                `Archived: ${beforeArchived ? "Yes" : "No"} → ${
                  afterArchived ? "Yes" : "No"
                }`
              );
            }
          }
          const line =
            changes.length > 0
              ? `${header}\n  ${changes.join("\n  ")}`
              : header;
          diffLines.push(line);
        }
      } catch (error) {
        await logger.error("update_issues", {
          message: "Failed to update issue",
          id: it.id,
          error: (error as Error).message,
        });
        results.push({
          index: i,
          ok: false,
          id: it.id,
          error: (error as Error).message,
          code: "LINEAR_UPDATE_ERROR",
        });
      }
    }
    const summary = {
      ok: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).length,
    };
    const structured = UpdateIssuesOutputSchema.parse({ results, summary });
    const okIds = results
      .filter((r) => r.ok)
      .map((r) => r.id ?? `item[${String(r.index)}]`) as string[];
    const failures = results
      .filter((r) => !r.ok)
      .map((r) => ({
        index: r.index,
        id: r.id,
        error: r.error ?? "",
        code: undefined,
      }));
    const archivedRequested = items.some(
      (x) => typeof (x as { archived?: boolean }).archived === "boolean"
    );
    const base = summarizeBatch({
      action: "Updated issues",
      ok: summary.ok,
      total: items.length,
      okIdentifiers: okIds,
      failures,
      nextSteps: [
        archivedRequested
          ? "Use list_issues (filter by id or by number+team.key/team.id, includeArchived: true, limit=1) for verification and to confirm filters/states."
          : "Use list_issues (filter by id or by number+team.key/team.id, limit=1) for verification and to confirm filters/states.",
      ],
    });
    const text =
      diffLines.length > 0 ? `${base}\n\n${diffLines.join("\n")}` : base;
    const parts: Array<{ type: "text"; text: string }> = [
      { type: "text", text },
    ];
    if (config.LINEAR_MCP_INCLUDE_JSON_IN_CONTENT) {
      parts.push({ type: "text", text: JSON.stringify(structured) });
    }
    return { content: parts, structuredContent: structured };
  },
};
