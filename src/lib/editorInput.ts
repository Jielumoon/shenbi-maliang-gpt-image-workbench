export function shouldSubmitComposerOnEnter(key: string, shiftKey: boolean, isComposing: boolean) {
  return key === "Enter" && !shiftKey && !isComposing;
}

export function wheelSizeDelta(deltaX: number, deltaY: number, step: number) {
  const delta = Math.abs(deltaY) >= Math.abs(deltaX) ? deltaY : deltaX;
  if (!Number.isFinite(delta) || Math.abs(delta) < 1 || !Number.isFinite(step) || step <= 0) return 0;
  return delta < 0 ? step : -step;
}

export function shouldWheelAdjustToolSize(zoomValue: "fit" | number) {
  return zoomValue === "fit";
}

export function editorPreviewPanY(
  requestedPanY: number,
  annotationComposerExpanded: boolean,
  zoomValue: "fit" | number,
  visibleStageHeight: number,
  stageHeight: number
) {
  return annotationComposerExpanded && shouldWheelAdjustToolSize(zoomValue) && visibleStageHeight > 0
    ? visibleStageHeight / 2 - stageHeight / 2
    : requestedPanY;
}
