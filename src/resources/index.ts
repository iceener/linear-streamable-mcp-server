import type { McpServer } from '@modelcontextprotocol/server';
import { issuesUIMetadata, issuesUIResource } from './issues-ui.resource.js';

/** Register the existing Linear issues UI through the public v2 resource API. */
export function registerResources(server: McpServer): void {
  server.registerResource(
    issuesUIMetadata.name,
    issuesUIMetadata.uri,
    {
      description: issuesUIMetadata.description,
      mimeType: issuesUIMetadata.mimeType,
      cacheHint: { ttlMs: 60_000, cacheScope: 'private' },
    },
    async () => issuesUIResource.handler(),
  );
}
