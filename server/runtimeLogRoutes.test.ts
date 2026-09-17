import { afterEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { registerRuntimeLogRoutes } from "./runtimeLogRoutes";
import { RuntimeLogStore } from "./runtimeLogger";

const temporaryDirectories: string[] = [];

async function testApp(options: { enabled?: boolean; openDirectory?: (directory: string) => Promise<void> } = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), "gpt-image-runtime-routes-"));
  temporaryDirectories.push(directory);
  const store = new RuntimeLogStore({ directory: path.join(directory, "logs"), version: "test" });
  if (options.enabled !== false) store.setEnabled(true);
  const app = new Hono();
  registerRuntimeLogRoutes(app, {
    store,
    authorizeConfig: (c) => c.req.header("x-admin") === "1" ? null : c.json({ error: "配置页面未登录" }, 401),
    resolveClientActor: async (c) => c.req.header("x-user") ? { key: `test:${c.req.header("x-user")}`, userId: c.req.header("x-user")! } : null,
    openDirectory: options.openDirectory,
    writeAudit: () => undefined
  });
  return { app, store };
}

afterEach(async () => {
  while (temporaryDirectories.length) await rm(temporaryDirectories.pop()!, { recursive: true, force: true });
});

describe("runtime log routes", () => {
  test("protects admin reads and supports preview filters and downloads", async () => {
    const { app, store } = await testApp();
    store.write({ level: "warn", source: "server", event: "server.warning", message: "warning" });
    store.write({ level: "error", source: "http", event: "http.failure", message: "failure" });

    expect((await app.request("/config/runtime-logs")).status).toBe(401);
    const response = await app.request("/config/runtime-logs?level=error&source=http", { headers: { "x-admin": "1" } });
    expect(response.status).toBe(200);
    const result = await response.json() as { selectedFile: string; entries: Array<{ event: string }>; files: Array<{ name: string }> };
    expect(result.entries.map((entry) => entry.event)).toEqual(["http.failure"]);
    expect(result.files.length).toBeGreaterThan(0);

    const download = await app.request(`/config/runtime-logs/download?file=${encodeURIComponent(result.selectedFile)}`, { headers: { "x-admin": "1" } });
    expect(download.status).toBe(200);
    expect(download.headers.get("content-disposition")).toContain(result.selectedFile);
    expect(await download.text()).toContain("http.failure");

    expect((await app.request(`/config/runtime-logs/raw?file=${encodeURIComponent(result.selectedFile)}`)).status).toBe(401);
    const raw = await app.request(`/config/runtime-logs/raw?file=${encodeURIComponent(result.selectedFile)}`, { headers: { "x-admin": "1" } });
    expect(raw.status).toBe(200);
    const rawResult = await raw.json() as { content: string; start: number; end: number; size: number };
    expect(rawResult.content).toContain("http.failure");
    expect(rawResult.end).toBe(rawResult.size);

    const invalidPosition = await app.request(
      `/config/runtime-logs/raw?file=${encodeURIComponent(result.selectedFile)}&before=${rawResult.size + 1}`,
      { headers: { "x-admin": "1" } }
    );
    expect(invalidPosition.status).toBe(400);

    const traversal = await app.request("/config/runtime-logs/download?file=..%2Fsecret.log", { headers: { "x-admin": "1" } });
    expect(traversal.status).toBe(400);
  });

  test("accepts bounded authenticated browser errors and ignores reports while disabled", async () => {
    const enabled = await testApp();
    expect((await enabled.app.request("/runtime-errors/client", { method: "POST", body: "{}" })).status).toBe(401);
    const accepted = await enabled.app.request("/runtime-errors/client", {
      method: "POST",
      headers: { "content-type": "application/json", "x-user": "user-1" },
      body: JSON.stringify({ kind: "window_error", message: "client failed", stack: "stack", path: "/images?token=hidden" })
    });
    expect(accepted.status).toBe(204);
    const clientEntries = enabled.store.preview({ source: "client" }).entries;
    expect(clientEntries).toHaveLength(1);
    expect(clientEntries[0]).toMatchObject({ userId: "user-1", path: "/images", message: "client failed" });

    const oversized = await enabled.app.request("/runtime-errors/client", {
      method: "POST",
      headers: { "content-type": "application/json", "x-user": "user-2" },
      body: JSON.stringify({ message: "x".repeat(9 * 1024) })
    });
    expect(oversized.status).toBe(413);

    const disabled = await testApp({ enabled: false });
    const ignored = await disabled.app.request("/runtime-errors/client", {
      method: "POST",
      headers: { "content-type": "application/json", "x-user": "user-3" },
      body: JSON.stringify({ message: "ignored" })
    });
    expect(ignored.status).toBe(204);
    expect(disabled.store.files()).toHaveLength(0);
  });

  test("rate limits repeated browser reports per actor", async () => {
    const { app } = await testApp();
    for (let index = 0; index < 20; index += 1) {
      const response = await app.request("/runtime-errors/client", {
        method: "POST",
        headers: { "content-type": "application/json", "x-user": "rate-user" },
        body: JSON.stringify({ message: `failure-${index}` })
      });
      expect(response.status).toBe(204);
    }
    const limited = await app.request("/runtime-errors/client", {
      method: "POST",
      headers: { "content-type": "application/json", "x-user": "rate-user" },
      body: JSON.stringify({ message: "failure-21" })
    });
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("60");
  });

  test("opens only the fixed runtime log directory for an authenticated administrator", async () => {
    const opened: string[] = [];
    const { app, store } = await testApp({
      openDirectory: async (directory) => {
        opened.push(directory);
      }
    });
    expect((await app.request("/config/runtime-logs/open-directory", { method: "POST" })).status).toBe(401);
    const response = await app.request("/config/runtime-logs/open-directory", {
      method: "POST",
      headers: { "x-admin": "1" }
    });
    expect(response.status).toBe(200);
    expect(opened).toEqual([store.directory]);
    expect(await response.json()).toMatchObject({ ok: true });
  });
});
