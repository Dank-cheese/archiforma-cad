import React from 'react';
import type { PlanPrim } from '../engine/planPrimitives';

/** Screen pixels per "paper millimetre" for annotation-sized marks drawn in world views. */
export const SCREEN_PX_PER_MM = 3.2;

/**
 * Draws plot primitives inside a world-space SVG group (units = model inches). Pen widths and
 * text heights are paper millimetres, converted with the current zoom so they keep a constant
 * size on screen. Optional per-primitive colour override (selection highlight) and click handler.
 */
export const PrimsWorld: React.FC<{
  prims: PlanPrim[];
  zoom: number; // screen px per model inch
  colorOverride?: (p: PlanPrim) => string | undefined;
  onPrimClick?: (id: string, e: React.MouseEvent) => void;
}> = ({ prims, zoom, colorOverride, onPrimClick }) => {
  const k = SCREEN_PX_PER_MM / Math.max(1e-6, zoom); // paper mm -> world inches
  return (
    <>
      {prims.map((p, i) => {
        const over = colorOverride?.(p);
        const click = onPrimClick && p.id ? (e: React.MouseEvent) => onPrimClick(p.id!, e) : undefined;
        if (p.k === 'text') {
          return (
            <text
              key={i}
              x={p.p.x}
              y={p.p.y}
              fontSize={(p.size / 0.72) * k}
              fontFamily="Helvetica, Arial, sans-serif"
              fontWeight={p.bold ? 'bold' : 'normal'}
              fill={over || p.color}
              textAnchor={p.align === 'center' ? 'middle' : p.align === 'right' ? 'end' : 'start'}
              dominantBaseline="central"
              transform={p.rot ? `rotate(${p.rot} ${p.p.x} ${p.p.y})` : undefined}
              pointerEvents={click ? 'auto' : 'none'}
              onClick={click}
              style={{ userSelect: 'none' }}
            >
              {p.text}
            </text>
          );
        }
        const stroke = p.stroke && p.w > 0 ? over || p.stroke : 'none';
        const common = {
          stroke,
          strokeWidth: Math.max(p.w, 0.08) * k,
          fill: p.fill ? (over && !p.stroke ? over : p.fill) : 'none',
          strokeDasharray: p.dash && p.dash.length ? p.dash.map((v) => v * k).join(' ') : undefined,
          strokeLinejoin: 'round' as const,
          opacity: p.opacity,
          onClick: click,
          pointerEvents: click ? ('visiblePainted' as const) : ('none' as const),
          className: click ? 'cursor-pointer' : undefined,
        };
        if (p.k === 'circle') return <circle key={i} cx={p.c.x} cy={p.c.y} r={Math.max(0.05, p.r)} {...common} />;
        const pts = p.pts.map((q) => `${q.x},${q.y}`).join(' ');
        return p.closed ? <polygon key={i} points={pts} {...common} /> : <polyline key={i} points={pts} {...common} fill="none" />;
      })}
    </>
  );
};
