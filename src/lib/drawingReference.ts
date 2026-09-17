export const DRAWING_REFERENCE_REQUEST_KEY = "_drawingReference" as const;

export const DRAWING_REFERENCE_PROMPT_INSTRUCTION =
  "绘图参考要求：附件中由绘图功能生成的简笔线稿或几何草图是用户提供的构图草图，不是普通风格素材。生成时必须把草图作为主要结构约束，保留主体数量、相对位置、姿态与朝向、轮廓、比例、文字内容及空间关系；草图线条和几何图形默认表示结构与占位，不要直接当作成品物体。请依据用户提示补全人物、场景、材质、色彩、光影和细节。除非用户明确要求改变或忽略草图，否则不要重新安排构图。";

const DRAWING_REFERENCE_NAME_PATTERN =
  /^(?:绘图素材|繪圖素材|drawing material|描画素材|그림 소재|chatgpt 草图)/i;

export function isDrawingReferenceName(value: unknown) {
  return DRAWING_REFERENCE_NAME_PATTERN.test(String(value ?? "").trim());
}

export function appendDrawingReferenceInstruction(prompt: string, drawingReference: boolean) {
  if (!drawingReference || prompt.includes(DRAWING_REFERENCE_PROMPT_INSTRUCTION)) return prompt;
  return [prompt, "", DRAWING_REFERENCE_PROMPT_INSTRUCTION].join("\n");
}
