import React from 'react';
import type { ArchEntity, CameraEntity, Point } from '../types/model';
import { fovLabel, wedgePoints } from '../engine/camera';

const BLUE = '#2563eb';

/** Camera glyph (body + lens) at a plan point, aimed along `angle`, constant on-screen size. */
function CameraGlyph({ at, angle, zoom, color, selected }: { at: Point; angle: number; zoom: number; color: string; selected?: boolean }) {
  const k = 1 / zoom;
  return (
    <g transform={`translate(${at.x},${at.y}) rotate(${(angle * 180) / Math.PI}) scale(${k})`}>
      {selected && <circle r={17} fill="rgba(217,119,6,0.15)" stroke="#d97706" strokeWidth={1.2} />}
      <rect x={-12} y={-7} width={14} height={14} rx={2.5} fill="#ffffff" stroke={color} strokeWidth={1.8} />
      <circle cx={-8} cy={-9.5} r={2.8} fill="#ffffff" stroke={color} strokeWidth={1.4} />
      <circle cx={-2} cy={-9.5} r={2.8} fill="#ffffff" stroke={color} strokeWidth={1.4} />
      <path d="M 2 -4 L 11 -8 L 11 8 L 2 4 Z" fill={color} />
    </g>
  );
}

/**
 * CAMERA (CAM) in plan: every camera on this level as an icon with a faint view wedge (stronger when
 * selected), plus the live placement wedge with the FOV / lens readout. Cameras exist only in plan.
 */
export const CameraPlanLayer: React.FC<{
  cameras: CameraEntity[];
  selectedIds: Set<string>;
  zoom: number;
  darkMode: boolean;
  /** placement draft: position, aim target (cursor or locked), FOV — null when not placing */
  draft: { position: Point; target: Point; fov: number; stage: 1 | 2; cursor: Point } | null;
  /** step 0: FOV readout next to the cursor */
  idleCursor?: { at: Point; fov: number } | null;
  onEntityClick: (e: React.MouseEvent, ent: ArchEntity) => void;
  onEntityContextMenu: (e: React.MouseEvent, ent: ArchEntity) => void;
  onOpenCamera?: (id: string) => void;
}> = ({ cameras, selectedIds, zoom, darkMode, draft, idleCursor, onEntityClick, onEntityContextMenu, onOpenCamera }) => {
  const fs = 11 / zoom;
  return (
    <g data-testid="camera-plan-layer">
      {cameras.map((c) => {
        const sel = selectedIds.has(c.id);
        const [a, l, r] = wedgePoints(c.position, c.target, c.fov);
        const ang = Math.atan2(c.target.y - c.position.y, c.target.x - c.position.x);
        return (
          <g
            key={c.id}
            data-testid={`camera-icon-${c.id}`}
            className="cursor-pointer"
            onClick={(ev) => {
              if (ev.detail >= 2 && onOpenCamera) {
                ev.stopPropagation();
                onOpenCamera(c.id);
                return;
              }
              onEntityClick(ev, c);
            }}
            onDoubleClick={(ev) => {
              ev.stopPropagation();
              onOpenCamera?.(c.id);
            }}
            onContextMenu={(ev) => onEntityContextMenu(ev, c)}
          >
            <polygon
              points={[a, l, r].map((p) => `${p.x},${p.y}`).join(' ')}
              fill={sel ? 'rgba(37,99,235,0.10)' : 'rgba(37,99,235,0.04)'}
              stroke={sel ? BLUE : 'rgba(37,99,235,0.45)'}
              strokeWidth={(sel ? 1.4 : 1) / zoom}
              strokeDasharray={sel ? undefined : `${5 / zoom} ${4 / zoom}`}
              pointerEvents={sel ? 'visiblePainted' : 'none'}
            />
            {sel && <line x1={c.position.x} y1={c.position.y} x2={c.target.x} y2={c.target.y} stroke={BLUE} strokeWidth={1 / zoom} strokeDasharray={`${8 / zoom} ${4 / zoom}`} pointerEvents="none" />}
            {/* generous hit target around the icon */}
            <circle cx={c.position.x} cy={c.position.y} r={16 / zoom} fill="transparent" />
            <CameraGlyph at={c.position} angle={ang} zoom={zoom} color={BLUE} selected={sel} />
            <text
              x={c.position.x + 16 / zoom}
              y={c.position.y + 20 / zoom}
              fontSize={fs}
              fontWeight={700}
              fill={darkMode ? '#93c5fd' : '#1d4ed8'}
              fontFamily="Inter, system-ui, sans-serif"
              pointerEvents="none"
            >
              {c.name}
              {sel ? ` · ${fovLabel(c.fov)}` : ''}
            </text>
          </g>
        );
      })}

      {draft && (() => {
        const [a, l, r] = wedgePoints(draft.position, draft.target, draft.fov);
        const ang = Math.atan2(draft.target.y - draft.position.y, draft.target.x - draft.position.x);
        const lab = fovLabel(draft.fov);
        const at = draft.stage === 2 ? draft.cursor : draft.target;
        return (
          <g pointerEvents="none" data-testid="camera-draft-wedge">
            <polygon points={[a, l, r].map((p) => `${p.x},${p.y}`).join(' ')} fill="rgba(37,99,235,0.16)" stroke={BLUE} strokeWidth={1.5 / zoom} />
            <line x1={draft.position.x} y1={draft.position.y} x2={draft.target.x} y2={draft.target.y} stroke={BLUE} strokeWidth={1 / zoom} strokeDasharray={`${8 / zoom} ${4 / zoom}`} />
            <circle cx={draft.target.x} cy={draft.target.y} r={4 / zoom} fill="#ffffff" stroke={BLUE} strokeWidth={1.5 / zoom} />
            <CameraGlyph at={draft.position} angle={ang} zoom={zoom} color={BLUE} />
            {/* up-left of the cursor: the snap / tracking tags use the lower-right side */}
            <g transform={`translate(${at.x - (lab.length * 6.7 + 18) / zoom},${at.y - 16 / zoom})`}>
              <rect x={-4 / zoom} y={-13 / zoom} width={(lab.length * 6.7 + 8) / zoom} height={18 / zoom} rx={4 / zoom} fill={BLUE} />
              <text x={0} y={0} fontSize={fs} fill="#ffffff" fontWeight={700} fontFamily="JetBrains Mono, monospace" data-testid="camera-fov-label">
                {lab}
              </text>
            </g>
          </g>
        );
      })()}

      {!draft && idleCursor && (
        <g pointerEvents="none">
          <CameraGlyph at={idleCursor.at} angle={-Math.PI / 2} zoom={zoom} color={BLUE} />
          <text x={idleCursor.at.x + 16 / zoom} y={idleCursor.at.y - 12 / zoom} fontSize={fs} fill={BLUE} fontWeight={700} fontFamily="JetBrains Mono, monospace">
            {fovLabel(idleCursor.fov)}
          </text>
        </g>
      )}
    </g>
  );
};
