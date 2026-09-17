const CLIENT_ERROR_ENDPOINT = "/api/runtime-errors/client";
const CLIENT_ERROR_DEDUPLICATION_MS = 10_000;
const recentClientErrors = new Map<string, number>();
let installed = false;

type RuntimeClientErrorKind = "window_error" | "unhandled_rejection" | "react_uncaught" | "react_caught" | "react_recoverable";

function bounded(value: unknown, maximum: number) {
  const text = String(value ?? "").trim();
  return text.length <= maximum ? text : `${text.slice(0, maximum)}…[truncated]`;
}

function errorDetails(error: unknown, fallback = "浏览器发生未知异常") {
  if (error instanceof Error) {
    return {
      message: bounded(error.message || error.name || fallback, 2_000),
      stack: bounded(error.stack, 6_000)
    };
  }
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    return {
      message: bounded(record.message || fallback, 2_000),
      stack: bounded(record.stack, 6_000)
    };
  }
  return { message: bounded(error || fallback, 2_000), stack: "" };
}

function shouldReport(message: string, stack: string) {
  const fingerprint = `${message}\n${stack.slice(0, 500)}`;
  const timestamp = Date.now();
  const previous = recentClientErrors.get(fingerprint) ?? 0;
  if (timestamp - previous < CLIENT_ERROR_DEDUPLICATION_MS) return false;
  recentClientErrors.set(fingerprint, timestamp);
  if (recentClientErrors.size > 100) {
    for (const [key, seenAt] of recentClientErrors) {
      if (timestamp - seenAt > CLIENT_ERROR_DEDUPLICATION_MS) recentClientErrors.delete(key);
    }
  }
  return true;
}

export function reportRuntimeClientError(kind: RuntimeClientErrorKind, error: unknown, componentStack = "") {
  const normalized = errorDetails(error);
  const stack = bounded([normalized.stack, componentStack].filter(Boolean).join("\n"), 6_000);
  if (!shouldReport(normalized.message, stack)) return;
  const payload = JSON.stringify({
    kind,
    message: normalized.message,
    stack,
    path: window.location.pathname,
    userAgent: navigator.userAgent,
    online: navigator.onLine,
    visibility: document.visibilityState
  });
  void fetch(CLIENT_ERROR_ENDPOINT, {
    method: "POST",
    credentials: "include",
    keepalive: true,
    headers: { "Content-Type": "application/json" },
    body: payload
  }).catch(() => undefined);
}

export function installRuntimeErrorReporting() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("error", (event) => {
    const error = event.error ?? new Error(event.message || "浏览器脚本异常");
    reportRuntimeClientError("window_error", error);
  });
  window.addEventListener("unhandledrejection", (event) => {
    reportRuntimeClientError("unhandled_rejection", event.reason);
  });
}
