import { useLayoutEffect, useRef, useState } from "react";

type TextareaRef = {
  current: HTMLTextAreaElement | null;
};

type UseComposerTextareaAutosizeOptions = {
  autosize?: boolean;
  draftPrompt: string;
  expanded?: boolean;
  maxHeight?: number;
  maxLines?: number;
  previewCount: number;
  textareaRef: TextareaRef;
};

export function useComposerTextareaAutosize({
  autosize = true,
  draftPrompt,
  expanded = false,
  maxHeight = 220,
  maxLines = 5,
  previewCount,
  textareaRef
}: UseComposerTextareaAutosizeOptions) {
  const [expandable, setExpandable] = useState(false);
  const [multiline, setMultiline] = useState(false);
  const [collapsedHeight, setCollapsedHeight] = useState(0);
  const collapsedBoxMetricsRef = useRef<{ maxHeight: number; verticalPadding: number } | null>(null);
  const singleLineMeasureWidthRef = useRef(0);

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const resize = () => {
      const styles = window.getComputedStyle(textarea);
      const fontSize = Number.parseFloat(styles.fontSize) || 16;
      const lineHeight = Number.parseFloat(styles.lineHeight) || fontSize * 1.55;
      const verticalPadding = (Number.parseFloat(styles.paddingTop) || 0) + (Number.parseFloat(styles.paddingBottom) || 0);
      const verticalBorder = (Number.parseFloat(styles.borderTopWidth) || 0) + (Number.parseFloat(styles.borderBottomWidth) || 0);
      const singleLineHeight = Math.ceil(lineHeight + verticalPadding + verticalBorder);
      const lineLimitHeight = Math.ceil(lineHeight * Math.max(1, maxLines) + verticalPadding + verticalBorder);
      const collapsedMaxHeight = Math.min(maxHeight, lineLimitHeight);
      if (!expanded) {
        collapsedBoxMetricsRef.current = {
          maxHeight: collapsedMaxHeight,
          verticalPadding
        };
      }
      const currentWidth = textarea.getBoundingClientRect().width;
      if (!multiline && currentWidth > 0) singleLineMeasureWidthRef.current = currentWidth;

      textarea.style.height = "0px";
      const naturalHeight = textarea.scrollHeight;
      let multilineMeasureHeight = naturalHeight;
      const singleLineMeasureWidth = singleLineMeasureWidthRef.current;
      if (multiline && singleLineMeasureWidth > 0 && Math.abs(currentWidth - singleLineMeasureWidth) > 0.5) {
        const previousWidth = textarea.style.width;
        textarea.style.width = `${singleLineMeasureWidth}px`;
        textarea.style.height = "0px";
        multilineMeasureHeight = textarea.scrollHeight;
        textarea.style.width = previousWidth;
        textarea.style.height = "0px";
      }
      setMultiline(multilineMeasureHeight > singleLineHeight + 1);
      setExpandable(naturalHeight > collapsedMaxHeight + 1);
      const collapsedBoxMetrics = collapsedBoxMetricsRef.current;
      const collapsedNaturalHeight = expanded && collapsedBoxMetrics
        ? Math.max(0, naturalHeight - verticalPadding + collapsedBoxMetrics.verticalPadding)
        : naturalHeight;
      setCollapsedHeight(Math.min(collapsedNaturalHeight, collapsedBoxMetrics?.maxHeight ?? collapsedMaxHeight));
      textarea.style.height = expanded
        ? "100%"
        : autosize
          ? `${Math.min(naturalHeight, collapsedMaxHeight)}px`
          : "";
    };

    resize();
    window.addEventListener("resize", resize);
    const parent = textarea.parentElement;
    let observedWidth = parent?.clientWidth ?? 0;
    const observer = parent && typeof ResizeObserver !== "undefined"
      ? new ResizeObserver(() => {
          const nextWidth = parent.clientWidth;
          if (nextWidth === observedWidth) return;
          observedWidth = nextWidth;
          resize();
        })
      : null;
    if (parent && observer) observer.observe(parent);
    return () => {
      window.removeEventListener("resize", resize);
      observer?.disconnect();
    };
  }, [autosize, draftPrompt, expanded, maxHeight, maxLines, multiline, previewCount, textareaRef]);

  return { collapsedHeight, expandable, multiline };
}
