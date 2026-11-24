const LEVELS = ["debug", "info", "warn", "error"] as const;

export type LogLevel = (typeof LEVELS)[number];

let threshold = LEVELS.indexOf("info");

export function setLogLevel(level: LogLevel): void {
  threshold = LEVELS.indexOf(level);
}

export interface Logger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

export function createLogger(scope: string): Logger {
  const write = (level: LogLevel, message: string, args: unknown[]) => {
    if (LEVELS.indexOf(level) < threshold) return;
    const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} [${scope}] ${message}`;
    const sink = level === "error" || level === "warn" ? console.error : console.log;
    sink(line, ...args);
  };

  return {
    debug: (message, ...args) => write("debug", message, args),
    info: (message, ...args) => write("info", message, args),
    warn: (message, ...args) => write("warn", message, args),
    error: (message, ...args) => write("error", message, args),
  };
}
