import { describe, expect, test } from "bun:test";
import { resolveDebugSettingsUpdate } from "./debugSettings";

describe("debug settings update compatibility", () => {
  test("preserves the runtime logging switch when an older client omits it", () => {
    expect(resolveDebugSettingsUpdate(
      { imageEditMask: true },
      { imageEditMask: false, runtimeLogging: true }
    )).toEqual({ imageEditMask: true, runtimeLogging: true });
  });

  test("applies explicitly supplied switches", () => {
    expect(resolveDebugSettingsUpdate(
      { imageEditMask: false, runtimeLogging: false },
      { imageEditMask: true, runtimeLogging: true }
    )).toEqual({ imageEditMask: false, runtimeLogging: false });
  });
});
