import type { McpServer } from '@modelcontextprotocol/server';

/** The pre-migration Linear contract does not expose prompts. */
export function registerPrompts(_server: McpServer): void {}
