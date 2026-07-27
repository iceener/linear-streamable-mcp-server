/**
 * Show Issues UI tool.
 *
 * Opens an interactive Linear issues dashboard UI.
 * The UI allows users to browse, filter, and manage issues visually.
 */

import { z } from 'zod/v4';
import { ShowIssuesUIOutputSchema } from '../../../schemas/outputs.js';
import { defineTool, type ToolContext, type ToolResult } from '../types.js';

const UI_RESOURCE_URI = 'ui://linear/issues';

const InputSchema = z.object({
  /** Optional team ID to pre-filter issues */
  teamId: z.string().optional().describe('Team ID to pre-filter issues'),
  /** Optional state type to pre-filter issues */
  stateType: z
    .enum(['started', 'unstarted', 'backlog', 'completed', 'cancelled'])
    .optional()
    .describe('State type to pre-filter'),
  /** Whether to show only issues assigned to the current user */
  assignedToMe: z.boolean().optional().describe('Show only my issues'),
});

export const showIssuesUITool = defineTool({
  name: 'show_issues_ui',
  title: 'Show Issues Dashboard',
  description:
    'Opens an interactive Linear issues dashboard. The UI displays issues in a dark, minimalistic Linear-style interface where users can browse, filter, and manage issues visually. Use this when the user wants to see their issues in a visual interface rather than text output.',
  inputSchema: InputSchema,
  outputSchema: ShowIssuesUIOutputSchema,
  annotations: {
    title: 'Show Issues Dashboard',
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: false,
  },

  handler: async (args, _context: ToolContext): Promise<ToolResult> => {
    // Build a message describing what the UI will show
    const filters: string[] = [];
    if (args.teamId) filters.push(`team: ${args.teamId}`);
    if (args.stateType) filters.push(`state: ${args.stateType}`);
    if (args.assignedToMe) filters.push('assigned to you');

    const filterDesc = filters.length > 0 ? ` (filtered by ${filters.join(', ')})` : '';

    return {
      content: [
        {
          type: 'text',
          text: `Opening Linear Issues Dashboard${filterDesc}. The interactive UI will display below.`,
        },
      ],
      structuredContent: {
        action: 'show_issues_ui',
        filters: {
          teamId: args.teamId,
          stateType: args.stateType,
          assignedToMe: args.assignedToMe,
        },
        message: `Linear Issues Dashboard${filterDesc}`,
      },
      // SEP-1865: Return UI resource URI in _meta for the host to render
      _meta: {
        ui: {
          resourceUri: UI_RESOURCE_URI,
        },
      },
    } as ToolResult & { _meta: Record<string, unknown> };
  },
});
