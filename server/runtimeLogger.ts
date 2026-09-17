import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  statSync,
  unlinkSync
} from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { ROOT, RUNTIME_LOG_DIR } from "./paths";

export const RUNTIME_LOG_RETENTION_DAYS = 14;
export const RUNTIME_LOG_MAX_FILE_BYTES = 20 * 1024 * 1024;
export const RUNTIME_LOG_MAX_TOTAL_BYTES = 200 * 1024 * 1024;
export const RUNTIME_LOG_PREVIEW_LIMIT = 200;
export const RUNTIME_LOG_RAW_CHUNK_BYTES = 256 * 1024;

const RUNTIME_LOG_PREVIEW_MAX_BYTES = 4 * 1024 * 1024;
const RUNTIME_LOG_LINE_MAX_CHARS = 16 * 1024;
const RUNTIME_LOG_FILE_PATTERN = /^runtime-(\d{4}-\d{2}-\d{2})(?:-(\d+))?\.jsonl$/;
const SENSITIVE_KEY_PATTERN = /authorization|cookie|password|passphrase|secret|token|api.?key|access.?key|web.?cookies|auth.?json/i;
const originalConsoleWarn = console.warn.bind(console);
const originalConsoleError = console.error.bind(console);

export type RuntimeLogLevel = "info" | "warn" | "error" | "fatal";
export type RuntimeLogSource = "server" | "http" | "client";

export type RuntimeLogEntry = {
  id: string;
  timestamp: string;
  level: RuntimeLogLevel;
  source: RuntimeLogSource;
  event: string;
  message: string;
  stack?: string;
  requestId?: string;
  method?: string;
  path?: string;
  status?: number;
  durationMs?: number;
  userId?: string;
  details?: Record<string, unknown>;
  pid: number;
  version: string;
  platform: string;
  uptimeMs: number;
};

export type RuntimeLogFile = {
  name: string;
  date: string;
  size: number;
  updatedAt: string;
  modifiedMs: number;
  segment: number;
};

export type RuntimeLogInput = {
  level: RuntimeLogLevel;
  source: RuntimeLogSource;
  event: string;
  message: string;
  stack?: string;
  requestId?: string;
  method?: string;
  path?: string;
  status?: number;
  durationMs?: number;
  userId?: string;
  details?: Record<string, unknown>;
};

export type RuntimeLogStoreOptions = {
  directory: string;
  retentionDays?: number;
  maximumFileBytes?: number;
  maximumTotalBytes?: number;
  version?: string;
  now?: () => Date;
};

function applicationVersion() {
  try {
    const parsed = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")) as { version?: unknown };
    return String(parsed.version ?? "unknown").trim() || "unknown";
  } catch {
    return "unknown";
  }
}

function localDateKey(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function formatRuntimeLogTimestamp(date: Date) {
  const pad = (value: number, length = 2) => String(value).padStart(length, "0");
  const offsetMinutes = -date.getTimezoneOffset();
  const offsetSign = offsetMinutes >= 0 ? "+" : "-";
  const absoluteOffset = Math.abs(offsetMinutes);
  const offset = `${offsetSign}${pad(Math.floor(absoluteOffset / 60))}:${pad(absoluteOffset % 60)}`;
  return [
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`,
    offset
  ].join("");
}

function truncate(value: string, maximum = 4_000) {
  return value.length <= maximum ? value : `${value.slice(0, maximum)}…[truncated]`;
}

function sanitizedUrl(value: string) {
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return value;
  }
}

export function sanitizeRuntimeLogString(value: string) {
  let result = value;
  result = result.replace(/data:[^;,\s]+;base64,[A-Za-z0-9+/=_-]+/gi, "[redacted data URL]");
  result = result.replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]");
  result = result.replace(
    /\b(authorization|cookie|password|passphrase|secret|token|api[_-]?key|access[_-]?key)\b\s*[:=]\s*([^\s,;]+)/gi,
    "$1=[redacted]"
  );
  result = result.replace(/https?:\/\/[^\s"'<>]+/gi, (url) => sanitizedUrl(url));
  return truncate(result);
}

function sanitizedValue(value: unknown, key = "", depth = 0, seen = new WeakSet<object>()): unknown {
  if (SENSITIVE_KEY_PATTERN.test(key)) return "[redacted]";
  if (value == null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return sanitizeRuntimeLogString(value);
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "symbol" || typeof value === "function") return String(value);
  if (value instanceof Error) {
    return {
      name: value.name,
      message: sanitizeRuntimeLogString(value.message),
      stack: value.stack ? truncate(sanitizeRuntimeLogString(value.stack), 8_000) : undefined
    };
  }
  if (depth >= 4) return "[truncated object]";
  if (typeof value !== "object") return sanitizeRuntimeLogString(String(value));
  if (seen.has(value)) return "[circular]";
  seen.add(value);
  if (Array.isArray(value)) return value.slice(0, 30).map((item) => sanitizedValue(item, "", depth + 1, seen));
  const result: Record<string, unknown> = {};
  for (const [childKey, childValue] of Object.entries(value).slice(0, 50)) {
    result[childKey] = sanitizedValue(childValue, childKey, depth + 1, seen);
  }
  return result;
}

function runtimeLogMessage(args: unknown[]) {
  let stack = "";
  const parts = args.map((value) => {
    if (value instanceof Error) {
      if (!stack && value.stack) stack = truncate(sanitizeRuntimeLogString(value.stack), 8_000);
      return sanitizeRuntimeLogString(value.message || value.name);
    }
    if (typeof value === "string") return sanitizeRuntimeLogString(value);
    try {
      return JSON.stringify(sanitizedValue(value));
    } catch {
      return sanitizeRuntimeLogString(String(value));
    }
  });
  return { message: truncate(parts.filter(Boolean).join(" "), 8_000) || "未知异常", stack };
}

function entryLine(entry: RuntimeLogEntry) {
  const value = JSON.stringify(entry);
  return `${value.length <= RUNTIME_LOG_LINE_MAX_CHARS ? value : JSON.stringify({
    ...entry,
    message: truncate(entry.message, 2_000),
    stack: entry.stack ? truncate(entry.stack, 4_000) : undefined,
    details: { truncated: true }
  })}\n`;
}

export class RuntimeLogStore {
  readonly directory: string;
  readonly retentionDays: number;
  readonly maximumFileBytes: number;
  readonly maximumTotalBytes: number;
  readonly version: string;
  private readonly now: () => Date;
  private enabled = false;
  private currentFile = "";
  private lastWriteAt = "";
  private lastError = "";
  private lastCleanupAt = 0;

  constructor(options: RuntimeLogStoreOptions) {
    this.directory = path.resolve(options.directory);
    this.retentionDays = options.retentionDays ?? RUNTIME_LOG_RETENTION_DAYS;
    this.maximumFileBytes = options.maximumFileBytes ?? RUNTIME_LOG_MAX_FILE_BYTES;
    this.maximumTotalBytes = options.maximumTotalBytes ?? RUNTIME_LOG_MAX_TOTAL_BYTES;
    this.version = options.version ?? applicationVersion();
    this.now = options.now ?? (() => new Date());
  }

  isEnabled() {
    return this.enabled;
  }

  prepare() {
    this.ensureDirectory();
    const probe = path.join(this.directory, `.runtime-log-write-${process.pid}-${Date.now()}.tmp`);
    try {
      const descriptor = openSync(probe, "a");
      closeSync(descriptor);
    } finally {
      if (existsSync(probe)) unlinkSync(probe);
    }
  }

  ensureDirectory() {
    mkdirSync(this.directory, { recursive: true });
    return this.directory;
  }

  restoreConfiguredState(enabled: boolean) {
    this.enabled = enabled;
    if (!enabled) {
      this.cleanupExistingFiles();
      return;
    }
    try {
      this.prepare();
      this.cleanup(true);
      this.write({ level: "info", source: "server", event: "runtime.logging_restored", message: "运行故障日志已恢复" });
    } catch (error) {
      this.reportFailure(error);
    }
  }

  setEnabled(enabled: boolean) {
    if (enabled === this.enabled) return this.status();
    if (enabled) {
      this.prepare();
      this.enabled = true;
      this.lastError = "";
      this.cleanup(true);
      this.write({ level: "info", source: "server", event: "runtime.logging_enabled", message: "运行故障日志已开启" });
    } else {
      this.write({ level: "info", source: "server", event: "runtime.logging_disabled", message: "运行故障日志已关闭" });
      this.enabled = false;
    }
    return this.status();
  }

  write(input: RuntimeLogInput) {
    if (!this.enabled) return null;
    const timestamp = formatRuntimeLogTimestamp(this.now());
    const details = sanitizedValue(input.details ?? {}, "details");
    const entry: RuntimeLogEntry = {
      id: randomUUID(),
      timestamp,
      level: input.level,
      source: input.source,
      event: truncate(sanitizeRuntimeLogString(input.event), 160),
      message: truncate(sanitizeRuntimeLogString(input.message), 8_000),
      ...(input.stack ? { stack: truncate(sanitizeRuntimeLogString(input.stack), 8_000) } : {}),
      ...(input.requestId ? { requestId: truncate(sanitizeRuntimeLogString(input.requestId), 160) } : {}),
      ...(input.method ? { method: truncate(input.method.toUpperCase(), 16) } : {}),
      ...(input.path ? { path: truncate(sanitizeRuntimeLogString(input.path.split(/[?#]/, 1)[0]), 1_000) } : {}),
      ...(Number.isFinite(input.status) ? { status: Number(input.status) } : {}),
      ...(Number.isFinite(input.durationMs) ? { durationMs: Math.max(0, Math.round(Number(input.durationMs))) } : {}),
      ...(input.userId ? { userId: truncate(sanitizeRuntimeLogString(input.userId), 200) } : {}),
      ...(details && typeof details === "object" && !Array.isArray(details) && Object.keys(details).length > 0
        ? { details: details as Record<string, unknown> }
        : {}),
      pid: process.pid,
      version: this.version,
      platform: `${process.platform}-${process.arch}`,
      uptimeMs: Math.max(0, Math.round(process.uptime() * 1_000))
    };
    try {
      const line = entryLine(entry);
      const previousFile = this.currentFile;
      const filePath = this.writableFilePath(Buffer.byteLength(line));
      appendFileSync(filePath, line, "utf8");
      this.currentFile = path.basename(filePath);
      this.lastWriteAt = timestamp;
      this.lastError = "";
      this.cleanup(previousFile !== this.currentFile);
      return entry;
    } catch (error) {
      this.reportFailure(error);
      return null;
    }
  }

  status() {
    return {
      enabled: this.enabled,
      healthy: !this.lastError,
      directory: this.displayDirectory(),
      absoluteDirectory: this.directory,
      retentionDays: this.retentionDays,
      maximumFileBytes: this.maximumFileBytes,
      maximumTotalBytes: this.maximumTotalBytes,
      currentFile: this.currentFile,
      lastWriteAt: this.lastWriteAt,
      lastError: this.lastError
    };
  }

  files() {
    this.cleanupExistingFiles();
    return this.fileRows().sort((left, right) => right.date.localeCompare(left.date) || right.segment - left.segment);
  }

  resolveFile(fileName: string) {
    const name = String(fileName ?? "").trim();
    if (!RUNTIME_LOG_FILE_PATTERN.test(name) || path.basename(name) !== name) throw new Error("日志文件名不合法");
    const resolved = path.resolve(this.directory, name);
    if (path.dirname(resolved) !== this.directory) throw new Error("日志文件路径不合法");
    if (!existsSync(resolved) || !statSync(resolved).isFile()) throw new Error("日志文件不存在");
    return resolved;
  }

  preview(options: { fileName?: string; level?: string; source?: string; limit?: number } = {}) {
    const files = this.files();
    const selected = options.fileName?.trim() || files[0]?.name || "";
    if (!selected) return { files, selectedFile: "", entries: [], truncated: false };
    const filePath = this.resolveFile(selected);
    const info = statSync(filePath);
    const bytes = Math.min(info.size, RUNTIME_LOG_PREVIEW_MAX_BYTES);
    const offset = Math.max(0, info.size - bytes);
    const buffer = Buffer.alloc(bytes);
    const descriptor = openSync(filePath, "r");
    try {
      if (bytes > 0) readSync(descriptor, buffer, 0, bytes, offset);
    } finally {
      closeSync(descriptor);
    }
    let text = buffer.toString("utf8");
    if (offset > 0) {
      const firstNewline = text.indexOf("\n");
      text = firstNewline >= 0 ? text.slice(firstNewline + 1) : "";
    }
    const maximum = Math.max(1, Math.min(RUNTIME_LOG_PREVIEW_LIMIT, Math.trunc(Number(options.limit) || RUNTIME_LOG_PREVIEW_LIMIT)));
    const level = String(options.level ?? "all").toLowerCase();
    const source = String(options.source ?? "all").toLowerCase();
    const entries: RuntimeLogEntry[] = [];
    let matched = 0;
    const lines = text.split(/\r?\n/).filter(Boolean).reverse();
    for (const line of lines) {
      let entry: RuntimeLogEntry;
      try {
        entry = JSON.parse(line) as RuntimeLogEntry;
      } catch {
        continue;
      }
      const levelMatches = level === "all" || entry.level === level || (level === "error" && entry.level === "fatal");
      const sourceMatches = source === "all" || entry.source === source;
      if (!levelMatches || !sourceMatches) continue;
      matched += 1;
      if (entries.length < maximum) entries.push(entry);
    }
    return {
      files,
      selectedFile: selected,
      entries,
      truncated: offset > 0 || matched > entries.length
    };
  }

  rawChunk(fileName: string, before?: number, maximumBytes = RUNTIME_LOG_RAW_CHUNK_BYTES) {
    const filePath = this.resolveFile(fileName);
    const info = statSync(filePath);
    const requestedEnd = before == null ? info.size : Number(before);
    if (!Number.isSafeInteger(requestedEnd) || requestedEnd < 0 || requestedEnd > info.size) {
      throw new Error("日志读取位置不合法");
    }
    const byteLimit = Math.max(1, Math.min(RUNTIME_LOG_RAW_CHUNK_BYTES, Math.trunc(Number(maximumBytes) || RUNTIME_LOG_RAW_CHUNK_BYTES)));
    const requestedStart = Math.max(0, requestedEnd - byteLimit);
    const buffer = Buffer.alloc(requestedEnd - requestedStart);
    const descriptor = openSync(filePath, "r");
    let bytesRead = 0;
    try {
      if (buffer.length > 0) bytesRead = readSync(descriptor, buffer, 0, buffer.length, requestedStart);
    } finally {
      closeSync(descriptor);
    }
    let contentBuffer = buffer.subarray(0, bytesRead);
    let start = requestedStart;
    if (requestedStart > 0) {
      const newlineIndex = contentBuffer.indexOf(0x0a);
      if (newlineIndex >= 0) {
        start += newlineIndex + 1;
        contentBuffer = contentBuffer.subarray(newlineIndex + 1);
      } else {
        start = requestedEnd;
        contentBuffer = Buffer.alloc(0);
      }
    }
    return {
      file: path.basename(filePath),
      content: contentBuffer.toString("utf8"),
      start,
      end: requestedEnd,
      size: info.size,
      hasEarlier: start > 0,
      hasLater: requestedEnd < info.size
    };
  }

  private displayDirectory() {
    const relative = path.relative(ROOT, this.directory);
    return relative && !relative.startsWith("..") && !path.isAbsolute(relative) ? relative.replace(/\\/g, "/") : this.directory;
  }

  private reportFailure(error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === this.lastError) return;
    this.lastError = truncate(sanitizeRuntimeLogString(message), 1_000);
    originalConsoleError(`运行故障日志写入失败：${this.lastError}`);
  }

  private writableFilePath(nextBytes: number) {
    mkdirSync(this.directory, { recursive: true });
    const date = localDateKey(this.now());
    const files = this.fileRows().filter((file) => file.date === date).sort((left, right) => left.segment - right.segment);
    const latest = files.at(-1);
    if (!latest) return path.join(this.directory, `runtime-${date}.jsonl`);
    if (latest.size + nextBytes <= this.maximumFileBytes) return path.join(this.directory, latest.name);
    return path.join(this.directory, `runtime-${date}-${latest.segment + 1}.jsonl`);
  }

  private fileRows(): RuntimeLogFile[] {
    if (!existsSync(this.directory)) return [];
    const rows: RuntimeLogFile[] = [];
    for (const name of readdirSync(this.directory)) {
      const match = name.match(RUNTIME_LOG_FILE_PATTERN);
      if (!match) continue;
      const filePath = path.join(this.directory, name);
      let info;
      try {
        info = statSync(filePath);
      } catch {
        continue;
      }
      if (!info.isFile()) continue;
      rows.push({
        name,
        date: match[1],
        segment: Number(match[2] ?? 0),
        size: info.size,
        updatedAt: info.mtime.toISOString(),
        modifiedMs: info.mtimeMs
      });
    }
    return rows;
  }

  private cleanupExistingFiles() {
    if (!existsSync(this.directory)) return;
    try {
      this.cleanup(true);
    } catch (error) {
      this.reportFailure(error);
    }
  }

  private cleanup(force = false) {
    const timestamp = Date.now();
    if (!force && timestamp - this.lastCleanupAt < 60 * 60 * 1_000) return;
    this.lastCleanupAt = timestamp;
    if (!existsSync(this.directory)) return;
    const today = this.now();
    const cutoff = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    cutoff.setDate(cutoff.getDate() - (this.retentionDays - 1));
    let files = this.fileRows();
    for (const file of files) {
      const fileDate = new Date(`${file.date}T00:00:00`);
      if (!Number.isNaN(fileDate.getTime()) && fileDate < cutoff) {
        unlinkSync(path.join(this.directory, file.name));
      }
    }
    files = this.fileRows().sort((left, right) => left.modifiedMs - right.modifiedMs || left.name.localeCompare(right.name));
    let totalBytes = files.reduce((total, file) => total + file.size, 0);
    for (const file of files) {
      if (totalBytes <= this.maximumTotalBytes || files.length <= 1) break;
      if (file.name === this.currentFile && files.length > 1) continue;
      unlinkSync(path.join(this.directory, file.name));
      totalBytes -= file.size;
    }
  }
}

export const runtimeLogStore = new RuntimeLogStore({ directory: RUNTIME_LOG_DIR });

const requestIds = new WeakMap<Request, string>();
let runtimeLoggingInitialized = false;

export function runtimeRequestId(request: Request) {
  const existing = requestIds.get(request);
  if (existing) return existing;
  const requestId = randomUUID();
  requestIds.set(request, requestId);
  return requestId;
}

export function runtimeLog(input: RuntimeLogInput) {
  return runtimeLogStore.write(input);
}

export function runtimeLogErrorWithConsole(input: Omit<RuntimeLogInput, "level">, ...args: unknown[]) {
  originalConsoleError(...args);
  return runtimeLog({ ...input, level: "error" });
}

export function runtimeLogFromConsole(level: "warn" | "error", args: unknown[]) {
  const normalized = runtimeLogMessage(args);
  return runtimeLog({
    level,
    source: "server",
    event: `console.${level}`,
    message: normalized.message,
    ...(normalized.stack ? { stack: normalized.stack } : {})
  });
}

export function initializeRuntimeLogging(enabled: boolean) {
  if (runtimeLoggingInitialized) {
    runtimeLogStore.restoreConfiguredState(enabled);
    return runtimeLogStore.status();
  }
  runtimeLoggingInitialized = true;
  console.warn = (...args: unknown[]) => {
    originalConsoleWarn(...args);
    runtimeLogFromConsole("warn", args);
  };
  console.error = (...args: unknown[]) => {
    originalConsoleError(...args);
    runtimeLogFromConsole("error", args);
  };
  process.on("uncaughtExceptionMonitor", (error) => {
    const normalized = runtimeLogMessage([error]);
    runtimeLog({
      level: "fatal",
      source: "server",
      event: "process.uncaught_exception",
      message: normalized.message,
      ...(normalized.stack ? { stack: normalized.stack } : {})
    });
  });
  process.on("unhandledRejection", (reason) => {
    const normalized = runtimeLogMessage([reason]);
    runtimeLog({
      level: "fatal",
      source: "server",
      event: "process.unhandled_rejection",
      message: normalized.message,
      ...(normalized.stack ? { stack: normalized.stack } : {})
    });
    originalConsoleError("Unhandled promise rejection", reason);
    process.exit(1);
  });
  process.on("exit", (code) => {
    runtimeLog({
      level: code === 0 ? "info" : "error",
      source: "server",
      event: "process.exit",
      message: `服务进程退出，退出码 ${code}`,
      details: { exitCode: code }
    });
  });
  const exitForSignal = (signal: "SIGINT" | "SIGTERM", exitCode: number) => {
    runtimeLog({
      level: "info",
      source: "server",
      event: "process.signal",
      message: `服务收到 ${signal}，准备退出`,
      details: { signal, exitCode }
    });
    process.exit(exitCode);
  };
  process.once("SIGINT", () => exitForSignal("SIGINT", 130));
  process.once("SIGTERM", () => exitForSignal("SIGTERM", 143));
  runtimeLogStore.restoreConfiguredState(enabled);
  return runtimeLogStore.status();
}
