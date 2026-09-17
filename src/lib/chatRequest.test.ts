import { describe, expect, test } from "bun:test";
import type { Message } from "../types";
import { sourceSnapshotFromMessage } from "./chatRequest";

describe("chat request source snapshots", () => {
  test("restores explicit drawing-reference metadata", () => {
    const snapshot = sourceSnapshotFromMessage({
      metadata: { drawingReference: true }
    } as unknown as Message);
    expect(snapshot.drawingReference).toBe(true);
  });

  test("recognizes an older drawing snapshot from its preserved name", () => {
    const snapshot = sourceSnapshotFromMessage({
      sourceReferenceImages: [{
        id: "message-source:msgref-1",
        sourceReferenceId: "msgref-1",
        kind: "asset",
        name: "绘图素材-123.png",
        url: "/drawing.png",
        imageWidth: 200,
        imageHeight: 120
      }]
    } as unknown as Message);
    expect(snapshot.drawingReference).toBe(true);
    expect(snapshot.sourceReferenceIds).toEqual(["msgref-1"]);
  });
});
