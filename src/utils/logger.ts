export type LogLevel =
  | 'debug'
  | 'info'
  | 'notice'
  | 'warning'
  | 'error'
  | 'critical'
  | 'alert'
  | 'emergency';

const LOG_SEVERITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  notice: 2,
  warning: 3,
  error: 4,
  critical: 5,
  alert: 6,
  emergency: 7,
};

function sanitizeLogData(data: unknown): unknown {
  if (typeof data !== 'object' || data === null) return data;
  const sanitized = { ...data } as Record<string, unknown>;
  const sensitivePatterns = [
    'password',
    'token',
    'secret',
    'key',
    'authorization',
    'apikey',
    'api_key',
    'credential',
    'private',
  ];
  for (const key of Object.keys(sanitized)) {
    if (sensitivePatterns.some((pattern) => key.toLowerCase().includes(pattern))) {
      sanitized[key] = '[REDACTED]';
    }
  }
  return sanitized;
}

/** Console-only provider logger; protocol logging is deprecated in 2026-07-28. */
class Logger {
  private currentLevel: LogLevel = 'info';

  setLevel(level: string): void {
    if (level in LOG_SEVERITY) this.currentLevel = level as LogLevel;
  }

  private async log(level: LogLevel, loggerName: string, data: unknown): Promise<void> {
    if (LOG_SEVERITY[level] < LOG_SEVERITY[this.currentLevel]) return;
    const sanitized = sanitizeLogData(data);
    const logData =
      typeof sanitized === 'object'
        ? JSON.stringify(sanitized, null, 2)
        : String(sanitized);
    console.log(
      `[${new Date().toISOString()}] ${level.toUpperCase()} ${loggerName}: ${logData}`,
    );
  }

  debug(loggerName: string, data?: unknown): Promise<void> {
    return this.log('debug', loggerName, data ?? {});
  }
  info(loggerName: string, data?: unknown): Promise<void> {
    return this.log('info', loggerName, data ?? {});
  }
  notice(loggerName: string, data?: unknown): Promise<void> {
    return this.log('notice', loggerName, data ?? {});
  }
  warning(loggerName: string, data?: unknown): Promise<void> {
    return this.log('warning', loggerName, data ?? {});
  }
  error(loggerName: string, data?: unknown): Promise<void> {
    return this.log('error', loggerName, data ?? {});
  }
  critical(loggerName: string, data?: unknown): Promise<void> {
    return this.log('critical', loggerName, data ?? {});
  }
  alert(loggerName: string, data?: unknown): Promise<void> {
    return this.log('alert', loggerName, data ?? {});
  }
  emergency(loggerName: string, data?: unknown): Promise<void> {
    return this.log('emergency', loggerName, data ?? {});
  }
}

export const logger = new Logger();
