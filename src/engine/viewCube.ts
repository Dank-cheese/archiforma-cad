/**
 * VIEWCUBE — pure orientation math for the AutoCAD-style ViewCube.
 *
 * World (three.js): x = east, y = up, z = south (plan +Y is down = south). The camera orbits a target;
 * its direction is described the way OrbitControls does it:
 *   phi   = angle from +Y (0 = looking straight down from above, π = looking up from below)
 *   theta = atan2(x, z) of the eye relative to the target (0 = eye on the south side, looking north)
 *
 * The cube's FRONT is south by default ("Set Current View as Front" turns the cube by frontOffset).
 * A hotspot is a sign vector (sx, sy, sz) ∈ {-1, 0, 1}³ in CUBE coordinates:
 *   1 non-zero component  → a face   (6)
 *   2 non-zero components → an edge  (12)  — the 45° view between two faces
 *   3 non-zero components → a corner (8)   — an isometric view
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export type CubeFace = 'top' | 'bottom' | 'front' | 'back' | 'left' | 'right';
export const CUBE_FACES: CubeFace[] = ['top', 'bottom', 'front', 'back', 'left', 'right'];
export type Hotspot = [number, number, number];
export type Projection = 'perspective' | 'orthographic' | 'perspective-ortho-faces';
export type Cardinal = 'N' | 'E' | 'S' | 'W';
export type ArrowDir = 'up' | 'down' | 'left' | 'right';

export const POLAR_EPS = 0.001;
const TAU = Math.PI * 2;

/** Outward normal of each face in cube coordinates. */
export const FACE_NORMAL: Record<CubeFace, Vec3> = {
  top: { x: 0, y: 1, z: 0 },
  bottom: { x: 0, y: -1, z: 0 },
  front: { x: 0, y: 0, z: 1 },
  back: { x: 0, y: 0, z: -1 },
  right: { x: 1, y: 0, z: 0 },
  left: { x: -1, y: 0, z: 0 },
};

/**
 * How each face is seen from outside, upright: its screen-right and screen-up directions.
 * Top is seen with FRONT at the bottom; Bottom with FRONT at the top.
 */
export const FACE_FRAME: Record<CubeFace, { n: Vec3; right: Vec3; up: Vec3 }> = {
  front: { n: FACE_NORMAL.front, right: { x: 1, y: 0, z: 0 }, up: { x: 0, y: 1, z: 0 } },
  back: { n: FACE_NORMAL.back, right: { x: -1, y: 0, z: 0 }, up: { x: 0, y: 1, z: 0 } },
  right: { n: FACE_NORMAL.right, right: { x: 0, y: 0, z: -1 }, up: { x: 0, y: 1, z: 0 } },
  left: { n: FACE_NORMAL.left, right: { x: 0, y: 0, z: 1 }, up: { x: 0, y: 1, z: 0 } },
  top: { n: FACE_NORMAL.top, right: { x: 1, y: 0, z: 0 }, up: { x: 0, y: 0, z: -1 } },
  bottom: { n: FACE_NORMAL.bottom, right: { x: 1, y: 0, z: 0 }, up: { x: 0, y: 0, z: 1 } },
};

export const FACE_LABEL: Record<CubeFace, string> = { top: 'TOP', bottom: 'BOTTOM', front: 'FRONT', back: 'BACK', left: 'LEFT', right: 'RIGHT' };

const len = (v: Vec3) => Math.hypot(v.x, v.y, v.z);
const norm = (v: Vec3): Vec3 => {
  const l = len(v) || 1;
  return { x: v.x / l, y: v.y / l, z: v.z / l };
};
const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;

export const hotspotKey = (h: Hotspot) => h.join(',');
export const hotspotRank = (h: Hotspot) => h.filter((v) => v !== 0).length;

/** Hotspot under a cell of a face's 3 × 3 grid (col / row ∈ {-1, 0, 1}; row −1 = top of the face as drawn). */
export function hotspotForCell(face: CubeFace, col: number, row: number): Hotspot {
  const f = FACE_FRAME[face];
  const v = { x: f.n.x + col * f.right.x - row * f.up.x, y: f.n.y + col * f.right.y - row * f.up.y, z: f.n.z + col * f.right.z - row * f.up.z };
  return [Math.sign(Math.round(v.x)), Math.sign(Math.round(v.y)), Math.sign(Math.round(v.z))] as Hotspot;
}

/** Faces touching a hotspot (1 for a face, 2 for an edge, 3 for a corner). */
export function hotspotFaces(h: Hotspot): CubeFace[] {
  const out: CubeFace[] = [];
  if (h[1] > 0) out.push('top');
  if (h[1] < 0) out.push('bottom');
  if (h[2] > 0) out.push('front');
  if (h[2] < 0) out.push('back');
  if (h[0] > 0) out.push('right');
  if (h[0] < 0) out.push('left');
  return out;
}

/** Friendly name: "TOP", "TOP · FRONT", "SE Iso (top)", "NW Iso (bottom)". Compass names assume FRONT = south. */
export function hotspotLabel(h: Hotspot): string {
  const faces = hotspotFaces(h);
  if (faces.length === 3) {
    const ns = h[2] > 0 ? 'S' : 'N';
    const ew = h[0] > 0 ? 'E' : 'W';
    return `${ns}${ew} Iso${h[1] < 0 ? ' (bottom)' : ''}`;
  }
  return faces.map((f) => FACE_LABEL[f]).join(' · ');
}

/** Rotate a cube vector into the world (the cube is turned by frontOffset about the vertical). */
export function cubeToWorld(v: Vec3, frontOffset = 0): Vec3 {
  const c = Math.cos(frontOffset);
  const s = Math.sin(frontOffset);
  return { x: v.x * c + v.z * s, y: v.y, z: -v.x * s + v.z * c };
}

export function worldToCube(v: Vec3, frontOffset = 0): Vec3 {
  return cubeToWorld(v, -frontOffset);
}

/** Unit view direction (target → eye) for a hotspot, in world coordinates. */
export function hotspotDirection(h: Hotspot, frontOffset = 0): Vec3 {
  return cubeToWorld(norm({ x: h[0], y: h[1], z: h[2] }), frontOffset);
}

export const wrapAngle = (a: number) => {
  let x = (a + Math.PI) % TAU;
  if (x < 0) x += TAU;
  return x - Math.PI;
};

/** Nearest theta to `theta` that is a whole quarter turn from the cube's front. */
export function snapTheta(theta: number, frontOffset = 0): number {
  const k = Math.round(wrapAngle(theta - frontOffset) / (Math.PI / 2));
  return wrapAngle(frontOffset + (k * Math.PI) / 2);
}

/** Spherical (phi from +Y, theta = atan2(x, z)) of a direction; a vertical direction keeps `thetaIfVertical`. */
export function directionToSpherical(d: Vec3, thetaIfVertical = 0): { phi: number; theta: number } {
  const u = norm(d);
  const phi = Math.min(Math.PI - POLAR_EPS, Math.max(POLAR_EPS, Math.acos(Math.max(-1, Math.min(1, u.y)))));
  const horiz = Math.hypot(u.x, u.z);
  const theta = horiz < 1e-6 ? thetaIfVertical : Math.atan2(u.x, u.z);
  return { phi, theta };
}

export function sphericalToDirection(phi: number, theta: number): Vec3 {
  return { x: Math.sin(phi) * Math.sin(theta), y: Math.cos(phi), z: Math.sin(phi) * Math.cos(theta) };
}

/**
 * Camera orientation for a clicked hotspot. Top / Bottom keep the current heading snapped to a
 * quarter turn of the cube (so clicking TOP from the right side shows RIGHT at the bottom).
 */
export function viewForHotspot(h: Hotspot, frontOffset = 0, currentTheta = frontOffset): { phi: number; theta: number } {
  return directionToSpherical(hotspotDirection(h, frontOffset), snapTheta(currentTheta, frontOffset));
}

/** The face the view is looking straight at (within `tolDeg`), else null. */
export function alignedFace(dir: Vec3, frontOffset = 0, tolDeg = 1): CubeFace | null {
  const c = worldToCube(norm(dir), frontOffset);
  const cos = Math.cos((tolDeg * Math.PI) / 180);
  for (const f of CUBE_FACES) if (dot(c, FACE_NORMAL[f]) >= cos) return f;
  return null;
}

/** Face whose normal is closest to a world vector (used by the four triangle arrows). */
export function faceToward(worldVec: Vec3, frontOffset = 0): CubeFace {
  const c = worldToCube(worldVec, frontOffset);
  let best: CubeFace = 'front';
  let bd = -Infinity;
  for (const f of CUBE_FACES) {
    const d = dot(c, FACE_NORMAL[f]);
    if (d > bd) {
      bd = d;
      best = f;
    }
  }
  return best;
}

export const faceHotspot = (f: CubeFace): Hotspot => {
  const n = FACE_NORMAL[f];
  return [n.x, n.y, n.z] as Hotspot;
};

/**
 * Triangle arrow around a face-on view: the adjacent face in that screen direction becomes the view.
 * screenUp / screenRight are the camera's up / right vectors in world coordinates.
 */
export function adjacentFace(arrow: ArrowDir, screenUp: Vec3, screenRight: Vec3, frontOffset = 0): CubeFace {
  const v =
    arrow === 'up' ? screenUp : arrow === 'down' ? { x: -screenUp.x, y: -screenUp.y, z: -screenUp.z } : arrow === 'right' ? screenRight : { x: -screenRight.x, y: -screenRight.y, z: -screenRight.z };
  return faceToward(v, frontOffset);
}

/**
 * Roll arrows (90° clockwise / counter-clockwise as seen on screen). Looking at TOP or BOTTOM the roll
 * is a turn about the vertical (dTheta); looking at a side face it is a screen roll (dRoll).
 */
export function rollStep(face: CubeFace, clockwise: boolean): { dTheta: number; dRoll: number } {
  const q = Math.PI / 2;
  // the MODEL IMAGE turns clockwise: the eye moves counter-clockwise around it
  if (face === 'top') return { dTheta: clockwise ? q : -q, dRoll: 0 };
  if (face === 'bottom') return { dTheta: clockwise ? -q : q, dRoll: 0 };
  return { dTheta: 0, dRoll: clockwise ? q : -q };
}

// ---- COMPASS ---------------------------------------------------------------------------------

/** Theta that puts the eye on the given side of the model ("view from the north" = N). */
export const CARDINAL_THETA: Record<Cardinal, number> = { S: 0, E: Math.PI / 2, N: Math.PI, W: -Math.PI / 2 };

/** Compass heading the camera faces (0 = north, 90 = east), in degrees [0, 360). */
export function headingDeg(theta: number): number {
  const d = (-theta * 180) / Math.PI;
  return ((d % 360) + 360) % 360;
}

/** Dragging the compass ring: the model turns with the pointer (clockwise on screen = +delta). */
export function rotateAzimuth(theta: number, deltaRad: number): number {
  return wrapAngle(theta + deltaRad);
}

/** Shortest-path interpolation of an angle. */
export function lerpAngle(a: number, b: number, t: number): number {
  return a + wrapAngle(b - a) * t;
}

export const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

/** True when "Perspective with Ortho Faces" should draw orthographic. */
export function isOrthographicView(p: Projection, aligned: CubeFace | null): boolean {
  return p === 'orthographic' || (p === 'perspective-ortho-faces' && aligned !== null);
}

/** Half height of an orthographic frustum that matches the perspective view at the target. */
export function orthoHalfHeight(distance: number, vfovDeg: number): number {
  return Math.max(1, distance) * Math.tan((vfovDeg * Math.PI) / 360);
}

// ---- CSS ------------------------------------------------------------------------------------

/** CSS uses y down: a world vector (x, y, z) is (x, −y, z) in the cube's CSS space. */
const css = (v: Vec3): Vec3 => ({ x: v.x, y: -v.y, z: v.z });

/** matrix3d() placing a face element (its own plane = CSS x/y) on the cube at half-size `h` px. */
export function faceCssMatrix(face: CubeFace, h: number): string {
  const f = FACE_FRAME[face];
  const r = css(f.right);
  const d = css({ x: -f.up.x, y: -f.up.y, z: -f.up.z }); // element +y (down) = −up
  const n = css(f.n);
  const m = [r.x, r.y, r.z, 0, d.x, d.y, d.z, 0, n.x, n.y, n.z, 0, n.x * h, n.y * h, n.z * h, 1];
  return `matrix3d(${m.map((v) => +v.toFixed(6)).join(',')})`;
}

/**
 * Cube orientation from the camera's view matrix (column-major 4×4, world → camera). CSS needs
 * S·R·S with S = diag(1, −1, 1); the cube's front offset is applied as rotateY.
 */
export function cubeCssTransform(viewMatrix: ArrayLike<number>, frontOffset = 0): string {
  const e = viewMatrix;
  const r = [e[0], -e[1], e[2], 0, -e[4], e[5], -e[6], 0, e[8], -e[9], e[10], 0, 0, 0, 0, 1];
  return `matrix3d(${r.map((v) => (+v).toFixed(5)).join(',')}) rotateY(${frontOffset.toFixed(5)}rad)`;
}

/** View matrix (rotation only, column-major) of a camera looking from (phi, theta) with a screen roll. */
export function viewRotation(phi: number, theta: number, roll = 0): number[] {
  // camera basis in world: back (z) = direction to eye, right (x), up (y)
  const z = sphericalToDirection(phi, theta);
  const worldUp = { x: 0, y: 1, z: 0 };
  let x = norm({ x: worldUp.y * z.z - worldUp.z * z.y, y: worldUp.z * z.x - worldUp.x * z.z, z: worldUp.x * z.y - worldUp.y * z.x });
  if (len(x) < 1e-6 || !Number.isFinite(x.x)) x = { x: Math.cos(theta), y: 0, z: -Math.sin(theta) };
  let y = { x: z.y * x.z - z.z * x.y, y: z.z * x.x - z.x * x.z, z: z.x * x.y - z.y * x.x };
  if (roll) {
    const c = Math.cos(roll);
    const s = Math.sin(roll);
    const xr = { x: x.x * c + y.x * s, y: x.y * c + y.y * s, z: x.z * c + y.z * s };
    const yr = { x: -x.x * s + y.x * c, y: -x.y * s + y.y * c, z: -x.z * s + y.z * c };
    x = xr;
    y = yr;
  }
  // inverse of a rotation = transpose; column-major elements of R^T
  return [x.x, y.x, z.x, 0, x.y, y.y, z.y, 0, x.z, y.z, z.z, 0, 0, 0, 0, 1];
}

// ---- SETTINGS (persisted in localStorage) ----------------------------------------------------

export interface ViewCubeSettings {
  on: boolean;
  projection: Projection;
  /** radians: the cube's FRONT is turned this much from south ("Set Current View as Front") */
  frontOffset: number;
  /** "Set Current View as Home": eye and target in world coordinates */
  home: { eye: Vec3; target: Vec3 } | null;
}

export const VIEWCUBE_STORAGE_KEY = 'archiforma_viewcube_v1';
export const DEFAULT_VIEWCUBE_SETTINGS: ViewCubeSettings = { on: true, projection: 'perspective', frontOffset: 0, home: null };

export function loadViewCubeSettings(): ViewCubeSettings {
  try {
    if (typeof localStorage === 'undefined') return { ...DEFAULT_VIEWCUBE_SETTINGS };
    const raw = localStorage.getItem(VIEWCUBE_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_VIEWCUBE_SETTINGS };
    const v = JSON.parse(raw) as Partial<ViewCubeSettings>;
    return {
      on: v.on !== false,
      projection: v.projection === 'orthographic' || v.projection === 'perspective-ortho-faces' ? v.projection : 'perspective',
      frontOffset: Number.isFinite(v.frontOffset) ? Number(v.frontOffset) : 0,
      home: v.home && v.home.eye && v.home.target ? v.home : null,
    };
  } catch {
    return { ...DEFAULT_VIEWCUBE_SETTINGS };
  }
}

export function saveViewCubeSettings(patch: Partial<ViewCubeSettings>): ViewCubeSettings {
  const next = { ...loadViewCubeSettings(), ...patch };
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(VIEWCUBE_STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable: keep the setting for this session only */
  }
  return next;
}

/** NAVVCUBE answer: "ON" / "OFF" (any case, also O/OF prefixes that are unique), or null when invalid. */
export function parseOnOff(input: string, current: boolean): boolean | null {
  const t = input.trim().toUpperCase();
  if (!t) return current;
  if (t === 'ON') return true;
  if (t === 'OF' || t === 'OFF') return false;
  return null;
}
