### Linear MCP - Code Review (Functional Programming and Organization)

This review evaluates `linear/` against the practices in `_spec/_manual/00_general.md`, with emphasis on functional programming, LLM-first interfaces, and code organization.

### Summary

The Linear MCP codebase is well-structured, schema-driven, and largely aligned with the manual: strong Zod validation, centralized tool metadata, deterministic outputs, and a clean HTTP transport. Primary improvement areas are: eliminating empty catch blocks, extracting pure mappers to reduce casting, adopting data-first transformations, optional server-side defaults for recency windows, and wiring concurrency/limits/cancellation utilities that already exist.

### What’s great

- **Clear server instructions and centralized tool metadata**
  - `serverMetadata.instructions` and `toolsMetadata` guide LLMs and prevent drift.
- **Zod-first inputs/outputs with .strict() and .describe()**
  - Natural-language descriptions, explicit enums, and consistent pagination shapes.
- **Deterministic responses**
  - `content` for human summary + `structuredContent` validated by Zod across tools.
- **Transport matches spec**
  - Streamable HTTP with `/mcp` POST/GET/DELETE, `Mcp-Session-Id`, protocol-version and origin validation, OAuth RS challenge.
- **Safety and helpful UX**
  - Pagination via `cursor/nextCursor/limit`, descriptive previews and next-steps, actionable error messages for parse failures.

### Findings and recommendations

#### 1) Empty catch blocks (violates “Never catch without meaningful handling”)

Replace silent catches with handled Result-style errors, logging, or at least contextual messages. Examples:

- `linear/src/tools/account.tool.ts` (fetching individual teams)
- `linear/src/core/tokens.ts` (persistence I/O)
- `linear/src/tools/issues.tool.ts` (optional relations like state/project/assignee)

Example pattern to avoid:

```typescript
try {
  // ...
} catch {
  // swallowed
}
```

Action: introduce small helpers like `safe<T>(promise): Promise<Result<T,string>>` or wrap in per-tool error paths with informative messages and optional `code` (e.g., "LINEAR_FETCH_ERROR"). At minimum, log at `debug` to aid observability.

#### 2) Excessive casting to unknown instead of type guards

There’s frequent `(x as unknown as { ... })` to access SDK internals. Create reusable type guards and pure mappers to avoid repeated casts and improve readability.

- Add guards: `isIssueLike`, `isProjectLike`, `isUserLike`, `hasUrl`, etc.
- Extract pure mappers: `mapIssueNodeToListItem`, `mapIssueToDetail`, `mapProjectNodeToListItem` and unit-test them in isolation.

This improves safety and aligns with “Prefer unknown + type guards; compose small functions; avoid deep nesting.”

#### 3) Prefer data-first, immutable transforms over push/loops

Many handlers build arrays with `for` loops and `push`. Replace with `map/filter/reduce` and pure helpers. This reduces mutation and clarifies intent.

- Example targets: `createIssuesTool`, `updateIssuesTool`, `listIssuesTool`, `listUsersTool`, `listCommentsTool`.
- Keep side effects at boundaries (actual calls to Linear SDK). Everything else should be pure and testable.

#### 4) Concurrency, rate limits, cancellation, and progress

The project ships utilities and config but tools don’t yet use them:

- `config.CONCURRENCY_LIMIT`, `config.RPS_LIMIT`; `utils/limits.ts` (token bucket/gates) — not wired in tool calls
- `utils/cancellation.ts` — no `AbortSignal` propagation
- `utils/progress.ts` — no progress notifications on long-running batches

Action: wrap Linear SDK calls with a gate (e.g., `withConcurrencyGate`, `withRateLimitGate`), accept/propagate an `AbortSignal` in tool handlers, and send `notifications/progress` for multi-item writes.

#### 5) Optional server-side default recency window

The instructions advise a client default window (current week by viewer timezone). Tools currently do not enforce a fallback. Consider a conservative server-side default when `filter.updatedAt` is absent to prevent accidental wide scans, especially for `list_issues` and `list_my_issues`.

- Derive viewer timezone via `viewer` or omit when unavailable; include a clear hint in `content` when the default is applied.

#### 6) Structured error codes

Most error returns set `isError: true` with text only. Add stable `code` fields to aid programmatic handling (e.g., `INVALID_INPUT`, `LINEAR_UNAUTHORIZED`, `LINEAR_RATE_LIMITED`, `CYCLES_DISABLED`).

#### 7) Pagination metadata consistency

`PageInfoSchema` includes `total`, but most list tools don’t surface it. If the Linear API can provide totals cheaply, populate `total`. If not, consider omitting `total` from the schema or explicitly documenting `total` as often unavailable.

#### 8) Leverage existing logger

Only transport-level logging is wired. Add per-tool `logger.info/debug/error` with event names and minimal context (tool name, args shape, item counts, durations). Avoid logging secrets.

#### 9) Naming and readability nits

- Replace loop indices `i` with descriptive names where practical (manual discourages single-letter names).
- Flatten nested try/catch where possible with early returns and composable helpers.

### File-by-file notes (selected)

- `src/config/metadata.ts`: Excellent, LLM-first instructions and detailed tool docs; keep this as the single source of tool narratives.
- `src/schemas/inputs.ts` / `outputs.ts`: Strong `.strict()` usage, good descriptions. Consider extracting discriminated unions for write operations if behavior branches (e.g., archive vs update).
- `src/tools/issues.tool.ts`: Solid list/batch operations and previews. Improve with pure mappers, error codes, concurrency gates, and optional default date window.
- `src/tools/projects.tool.ts`: Batch create/update is clean; again, add guarded error handling and logger + concurrency gates.
- `src/tools/comments.tool.ts`: Good UX on previews; same recommendations for mappers and error handling.
- `src/tools/account.tool.ts`: Useful bootstrap. Replace empty catches, add logger, and surface partial failures in `structuredContent` when sub-fetches fail.
- `src/http/*`: Transport is clean and aligned with spec; security middleware is thoughtful (origin, protocol version, OAuth RS challenge). Consider minimal metrics and debug logging on error paths.
- `src/core/tokens.ts`: Good persistence abstraction. Replace silent catches and consider explicit error returns for malformed files. Ensure these Node-only imports are guarded for Worker builds (already commented in header).
- `src/utils/filters.ts`: Nice `normalizeIssueFilter`; consider tests for alias mapping and nested comparator paths.
- `src/utils/messages.ts`: Helpful summaries; keep messages short and actionable.

### Quick wins (prioritized)

1. Remove empty catch blocks; add error codes and lightweight logging.
2. Extract pure mappers + type guards for Issues/Projects/Users/Comments.
3. Wire concurrency/rate-limit gates in write-heavy tools; honor the `parallel` flag safely.
4. Optionally enforce a conservative default date window server-side for `list_issues` to avoid broad scans.
5. Add `AbortSignal` propagation and progress notifications for batch tools.
6. Populate `total` in pagination when cheap; otherwise document it as unavailable.

### Optional examples (sketches)

- Type guard pattern for SDK bits (replace repeated casts):

```typescript
function hasName<T extends object>(x: unknown): x is T & { name?: string } {
  return Boolean(x && typeof (x as { name?: unknown }).name !== "undefined");
}
```

- Pure mapper stub:

```typescript
function mapIssueNodeToListItem(
  node: SDK.Issue
): ListIssuesOutput["items"][number] {
  // read-only mapping; no side effects
}
```

### Compliance snapshot vs manual

- **LLM-first design**: strong
- **Zod validation and determinism**: strong
- **Functional style (purity, composition, guards)**: moderate -> improve
- **Error handling (no silent catches, structured codes)**: moderate -> improve
- **Concurrency/limits/cancellation/progress**: available but not wired -> improve
- **Transport/security**: strong

---

If useful, I can follow up with targeted edits starting with error handling + pure mappers in `issues.tool.ts` and concurrency gates in batch tools.
