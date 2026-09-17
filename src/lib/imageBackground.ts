export const IMAGE_BACKGROUND_OPTIONS = ["auto", "opaque", "transparent"] as const;
export const TRANSPARENT_IMAGE_OUTPUT_FORMAT = "png" as const;
export const INHERITED_SOURCE_BACKGROUND_REQUEST_KEY = "_inheritedSourceBackground" as const;
export const REMOVE_IMAGE_BACKGROUND_PROMPT =
  "移除此图像的背景。保持所有前景主体不变且完整无损，边缘干净平滑。将背景设为透明。";

export type ImageBackgroundOption = (typeof IMAGE_BACKGROUND_OPTIONS)[number];
export type TransparentImageOutputFormat = "png" | "webp";

export const TRANSPARENT_BACKGROUND_PROMPT_INSTRUCTION =
  "透明背景要求：主体必须独立呈现在完全透明的 Alpha 背景上；不要生成棋盘格、纯色底、场景背景或主体外投影。";
export const INHERITED_TRANSPARENT_BACKGROUND_PROMPT_INSTRUCTION =
  "保持透明图片。";
export const OPAQUE_BACKGROUND_PROMPT_INSTRUCTION =
  "不透明背景要求：画布所有区域都必须保持完全不透明；不要输出透明、半透明或 Alpha 镂空背景。";

export function isImageBackgroundOption(value: unknown): value is ImageBackgroundOption {
  return IMAGE_BACKGROUND_OPTIONS.includes(String(value ?? "").trim().toLowerCase() as ImageBackgroundOption);
}

export function normalizeImageBackgroundOption(value: unknown): ImageBackgroundOption {
  const normalized = String(value ?? "").trim().toLowerCase();
  return isImageBackgroundOption(normalized) ? normalized : "auto";
}

export function isTransparentImageOutputFormat(value: unknown): value is TransparentImageOutputFormat {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized === "png" || normalized === "webp";
}

export function normalizeTransparentImageOutputFormat(value: unknown): TransparentImageOutputFormat {
  const normalized = String(value ?? "").trim().toLowerCase();
  return isTransparentImageOutputFormat(normalized) ? normalized : TRANSPARENT_IMAGE_OUTPUT_FORMAT;
}

export function imageEditPromptRequestsNonTransparentBackground(prompt: unknown) {
  const normalized = String(prompt ?? "").replace(/\s+/g, " ").trim();
  if (!normalized) return false;

  const explicitlyRejectsTransparency = [
    /(?:不要|不再|无需|不需要|取消|去掉|去除|移除).{0,10}(?:保持|保留|使用|输出)?\s*(?:透明图片|透明背景|透明效果|alpha\s*通道)/i,
    /\b(?:do\s+not|don't|no\s+longer)\s+(?:keep|preserve|use|output)?\s*(?:a\s+)?transparent\s+(?:image|background)\b/i,
    /\b(?:opaque|non[-\s]?transparent)\s+(?:background|backdrop|image)\b/i
  ].some((pattern) => pattern.test(normalized));
  if (explicitlyRejectsTransparency) return true;

  const explicitlyKeepsTransparency = [
    /(?:保持|保留|继续|仍然|依旧|维持)[^，。！？；;]{0,12}(?:透明图片|透明背景|透明效果|alpha\s*通道|(?:背景|图片)[^，。！？；;]{0,6}透明)/i,
    /(?:添加|增加|新增|加上|创建|换成|换为|更换为?|替换为?|改成|改为|设为|设置为|使用)[^，。！？；;]{0,12}(?:透明背景|无背景)/i,
    /(?:背景|底色|底图)[^，。！？；;]{0,12}(?:保持|保留|继续|仍然|依旧|维持|换成|换为|更换为?|替换为?|改成|改为|设为|设置为)[^，。！？；;]{0,12}(?:透明|无背景)/i,
    /\b(?:keep|preserve|remain)\b[^,.!?;]{0,20}\b(?:transparent|alpha)\b/i,
    /\b(?:add|create|change|set|replace|make|use)\b[^,.!?;]{0,20}\btransparent\b[^,.!?;]{0,12}\b(?:background|backdrop)\b/i,
    /\b(?:add|create|change|set|replace|make|use)\b[^,.!?;]{0,20}\b(?:background|backdrop)\b[^,.!?;]{0,12}\btransparent\b/i
  ].some((pattern) => pattern.test(normalized));
  if (explicitlyKeepsTransparency) return false;

  const negatesBackgroundChange = [
    /(?:不要|不用|无需|不需要|禁止|别)(?:再)?\s*(?:添加|增加|新增|加上|补上|换成|换为|更换|替换|修改|改变|设置|使用)[^，。！？；;]{0,24}(?:背景|底色|底图)/i,
    /(?:背景|底色|底图)[^，。！？；;]{0,12}(?:不要|不用|无需|不需要|禁止|别)\s*(?:修改|改变|更换|替换|添加|增加)/i,
    /\b(?:do\s+not|don't)\b[^,.!?;]{0,20}\b(?:add|create|change|replace|modify|set|use)\b[^,.!?;]{0,24}\b(?:background|backdrop)\b/i
  ].some((pattern) => pattern.test(normalized));
  if (negatesBackgroundChange) return false;

  return [
    /(?:添加|增加|新增|加上|补上|换成|换为|更换|替换|改成|改为|设为|设置为|使用|放到|置于)[^，。！？；;]{0,24}(?:背景|底色|底图)/i,
    /(?:背景|底色|底图)[^，。！？；;]{0,12}(?:换成|换为|更换为?|替换为?|改成|改为|设为|设置为|使用)/i,
    /(?:白色?|黑色?|灰色?|红色?|蓝色?|绿色?|黄色?|纯色|实色|不透明|场景)\s*(?:背景|底色|底图)/i,
    /\b(?:add|create|change|replace|modify|set|use)\b[^,.!?;]{0,32}\b(?:background|backdrop)\b/i,
    /\b(?:background|backdrop)\b[^,.!?;]{0,20}\b(?:to|with|as)\b/i,
    /\b(?:white|black|gray|grey|red|blue|green|yellow|solid|scene)\s+(?:background|backdrop)\b/i
  ].some((pattern) => pattern.test(normalized));
}

export function imageBackgroundRequestOptions(
  background: ImageBackgroundOption,
  transparentOutputFormat: TransparentImageOutputFormat = TRANSPARENT_IMAGE_OUTPUT_FORMAT
) {
  const normalized = normalizeImageBackgroundOption(background);
  if (normalized === "transparent") {
    return {
      background: normalized,
      outputFormat: normalizeTransparentImageOutputFormat(transparentOutputFormat)
    };
  }
  return normalized === "opaque" ? { background: normalized } : {};
}

export function inheritSourceImageBackgroundOptions<T extends {
  background?: ImageBackgroundOption;
  output_format?: TransparentImageOutputFormat;
}>(options: T, sourceImageTransparent: boolean): Omit<T, "background" | "output_format"> & {
  background?: ImageBackgroundOption;
  output_format?: TransparentImageOutputFormat;
} {
  if (!sourceImageTransparent || (options.background && options.background !== "auto")) return { ...options };
  return {
    ...options,
    background: "transparent" as const,
    output_format: TRANSPARENT_IMAGE_OUTPUT_FORMAT
  };
}

export function imageBackgroundRequestOptionsFromMetadata(
  metadata: Record<string, unknown> | null | undefined,
  fallbackBackground: ImageBackgroundOption
) {
  const normalizedFallback = normalizeImageBackgroundOption(fallbackBackground);
  const metadataBackground = isImageBackgroundOption(metadata?.background)
    ? normalizeImageBackgroundOption(metadata?.background)
    : null;
  const fallbackIsExplicit = normalizedFallback !== "auto";
  const effectiveBackground = fallbackIsExplicit
    ? normalizedFallback
    : metadataBackground ?? normalizedFallback;
  const effectiveOutputFormat = fallbackIsExplicit
    ? TRANSPARENT_IMAGE_OUTPUT_FORMAT
    : normalizeTransparentImageOutputFormat(metadata?.outputFormat ?? metadata?.output_format);
  return imageBackgroundRequestOptions(effectiveBackground, effectiveOutputFormat);
}

export function isTransparentImageRequest(payload: Record<string, unknown>) {
  return normalizeImageBackgroundOption(payload.background) === "transparent";
}

export function injectImageBackgroundInstruction(
  prompt: unknown,
  background: unknown,
  inheritedSourceBackground = false
) {
  const normalizedPrompt = String(prompt ?? "");
  const normalizedBackground = normalizeImageBackgroundOption(background);
  const instruction = normalizedBackground === "transparent"
    ? inheritedSourceBackground
      ? INHERITED_TRANSPARENT_BACKGROUND_PROMPT_INSTRUCTION
      : TRANSPARENT_BACKGROUND_PROMPT_INSTRUCTION
    : normalizedBackground === "opaque"
      ? OPAQUE_BACKGROUND_PROMPT_INSTRUCTION
      : "";
  if (!instruction || !normalizedPrompt.trim() || normalizedPrompt.includes(instruction)) return normalizedPrompt;
  return [normalizedPrompt, "", instruction].join("\n");
}
