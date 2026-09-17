import { describe, expect, test } from "bun:test";
import path from "node:path";
import { localDirectoryOpenCommand } from "./openLocalDirectory";

describe("local directory opener", () => {
  test("opens the exact resolved directory with Windows Explorer arguments", () => {
    const result = localDirectoryOpenCommand("data/logs", "win32", 1234);
    expect(result.candidates[0].replaceAll("\\", "/").toLowerCase()).toEndWith("/powershell.exe");
    expect(result.environment.GPT_IMAGE_LOG_DIRECTORY).toBe(path.resolve("data/logs"));
    expect(result.environment.GPT_IMAGE_SERVER_PID).toBe("1234");
    expect(result.args.join(" ")).toContain("SessionId");
    expect(result.args.join(" ")).toContain("Start-Process");
  });

  test("fails clearly outside a Windows desktop environment", () => {
    expect(() => localDirectoryOpenCommand("data/logs", "linux")).toThrow("无法打开资源管理器");
  });
});
