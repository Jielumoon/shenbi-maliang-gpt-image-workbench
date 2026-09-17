import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  while (temporaryDirectories.length) await rm(temporaryDirectories.pop()!, { recursive: true, force: true });
});

async function runFatalProbe(kind: "exception" | "rejection") {
  const root = await mkdtemp(path.join(tmpdir(), "gpt-image-runtime-fatal-"));
  temporaryDirectories.push(root);
  const moduleUrl = pathToFileURL(path.join(import.meta.dir, "runtimeLogger.ts")).href;
  const failure = kind === "exception"
    ? "throw new Error('fatal exception probe')"
    : "Promise.reject(new Error('fatal rejection probe')); setTimeout(() => {}, 1000)";
  const script = `
    process.env.GPT_IMAGE_DATA_DIR = ${JSON.stringify(root)};
    const { initializeRuntimeLogging } = await import(${JSON.stringify(moduleUrl)});
    initializeRuntimeLogging(true);
    ${failure};
  `;
  const processResult = Bun.spawn([process.execPath, "-e", script], { stdout: "pipe", stderr: "pipe" });
  const [exitCode] = await Promise.all([
    processResult.exited,
    new Response(processResult.stdout).text(),
    new Response(processResult.stderr).text()
  ]);
  const logDirectory = path.join(root, "logs");
  const files = await readdir(logDirectory);
  const content = (await Promise.all(files.filter((name) => name.endsWith(".jsonl")).map((name) => readFile(path.join(logDirectory, name), "utf8")))).join("\n");
  return { exitCode, content };
}

describe("runtime logger fatal process handling", () => {
  test("records uncaught exceptions without swallowing the non-zero exit", async () => {
    const result = await runFatalProbe("exception");
    expect(result.exitCode).not.toBe(0);
    expect(result.content).toContain("process.uncaught_exception");
    expect(result.content).toContain("fatal exception probe");
  });

  test("records unhandled rejections and preserves the non-zero exit", async () => {
    const result = await runFatalProbe("rejection");
    expect(result.exitCode).not.toBe(0);
    expect(result.content).toContain("process.unhandled_rejection");
    expect(result.content).toContain("fatal rejection probe");
  });
});
