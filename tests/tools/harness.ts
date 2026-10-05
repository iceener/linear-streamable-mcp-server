import type { CallToolResult, McpServer, ToolAnnotations } from '@modelcontextprotocol/server';
import type * as z from 'zod/v4';
import type { Definition } from '../../src/platform/primitives';
import type { Deps } from '../../src/server';
import { type CallToolOptions, callTool, linearFactory, signedIn, testDeps } from '../helpers';

/** What a tool test passes as the caller: a signed-in user with this Linear token. */
export interface CallerContext {
  linearProviderAccessToken?: string;
  [key: string]: unknown;
}

/**
 * A list whose first two entries a test reads directly. The assertions on the length come
 * first, so these are known to exist; the type says so under `noUncheckedIndexedAccess`.
 */
export type Rows<T = Record<string, unknown>> = T[] & { 0: T; 1: T };

/** A text block, as every Linear tool answers. */
export type TextBlock = { type: 'text'; text: string; [key: string]: unknown };

/** A result as the client receives it, with the structured content open for assertions. */
export type ToolCallResult = Omit<CallToolResult, 'content'> & {
  content: Rows<TextBlock>;
  // biome-ignore lint/suspicious/noExplicitAny: tests read arbitrary fields of the result.
  structuredContent?: any;
};

export interface ToolUnderTest {
  name: string;
  title?: string;
  description: string;
  annotations?: ToolAnnotations;
  inputSchema: z.ZodObject;
  outputSchema?: z.ZodObject;
  /** Call the tool through the in-process SDK client, as `caller`. */
  handler(args: Record<string, unknown>, caller?: CallerContext): Promise<ToolCallResult>;
  /**
   * The registered callback's own result, before the SDK serializes it, so fields that hold
   * `undefined` are still there. Only for assertions about the handler's raw result.
   */
  direct(args: Record<string, unknown>, caller?: CallerContext): Promise<ToolCallResult>;
}

/**
 * A tool's published definition, read by registering it, and a `handler` that calls it the way
 * a client does: through the SDK's input and output validation, the platform's error policy,
 * and `withLinear`. `linear()` gives the Linear client the tool gets, usually a mock.
 */
export function toolUnderTest(
  definition: Definition,
  linear: () => unknown,
  options: Omit<CallToolOptions, 'linear' | 'authInfo'> = {},
): ToolUnderTest {
  let published: Omit<ToolUnderTest, 'handler' | 'direct'> | undefined;
  const capture = {
    registerTool: (name: string, config: Omit<ToolUnderTest, 'handler' | 'direct' | 'name'>) => {
      published = { name, ...config };
    },
  };
  definition.register(capture as unknown as McpServer, {} as Deps);
  if (!published) throw new Error(`${definition.name} is not a tool`);

  const callback = (deps: Deps) => {
    let registered: ((args: unknown, ctx: unknown) => Promise<ToolCallResult>) | undefined;
    definition.register(
      {
        registerTool: (_name: string, _config: unknown, run: typeof registered) => {
          registered = run;
        },
      } as unknown as McpServer,
      deps,
    );
    return registered as NonNullable<typeof registered>;
  };

  const name = published.name;
  return {
    ...published,
    handler: async (args, caller = {}) =>
      (await callTool(name, args, {
        ...options,
        linear: linear(),
        authInfo: caller.linearProviderAccessToken
          ? signedIn(caller.linearProviderAccessToken)
          : null,
      })) as ToolCallResult,
    direct: (args, caller = {}) =>
      callback(testDeps({ linear: linearFactory(linear()), ...options.deps }))(args, {
        mcpReq: { id: 1, signal: new AbortController().signal, notify: async () => {} },
        http: {
          ...(caller.linearProviderAccessToken && {
            authInfo: signedIn(caller.linearProviderAccessToken),
          }),
        },
      }),
  };
}
