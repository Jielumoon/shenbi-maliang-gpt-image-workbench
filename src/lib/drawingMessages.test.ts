import { describe, expect, test } from "bun:test";
import { enabledLocales } from "../i18n/locales";
import drawingMessages from "../i18n/messages/drawingMessages";

const requiredKeys = [
  "composer.drawing",
  "drawing.title",
  "drawing.fileName",
  "drawing.tool.select",
  "drawing.tool.brush",
  "drawing.tool.text",
  "drawing.tool.shape",
  "drawing.tool.eraser",
  "drawing.shape.roundedRectangle",
  "drawing.shape.triangle",
  "drawing.shape.diamond",
  "drawing.shape.star",
  "drawing.shape.hexagon",
  "drawing.shape.heart",
  "drawing.confirm",
  "drawing.elementSize",
  "drawing.continue",
  "drawing.discard.title",
  "drawing.error.inlineLimit",
  "toast.drawingImageAdded",
  "toast.drawingImageAddedFallback",
  "toast.drawingImageFailed",
  "settings.general.autoUpload.desc"
];

describe("drawing messages", () => {
  test("provides the complete drawing interaction copy for every enabled locale", () => {
    for (const locale of enabledLocales) {
      const messages = drawingMessages[locale.code];
      for (const key of requiredKeys) {
        expect(messages[key], `${locale.code} should define ${key}`).toBeTruthy();
      }
    }
  });
});
