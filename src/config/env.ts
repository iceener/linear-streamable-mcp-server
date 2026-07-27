import { parseConfig } from '../shared/config/env.js';

export {
  parseConfig,
  type UnifiedConfig,
} from '../shared/config/env.js';

/**
 * Compatibility defaults for direct tool-level tests. Deployed runtimes inject
 * their parsed configuration through ToolContext and never mutate this object.
 */
export const config = parseConfig({
  NODE_ENV: 'test',
  AUTH_ENABLED: 'false',
});
