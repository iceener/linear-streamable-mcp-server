// Re-export commonly used types from schemas

export type {
  AccountInput,
  CreateIssuesInput,
  ListIssuesInput,
  ListProjectsInput,
  ListTeamsInput,
  ListUsersInput,
  UpdateIssuesInput,
} from '../schemas/inputs.js';
export type {
  AccountOutput,
  CreateIssuesOutput,
  GetIssueOutput,
  GetIssuesOutput,
  ListCommentsOutput,
  ListCyclesOutput,
  ListIssuesOutput,
  ListProjectsOutput,
  ListTeamsOutput,
  ListUsersOutput,
  UpdateIssuesOutput,
} from '../schemas/outputs.js';

// Service layer types
export interface ApiError extends Error {
  status?: number;
  code?: string;
}

export interface ServiceResponse<T = unknown> {
  data: T;
  success: boolean;
  error?: string;
}

// HTTP client types
export interface RetryConfig {
  attempts: number;
  delay: number;
  backoff: 'linear' | 'exponential';
}

export interface RateLimitConfig {
  rps: number;
  burst: number;
}

// Tracing and observability
export interface TraceContext {
  traceId: string;
  spanId: string;
  requestId?: string;
  sessionId?: string;
}

export interface MetricPoint {
  name: string;
  value: number;
  tags?: Record<string, string>;
  timestamp?: number;
}
