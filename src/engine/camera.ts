/**
 * CAMERA (CAM) — pure camera math for saved 3D perspective views.
 *
 * Plan coordinates are inches, +Y down (south), +X east. 3D (three.js) mapping used across the app:
 * three.x = plan x, three.z = plan y, three.y = up.
 *
 * Field of view is stored HORIZONTAL (what architects and photographers quote with a lens);
 * THREE.PerspectiveCamera wants the VERTICAL fov, so convert with horizontalToVerticalFov().
 */
import type { ArchEntity, ArchModel, CameraAspect, CameraEntity, CameraSun, Point } from '../types/model';

export const EYE_HEIGHT_DEFAULT = 66; // 5'-6" ≈ 1.7 m
export const FOV_MIN = 20;
export const FOV_MAX = 100;
export const FOV_DEFAULT = 60;
/** full-frame 35 mm film / sensor: 36 × 24 mm */
export const SENSOR_WIDTH_MM = 36;
export const LENS_PRESETS: Array<{ mm: number; label: string }> = [
  { mm: 18, label: '18 mm ultra-wide' },
  { mm: 24, label: '24 mm wide' },
  { mm: 35, label: '35 mm' },
  { mm: 50, label: '50 mm normal' },
  { mm: 85, label: '85 mm portrait' },
];
export const CAMERA_ASPECTS: Array<{ id: CameraAspect; label: string; ratio: number }> = [
  { id: '16:9', label: '16:9 widescreen', ratio: 16 / 9 },
  { id: '4:3', label: '4:3', ratio: 4 / 3 },
  { id: '1:1', label: '1:1 square', ratio: 1 },
  { id: 'A3', label: 'A3 landscape', ratio: 420 / 297 },
];

const DEG = Math.PI / 180;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export const clampFov = (deg: number) => clamp(Number.isFinite(deg) ? deg : FOV_DEFAULT, FOV_MIN, FOV_MAX);

/** Horizontal FOV (deg) of a lens of focal length `mm` on a sensor `sensorWidth` mm wide. */
export function focalToFov(mm: number, sensorWidth = SENSOR_WIDTH_MM): number {
  return (2 * Math.atan(sensorWidth / (2 * Math.max(0.1, mm)))) / DEG;
}

/** Focal length (mm) giving a horizontal FOV of `deg`. */
export function fovToFocal(deg: number, sensorWidth = SENSOR_WIDTH_MM): number {
  return sensorWidth / (2 * Math.tan((clamp(deg, 0.1, 179) * DEG) / 2));
}

export function aspectRatio(a: CameraAspect | undefined): number {
  return CAMERA_ASPECTS.find((x) => x.id === a)?.ratio ?? 16 / 9;
}

/** THREE.PerspectiveCamera.fov is vertical: vfov = 2·atan(tan(hfov/2) / aspect). */
export function horizontalToVerticalFov(hfovDeg: number, aspect: number): number {
  return (2 * Math.atan(Math.tan((hfovDeg * DEG) / 2) / Math.max(1e-6, aspect))) / DEG;
}

export function verticalToHorizontalFov(vfovDeg: number, aspect: number): number {
  return (2 * Math.atan(Math.tan((vfovDeg * DEG) / 2) * aspect)) / DEG;
}

/** Short label shown live while placing / editing: "FOV 62° · ≈ 30 mm". */
export function fovLabel(fov: number): string {
  return `FOV ${Math.round(fov)}° · ≈ ${Math.round(fovToFocal(fov))} mm`;
}

const sub = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });
const len = (v: Point) => Math.hypot(v.x, v.y);
const unit = (v: Point): Point => {
  const l = len(v);
  return l > 1e-9 ? { x: v.x / l, y: v.y / l } : { x: 1, y: 0 };
};
const rot = (v: Point, a: number): Point => ({ x: v.x * Math.cos(a) - v.y * Math.sin(a), y: v.x * Math.sin(a) + v.y * Math.cos(a) });

/** Plan distance from the camera to its target (the target / far distance). */
export const aimDistance = (position: Point, target: Point) => len(sub(target, position));

/**
 * Field of view from the cursor's offset from the centre line (placement step 3 and the edge grips):
 * each wedge edge passes through the cursor, so FOV = 2·atan(|offset| / along).
 * A cursor beside or behind the camera gives the maximum.
 */
export function fovFromCursor(position: Point, target: Point, cursor: Point): number {
  const d = unit(sub(target, position));
  const v = sub(cursor, position);
  const along = v.x * d.x + v.y * d.y;
  const perp = Math.abs(v.x * d.y - v.y * d.x);
  if (along <= 1e-6) return FOV_MAX;
  return clampFov((2 * Math.atan2(perp, along)) / DEG);
}

/**
 * The view wedge in plan: [apex, left corner, right corner]. The far side is perpendicular to the
 * centre line at the target distance (so the corners lie at distance D / cos(fov/2)).
 * "Left" is the left of the view direction as seen by the camera (plan +Y is down, so that is the
 * side reached by rotating the direction by −fov/2).
 */
export function wedgePoints(position: Point, target: Point, fovDeg: number, distance?: number): [Point, Point, Point] {
  const d = unit(sub(target, position));
  const D = distance ?? Math.max(1, aimDistance(position, target));
  const half = (clampFov(fovDeg) * DEG) / 2;
  const r = D / Math.cos(half);
  const l = rot(d, -half);
  const rr = rot(d, half);
  return [
    { ...position },
    { x: position.x + l.x * r, y: position.y + l.y * r },
    { x: position.x + rr.x * r, y: position.y + rr.y * r },
  ];
}

/** Ground elevation under a plan point. No terrain in the model → the level's elevation. */
export function groundElevationAt(model: Pick<ArchModel, 'levels'>, _pt: Point, levelId?: string, terrain?: (p: Point) => number | null): number {
  const t = terrain?.(_pt);
  if (t !== null && t !== undefined && Number.isFinite(t)) return t;
  return (model.levels ?? []).find((l) => l.id === (levelId || 'level-1'))?.elevation ?? 0;
}

export function nextCameraName(entities: ArchEntity[]): string {
  let n = 1;
  const names = new Set(entities.filter((e): e is CameraEntity => e.type === 'camera').map((c) => c.name));
  while (names.has(`Camera ${n}`)) n++;
  return `Camera ${n}`;
}

export const DEFAULT_SUN: CameraSun = { enabled: false, month: 6, day: 21, hour: 15, latitude: 40 };

/** New camera from the three placement clicks. */
export function makeCamera(args: {
  id: string;
  name: string;
  levelId?: string;
  position: Point;
  target: Point;
  fov: number;
  baseZ: number;
  eyeHeight?: number;
}): CameraEntity {
  const D = aimDistance(args.position, args.target);
  return {
    id: args.id,
    type: 'camera',
    layer: 'A-CAMR',
    levelId: args.levelId,
    name: args.name,
    position: { ...args.position },
    target: { ...args.target },
    eyeHeight: args.eyeHeight ?? EYE_HEIGHT_DEFAULT,
    targetHeight: args.eyeHeight ?? EYE_HEIGHT_DEFAULT,
    baseZ: args.baseZ,
    fov: Math.round(clampFov(args.fov) * 10) / 10,
    near: 6,
    far: Math.max(6000, D * 10),
    twoPoint: true,
    aspect: '16:9',
  };
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Eye and look-at in three.js coordinates (x = plan x, y = up, z = plan y). */
export function cameraEye3D(c: Pick<CameraEntity, 'position' | 'target' | 'eyeHeight' | 'targetHeight' | 'baseZ'>): { eye: Vec3; look: Vec3 } {
  return {
    eye: { x: c.position.x, y: c.baseZ + c.eyeHeight, z: c.position.y },
    look: { x: c.target.x, y: c.baseZ + c.targetHeight, z: c.target.y },
  };
}

/** Inverse of cameraEye3D — "Save view" after orbiting / walking inside a camera view. */
export function cameraFromEye3D(c: CameraEntity, eye: Vec3, look: Vec3): CameraEntity {
  return {
    ...c,
    position: { x: eye.x, y: eye.z },
    target: { x: look.x, y: look.z },
    eyeHeight: eye.y - c.baseZ,
    targetHeight: look.y - c.baseZ,
  };
}

/**
 * Two-point perspective: the camera is kept level (verticals stay vertical) and the image is shifted
 * vertically like a shift lens so the target height stays framed. Returns the vertical shift as a
 * fraction of the half-height of the image (NDC units, +up).
 */
export function twoPointShift(c: Pick<CameraEntity, 'position' | 'target' | 'eyeHeight' | 'targetHeight' | 'fov'>, aspect: number): number {
  const D = Math.max(1, aimDistance(c.position, c.target));
  const tanPitch = (c.targetHeight - c.eyeHeight) / D;
  const vfov = horizontalToVerticalFov(c.fov, aspect) * DEG;
  return clamp(tanPitch / Math.tan(vfov / 2), -1.5, 1.5);
}

// ---- SUN ---------------------------------------------------------------------------------------

export function dayOfYear(month: number, day: number): number {
  const cum = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  const m = clamp(Math.round(month), 1, 12);
  return cum[m - 1] + clamp(Math.round(day), 1, 31);
}

/**
 * Sun position for a latitude, day and local solar hour.
 * azimuth: degrees clockwise from north (90 = east); altitude: degrees above the horizon.
 * dir: unit vector TOWARD the sun in three.js coordinates (plan north = −Y = three −Z).
 */
export function sunPosition(latitudeDeg: number, doy: number, hour: number): { azimuth: number; altitude: number; dir: Vec3 } {
  const phi = latitudeDeg * DEG;
  const decl = 23.44 * DEG * Math.sin(((2 * Math.PI) / 365) * (284 + doy));
  const H = (hour - 12) * 15 * DEG;
  const sinAlt = Math.sin(phi) * Math.sin(decl) + Math.cos(phi) * Math.cos(decl) * Math.cos(H);
  const alt = Math.asin(clamp(sinAlt, -1, 1));
  let az = Math.atan2(-Math.sin(H), Math.tan(decl) * Math.cos(phi) - Math.sin(phi) * Math.cos(H));
  if (az < 0) az += 2 * Math.PI;
  const east = Math.sin(az) * Math.cos(alt);
  const north = Math.cos(az) * Math.cos(alt);
  return { azimuth: az / DEG, altitude: alt / DEG, dir: { x: east, y: Math.sin(alt), z: -north } };
}

export function formatSunTime(hour: number): string {
  const h = Math.floor(hour);
  const m = Math.round((hour - h) * 60);
  const hh = (m === 60 ? h + 1 : h) % 24;
  const mm = m === 60 ? 0 : m;
  const ap = hh < 12 ? 'AM' : 'PM';
  return `${((hh + 11) % 12) + 1}:${String(mm).padStart(2, '0')} ${ap}`;
}

// ---- WALKTHROUGH -------------------------------------------------------------------------------

export interface CameraPose {
  eye: Vec3;
  look: Vec3;
  fov: number;
}

const cr = (p0: number, p1: number, p2: number, p3: number, t: number) =>
  0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);
const crV = (a: Vec3, b: Vec3, c: Vec3, d: Vec3, t: number): Vec3 => ({ x: cr(a.x, b.x, c.x, d.x, t), y: cr(a.y, b.y, c.y, d.y, t), z: cr(a.z, b.z, c.z, d.z, t) });

/**
 * Smooth fly-through along the cameras (Catmull-Rom through every eye and look-at point).
 * u runs 0 → 1 over the whole path; the segments are weighted by their length so speed is even.
 */
export function walkthroughPose(cams: CameraEntity[], u: number): CameraPose | null {
  if (!cams.length) return null;
  const poses = cams.map((c) => ({ ...cameraEye3D(c), fov: c.fov }));
  if (poses.length === 1) return poses[0];
  const segLen = poses.slice(1).map((p, i) => Math.max(1, Math.hypot(p.eye.x - poses[i].eye.x, p.eye.y - poses[i].eye.y, p.eye.z - poses[i].eye.z)));
  const total = segLen.reduce((a, b) => a + b, 0);
  let s = clamp(u, 0, 1) * total;
  let i = 0;
  while (i < segLen.length - 1 && s > segLen[i]) {
    s -= segLen[i];
    i++;
  }
  const t = clamp(s / segLen[i], 0, 1);
  const P = (k: number) => poses[clamp(k, 0, poses.length - 1)];
  const te = t * t * (3 - 2 * t) * 0.35 + t * 0.65; // gentle ease at every camera
  return {
    eye: crV(P(i - 1).eye, P(i).eye, P(i + 1).eye, P(i + 2).eye, te),
    look: crV(P(i - 1).look, P(i).look, P(i + 1).look, P(i + 2).look, te),
    fov: P(i).fov + (P(i + 1).fov - P(i).fov) * te,
  };
}

/** Walkthrough length in seconds at a walking / flying speed (inches per second). */
export function walkthroughDuration(cams: CameraEntity[], speedInPerSec = 60): number {
  if (cams.length < 2) return 0;
  let L = 0;
  for (let i = 1; i < cams.length; i++) {
    const a = cameraEye3D(cams[i - 1]).eye;
    const b = cameraEye3D(cams[i]).eye;
    L += Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  }
  return Math.max(2, L / Math.max(1, speedInPerSec) + cams.length * 0.6);
}

// ---- GRIPS -------------------------------------------------------------------------------------

/** Grips of a selected camera: position, target and the two wedge edges (drag = FOV). */
export function cameraGrips(c: CameraEntity): Array<{ gripIndex: 'position' | 'target' | 'fov-left' | 'fov-right'; point: Point }> {
  const [, l, r] = wedgePoints(c.position, c.target, c.fov);
  return [
    { gripIndex: 'position', point: c.position },
    { gripIndex: 'target', point: c.target },
    { gripIndex: 'fov-left', point: l },
    { gripIndex: 'fov-right', point: r },
  ];
}

export function applyCameraGrip(c: CameraEntity, grip: string, p: Point): CameraEntity {
  if (grip === 'position') {
    if (aimDistance(p, c.target) < 6) return c;
    return { ...c, position: { ...p } };
  }
  if (grip === 'target') {
    if (aimDistance(c.position, p) < 6) return c;
    return { ...c, target: { ...p } };
  }
  if (grip === 'fov-left' || grip === 'fov-right') return { ...c, fov: Math.round(fovFromCursor(c.position, c.target, p)) };
  return c;
}
