import type { Database } from "bun:sqlite";
import type { Context, Hono } from "hono";
import { configDb, getAll } from "./db";
import { requireUser } from "./auth";
import {
  InvalidUploadedImageError,
  SAFE_UPLOAD_IMAGE_MIME_TYPES,
  validateUploadedImage
} from "./imageValidation";
import { LimitedRequestBodyError, requestWithLimitedBody } from "./limitedRequestBody";
import { providerFetch, proxyFetch } from "./providerHttp";
import type { ProviderRow, UserRow } from "./types";

export const IMAGE_PROVENANCE_MAX_FILE_BYTES = 20 * 1024 * 1024;
const IMAGE_PROVENANCE_MAX_REQUEST_BYTES = IMAGE_PROVENANCE_MAX_FILE_BYTES + 1024 * 1024;
const IMAGE_PROVENANCE_REQUEST_TIMEOUT_MS = 30_000;
const IMAGE_PROVENANCE_GLOBAL_CONCURRENCY = 2;
const OPENAI_PROVENANCE_ENDPOINT = "https://api.openai.com/v1/content_provenance_checks";

export type ImageProvenanceSignal = {
  type: "c2pa" | "synthid";
  outcome: "detected" | "not_detected";
  validationState: "trusted" | "valid" | "invalid" | "not_present" | null;
  issuer: string | null;
  model: string | null;
  generatedAt: string | null;
};

export type ImageProvenanceCheckResult = {
  object: "content_provenance_check";
  createdAt: number;
  detected: boolean;
  results: ImageProvenanceSignal[];
};

type OpenAiProvenanceAccess = {
  apiKey: string;
  provider: ProviderRow | null;
};

type ImageProvenanceRouteOptions = {
  db?: Database;
  authorize?: (c: Context) => Promise<Pick<UserRow, "id"> | null>;
  environment?: Record<string, string | undefined>;
  verify?: (access: OpenAiProvenanceAccess, file: File) => Promise<ImageProvenanceCheckResult>;
};

export class OpenAiProvenanceRequestError extends Error {
  constructor(readonly status: number, message: string, readonly retryAfter = "") {
    super(message);
    this.name = "OpenAiProvenanceRequestError";
  }
}

let activeImageProvenanceChecks = 0;
const activeImageProvenanceUsers = new Set<string>();

function stringField(value: unknown, maximumLength = 300) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized ? normalized.slice(0, maximumLength) : null;
}

function validationState(value: unknown): ImageProvenanceSignal["validationState"] {
  return value === "trusted" || value === "valid" || value === "invalid" || value === "not_present"
    ? value
    : null;
}

export function normalizeContentProvenanceResponse(input: unknown): ImageProvenanceCheckResult {
  if (!input || typeof input !== "object") throw new Error("OpenAI 内容验证返回格式不正确");
  const record = input as Record<string, unknown>;
  if (!Array.isArray(record.results)) throw new Error("OpenAI 内容验证返回格式不正确");
  const results = record.results
    .map((item): ImageProvenanceSignal | null => {
      if (!item || typeof item !== "object") return null;
      const signal = item as Record<string, unknown>;
      if (signal.type !== "c2pa" && signal.type !== "synthid") return null;
      if (signal.outcome !== "detected" && signal.outcome !== "not_detected") return null;
      return {
        type: signal.type,
        outcome: signal.outcome,
        validationState: validationState(signal.validation_state),
        issuer: stringField(signal.issuer),
        model: stringField(signal.model),
        generatedAt: stringField(signal.generated_at, 100)
      };
    })
    .filter((item): item is ImageProvenanceSignal => Boolean(item));
  if (results.length === 0) throw new Error("OpenAI 内容验证未返回可识别的检测项");
  const createdAt = Number(record.created_at);
  return {
    object: "content_provenance_check",
    createdAt: Number.isFinite(createdAt) ? Math.trunc(createdAt) : Math.floor(Date.now() / 1000),
    detected: results.some((item) => item.outcome === "detected"),
    results
  };
}

export function isOfficialOpenAiApiBaseUrl(value: unknown) {
  try {
    const url = new URL(String(value ?? "").trim());
    return url.protocol === "https:" && !url.username && !url.password && url.hostname.toLowerCase() === "api.openai.com";
  } catch {
    return false;
  }
}

export function isPlausibleOpenAiApiKey(value: unknown) {
  const key = String(value ?? "").trim();
  return key.length >= 32 && /^sk-[A-Za-z0-9_-]+$/.test(key);
}

function providerApiKey(provider: ProviderRow, environment: Record<string, string | undefined>) {
  const stored = String(provider.api_key_value ?? "").trim();
  if (stored) return stored;
  const environmentName = String(provider.api_key_env ?? "").trim();
  return environmentName ? String(environment[environmentName] ?? "").trim() : "";
}

function openAiProvenanceAccess(
  db: Database = configDb,
  environment: Record<string, string | undefined> = Bun.env
): OpenAiProvenanceAccess | null {
  const providers = getAll<ProviderRow>(
    db,
    "select * from provider_configs where enabled = 1 and channel = ? order by created_at asc",
    "api"
  );
  for (const provider of providers) {
    if (!isOfficialOpenAiApiBaseUrl(provider.base_url)) continue;
    const apiKey = providerApiKey(provider, environment);
    if (isPlausibleOpenAiApiKey(apiKey)) return { apiKey, provider };
  }
  const apiKey = String(environment.OPENAI_API_KEY ?? "").trim();
  return isPlausibleOpenAiApiKey(apiKey) ? { apiKey, provider: null } : null;
}

function safeFileName(value: string, mimeType: string) {
  const fallback = mimeType === "image/png" ? "image.png" : mimeType === "image/webp" ? "image.webp" : "image.jpg";
  const normalized = value.replace(/[\r\n\\/]/g, "_").trim().slice(0, 180);
  return normalized || fallback;
}

async function verifyWithOpenAi(access: OpenAiProvenanceAccess, file: File) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), IMAGE_PROVENANCE_REQUEST_TIMEOUT_MS);
  try {
    const form = new FormData();
    form.append("file", file, file.name);
    const requestInit: RequestInit = {
      method: "POST",
      headers: { Authorization: `Bearer ${access.apiKey}`, Accept: "application/json" },
      body: form,
      signal: controller.signal
    };
    const response = access.provider
      ? await providerFetch(access.provider, OPENAI_PROVENANCE_ENDPOINT, requestInit)
      : await proxyFetch(OPENAI_PROVENANCE_ENDPOINT, requestInit);
    const responseText = await response.text();
    let responseBody: unknown = null;
    try {
      responseBody = responseText ? JSON.parse(responseText) : null;
    } catch {
      responseBody = null;
    }
    if (!response.ok) {
      const upstreamMessage = responseBody && typeof responseBody === "object"
        ? stringField((responseBody as { error?: { message?: unknown } }).error?.message, 500)
        : null;
      throw new OpenAiProvenanceRequestError(
        response.status,
        upstreamMessage ?? "OpenAI 内容验证请求失败",
        String(response.headers.get("retry-after") ?? "").trim()
      );
    }
    return normalizeContentProvenanceResponse(responseBody);
  } catch (error) {
    if (controller.signal.aborted) throw new OpenAiProvenanceRequestError(408, "OpenAI 内容验证请求超时");
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

function openAiErrorResponse(c: Context, error: OpenAiProvenanceRequestError) {
  if (error.retryAfter) c.header("Retry-After", error.retryAfter);
  if (error.status === 400) return c.json({ error: "OpenAI 无法验证这张图片，请确认图片格式和内容有效" }, 400);
  if (error.status === 401 || error.status === 403) return c.json({ error: "OpenAI API 密钥无效或没有访问权限" }, 424);
  if (error.status === 404) return c.json({ error: "当前 OpenAI 组织尚未开通 AI 内容验证" }, 424);
  if (error.status === 429) return c.json({ error: "OpenAI 内容验证请求过于频繁，请稍后重试" }, 429);
  if (error.status === 408) return c.json({ error: error.message }, 408);
  return c.json({ error: "OpenAI 内容验证暂时不可用，请稍后重试" }, 502);
}

export function registerImageProvenanceRoutes(api: Hono, options: ImageProvenanceRouteOptions = {}) {
  const authorize = options.authorize ?? requireUser;
  const db = options.db ?? configDb;
  const environment = options.environment ?? Bun.env;
  const verify = options.verify ?? verifyWithOpenAi;

  api.use("/image-provenance/*", async (c, next) => {
    await next();
    c.header("Cache-Control", "private, no-store");
    c.header("X-Content-Type-Options", "nosniff");
  });

  api.get("/image-provenance/capabilities", async (c) => {
    const user = await authorize(c);
    if (!user) return c.json({ error: "未登录" }, 401);
    return c.json({
      configured: Boolean(openAiProvenanceAccess(db, environment)),
      provider: "openai",
      acceptedMimeTypes: [...SAFE_UPLOAD_IMAGE_MIME_TYPES],
      maxFileBytes: IMAGE_PROVENANCE_MAX_FILE_BYTES
    });
  });

  api.post("/image-provenance/check", async (c) => {
    const user = await authorize(c);
    if (!user) return c.json({ error: "未登录" }, 401);
    if (activeImageProvenanceUsers.has(user.id)) {
      c.header("Retry-After", "3");
      return c.json({ error: "当前账号已有图片正在验证，请稍候" }, 429);
    }
    if (activeImageProvenanceChecks >= IMAGE_PROVENANCE_GLOBAL_CONCURRENCY) {
      c.header("Retry-After", "3");
      return c.json({ error: "图片验证服务繁忙，请稍后重试" }, 503);
    }
    const access = openAiProvenanceAccess(db, environment);
    if (!access) return c.json({ error: "尚未配置 OpenAI 官方 API 渠道" }, 503);

    activeImageProvenanceUsers.add(user.id);
    activeImageProvenanceChecks += 1;
    try {
      const limitedRequest = await requestWithLimitedBody(c.req.raw, IMAGE_PROVENANCE_MAX_REQUEST_BYTES);
      const form = await limitedRequest.formData();
      const uploaded = form.get("file");
      if (!(uploaded instanceof File) || !SAFE_UPLOAD_IMAGE_MIME_TYPES.has(uploaded.type)) {
        return c.json({ error: "请选择 PNG、JPEG 或 WebP 图片" }, 400);
      }
      if (uploaded.size <= 0 || uploaded.size > IMAGE_PROVENANCE_MAX_FILE_BYTES) {
        return c.json({ error: "图片大小必须在 20 MB 以内" }, 413);
      }
      const buffer = Buffer.from(await uploaded.arrayBuffer());
      const validated = await validateUploadedImage(buffer, uploaded.type);
      const file = new File([buffer], safeFileName(uploaded.name, validated.mimeType), { type: validated.mimeType });
      return c.json(await verify(access, file));
    } catch (error) {
      if (error instanceof LimitedRequestBodyError) return c.json({ error: "图片大小必须在 20 MB 以内" }, 413);
      if (error instanceof InvalidUploadedImageError) return c.json({ error: "图片文件无效或实际格式不匹配" }, 400);
      if (error instanceof OpenAiProvenanceRequestError) return openAiErrorResponse(c, error);
      throw error;
    } finally {
      activeImageProvenanceUsers.delete(user.id);
      activeImageProvenanceChecks = Math.max(0, activeImageProvenanceChecks - 1);
    }
  });
}
