export type LogLevel = "debug" | "info" | "warn" | "error"

export type LoggerContext = {
  traceId: string
  shardId?: number
  operation: string
}

export function createLogger(ctx: LoggerContext) {
  function log(level: LogLevel, message: string, meta?: Record<string, unknown>) {
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      traceId: ctx.traceId,
      shardId: ctx.shardId,
      operation: ctx.operation,
      message,
      ...meta,
    }
    const line = JSON.stringify(entry)
    if (level === "error") console.error(line)
    else if (level === "warn") console.warn(line)
    else console.log(line)
  }

  return {
    debug: (msg: string, meta?: Record<string, unknown>) => log("debug", msg, meta),
    info: (msg: string, meta?: Record<string, unknown>) => log("info", msg, meta),
    warn: (msg: string, meta?: Record<string, unknown>) => log("warn", msg, meta),
    error: (msg: string, meta?: Record<string, unknown>) => log("error", msg, meta),
  }
}

export function newTraceId(): string {
  return crypto.randomUUID()
}
