import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { formatRuntimeLogTimestamp, RuntimeLogStore, sanitizeRuntimeLogString } from "./runtimeLogger";

const temporaryDirectories: string[] = [];

async function temporaryLogDirectory() {
  const root = await mkdtemp(path.join(tmpdir(), "gpt-image-runtime-log-"));
  temporaryDirectories.push(root);
  return path.join(root, "logs");
}

afterEach(async () => {
  while (temporaryDirectories.length) await rm(temporaryDirectories.pop()!, { recursive: true, force: true });
});

describe("runtime log store", () => {
  test("writes an unambiguous local timestamp with a numeric timezone offset", () => {
    const date = new Date(2026, 8, 17, 11, 23, 1, 258);
    const timestamp = formatRuntimeLogTimestamp(date);
    expect(timestamp).toMatch(/^2026-09-17T11:23:01\.258[+-]\d{2}:\d{2}$/);
    expect(timestamp.endsWith("Z")).toBe(false);
    expect(Date.parse(timestamp)).toBe(date.getTime());
  });

  test("does not create files while disabled and stops appending immediately", async () => {
    const directory = await temporaryLogDirectory();
    const store = new RuntimeLogStore({ directory, version: "test" });
    expect(store.write({ level: "error", source: "server", event: "disabled", message: "ignored" })).toBeNull();
    expect(existsSync(directory)).toBe(false);

    store.setEnabled(true);
    store.write({ level: "warn", source: "server", event: "enabled", message: "saved" });
    store.setEnabled(false);
    const before = store.preview().entries.length;
    store.write({ level: "error", source: "server", event: "disabled-again", message: "ignored" });
    expect(store.preview().entries.length).toBe(before);
  });

  test("redacts credentials, strips URL queries, and filters previews", async () => {
    const directory = await temporaryLogDirectory();
    const store = new RuntimeLogStore({ directory, version: "test" });
    store.setEnabled(true);
    store.write({
      level: "error",
      source: "http",
      event: "provider.failed",
      message: "Authorization: Bearer abc.secret https://example.com/path?token=hidden",
      path: "/api/test?token=hidden",
      details: { apiKey: "sk-secret", nested: { password: "pw", safe: "visible" } }
    });
    const preview = store.preview({ level: "error", source: "http" });
    expect(preview.entries).toHaveLength(1);
    const serialized = JSON.stringify(preview.entries[0]);
    expect(serialized).not.toContain("abc.secret");
    expect(serialized).not.toContain("sk-secret");
    expect(serialized).not.toContain("hidden");
    expect(serialized).not.toContain("\"pw\"");
    expect(preview.entries[0].path).toBe("/api/test");
    expect(preview.entries[0].details).toMatchObject({ apiKey: "[redacted]", nested: { password: "[redacted]", safe: "visible" } });
  });

  test("rotates files and enforces age and total-size retention", async () => {
    const directory = await temporaryLogDirectory();
    const now = new Date(2026, 8, 16, 12, 0, 0);
    const store = new RuntimeLogStore({
      directory,
      version: "test",
      now: () => now,
      retentionDays: 14,
      maximumFileBytes: 700,
      maximumTotalBytes: 1_600
    });
    store.setEnabled(true);
    for (let index = 0; index < 8; index += 1) {
      store.write({ level: "warn", source: "server", event: `event-${index}`, message: "x".repeat(220) });
    }
    await writeFile(path.join(directory, "runtime-2026-08-01.jsonl"), "old\n");
    const files = store.files();
    expect(files.some((file) => file.name === "runtime-2026-08-01.jsonl")).toBe(false);
    expect(files.length).toBeGreaterThan(1);
    expect(files.reduce((total, file) => total + file.size, 0)).toBeLessThanOrEqual(1_600);
  });

  test("rejects traversal and reports an unwritable directory without throwing during restore", async () => {
    const root = await temporaryLogDirectory();
    await writeFile(root, "not-a-directory");
    const store = new RuntimeLogStore({ directory: root, version: "test" });
    store.restoreConfiguredState(true);
    expect(store.status().enabled).toBe(true);
    expect(store.status().healthy).toBe(false);
    expect(store.status().lastError).not.toBe("");

    const validDirectory = await temporaryLogDirectory();
    const validStore = new RuntimeLogStore({ directory: validDirectory, version: "test" });
    validStore.setEnabled(true);
    expect(() => validStore.resolveFile("../secret.log")).toThrow("日志文件名不合法");
  });

  test("sanitizes bearer tokens and URL credentials", () => {
    const sanitized = sanitizeRuntimeLogString("Bearer top-secret https://admin:pw@example.com/path?api_key=secret#fragment");
    expect(sanitized).toContain("Bearer [redacted]");
    expect(sanitized).toContain("https://example.com/path");
    expect(sanitized).not.toContain("top-secret");
    expect(sanitized).not.toContain("admin:pw");
    expect(sanitized).not.toContain("api_key");
  });

  test("reads raw JSONL from the tail in line-aligned chunks", async () => {
    const directory = await temporaryLogDirectory();
    const store = new RuntimeLogStore({ directory, version: "test" });
    store.setEnabled(true);
    for (let index = 0; index < 8; index += 1) {
      store.write({ level: "warn", source: "server", event: `raw-${index}`, message: `message-${index}-${"x".repeat(100)}` });
    }
    const fileName = store.files()[0].name;
    const chunks: string[] = [];
    let before: number | undefined;
    do {
      const chunk = store.rawChunk(fileName, before, 1_024);
      chunks.unshift(chunk.content);
      before = chunk.hasEarlier ? chunk.start : undefined;
      if (!chunk.hasEarlier) break;
    } while (true);
    const content = chunks.join("");
    expect(content).toContain("raw-0");
    expect(content).toContain("raw-7");
    expect(content.trim().split(/\r?\n/).every((line) => JSON.parse(line))).toBe(true);
  });
});
