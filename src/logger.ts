/**
 * Structured logger.
 * Outputs JSON-like lines with timestamp, level, event, and fields.
 */

import { config } from "./config.js";

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 } as const;
const minLevel = LEVELS[config.logLevel] ?? 1;

export function log(
  level: keyof typeof LEVELS,
  event: string,
  fields?: Record<string, unknown>,
): void {
  if (LEVELS[level] < minLevel) return;

  const ts = new Date().toISOString();
  const parts = [`${ts} [${level.padEnd(5)}] ${event}`];

  if (fields) {
    for (const [k, v] of Object.entries(fields)) {
      parts.push(`${k}=${typeof v === "string" ? v : JSON.stringify(v)}`);
    }
  }

  const line = parts.join("  ");

  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }
}
