# MCP Tool Design Guide (Lessons from `linear-mcp`)

This guide documents the interface decisions behind the Linear MCP tools: schemas that *teach* the agent how to call them, responses that are easy to scan, and runtime behavior that stays safe and reliable under agentic workloads. Use it as a checklist when adding or refining tools.

## 1. Self-Documented Tool Contracts (Zero Context Required)

Goal: an LLM can use the tools correctly **without knowing Linear’s API** (or reading external docs). The tool surface must be self-explanatory at the point of use.

- **Centralized descriptions**: Tool `name/title/description` live in `src/config/metadata.ts`, not scattered across implementations. This keeps instructions consistent and makes “prompt quality” easy to iterate on.
- **Schema-level documentation**: Zod `.describe()` is used to explain *what a field means*, *where its value comes from*, and *how to recover when it’s missing* (e.g., “use workspace_metadata to find IDs”). This is especially important for non-obvious inputs like `cursor`, `matchMode`, `assignedToMe`, `includeArchived`, `parallel`, and `dry_run`.
- **Closed-loop discoverability**: If a field expects an ID, the schema should point to the tool that can produce it (typically `workspace_metadata` or a `list_*` tool), so the agent can always get unstuck.

## 2. High-Signal Responses (Fast to Understand, Low Noise)

MCP responses always include `content[]`. We treat the first text block as the agent’s **status line** and design it for quick comprehension.

- **Human-readable summary (`content[0].text`)**: Short, scannable feedback using `summarizeList` / `summarizeBatch`. It should answer: *did it work, how many items, what should I look at next?*
- **Structured output (`structuredContent`)**: Schema-validated data for chaining, UIs, and deterministic follow-up calls.
- **Built-in guidance**: Prefer `meta.nextSteps` and `meta.relatedTools` on successful responses. For zero-result lists, include `meta.hints` (e.g., “verify teamId”, “try broader keywords”) so the agent can reframe the query instead of guessing.

Tip: We avoid dumping raw JSON into the human channel by default. When debugging integrations, `LINEAR_MCP_INCLUDE_JSON_IN_CONTENT` can include it explicitly.

## 3. Curated Surface Area (Less API, More Intent)

Provider APIs are optimized for developers, not agents. The MCP layer intentionally trades completeness for clarity:

- **Fewer tools**: We expose a small set of actions that match how users actually work (discover IDs, list/get issues, create/update issues, comments, projects, teams/users, cycles).
- **Fewer props**: We omit internal or confusing fields (e.g., ordering internals like `prioritySortOrder`, or complex editor formats like Prosemirror `descriptionData`).
- **Simpler shapes**: When the provider expects complex shapes, we map to agent-friendly inputs (e.g., `teamId` instead of `teamIds[]` for project creation).

## 4. Batch-First Writes (Index-Stable and Failure-Tolerant)

Agents frequently need to apply the same action to many items. Write tools are designed to batch cleanly and safely.

- **Index-stable contract**: `results[i]` always corresponds to `items[i]`. This allows the agent to map failures back to its original intent without ambiguity.
- **Per-item outcomes**: One failed item should not abort the entire batch; each result includes success/error details.
- **Clear rollups**: Responses include a `summary` (`total/succeeded/failed`) plus actionable follow-ups.
- **Predictable caps**: Batch inputs are capped (commonly 50 items) to keep latency reasonable and reduce rate-limit risk.
- **Optional validation runs**: High-impact tools like `create_issues` and `update_issues` support `dry_run: true` so the agent can validate payloads and name resolution without writing.
- **Controlled parallelism**: Some batch tools accept `parallel: true`, but still self-throttle internally to protect the provider API.

## 5. Human Inputs + Resolvers (Names Over UUIDs)

LLMs are strong at names and weak at opaque identifiers. Tools accept human-like inputs and resolve them internally.

- **Name-first inputs**: Accept fields like `stateName`, `stateType`, `labelNames`, `assigneeName`, `assigneeEmail`, and `projectName`.
- **Helpful resolution failures**: When resolution fails, return suggestions (e.g., similar state/label names) so the agent can self-correct in the next call.
- **Semantic normalization**: Accept priority as strings (“High”, “Urgent”) and map to provider integers so the agent doesn’t need to memorize encoding.
- **Smart defaults**: When it is safe and expected, default missing values (e.g., issue creation defaults assignee to the current viewer).

## 6. Actionable Errors + Recovery Paths

Errors are part of the interface. They must be recoverable without manual digging.

- **Actionable hints**: Errors map to an `ErrorCode` and come with a next-step hint (e.g., `NOT_FOUND` → “use workspace_metadata or list tools to find valid IDs”).
- **Concrete suggestions**: Error payloads include `suggestions[]` whenever the tool can propose fixes (valid values, similar names, follow-up tools).
- **Validation that teaches**: For invalid filters or inputs, the error message should explain *what was wrong* and show an example of the correct shape.

## 7. Production-Grade Tooling (Reliability Under Agent Load)

Agents can be bursty, repetitive, and overly parallel. The tools include guardrails so they remain robust in production.

- **Input validation**: Every tool validates inputs via Zod before doing any external work.
- **Cancellation support**: Handlers respect `AbortSignal` where possible to stop long-running batches.
- **Rate-limit resilience**: Batch tools use concurrency gates, small delays, and retries with backoff (`withRetry`) to survive transient provider failures.
- **N+1 avoidance**: List endpoints fetch related data in a single GraphQL query where possible (assignee/state/project/labels), reducing latency and follow-up calls.
- **Output validation**: Tools parse and validate `structuredContent` against output schemas to keep contracts stable over time.

## 8. Safety by Design (Explicit Side Effects, Reversible Defaults)

We encode safety into both the tool surface and the tool metadata.

- **Explicit side-effect hints**: Tools set `readOnlyHint` and `destructiveHint` so clients can apply guardrails (e.g., auto-run reads; confirm writes).
- **Reversible operations**: We prefer archive/unarchive patterns over hard deletes, and we omit destructive actions from the exposed tool set by default.
- **Small, intentional interfaces**: The safest tool is the one you don’t expose. The MCP layer stays intentionally limited compared to the full provider API.
