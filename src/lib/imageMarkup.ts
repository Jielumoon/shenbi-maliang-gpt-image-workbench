export const IMAGE_MARKUP_DEFAULT_PROMPT = "请按照标注图中的位置与意图编辑原图。";

export const IMAGE_MARKUP_PROMPT_INSTRUCTION =
  "图片标注参考要求：附件中的标注图是在原图上叠加的编辑说明。彩色画笔、文字和几何图形只用于指出位置、范围、方向与修改意图，不是最终画面内容；除非用户明确要求保留，否则不得把这些标注线条、文字或图形绘制到结果中。请以未标注的原图为内容基础，结合标注位置和用户说明完成修改，并尽量保持未标注区域不变。";

const IMAGE_MARKUP_REFERENCE_NAME_PATTERN =
  /^(?:图片标注|圖像標註|image markup|画像注釈|이미지 주석)/i;

export function isImageMarkupReferenceName(value: unknown) {
  return IMAGE_MARKUP_REFERENCE_NAME_PATTERN.test(String(value ?? "").trim());
}

export function appendImageMarkupInstruction(prompt: string, imageMarkupReference: boolean) {
  if (!imageMarkupReference || prompt.includes(IMAGE_MARKUP_PROMPT_INSTRUCTION)) return prompt;
  return [prompt, "", IMAGE_MARKUP_PROMPT_INSTRUCTION].join("\n");
}
