"use client";

import React, { useEffect, useRef, useState } from "react";
import {
  motion,
  animate,
  useMotionValue,
  useMotionValueEvent,
  useTransform,
  useReducedMotion,
} from "motion/react";

export interface TimelineProps {
  children: React.ReactNode;
  /** Inclinaison du bloc, en degrés. */
  rotation?: number;
  /** Position de repos de la poignée, en % de la largeur masquée à gauche. */
  initialLeft?: number;
  /** Si défini, la poignée glisse de cette valeur (%) vers initialLeft à l'affichage. */
  introFrom?: number;
  /** Largeur minimale (en %) toujours visible : la poignée ne va pas plus loin. */
  minWidth?: number;
  className?: string;
  /** Classes de la zone qui masque le texte : mettez la couleur du fond. */
  containerClassName?: string;
  handleClassName?: string;
  handleIndicatorClassName?: string;
}

export function TimelineText({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <span className={`block ${className}`}>{children}</span>;
}

export function Timeline({
  children,
  rotation = 0,
  initialLeft = 0,
  introFrom,
  minWidth = 30,
  className = "",
  containerClassName = "bg-white",
  handleClassName = "bg-white border-neutral-900",
  handleIndicatorClassName = "bg-neutral-900",
}: TimelineProps) {
  const reduce = useReducedMotion();
  const boxRef = useRef<HTMLSpanElement>(null);
  const playback = useRef<ReturnType<typeof animate> | null>(null);
  const max = Math.max(0, 100 - minWidth);
  const start = introFrom !== undefined && !reduce ? introFrom : initialLeft;
  const left = useMotionValue(Math.min(max, Math.max(0, start)));
  const edge = useTransform(left, (v) => `${v}%`);
  const [now, setNow] = useState(Math.round(left.get()));
  useMotionValueEvent(left, "change", (v) => setNow(Math.round(v)));

  useEffect(() => {
    if (introFrom === undefined || reduce) {
      left.set(initialLeft);
      return;
    }
    playback.current = animate(left, initialLeft, {
      duration: 1.2,
      delay: 0.7,
      ease: [0.22, 1, 0.36, 1],
    });
    return () => playback.current?.stop();
  }, [introFrom, initialLeft, reduce, left]);

  const moveTo = (clientX: number) => {
    const rect = boxRef.current?.getBoundingClientRect();
    if (!rect || !rect.width) return;
    const pct = ((clientX - rect.left) / rect.width) * 100;
    left.set(Math.min(max, Math.max(0, pct)));
  };

  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    playback.current?.stop();
    const onMove = (ev: PointerEvent) => moveTo(ev.clientX);
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 15 : 5;
    if (e.key === "ArrowRight") left.set(Math.min(max, left.get() + step));
    else if (e.key === "ArrowLeft") left.set(Math.max(0, left.get() - step));
    else if (e.key === "Home") left.set(0);
    else if (e.key === "End") left.set(max);
    else return;
    e.preventDefault();
  };

  return (
    <span
      ref={boxRef}
      className={`relative inline-block ${className}`}
      style={{ transform: `rotate(${rotation}deg)` }}
    >
      {children}

      {/* Zone qui masque le texte à gauche de la poignée */}
      <motion.span
        aria-hidden="true"
        style={{ width: edge }}
        className={`absolute inset-y-0 left-0 pointer-events-none ${containerClassName}`}
      />

      {/* Poignée : glisser ou flèches du clavier */}
      <motion.span
        role="slider"
        tabIndex={0}
        aria-label="Révéler le texte"
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={now}
        style={{ left: edge }}
        onPointerDown={onPointerDown}
        onKeyDown={onKeyDown}
        className={`absolute inset-y-[-2px] -ml-2 w-4 flex items-center justify-center rounded-md border-2 cursor-ew-resize touch-none select-none outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[#ff6a2b] ${handleClassName}`}
      >
        <span className={`w-1 h-1/2 rounded-full ${handleIndicatorClassName}`} />
      </motion.span>
    </span>
  );
}
