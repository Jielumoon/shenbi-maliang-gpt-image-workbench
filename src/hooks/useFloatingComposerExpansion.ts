import { useCallback, useEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import { flushSync } from "react-dom";

type FloatingComposerExpansionOptions = {
  formRef: RefObject<HTMLFormElement | null>;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
};

type ExpansionGeometry = {
  bottom: number;
  collapsedHeight: number;
  expandedHeight: number;
  left: number;
  width: number;
};

const EXPAND_DURATION_MS = 300;
const COLLAPSE_DURATION_MS = 250;
const EXPANSION_EASING = "cubic-bezier(0.22, 1, 0.36, 1)";

function expandedTopOffset() {
  return window.matchMedia("(max-width: 640px)").matches ? 12 : 72;
}

function measureCollapsedFormHeight(
  form: HTMLFormElement,
  textarea: HTMLTextAreaElement | null,
  collapsedTextareaHeight: number,
  fallbackHeight: number
) {
  if (!textarea || collapsedTextareaHeight <= 0) return fallbackHeight;
  const formClassName = form.className;
  const formStyle = form.getAttribute("style");
  const textareaStyle = textarea.getAttribute("style");
  form.classList.remove("input-expanded");
  form.style.removeProperty("bottom");
  form.style.removeProperty("height");
  form.style.removeProperty("left");
  form.style.removeProperty("width");
  textarea.style.height = `${collapsedTextareaHeight}px`;
  const measuredHeight = form.getBoundingClientRect().height;
  form.className = formClassName;
  if (formStyle === null) form.removeAttribute("style");
  else form.setAttribute("style", formStyle);
  if (textareaStyle === null) textarea.removeAttribute("style");
  else textarea.setAttribute("style", textareaStyle);
  return measuredHeight > 0 ? measuredHeight : fallbackHeight;
}

export function useFloatingComposerExpansion({ formRef, textareaRef }: FloatingComposerExpansionOptions) {
  const [expanded, setExpanded] = useState(false);
  const [geometry, setGeometry] = useState<ExpansionGeometry | null>(null);
  const animationRef = useRef<Animation | null>(null);
  const animationTimerRef = useRef<number | null>(null);

  const focusTextarea = useCallback(() => {
    window.requestAnimationFrame(() => textareaRef.current?.focus());
  }, [textareaRef]);

  const toggle = useCallback((collapsedTextareaHeight = 0) => {
    const form = formRef.current;
    if (!form) return;
    if (animationRef.current) {
      const activeAnimation = animationRef.current;
      animationRef.current = null;
      if (animationTimerRef.current !== null) {
        window.clearTimeout(animationTimerRef.current);
        animationTimerRef.current = null;
      }
      activeAnimation.cancel();
    }

    if (!expanded) {
      const rect = form.getBoundingClientRect();
      const bottom = Math.max(0, window.innerHeight - rect.bottom);
      const expandedHeight = Math.max(rect.height, window.innerHeight - expandedTopOffset() - bottom);
      const nextGeometry = {
        bottom,
        collapsedHeight: rect.height,
        expandedHeight,
        left: rect.left,
        width: rect.width
      };
      flushSync(() => {
        setGeometry(nextGeometry);
        setExpanded(true);
      });
      textareaRef.current?.scrollTo({ top: 0 });
      focusTextarea();
      const expandedForm = formRef.current;
      if (!expandedForm) return;
      const animation = expandedForm.animate(
        [{ height: `${nextGeometry.collapsedHeight}px` }, { height: `${nextGeometry.expandedHeight}px` }],
        { duration: EXPAND_DURATION_MS, easing: EXPANSION_EASING, fill: "both" }
      );
      animationRef.current = animation;
      const finish = () => {
        if (animationRef.current === animation) {
          animationRef.current = null;
          animation.onfinish = null;
          animation.oncancel = null;
          animation.cancel();
        }
        if (animationTimerRef.current !== null) {
          window.clearTimeout(animationTimerRef.current);
          animationTimerRef.current = null;
        }
      };
      animation.onfinish = finish;
      animation.oncancel = finish;
      animationTimerRef.current = window.setTimeout(finish, EXPAND_DURATION_MS + 50);
      return;
    }

    if (!geometry) return;
    const targetCollapsedHeight = measureCollapsedFormHeight(
      form,
      textareaRef.current,
      collapsedTextareaHeight,
      geometry.collapsedHeight
    );
    const animation = form.animate(
      [{ height: `${form.getBoundingClientRect().height}px` }, { height: `${targetCollapsedHeight}px` }],
      { duration: COLLAPSE_DURATION_MS, easing: EXPANSION_EASING, fill: "forwards" }
    );
    animationRef.current = animation;
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      if (animationRef.current === animation) animationRef.current = null;
      if (animationTimerRef.current !== null) {
        window.clearTimeout(animationTimerRef.current);
        animationTimerRef.current = null;
      }
      flushSync(() => {
        setExpanded(false);
        setGeometry(null);
      });
      animation.onfinish = null;
      animation.oncancel = null;
      animation.cancel();
      focusTextarea();
    };
    animation.onfinish = finish;
    animation.oncancel = finish;
    animationTimerRef.current = window.setTimeout(finish, COLLAPSE_DURATION_MS + 50);
  }, [expanded, focusTextarea, formRef, geometry]);

  useEffect(() => () => {
    if (animationTimerRef.current !== null) window.clearTimeout(animationTimerRef.current);
    const animation = animationRef.current;
    animationRef.current = null;
    if (animation) {
      animation.onfinish = null;
      animation.oncancel = null;
      animation.cancel();
    }
    animationTimerRef.current = null;
  }, []);

  const style: CSSProperties | undefined = expanded && geometry
    ? {
        bottom: geometry.bottom,
        height: geometry.expandedHeight,
        left: geometry.left,
        width: geometry.width
      }
    : undefined;

  return { collapsedHeight: geometry?.collapsedHeight ?? 0, expanded, style, toggle };
}
