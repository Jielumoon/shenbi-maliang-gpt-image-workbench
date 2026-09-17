import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { Hono } from "hono";
import sharp from "sharp";
import {
  isOfficialOpenAiApiBaseUrl,
  isPlausibleOpenAiApiKey,
  normalizeContentProvenanceResponse,
  OpenAiProvenanceRequestError,
  registerImageProvenanceRoutes
} from "./imageProvenanceRoutes";

describe("image provenance response", () => {
  test("normalizes C2PA and SynthID results without inventing missing fields", () => {
    expect(normalizeContentProvenanceResponse({
      object: "content_provenance_check",
      created_at: 1_778_000_000,
      results: [
        {
          type: "c2pa",
          outcome: "detected",
          validation_state: "trusted",
          issuer: "OpenAI OpCo, LLC",
          model: "gpt-image",
          generated_at: "2026-07-27T18:34:12Z"
        },
        { type: "synthid", outcome: "not_detected", model: null, generated_at: null }
      ]
    })).toEqual({
      object: "content_provenance_check",
      createdAt: 1_778_000_000,
      detected: true,
      results: [
        {
          type: "c2pa",
          outcome: "detected",
          validationState: "trusted",
          issuer: "OpenAI OpCo, LLC",
          model: "gpt-image",
          generatedAt: "2026-07-27T18:34:12Z"
        },
        {
          type: "synthid",
          outcome: "not_detected",
          validationState: null,
          issuer: null,
          model: null,
          generatedAt: null
        }
      ]
    });
  });

  test("rejects a response without supported result entries", () => {
    expect(() => normalizeContentProvenanceResponse({ results: [{ type: "future_signal", outcome: "detected" }] }))
      .toThrow("未返回可识别的检测项");
  });
});

describe("official OpenAI endpoint selection", () => {
  test("accepts only the exact HTTPS OpenAI API hostname", () => {
    expect(isOfficialOpenAiApiBaseUrl("https://api.openai.com")).toBe(true);
    expect(isOfficialOpenAiApiBaseUrl("https://api.openai.com/v1")).toBe(true);
    expect(isOfficialOpenAiApiBaseUrl("http://api.openai.com")).toBe(false);
    expect(isOfficialOpenAiApiBaseUrl("https://api.openai.com.example.com")).toBe(false);
    expect(isOfficialOpenAiApiBaseUrl("https://api.openai.com@example.com")).toBe(false);
  });

  test("rejects placeholders before sending a request to OpenAI", () => {
    expect(isPlausibleOpenAiApiKey("sk-xiongl")).toBe(false);
    expect(isPlausibleOpenAiApiKey("sk-your-key-here")).toBe(false);
    expect(isPlausibleOpenAiApiKey(`sk-proj-${"a".repeat(48)}`)).toBe(true);
  });
});

describe("image provenance routes", () => {
  test("requires a signed-in app user and forwards a validated original image", async () => {
    const db = new Database(":memory:");
    db.exec("create table provider_configs (enabled integer, channel text, created_at text)");
    const anonymousApp = new Hono();
    registerImageProvenanceRoutes(anonymousApp, {
      db,
      environment: { OPENAI_API_KEY: `sk-proj-${"a".repeat(48)}` },
      authorize: async () => null
    });
    const app = new Hono();
    const expected = normalizeContentProvenanceResponse({
      created_at: 1_778_000_000,
      results: [{ type: "synthid", outcome: "not_detected" }]
    });
    registerImageProvenanceRoutes(app, {
      db,
      environment: { OPENAI_API_KEY: `sk-proj-${"a".repeat(48)}` },
      authorize: async () => ({ id: "user-1" }),
      verify: async (_access, file) => {
        expect(file.type).toBe("image/png");
        expect(file.name).toBe("original.png");
        expect(file.size).toBeGreaterThan(0);
        return expected;
      }
    });
    try {
      expect((await anonymousApp.request("/image-provenance/capabilities")).status).toBe(401);
      const capabilityResponse = await app.request("/image-provenance/capabilities");
      expect(capabilityResponse.status).toBe(200);
      expect(await capabilityResponse.json()).toEqual(expect.objectContaining({ configured: true, provider: "openai" }));

      const png = await sharp({
        create: { width: 2, height: 2, channels: 4, background: { r: 20, g: 30, b: 40, alpha: 1 } }
      }).png().toBuffer();
      const form = new FormData();
      form.append("file", new File([png], "original.png", { type: "image/png" }));
      const response = await app.request("/image-provenance/check", { method: "POST", body: form });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(expected);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
    } finally {
      db.close();
    }
  });

  test("marks upstream authentication and access failures as a recoverable dependency error", async () => {
    const db = new Database(":memory:");
    db.exec("create table provider_configs (enabled integer, channel text, created_at text)");
    const app = new Hono();
    registerImageProvenanceRoutes(app, {
      db,
      environment: { OPENAI_API_KEY: `sk-proj-${"a".repeat(48)}` },
      authorize: async () => ({ id: "user-2" }),
      verify: async () => {
        throw new OpenAiProvenanceRequestError(403, "forbidden");
      }
    });
    try {
      const png = await sharp({
        create: { width: 2, height: 2, channels: 4, background: { r: 20, g: 30, b: 40, alpha: 1 } }
      }).png().toBuffer();
      const form = new FormData();
      form.append("file", new File([png], "original.png", { type: "image/png" }));
      const response = await app.request("/image-provenance/check", { method: "POST", body: form });
      expect(response.status).toBe(424);
      expect(await response.json()).toEqual({ error: "OpenAI API 密钥无效或没有访问权限" });
    } finally {
      db.close();
    }
  });
});
