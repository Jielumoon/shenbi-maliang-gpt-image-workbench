export type DebugToggleSettings = {
  imageEditMask: boolean;
  runtimeLogging: boolean;
};

export function resolveDebugSettingsUpdate(body: unknown, current: DebugToggleSettings): DebugToggleSettings {
  const record = body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : {};
  return {
    imageEditMask: Object.prototype.hasOwnProperty.call(record, "imageEditMask")
      ? Boolean(record.imageEditMask)
      : current.imageEditMask,
    runtimeLogging: Object.prototype.hasOwnProperty.call(record, "runtimeLogging")
      ? Boolean(record.runtimeLogging)
      : current.runtimeLogging
  };
}
