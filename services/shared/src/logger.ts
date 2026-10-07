const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const;
type Level = keyof typeof LEVELS;

const min = LEVELS[(process.env.LOG_LEVEL as Level) in LEVELS ? (process.env.LOG_LEVEL as Level) : "info"];

/** Structured JSON logger (one line per event). Never log keys or secrets. */
export function createLogger(service: string) {
  const log = (level: Level, msg: string, fields?: Record<string, unknown>) => {
    if (LEVELS[level] < min) return;
    const line = JSON.stringify(
      { t: new Date().toISOString(), level, service, msg, ...fields },
      (_k, v) => (typeof v === "bigint" ? v.toString() : v),
    );
    (level === "error" || level === "warn" ? console.error : console.log)(line);
  };
  return {
    debug: (m: string, f?: Record<string, unknown>) => log("debug", m, f),
    info: (m: string, f?: Record<string, unknown>) => log("info", m, f),
    warn: (m: string, f?: Record<string, unknown>) => log("warn", m, f),
    error: (m: string, f?: Record<string, unknown>) => log("error", m, f),
  };
}

export type Logger = ReturnType<typeof createLogger>;
