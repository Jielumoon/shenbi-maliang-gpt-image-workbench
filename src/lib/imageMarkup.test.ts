import { describe, expect, test } from "bun:test";
import {
  IMAGE_MARKUP_PROMPT_INSTRUCTION,
  appendImageMarkupInstruction,
  isImageMarkupReferenceName
} from "./imageMarkup";

describe("image markup references", () => {
  test("recognizes persisted markup attachment names", () => {
    expect(isImageMarkupReferenceName("图片标注-123.png")).toBe(true);
    expect(isImageMarkupReferenceName("image markup-123.png")).toBe(true);
    expect(isImageMarkupReferenceName("普通素材.png")).toBe(false);
  });

  test("adds the markup guidance once", () => {
    const prompt = appendImageMarkupInstruction("把这里换成蓝色", true);
    expect(prompt).toContain("把这里换成蓝色");
    expect(prompt).toContain(IMAGE_MARKUP_PROMPT_INSTRUCTION);
    expect(appendImageMarkupInstruction(prompt, true)).toBe(prompt);
    expect(appendImageMarkupInstruction("整体调亮", false)).toBe("整体调亮");
  });
});
