/**
 * Global test setup for Linear MCP tests (vitest).
 * Configures mocks and environment before tests run.
 */

import { vi } from 'vitest';

// Mock environment variables for tests
process.env.LINEAR_ACCESS_TOKEN = 'test-token-xxx';
process.env.LINEAR_MCP_INCLUDE_JSON_IN_CONTENT = 'false';

// Mock the Linear client module before any imports
vi.mock('../src/services/linear/client.js', async () => {
  const { createMockLinearClient } = await import('./mocks/linear-client.js');
  return {
    getLinearClient: vi.fn(() => Promise.resolve(createMockLinearClient())),
  };
});

export { createMockLinearClient, type MockLinearClient } from './mocks/linear-client.js';
