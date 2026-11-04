"use client";

import React, { useEffect, useRef } from "react";

export interface PixelBackgroundProps {
  /** Espace entre deux pixels, en px. */
  gap?: number;
  /** 60 = vitesse normale. */
  speed?: number;
  /** Couleurs séparées par des virgules, ou tableau. */
  colors?: string | string[];
  opacity?: number;
  /** Côté d'où part l'ondulation. */
  direction?: "top" | "bottom" | "left" | "right";
  className?: string;
}

export default function PixelBackground({
  gap = 6,
  speed = 60,
  colors = "#d4d4d4,#e5e5e5,#c4c4c4",
  opacity = 0.7,
  direction = "top",
  className = "",
}: PixelBackgroundProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const palette = Array.isArray(colors)
    ? colors
    : colors.split(",").map((c) => c.trim()).filter(Boolean);
  const paletteKey = palette.join("|");

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!wrap || !canvas || !ctx) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const colorList = paletteKey.split("|");
    const size = Math.max(2, gap - 3);
    let pixels: { x: number; y: number; c: string; p: number; s: number }[] = [];
    let raf = 0;
    let last = 0;

    const build = () => {
      const { width, height } = wrap.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.floor(width * dpr));
      canvas.height = Math.max(1, Math.floor(height * dpr));
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      pixels = [];
      for (let x = 0; x < width; x += gap) {
        for (let y = 0; y < height; y += gap) {
          if (Math.random() < 0.35) continue;
          const along =
            direction === "top" ? y / height
            : direction === "bottom" ? 1 - y / height
            : direction === "left" ? x / width
            : 1 - x / width;
          pixels.push({
            x,
            y,
            c: colorList[Math.floor(Math.random() * colorList.length)],
            p: Math.random() * 1.5 + along * 5, // ondulation depuis le côté choisi
            s: 0.4 + Math.random() * 0.6,
          });
        }
      }
    };

    const draw = (t: number) => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const k = (t / 1000) * (speed / 60);
      for (const px of pixels) {
        const a = reduced ? 0.6 : (Math.sin(k * px.s * 2 - px.p) + 1) / 2;
        ctx.globalAlpha = a * opacity;
        ctx.fillStyle = px.c;
        ctx.fillRect(px.x, px.y, size, size);
      }
    };

    const loop = (t: number) => {
      raf = requestAnimationFrame(loop);
      if (t - last < 33) return;
      last = t;
      draw(t);
    };

    build();
    draw(0);
    if (!reduced) raf = requestAnimationFrame(loop);

    const observer = new ResizeObserver(() => {
      build();
      draw(last);
    });
    observer.observe(wrap);

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, [gap, speed, opacity, direction, paletteKey]);

  return (
    <div ref={wrapRef} className={className} aria-hidden="true">
      <canvas ref={canvasRef} className="block" />
    </div>
  );
}
