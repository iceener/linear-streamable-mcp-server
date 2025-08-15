import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { accountTool } from "./account.tool.ts";
import { addCommentsTool, listCommentsTool } from "./comments.tool.ts";
import { listCyclesTool } from "./cycles.tool.ts";
import {
  createIssuesTool,
  listIssuesTool,
  listMyIssuesTool,
  updateIssuesTool,
} from "./issues.tool.ts";
import {
  createProjectsTool,
  listProjectsTool,
  updateProjectsTool,
} from "./projects.tool.ts";
import { listTeamsTool, listUsersTool } from "./teams-users.tool.ts";

export function registerTools(server: McpServer): void {
  const tools = [
    // Registered as workspace_metadata for clarity to LLMs
    {
      ...accountTool,
      name: "workspace_metadata",
      title: "Workspace Metadata & IDs",
    },

    listIssuesTool,
    listMyIssuesTool,
    createIssuesTool,
    updateIssuesTool,
    listProjectsTool,
    createProjectsTool,
    updateProjectsTool,
    listTeamsTool,
    listUsersTool,
    listCyclesTool,
    listCommentsTool,
    addCommentsTool,
  ];

  for (const t of tools) {
    server.registerTool(
      t.name,
      {
        description: t.description,
        // Pass Zod shapes directly; the SDK handles conversion for discovery
        inputSchema: t.inputSchema,
        annotations: { title: t.title },
      },
      (args: unknown) => t.handler(args as unknown)
    );
  }
}
