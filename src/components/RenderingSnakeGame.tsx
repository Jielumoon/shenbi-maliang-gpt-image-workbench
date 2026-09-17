import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { Translate } from "../i18n";
import {
  RENDERING_SNAKE_GRID_SIZE,
  advanceRenderingSnake,
  createRenderingSnakeState,
  queueRenderingSnakeDirection,
  renderingSnakeDirectionForDrag,
  renderingSnakeDirectionForKey,
  toggleRenderingSnakePause,
  type RenderingSnakeDirection,
  type RenderingSnakeState
} from "../lib/renderingSnake";

const SNAKE_STEP_MS = 190;
const SNAKE_CANVAS_MAX_DPR = 1.5;
const SNAKE_VISUAL_INSET_RATIO = 0.008;

type Rgb = [number, number, number];

function readSnakeRgb(element: HTMLElement): Rgb {
  const values = getComputedStyle(element)
    .getPropertyValue("--rendering-dot-rgb")
    .split(",")
    .map((value) => Number(value.trim()));
  if (values.length !== 3 || values.some((value) => !Number.isFinite(value))) return [47, 113, 235];
  return values.map((value) => Math.max(0, Math.min(255, value))) as Rgb;
}

function drawRenderingSnake(canvas: HTMLCanvasElement, state: RenderingSnakeState) {
  const rect = canvas.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return;
  const context = canvas.getContext("2d", { alpha: true });
  if (!context) return;
  const dpr = Math.min(Math.max(window.devicePixelRatio || 1, 1), SNAKE_CANVAS_MAX_DPR);
  const width = Math.round(rect.width * dpr);
  const height = Math.round(rect.height * dpr);
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.clearRect(0, 0, rect.width, rect.height);

  const [red, green, blue] = readSnakeRgb(canvas);
  const insetX = rect.width * SNAKE_VISUAL_INSET_RATIO;
  const insetY = rect.height * SNAKE_VISUAL_INSET_RATIO;
  const cellWidth = (rect.width - insetX * 2) / (RENDERING_SNAKE_GRID_SIZE - 1);
  const cellHeight = (rect.height - insetY * 2) / (RENDERING_SNAKE_GRID_SIZE - 1);
  const cellSize = Math.min(cellWidth, cellHeight);
  const centerFor = (point: { x: number; y: number }) => ({
    x: insetX + point.x * cellWidth,
    y: insetY + point.y * cellHeight
  });

  context.fillStyle = `rgba(${red}, ${green}, ${blue}, 0.14)`;
  for (let y = 0; y < RENDERING_SNAKE_GRID_SIZE; y += 1) {
    for (let x = 0; x < RENDERING_SNAKE_GRID_SIZE; x += 1) {
      context.beginPath();
      context.arc(insetX + x * cellWidth, insetY + y * cellHeight, Math.max(0.85, cellSize * 0.065), 0, Math.PI * 2);
      context.fill();
    }
  }

  const foodCenter = centerFor(state.food);
  const foodGlow = context.createRadialGradient(foodCenter.x, foodCenter.y, 0, foodCenter.x, foodCenter.y, cellSize * 0.62);
  foodGlow.addColorStop(0, `rgba(${red}, ${green}, ${blue}, 0.32)`);
  foodGlow.addColorStop(1, `rgba(${red}, ${green}, ${blue}, 0)`);
  context.fillStyle = foodGlow;
  context.beginPath();
  context.arc(foodCenter.x, foodCenter.y, cellSize * 0.62, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = `rgb(${red}, ${green}, ${blue})`;
  context.beginPath();
  context.arc(foodCenter.x, foodCenter.y, cellSize * 0.31, 0, Math.PI * 2);
  context.fill();

  state.snake.forEach((point, index) => {
    const center = centerFor(point);
    const tailProgress = state.snake.length <= 1 ? 0 : index / (state.snake.length - 1);
    const radiusScale = Math.max(0.14, 0.36 - tailProgress * 0.2);
    context.fillStyle = `rgba(${red}, ${green}, ${blue}, ${Math.max(0.58, 1 - index * 0.055)})`;
    context.beginPath();
    context.arc(center.x, center.y, cellSize * radiusScale, 0, Math.PI * 2);
    context.fill();
  });

  const head = centerFor(state.snake[0]);
  const eyeOffset = cellSize * 0.13;
  const eyeRadius = Math.max(1.05, cellSize * 0.055);
  const direction = state.direction;
  const horizontal = direction === "left" || direction === "right";
  const forward = direction === "left" || direction === "up" ? -1 : 1;
  const eyePoints = horizontal
    ? [{ x: head.x + forward * eyeOffset, y: head.y - eyeOffset }, { x: head.x + forward * eyeOffset, y: head.y + eyeOffset }]
    : [{ x: head.x - eyeOffset, y: head.y + forward * eyeOffset }, { x: head.x + eyeOffset, y: head.y + forward * eyeOffset }];
  context.fillStyle = "rgba(255, 255, 255, 0.94)";
  eyePoints.forEach((eye) => {
    context.beginPath();
    context.arc(eye.x, eye.y, eyeRadius, 0, Math.PI * 2);
    context.fill();
  });
}

export function RenderingSnakeGame({ onExit, t }: { onExit: () => void; t: Translate }) {
  const [game, setGame] = useState(createRenderingSnakeState);
  const gameRef = useRef(game);
  const inputRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const focusFrame = window.requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }));
    return () => window.cancelAnimationFrame(focusFrame);
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setGame((current) => advanceRenderingSnake(current)), SNAKE_STEP_MS);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    gameRef.current = game;
    if (canvasRef.current) drawRenderingSnake(canvasRef.current, game);
  }, [game]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const paint = () => drawRenderingSnake(canvas, gameRef.current);
    const observer = new ResizeObserver(paint);
    observer.observe(canvas);
    paint();
    return () => observer.disconnect();
  }, []);

  const queueDirection = useCallback((direction: RenderingSnakeDirection) => {
    setGame((current) => queueRenderingSnakeDirection(current, direction));
  }, []);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const direction = renderingSnakeDirectionForKey(event.key);
    if (direction) {
      event.preventDefault();
      queueDirection(direction);
      return;
    }
    if (event.key === " " || event.key === "Spacebar") {
      event.preventDefault();
      setGame((current) => toggleRenderingSnakePause(current));
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      onExit();
    }
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    pointerStartRef.current = { x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    event.currentTarget.focus({ preventScroll: true });
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const start = pointerStartRef.current;
    if (!start || (event.pointerType === "mouse" && event.buttons === 0)) return;
    const direction = renderingSnakeDirectionForDrag(event.clientX - start.x, event.clientY - start.y);
    if (!direction) return;
    queueDirection(direction);
    pointerStartRef.current = { x: event.clientX, y: event.clientY };
  };

  const handlePointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const start = pointerStartRef.current;
    pointerStartRef.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    if (!start) return;
    const direction = renderingSnakeDirectionForDrag(event.clientX - start.x, event.clientY - start.y);
    if (direction) queueDirection(direction);
  };

  const statusLabel = game.status === "paused"
    ? t("rendering.snake.paused")
    : game.status === "game-over"
      ? t("rendering.snake.gameOver")
      : "";

  return (
    <div
      ref={inputRef}
      className="rendering-snake-game"
      role="application"
      tabIndex={0}
      aria-label={t("rendering.snake.instructions")}
      onKeyDown={handleKeyDown}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={() => { pointerStartRef.current = null; }}
    >
      <canvas ref={canvasRef} className="rendering-snake-canvas" aria-hidden="true" />
      {statusLabel ? (
        <span className="rendering-snake-status">
          <strong>{statusLabel}</strong>
          {game.status === "game-over" ? <small>{t("rendering.snake.restart")}</small> : null}
        </span>
      ) : null}
      <span className="visually-hidden" aria-live="polite">
        {t("rendering.snake.score", { score: game.score })}
      </span>
    </div>
  );
}
