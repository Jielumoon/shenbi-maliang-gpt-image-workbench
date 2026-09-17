import type { Context, Hono } from "hono";
import { currentUser, isConfigAuthed, requireConfig } from "./auth";
import { requestWithLimitedBody, LimitedRequestBodyError } from "./limitedRequestBody";
import {
  type RuntimeLogStore,
  runtimeLogStore,
  RUNTIME_LOG_PREVIEW_LIMIT,
  sanitizeRuntimeLogString
} from "./runtimeLogger";
import { SESSION_SHARE_CLIENT_IP_HEADER } from "./sessionShareRoutes";
import { openLocalDirectory } from "./openLocalDirectory";
import { audit } from "./auditLog";

const CLIENT_ERROR_BODY_MAX_BYTES = 8 * 1024;
const CLIENT_ERROR_RATE_LIMIT = 20;
const CLIENT_ERROR_RATE_WINDOW_MS = 60_000;
const clientErrorBuckets = new Map<string, number[]>();

function boundedText(value: unknown, maximum: number) {
  const text = sanitizeRuntimeLogString(String(value ?? "").trim());
  return text.length <= maximum ? text : `${text.slice(0, maximum)}…[truncated]`;
}

function safeClientPath(value: unknown) {
  const path = String(value ?? "").trim().split(/[?#]/, 1)[0];
  return path.startsWith("/") ? boundedText(path, 1_000) : "";
}

function clientAddress(c: Context) {
  return String(c.req.header(SESSION_SHARE_CLIENT_IP_HEADER) ?? "unknown").trim() || "unknown";
}

function consumeClientErrorRateLimit(key: string) {
  const timestamp = Date.now();
  const recent = (clientErrorBuckets.get(key) ?? []).filter((value) => timestamp - value < CLIENT_ERROR_RATE_WINDOW_MS);
  if (recent.length >= CLIENT_ERROR_RATE_LIMIT) {
    clientErrorBuckets.set(key, recent);
    return false;
  }
  recent.push(timestamp);
  clientErrorBuckets.set(key, recent);
  if (clientErrorBuckets.size > 2_000) {
    for (const [bucketKey, values] of clientErrorBuckets) {
      if (!values.some((value) => timestamp - value < CLIENT_ERROR_RATE_WINDOW_MS)) clientErrorBuckets.delete(bucketKey);
    }
  }
  return true;
}

async function clientErrorActor(c: Context) {
  const user = await currentUser(c);
  if (user) return { key: `user:${user.id}`, userId: user.id };
  if (isConfigAuthed(c)) return { key: `config:${clientAddress(c)}`, userId: "config-admin" };
  return null;
}

type RuntimeLogRouteOptions = {
  store?: RuntimeLogStore;
  authorizeConfig?: (c: Context) => Response | null;
  resolveClientActor?: (c: Context) => Promise<{ key: string; userId: string } | null>;
  openDirectory?: (directory: string) => Promise<void>;
  writeAudit?: (action: string, detail?: Record<string, unknown>) => void;
};

export function registerRuntimeLogRoutes(api: Hono, options: RuntimeLogRouteOptions = {}) {
  const store = options.store ?? runtimeLogStore;
  const authorizeConfig = options.authorizeConfig ?? requireConfig;
  const resolveClientActor = options.resolveClientActor ?? clientErrorActor;
  const openDirectory = options.openDirectory ?? openLocalDirectory;
  const writeAudit = options.writeAudit ?? audit;
  api.get("/config/runtime-logs", (c) => {
    const blocked = authorizeConfig(c);
    if (blocked) return blocked;
    try {
      const result = store.preview({
        fileName: c.req.query("file"),
        level: c.req.query("level"),
        source: c.req.query("source"),
        limit: Math.max(1, Math.min(RUNTIME_LOG_PREVIEW_LIMIT, Number(c.req.query("limit") ?? RUNTIME_LOG_PREVIEW_LIMIT)))
      });
      return c.json({
        ...result,
        files: result.files.map(({ name, date, size, updatedAt }) => ({ name, date, size, updatedAt })),
        status: store.status()
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "运行日志读取失败";
      return c.json({ error: message }, 400);
    }
  });

  api.get("/config/runtime-logs/download", (c) => {
    const blocked = authorizeConfig(c);
    if (blocked) return blocked;
    try {
      const fileName = String(c.req.query("file") ?? "").trim();
      const filePath = store.resolveFile(fileName);
      return new Response(Bun.file(filePath), {
        headers: {
          "Content-Type": "application/x-ndjson; charset=utf-8",
          "Content-Disposition": `attachment; filename="${fileName}"`,
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff"
        }
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "运行日志下载失败";
      return c.json({ error: message }, 400);
    }
  });

  api.get("/config/runtime-logs/raw", (c) => {
    const blocked = authorizeConfig(c);
    if (blocked) return blocked;
    try {
      const fileName = String(c.req.query("file") ?? "").trim();
      const beforeText = String(c.req.query("before") ?? "").trim();
      const before = beforeText ? Number(beforeText) : undefined;
      return c.json(store.rawChunk(fileName, before));
    } catch (error) {
      const message = error instanceof Error ? error.message : "原始日志读取失败";
      return c.json({ error: message }, 400);
    }
  });

  api.post("/config/runtime-logs/open-directory", async (c) => {
    const blocked = authorizeConfig(c);
    if (blocked) return blocked;
    try {
      const directory = store.ensureDirectory();
      await openDirectory(directory);
      writeAudit("runtime_logs.open_directory", { directory: store.status().directory, platform: process.platform });
      return c.json({ ok: true, directory: store.status().directory });
    } catch (error) {
      const message = error instanceof Error ? error.message : "日志目录打开失败";
      return c.json({ error: message }, 409);
    }
  });

  api.post("/runtime-errors/client", async (c) => {
    const actor = await resolveClientActor(c);
    if (!actor) return c.json({ error: "未登录" }, 401);
    if (!store.isEnabled()) return c.body(null, 204);
    if (!consumeClientErrorRateLimit(actor.key)) {
      c.header("Retry-After", "60");
      return c.json({ error: "前端异常上报过于频繁" }, 429);
    }

    let body: Record<string, unknown>;
    try {
      const limitedRequest = await requestWithLimitedBody(c.req.raw, CLIENT_ERROR_BODY_MAX_BYTES);
      body = await limitedRequest.json() as Record<string, unknown>;
    } catch (error) {
      if (error instanceof LimitedRequestBodyError) return c.json({ error: "异常上报内容过大" }, 413);
      return c.json({ error: "异常上报格式不正确" }, 400);
    }

    const message = boundedText(body.message, 2_000);
    if (!message) return c.json({ error: "异常消息不能为空" }, 400);
    const event = boundedText(body.kind, 80) || "window.error";
    store.write({
      level: "error",
      source: "client",
      event: `client.${event}`,
      message,
      stack: boundedText(body.stack, 6_000),
      userId: actor.userId,
      path: safeClientPath(body.path),
      details: {
        userAgent: boundedText(body.userAgent, 500),
        online: Boolean(body.online),
        visibility: boundedText(body.visibility, 40)
      }
    });
    return c.body(null, 204);
  });
}
