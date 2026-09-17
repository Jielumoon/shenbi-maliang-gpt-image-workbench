import { describe, expect, test } from "bun:test";
import {
  DRAWING_REFERENCE_PROMPT_INSTRUCTION,
  appendDrawingReferenceInstruction,
  isDrawingReferenceName
} from "./drawingReference";

describe("drawing reference semantics", () => {
  test("recognizes current and localized drawing material names", () => {
    expect(isDrawingReferenceName("绘图素材-123.png")).toBe(true);
    expect(isDrawingReferenceName("Drawing material-123.png")).toBe(true);
    expect(isDrawingReferenceName("ChatGPT 草图 9月14日.png")).toBe(true);
    expect(isDrawingReferenceName("普通素材.png")).toBe(false);
  });

  test("adds the hidden drawing constraint exactly once", () => {
    const first = appendDrawingReferenceInstruction("生成一个女生", true);
    expect(first).toContain("生成一个女生");
    expect(first).toContain(DRAWING_REFERENCE_PROMPT_INSTRUCTION);
    expect(appendDrawingReferenceInstruction(first, true)).toBe(first);
    expect(appendDrawingReferenceInstruction("生成一个女生", false)).toBe("生成一个女生");
  });
});
