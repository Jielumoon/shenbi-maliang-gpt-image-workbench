import { describe, expect, test } from "bun:test";
import {
  collectChatGptResponsesModelIds,
  collectProviderModelIds,
  isImageGenerationModel,
  isResponsesLanguageModel,
  providerModelListPath,
  providerModelListUrl
} from "./providerModels";

describe("provider model discovery", () => {
  test("derives the standard model-list path from Responses configuration", () => {
    expect(providerModelListPath({ channel: "cpa", responses_path: "/v1/responses", generation_path: "/v1/images/generations" })).toBe("/v1/models");
    expect(providerModelListPath({ channel: "api", responses_path: "/openai/v1/responses", generation_path: "/images/generations" })).toBe("/openai/v1/models");
    expect(providerModelListUrl({ base_url: "https://example.com/openai/v1", channel: "api", responses_path: "/openai/v1/responses", generation_path: "/openai/v1/images/generations" })).toBe(
      "https://example.com/openai/v1/models"
    );
  });

  test("uses the Codex model catalog for ChatGPT Web", () => {
    expect(providerModelListPath({ channel: "chatgpt_web", responses_path: "/codex/responses", generation_path: "/f/conversation" })).toBe("/codex/models");
    expect(providerModelListUrl({ base_url: "https://chatgpt.com/backend-api", channel: "chatgpt_web", responses_path: "/codex/responses", generation_path: "/f/conversation" })).toBe(
      "https://chatgpt.com/backend-api/codex/models?client_version=0.154.0"
    );
  });

  test("collects OpenAI-compatible and Codex catalog model identifiers", () => {
    expect(collectProviderModelIds({ data: [{ id: "gpt-6-astra" }, { id: "gpt-image-2.5-flare" }] })).toEqual([
      "gpt-6-astra",
      "gpt-image-2.5-flare"
    ]);
    expect(collectProviderModelIds({ models: [{ slug: "gpt-5.6-terra" }, "gpt-5.6-luna"] })).toEqual([
      "gpt-5.6-terra",
      "gpt-5.6-luna"
    ]);
    expect(collectProviderModelIds({ data: [], models: [{ slug: "gpt-5.5" }] })).toEqual(["gpt-5.5"]);
  });

  test("uses ChatGPT catalog visibility and image/API support metadata", () => {
    const catalog = {
      models: [
        { slug: "gpt-6-astra", visibility: "list", supported_in_api: true, input_modalities: ["text", "image"] },
        { slug: "gpt-reserve", visibility: "hide", supported_in_api: true, input_modalities: ["text", "image"] },
        { slug: "gpt-5.3-codex-spark", visibility: "list", supported_in_api: false, input_modalities: ["text"] },
        { slug: "codex-auto-review", visibility: "hide", supported_in_api: true, input_modalities: ["text", "image"] }
      ]
    };
    expect(collectProviderModelIds(catalog)).toEqual(["gpt-6-astra", "gpt-5.3-codex-spark"]);
    expect(collectChatGptResponsesModelIds(catalog)).toEqual(["gpt-6-astra"]);
  });

  test("separates image and Responses language models", () => {
    expect(isImageGenerationModel("gpt-image-2.5-sunburst")).toBe(true);
    expect(isImageGenerationModel("dall-e-3")).toBe(true);
    expect(isResponsesLanguageModel("gpt-6-astra")).toBe(true);
    expect(isResponsesLanguageModel("glm-5")).toBe(true);
    expect(isResponsesLanguageModel("gpt-image-2")).toBe(false);
    expect(isResponsesLanguageModel("text-embedding-3-large")).toBe(false);
    expect(isResponsesLanguageModel("codex-auto-review")).toBe(false);
  });
});
