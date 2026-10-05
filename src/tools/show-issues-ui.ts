import * as z from 'zod/v4';
import { defineTool } from '../platform/primitives';
import { ISSUES_UI_URI } from '../resources/issues-ui';
import { ShowIssuesUIOutputSchema } from './shared/outputs';

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

/**
 * Opens the interactive issues dashboard (`ui://linear/issues`). The host renders the
 * resource named in `_meta.ui.resourceUri` (SEP-1865); the tool itself calls nothing.
 */
export const showIssuesUi = defineTool(
  'show_issues_ui',
  {
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
  },
  (args) => {
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
      _meta: { ui: { resourceUri: ISSUES_UI_URI } },
    };
  },
);
