export type LogFields = Record<string, unknown>;

export interface Logger {
  info(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
}

export const noopLogger: Logger = { info() {}, error() {} };

/** One JSON object per line, ready for CloudWatch/Datadog. Callers must never pass secrets or PII. */
export function createJsonLogger(write: (line: string) => void = (l) => process.stdout.write(l + "\n")): Logger {
  const emit = (level: string, msg: string, fields: LogFields = {}) =>
    write(JSON.stringify({ level, time: new Date().toISOString(), msg, ...fields }));
  return {
    info: (msg, fields) => emit("info", msg, fields),
    error: (msg, fields) => emit("error", msg, fields),
  };
}
