import { describe, expect, test } from "bun:test";
import {
  INHERITED_TRANSPARENT_BACKGROUND_PROMPT_INSTRUCTION,
  OPAQUE_BACKGROUND_PROMPT_INSTRUCTION,
  REMOVE_IMAGE_BACKGROUND_PROMPT,
  TRANSPARENT_BACKGROUND_PROMPT_INSTRUCTION,
  inheritSourceImageBackgroundOptions,
  imageEditPromptRequestsNonTransparentBackground,
  imageBackgroundRequestOptions,
  imageBackgroundRequestOptionsFromMetadata,
  injectImageBackgroundInstruction,
  isImageBackgroundOption,
  normalizeImageBackgroundOption
} from "./imageBackground";

describe("image background options", () => {
  test("keeps the one-click background removal prompt fixed", () => {
    expect(REMOVE_IMAGE_BACKGROUND_PROMPT).toBe(
      "移除此图像的背景。保持所有前景主体不变且完整无损，边缘干净平滑。将背景设为透明。"
    );
  });

  test("normalizes supported values and falls back to auto", () => {
    expect(normalizeImageBackgroundOption(" TRANSPARENT ")).toBe("transparent");
    expect(normalizeImageBackgroundOption("opaque")).toBe("opaque");
    expect(normalizeImageBackgroundOption("unknown")).toBe("auto");
    expect(isImageBackgroundOption("auto")).toBe(true);
    expect(isImageBackgroundOption("jpeg")).toBe(false);
  });

  test("forces transparent requests to PNG", () => {
    expect(imageBackgroundRequestOptions("transparent")).toEqual({
      background: "transparent",
      outputFormat: "png"
    });
    expect(imageBackgroundRequestOptions("opaque")).toEqual({ background: "opaque" });
    expect(imageBackgroundRequestOptions("auto")).toEqual({});
  });

  test("inherits transparent background parameters from the source image", () => {
    expect(inheritSourceImageBackgroundOptions({}, true)).toEqual({
      background: "transparent",
      output_format: "png"
    });
    expect(inheritSourceImageBackgroundOptions({ background: "auto" }, true)).toEqual({
      background: "transparent",
      output_format: "png"
    });
    expect(inheritSourceImageBackgroundOptions({ background: "opaque" }, true)).toEqual({ background: "opaque" });
    expect(inheritSourceImageBackgroundOptions({}, false)).toEqual({});
  });

  test("recognizes an explicit request to add or replace a non-transparent background", () => {
    expect(imageEditPromptRequestsNonTransparentBackground("给商品添加白色背景")).toBe(true);
    expect(imageEditPromptRequestsNonTransparentBackground("1. (x: 50%, y: 40%) 换一件衣服\n背景换为海滩")).toBe(true);
    expect(imageEditPromptRequestsNonTransparentBackground("把背景换成海滩场景")).toBe(true);
    expect(imageEditPromptRequestsNonTransparentBackground("不要透明图片，改成白底")).toBe(true);
    expect(imageEditPromptRequestsNonTransparentBackground("Change the background to a beach")).toBe(true);
    expect(imageEditPromptRequestsNonTransparentBackground("保持透明图片")).toBe(false);
    expect(imageEditPromptRequestsNonTransparentBackground("添加透明背景")).toBe(false);
    expect(imageEditPromptRequestsNonTransparentBackground("背景改成透明")).toBe(false);
    expect(imageEditPromptRequestsNonTransparentBackground("加一个狗绳，背景保持透明")).toBe(false);
    expect(imageEditPromptRequestsNonTransparentBackground("不要添加背景，只修改衣服")).toBe(false);
    expect(imageEditPromptRequestsNonTransparentBackground("加一个狗绳")).toBe(false);
    expect(imageEditPromptRequestsNonTransparentBackground("Add a transparent background")).toBe(false);
  });

  test("preserves background metadata when resubmitting a message", () => {
    expect(imageBackgroundRequestOptionsFromMetadata({
      background: "transparent",
      outputFormat: "webp"
    }, "auto")).toEqual({ background: "transparent", outputFormat: "webp" });
    expect(imageBackgroundRequestOptionsFromMetadata({ background: "opaque" }, "auto")).toEqual({
      background: "opaque"
    });
    expect(imageBackgroundRequestOptionsFromMetadata({ background: "opaque" }, "transparent")).toEqual({
      background: "transparent",
      outputFormat: "png"
    });
    expect(imageBackgroundRequestOptionsFromMetadata({}, "transparent")).toEqual({
      background: "transparent",
      outputFormat: "png"
    });
  });

  test("injects explicit background instructions idempotently", () => {
    const first = injectImageBackgroundInstruction("一只陶瓷杯", "transparent");
    const second = injectImageBackgroundInstruction(first, "transparent");
    const opaque = injectImageBackgroundInstruction("一只陶瓷杯", "opaque");

    expect(first).toContain(TRANSPARENT_BACKGROUND_PROMPT_INSTRUCTION);
    expect(second).toBe(first);
    expect(opaque).toContain(OPAQUE_BACKGROUND_PROMPT_INSTRUCTION);
    expect(injectImageBackgroundInstruction(opaque, "opaque")).toBe(opaque);
    expect(injectImageBackgroundInstruction("一只陶瓷杯", "auto")).toBe("一只陶瓷杯");
    const inherited = injectImageBackgroundInstruction("修改尾巴颜色", "transparent", true);
    expect(INHERITED_TRANSPARENT_BACKGROUND_PROMPT_INSTRUCTION).toBe("保持透明图片。");
    expect(inherited).toBe("修改尾巴颜色\n\n保持透明图片。");
    expect(injectImageBackgroundInstruction(inherited, "transparent", true)).toBe(inherited);
  });
});
