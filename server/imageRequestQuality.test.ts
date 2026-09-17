import { describe, expect, test } from "bun:test";
import { DEFAULT_REQUEST_QUALITY, requestImageQuality } from "./constants";

describe("image request quality", () => {
  test("uses the provider default only when the request is empty", () => {
    expect(requestImageQuality(undefined, "high")).toBe("high");
    expect(requestImageQuality("", "medium")).toBe("medium");
  });

  test("preserves the official automatic quality value", () => {
    expect(requestImageQuality("auto", "high")).toBe("auto");
    expect(requestImageQuality("AUTO", "medium")).toBe("auto");
    expect(requestImageQuality(undefined, undefined)).toBe(DEFAULT_REQUEST_QUALITY);
    expect(requestImageQuality("auto", "")).toBe(DEFAULT_REQUEST_QUALITY);
    expect(requestImageQuality("auto", "auto")).toBe(DEFAULT_REQUEST_QUALITY);
  });

  test("preserves an explicitly requested quality", () => {
    expect(requestImageQuality("low", "high")).toBe("low");
    expect(requestImageQuality("medium", "high")).toBe("medium");
    expect(requestImageQuality("high", "low")).toBe("high");
    expect(requestImageQuality("xhigh", "high")).toBe("xhigh");
    expect(requestImageQuality("max", "high")).toBe("max");
  });
});
