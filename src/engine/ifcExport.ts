/**
 * Basic IFC4 export (ISO 10303-21 STEP physical file).
 *
 * Spatial structure: IfcProject → IfcSite → IfcBuilding → IfcBuildingStorey (one per level).
 * Elements (all as extruded swept solids, millimetres, Z up):
 * - IfcWall: the wall's joined plan footprint (clean mitred corners, honours justification).
 * - IfcDoor / IfcWindow: a panel/frame body, plus an IfcOpeningElement that cuts the full wall
 *   thickness (IfcRelVoidsElement) and is filled by the door/window (IfcRelFillsElement).
 * - IfcSlab: floor slabs (top face at the level elevation).
 * - IfcSpace: rooms, extruded to the next level, with NetFloorArea / perimeter quantities.
 *
 * GlobalIds are valid IFC base64 GUIDs derived from element ids, so re-exporting the same
 * model gives the same GUIDs (stable for model federation / BCF). Opens in BlenderBIM
 * (Bonsai), FreeCAD, IfcOpenShell, Solibri and other IFC4 viewers.
 */
import { depthAcross, frameDepthOf, openingExtSign, wallExtSign } from './openings';
import { ArchModel, DoorEntity, FloorEntity, LevelDefinition, Point, RoomEntity, WallEntity, WallOpeningEntity, WindowEntity } from '../types/model';
import {
  allRebarBars,
  beamAxis,
  beamRefZ,
  beamSection,
  beamSystemJoists,
  beamVertical,
  columnMaterialId,
  columnPlanOutline,
  columnSection,
  columnZRange,
  footingPlanOutline,
  footingZRange,
  levelElevationOf,
  materialById,
  pilePositions,
  STRUCTURAL_DISCLAIMER,
} from './structure';
import {
  add,
  computePolygonAreaAndPerimeter,
  computeWallCornersWithJoins,
  createStarterLevels,
  dist,
  getWallOffsetVectors,
  lerpPoint,
  scale,
} from './geometry';

const IFC_B64 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$';

/** 128-bit hash (cyrb128) of a string, as 16 bytes. */
function hash128(str: string): number[] {
  let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762;
  for (let i = 0; i < str.length; i++) {
    const k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4;
  h2 ^= h1;
  h3 ^= h1;
  h4 ^= h1;
  const bytes: number[] = [];
  for (const h of [h1, h2, h3, h4]) {
    bytes.push((h >>> 24) & 255, (h >>> 16) & 255, (h >>> 8) & 255, h & 255);
  }
  // Shape it like an RFC 4122 v4 UUID (version + variant bits)
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  return bytes;
}

/** Compresses 16 bytes into the 22-character IFC GlobalId alphabet (first char is 0–3). */
export function makeIfcGuid(seed: string): string {
  let n = 0n;
  for (const b of hash128(seed)) n = (n << 8n) | BigInt(b);
  const chars: string[] = new Array(22);
  for (let i = 21; i >= 0; i--) {
    chars[i] = IFC_B64[Number(n & 63n)];
    n >>= 6n;
  }
  return chars.join('');
}

/** STEP string literal: quotes doubled, backslashes escaped, non-ASCII as \X2\hhhh\X0\. */
export function ifcStr(s: string): string {
  let out = '';
  for (const ch of String(s ?? '')) {
    const cp = ch.codePointAt(0)!;
    if (ch === "'") out += "''";
    else if (ch === '\\') out += '\\\\';
    else if (cp >= 32 && cp < 127) out += ch;
    else if (cp < 32) out += ' ';
    else if (cp <= 0xffff) out += `\\X2\\${cp.toString(16).toUpperCase().padStart(4, '0')}\\X0\\`;
    else out += `\\X4\\${cp.toString(16).toUpperCase().padStart(8, '0')}\\X0\\`;
  }
  return `'${out}'`;
}

function ifcReal(n: number): string {
  const val = Number.isFinite(n) ? Math.round(n * 1e6) / 1e6 : 0;
  if (Object.is(val, -0) || val === 0) return '0.';
  const s = String(val);
  if (s.includes('e')) return val.toExponential().replace('e', 'E');
  return s.includes('.') ? s : `${s}.`;
}

const DOOR_LEAF_IN = 2; // door panel thickness for the 3D body
/** IfcDoorTypeOperationEnum for a door instance. */
function ifcDoorOperation(d: DoorEntity): string {
  const k = d.kind || 'single';
  if (k === 'double') return '.DOUBLE_DOOR_SINGLE_SWING.';
  if (k === 'sliding' || k === 'multislide' || k === 'pocket' || k === 'barn') return d.swing.startsWith('left') ? '.SLIDING_TO_LEFT.' : '.SLIDING_TO_RIGHT.';
  if (k === 'barn-bypass') return '.DOUBLE_DOOR_SLIDING.';
  if (k === 'bifold') return (d.panels || 2) > 2 ? '.DOUBLE_DOOR_FOLDING.' : '.FOLDING_TO_LEFT.';
  if (k === 'pivot') return '.USERDEFINED.';
  if (k === 'garage') return '.ROLLINGUP.';
  return d.swing.startsWith('left') ? '.SINGLE_SWING_LEFT.' : '.SINGLE_SWING_RIGHT.';
}
const WINDOW_FRAME_IN = 4; // window frame depth for the 3D body
const OPENING_CLEARANCE_IN = 2; // opening protrudes this much each side so it cuts cleanly

export function exportToIFC4(model: ArchModel): string {
  let nextId = 1;
  const rows: string[] = [];
  const add$ = (expr: string): number => {
    const id = nextId++;
    rows.push(`#${id}=${expr};`);
    return id;
  };
  const ref = (ids: number[]) => `(${ids.map((i) => `#${i}`).join(',')})`;
  const projectKey = model.projectName || 'archiforma';
  const guid = (k: string) => makeIfcGuid(`${projectKey}::${k}`);

  // Model inches (SVG Y-down) -> IFC millimetres (Y-up)
  const mm = (inches: number) => inches * 25.4;
  const XY = (p: Point) => [mm(p.x), -mm(p.y)] as const;

  // Shared geometry
  const origin3d = add$('IFCCARTESIANPOINT((0.,0.,0.))');
  const origin2d = add$('IFCCARTESIANPOINT((0.,0.))');
  const dirZ = add$('IFCDIRECTION((0.,0.,1.))');
  const dirX = add$('IFCDIRECTION((1.,0.,0.))');
  const dirX2d = add$('IFCDIRECTION((1.,0.))');
  const worldPlacement = add$(`IFCAXIS2PLACEMENT3D(#${origin3d},#${dirZ},#${dirX})`);
  const profileAxis = add$(`IFCAXIS2PLACEMENT2D(#${origin2d},#${dirX2d})`);

  // Ownership
  const ts = Math.floor(Date.now() / 1000);
  const person = add$(`IFCPERSON($,'Architect',${ifcStr('ARCHIFORMA')},$,$,$,$,$)`);
  const org = add$(`IFCORGANIZATION($,'ARCHIFORMA',$,$,$)`);
  const personAndOrg = add$(`IFCPERSONANDORGANIZATION(#${person},#${org},$)`);
  const app = add$(`IFCAPPLICATION(#${org},'1.0','ARCHIFORMA CAD/BIM','ARCHIFORMA')`);
  const ownerHistory = add$(`IFCOWNERHISTORY(#${personAndOrg},#${app},$,.ADDED.,${ts},#${personAndOrg},#${app},${ts})`);

  // Units
  const uLen = add$('IFCSIUNIT(*,.LENGTHUNIT.,.MILLI.,.METRE.)');
  const uArea = add$('IFCSIUNIT(*,.AREAUNIT.,$,.SQUARE_METRE.)');
  const uVol = add$('IFCSIUNIT(*,.VOLUMEUNIT.,$,.CUBIC_METRE.)');
  const uAng = add$('IFCSIUNIT(*,.PLANEANGLEUNIT.,$,.RADIAN.)');
  const units = add$(`IFCUNITASSIGNMENT((#${uLen},#${uArea},#${uVol},#${uAng}))`);

  // Contexts
  const ctx = add$(`IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-05,#${worldPlacement},$)`);
  const body = add$(`IFCGEOMETRICREPRESENTATIONSUBCONTEXT('Body','Model',*,*,*,*,#${ctx},$,.MODEL_VIEW.,$)`);

  // Spatial structure
  const project = add$(
    `IFCPROJECT('${guid('project')}',#${ownerHistory},${ifcStr(model.projectName || 'ARCHIFORMA Project')},$,$,$,$,(#${ctx}),#${units})`
  );
  const sitePlace = add$(`IFCLOCALPLACEMENT($,#${worldPlacement})`);
  const site = add$(`IFCSITE('${guid('site')}',#${ownerHistory},'Default Site',$,$,#${sitePlace},$,$,.ELEMENT.,$,$,$,$,$)`);
  const bldgPlace = add$(`IFCLOCALPLACEMENT(#${sitePlace},#${worldPlacement})`);
  const building = add$(
    `IFCBUILDING('${guid('building')}',#${ownerHistory},${ifcStr(model.projectName || 'Building')},$,$,#${bldgPlace},$,$,.ELEMENT.,$,$,$)`
  );
  add$(`IFCRELAGGREGATES('${guid('rel-project-site')}',#${ownerHistory},$,$,#${project},(#${site}))`);
  add$(`IFCRELAGGREGATES('${guid('rel-site-building')}',#${ownerHistory},$,$,#${site},(#${building}))`);

  const levels: LevelDefinition[] = model.levels && model.levels.length > 0 ? model.levels : createStarterLevels();
  const sortedLevels = [...levels].sort((a, b) => a.elevation - b.elevation);
  const storeys = new Map<string, { id: number; place: number; elements: number[]; spaces: number[]; level: LevelDefinition }>();
  for (const lvl of sortedLevels) {
    const pt = add$(`IFCCARTESIANPOINT((0.,0.,${ifcReal(mm(lvl.elevation || 0))}))`);
    const axis = add$(`IFCAXIS2PLACEMENT3D(#${pt},#${dirZ},#${dirX})`);
    const place = add$(`IFCLOCALPLACEMENT(#${bldgPlace},#${axis})`);
    const id = add$(
      `IFCBUILDINGSTOREY('${guid('storey-' + lvl.id)}',#${ownerHistory},${ifcStr(lvl.name)},$,$,#${place},$,$,.ELEMENT.,${ifcReal(mm(lvl.elevation || 0))})`
    );
    storeys.set(lvl.id, { id, place, elements: [], spaces: [], level: lvl });
  }
  add$(`IFCRELAGGREGATES('${guid('rel-building-storeys')}',#${ownerHistory},$,$,#${building},${ref([...storeys.values()].map((s) => s.id))})`);
  const storeyOf = (levelId?: string) => storeys.get(levelId || '') || storeys.get('level-1') || [...storeys.values()][0];
  const storeyHeightIn = (levelId?: string) => {
    const s = storeyOf(levelId);
    const i = sortedLevels.findIndex((l) => l.id === s.level.id);
    const next = sortedLevels[i + 1];
    return next ? Math.max(48, next.elevation - s.level.elevation) : 108;
  };

  // ---- geometry helpers --------------------------------------------------------------------
  /** Local placement at (x, y, z) mm with the X axis along (ux, uy), relative to `parent`. */
  const placement = (parent: number, x: number, y: number, z: number, ux = 1, uy = 0) => {
    const p = add$(`IFCCARTESIANPOINT((${ifcReal(x)},${ifcReal(y)},${ifcReal(z)}))`);
    const d = ux === 1 && uy === 0 ? dirX : add$(`IFCDIRECTION((${ifcReal(ux)},${ifcReal(uy)},0.))`);
    const axis = add$(`IFCAXIS2PLACEMENT3D(#${p},#${dirZ},#${d})`);
    return add$(`IFCLOCALPLACEMENT(#${parent},#${axis})`);
  };
  const shapeOf = (solid: number) => {
    const rep = add$(`IFCSHAPEREPRESENTATION(#${body},'Body','SweptSolid',(#${solid}))`);
    return add$(`IFCPRODUCTDEFINITIONSHAPE($,$,(#${rep}))`);
  };
  /** Box centred on the local origin in X/Y, extruded up from z = 0. */
  const boxShape = (name: string, xMm: number, yMm: number, zMm: number) => {
    const prof = add$(`IFCRECTANGLEPROFILEDEF(.AREA.,${ifcStr(name)},#${profileAxis},${ifcReal(Math.max(1, xMm))},${ifcReal(Math.max(1, yMm))})`);
    const solid = add$(`IFCEXTRUDEDAREASOLID(#${prof},#${worldPlacement},#${dirZ},${ifcReal(Math.max(1, zMm))})`);
    return shapeOf(solid);
  };
  /** Polygon (model inches, world XY) extruded from zMm up by depthMm, in world-aligned local coords. */
  const polygonShape = (poly: Point[], zMm: number, depthMm: number) => {
    const pts = poly.filter((p, i) => i === 0 || dist(p, poly[i - 1]) > 1e-6);
    if (pts.length > 2 && dist(pts[0], pts[pts.length - 1]) < 1e-6) pts.pop();
    const ids = pts.map((p) => {
      const [x, y] = XY(p);
      return add$(`IFCCARTESIANPOINT((${ifcReal(x)},${ifcReal(y)}))`);
    });
    const loop = add$(`IFCPOLYLINE(${ref([...ids, ids[0]])})`);
    const prof = add$(`IFCARBITRARYCLOSEDPROFILEDEF(.AREA.,$,#${loop})`);
    const o = add$(`IFCCARTESIANPOINT((0.,0.,${ifcReal(zMm)}))`);
    const axis = add$(`IFCAXIS2PLACEMENT3D(#${o},#${dirZ},#${dirX})`);
    const solid = add$(`IFCEXTRUDEDAREASOLID(#${prof},#${axis},#${dirZ},${ifcReal(Math.max(1, depthMm))})`);
    return shapeOf(solid);
  };

  const materialUse = new Map<string, number[]>();
  const addMaterial = (materialId: string, elementId: number) => {
    if (!materialId) return;
    const name = materialById(materialId).label;
    materialUse.set(name, [...(materialUse.get(name) || []), elementId]);
  };
  const walls = model.entities.filter((e): e is WallEntity => e.type === 'wall');
  const doors = model.entities.filter((e): e is DoorEntity => e.type === 'door');
  const windows = model.entities.filter((e): e is WindowEntity => e.type === 'window');
  const floors = model.entities.filter((e): e is FloorEntity => e.type === 'floor');
  const rooms = model.entities.filter((e): e is RoomEntity => e.type === 'room');
  const wallIfc = new Map<string, number>();

  // ---- 1. Walls ----------------------------------------------------------------------------
  for (const wall of walls) {
    if (dist(wall.start, wall.end) < 1) continue;
    const st = storeyOf(wall.levelId);
    const sameLevel = walls.filter((w) => (w.levelId || 'level-1') === (wall.levelId || 'level-1'));
    const footprint = computeWallCornersWithJoins(wall, sameLevel);
    const place = placement(st.place, 0, 0, 0);
    const shape = polygonShape(footprint, mm(wall.baseOffset || 0), mm(wall.height || 108));
    const wt = (model.wallTypes || []).find((t) => t.id === wall.wallTypeId);
    const id = add$(
      `IFCWALL('${guid('wall-' + wall.id)}',#${ownerHistory},${ifcStr(wt?.name || `Wall ${wall.thickness}"`)},$,$,#${place},#${shape},${ifcStr(wall.id)},.STANDARD.)`
    );
    st.elements.push(id);
    wallIfc.set(wall.id, id);
  }

  // ---- 2/3. Doors & windows (body + opening + void/fill relationships) ----------------------
  const hostedOpening = (
    kind: 'door' | 'window' | 'wallopening',
    el: DoorEntity | WindowEntity | WallOpeningEntity,
    idx: number
  ) => {
    const host = walls.find((w) => w.id === el.wallId);
    const st = storeyOf(el.levelId || host?.levelId);
    let center: Point = { x: 0, y: 0 };
    let ux = 1;
    let uy = 0;
    let thickIn = 6;
    let baseIn = 0;
    let bodyCenter: Point = { x: 0, y: 0 };
    if (host) {
      const { dir, normal, leftOffset, rightOffset } = getWallOffsetVectors(host);
      // centre of the wall BODY (justified walls sit to one side of their reference line)
      center = add(lerpPoint(host.start, host.end, el.offset), scale(normal, (leftOffset - rightOffset) / 2));
      ux = dir.x;
      uy = -dir.y;
      thickIn = host.thickness || 6;
      baseIn = host.baseOffset || 0;
      // the door / window body sits at its depth position within the wall thickness
      const lvlWalls = walls.filter((w) => (w.levelId || 'level-1') === (host.levelId || 'level-1'));
      const across = el.type === 'wallopening' ? 0 : depthAcross(el.depthPosition, thickIn, frameDepthOf(el, thickIn), openingExtSign(el, wallExtSign(host, lvlWalls)));
      bodyCenter = add(center, scale(normal, across));
    }
    const [cx, cy] = XY(center);
    const [bx, by] = XY(bodyCenter);
    const sillIn = kind === 'door' ? 0 : (el as WindowEntity | WallOpeningEntity).sillHeight ?? 36;
    const wMm = mm(el.width || (kind === 'door' ? 36 : 48));
    const hMm = mm(el.height || (kind === 'door' ? 84 : 48));
    const zMm = mm(baseIn + sillIn);
    const mark = el.mark || `${kind === 'door' ? 'D' : kind === 'window' ? 'W' : 'O'}${idx + 1}`;
    const hostId = host ? wallIfc.get(host.id) : undefined;

    if (el.type === 'wallopening') {
      // empty wall opening: just the void (rectangular bounding box for arched openings)
      if (!hostId) return;
      const openPlace = placement(st.place, cx, cy, zMm, ux, uy);
      const openShape = boxShape('Opening', wMm, mm(thickIn + OPENING_CLEARANCE_IN * 2), hMm);
      const opening = add$(
        `IFCOPENINGELEMENT('${guid('opening-' + el.id)}',#${ownerHistory},${ifcStr(`Opening ${mark}${el.shape === 'arch' ? ' (arched)' : ''}`)},$,$,#${openPlace},#${openShape},$,.OPENING.)`
      );
      add$(`IFCRELVOIDSELEMENT('${guid('voids-' + el.id)}',#${ownerHistory},$,$,#${hostId},#${opening})`);
      return;
    }

    const bodyPlace = placement(st.place, bx, by, zMm, ux, uy);
    const bodyShape = boxShape(kind === 'door' ? 'DoorPanel' : 'WindowFrame', wMm, mm(kind === 'door' ? DOOR_LEAF_IN : Math.min(WINDOW_FRAME_IN, thickIn)), hMm);
    const typeName = kind === 'door'
      ? (model.doorTypes || []).find((t) => t.id === (el as DoorEntity).doorTypeId)?.name
      : (model.windowTypes || []).find((t) => t.id === (el as WindowEntity).windowTypeId)?.name;
    const elementId =
      kind === 'door'
        ? add$(
            `IFCDOOR('${guid('door-' + el.id)}',#${ownerHistory},${ifcStr(mark)},$,${typeName ? ifcStr(typeName) : '$'},#${bodyPlace},#${bodyShape},${ifcStr(el.id)},${ifcReal(hMm)},${ifcReal(wMm)},${(el as DoorEntity).kind === 'garage' ? '.GATE.' : '.DOOR.'},${ifcDoorOperation(el as DoorEntity)},$)`
          )
        : add$(
            `IFCWINDOW('${guid('window-' + el.id)}',#${ownerHistory},${ifcStr(mark)},$,${typeName ? ifcStr(typeName) : '$'},#${bodyPlace},#${bodyShape},${ifcStr(el.id)},${ifcReal(hMm)},${ifcReal(wMm)},.WINDOW.,${(el as WindowEntity).operation === 'slider' ? '.DOUBLE_PANEL_VERTICAL.' : (el as WindowEntity).operation === 'double-hung' ? '.DOUBLE_PANEL_HORIZONTAL.' : '.SINGLE_PANEL.'},$)`
          );
    st.elements.push(elementId);

    if (hostId) {
      const openPlace = placement(st.place, cx, cy, zMm, ux, uy);
      const openShape = boxShape('Opening', wMm, mm(thickIn + OPENING_CLEARANCE_IN * 2), hMm);
      const opening = add$(
        `IFCOPENINGELEMENT('${guid('opening-' + el.id)}',#${ownerHistory},${ifcStr(`Opening ${mark}`)},$,$,#${openPlace},#${openShape},$,.OPENING.)`
      );
      add$(`IFCRELVOIDSELEMENT('${guid('voids-' + el.id)}',#${ownerHistory},$,$,#${hostId},#${opening})`);
      add$(`IFCRELFILLSELEMENT('${guid('fills-' + el.id)}',#${ownerHistory},$,$,#${opening},#${elementId})`);
    }
  };
  doors.forEach((d, i) => hostedOpening('door', d, i));
  windows.forEach((w, i) => hostedOpening('window', w, i));
  model.entities.filter((e): e is WallOpeningEntity => e.type === 'wallopening').forEach((o, i) => hostedOpening('wallopening', o, i));

  // ---- 4. Slabs ----------------------------------------------------------------------------
  const slabs = floors.map((f, i) => ({ id: f.id, name: `Floor Slab ${i + 1}`, levelId: f.levelId, polygon: f.polygon, thickness: f.thickness || 6 }));
  if (slabs.length === 0) {
    rooms.forEach((rm) => slabs.push({ id: `room-${rm.id}`, name: `${rm.name} Floor Slab`, levelId: rm.levelId, polygon: rm.polygon, thickness: 6 }));
  }
  const slabIfc = new Map<string, number>();
  for (const s of slabs) {
    if (s.polygon.length < 3) continue;
    const st = storeyOf(s.levelId);
    const t = mm(s.thickness);
    const place = placement(st.place, 0, 0, 0);
    const shape = polygonShape(s.polygon, -t, t);
    const fl = floors.find((f) => f.id === s.id);
    const kind = fl?.foundation ? '.BASESLAB.' : '.FLOOR.';
    const id = add$(`IFCSLAB('${guid('slab-' + s.id)}',#${ownerHistory},${ifcStr(fl?.foundation ? 'Slab on Grade' : s.name)},$,$,#${place},#${shape},${ifcStr(s.id)},${kind})`);
    st.elements.push(id);
    slabIfc.set(s.id, id);
    if (fl) addMaterial(fl.structuralMaterialId || (fl.foundation || fl.structural ? 'conc-4000' : ''), id);
  }

  // ---- 4b. STRUCTURE: footings + piles, columns, beams / braces / joists, reinforcing bars ----
  // (For design visualization and coordination only — not a substitute for engineering by a licensed structural engineer.)
  const relZ = (levelId: string | undefined, zAbs: number) => mm(zAbs - (storeyOf(levelId).level.elevation || 0));
  const sweptBox = (st: { place: number }, a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }, wIn: number, dIn: number, name: string) => {
    // rectangle profile swept from a to b (local Z along the member)
    const dx = b.x - a.x, dy = -(b.y - a.y), dz = b.z - a.z;
    const L = Math.hypot(dx, dy, dz);
    if (L < 1e-3) return null;
    const ax = [dx / L, dy / L, dz / L];
    let ref3 = [-ax[1], ax[0], 0];
    const rl = Math.hypot(ref3[0], ref3[1]);
    ref3 = rl < 1e-6 ? [1, 0, 0] : [ref3[0] / rl, ref3[1] / rl, 0];
    const p = add$(`IFCCARTESIANPOINT((${ifcReal(mm(a.x))},${ifcReal(-mm(a.y))},${ifcReal(a.z)}))`);
    const dAx = add$(`IFCDIRECTION((${ifcReal(ax[0])},${ifcReal(ax[1])},${ifcReal(ax[2])}))`);
    const dRef = add$(`IFCDIRECTION((${ifcReal(ref3[0])},${ifcReal(ref3[1])},${ifcReal(ref3[2])}))`);
    const axis = add$(`IFCAXIS2PLACEMENT3D(#${p},#${dAx},#${dRef})`);
    const place = add$(`IFCLOCALPLACEMENT(#${st.place},#${axis})`);
    const prof = add$(`IFCRECTANGLEPROFILEDEF(.AREA.,${ifcStr(name)},#${profileAxis},${ifcReal(mm(wIn))},${ifcReal(mm(dIn))})`);
    const solid = add$(`IFCEXTRUDEDAREASOLID(#${prof},#${worldPlacement},#${dirZ},${ifcReal(mm(L))})`);
    return { place, shape: shapeOf(solid) };
  };
  model.entities.forEach((e, idx) => {
    if (e.type === 'footing') {
      const poly = footingPlanOutline(e, model.entities);
      if (poly.length < 3) return;
      const st = storeyOf(e.levelId);
      const z = footingZRange(model, e);
      const shape = polygonShape(poly, relZ(e.levelId, z.zBot), mm(e.thickness));
      const kind = e.kind === 'wall' ? '.STRIP_FOOTING.' : e.kind === 'pilecap' ? '.PILE_CAP.' : '.PAD_FOOTING.';
      const id = add$(`IFCFOOTING('${guid('footing-' + e.id)}',#${ownerHistory},${ifcStr(`Footing F${idx + 1}`)},$,$,#${placement(st.place, 0, 0, 0)},#${shape},${ifcStr(e.id)},${kind})`);
      st.elements.push(id);
      addMaterial(e.structuralMaterialId || 'conc-4000', id);
      if (e.kind === 'pilecap') {
        const r = (e.piles?.diameter ?? 14) / 2;
        const L = e.piles?.length ?? 360;
        pilePositions(e, model.entities).forEach((pp, k) => {
          const circ = Array.from({ length: 16 }, (_, i) => ({ x: pp.x + r * Math.cos((2 * Math.PI * i) / 16), y: pp.y + r * Math.sin((2 * Math.PI * i) / 16) }));
          const ps = polygonShape(circ, relZ(e.levelId, z.zBot - L), mm(L));
          const pid = add$(`IFCPILE('${guid('pile-' + e.id + '-' + k)}',#${ownerHistory},${ifcStr(`Pile ${k + 1}`)},$,$,#${placement(st.place, 0, 0, 0)},#${ps},$,.DRIVEN.,$)`);
          st.elements.push(pid);
        });
      }
    } else if (e.type === 'column') {
      const st = storeyOf(e.levelId);
      const z = columnZRange(model, e);
      const ol = columnPlanOutline(e);
      const shape = polygonShape(ol.outer, relZ(e.levelId, z.z0), mm(z.z1 - z.z0));
      const sec = columnSection(e);
      const id = add$(`IFCCOLUMN('${guid('column-' + e.id)}',#${ownerHistory},${ifcStr(`Column ${sec.label}`)},$,$,#${placement(st.place, 0, 0, 0)},#${shape},${ifcStr(e.id)},.COLUMN.)`);
      st.elements.push(id);
      addMaterial(columnMaterialId(e), id);
    } else if (e.type === 'beam') {
      const st = storeyOf(e.levelId);
      const ax = beamAxis(model, e);
      const sec = beamSection(e);
      const za = e.usage === 'brace' ? beamRefZ(model, e, ax.start) : beamVertical(model, e, ax.start).zMid;
      const zb = e.usage === 'brace' ? beamRefZ(model, e, ax.end) : beamVertical(model, e, ax.end).zMid;
      const sw = sweptBox(st, { x: ax.start.x, y: ax.start.y, z: relZ(e.levelId, za) }, { x: ax.end.x, y: ax.end.y, z: relZ(e.levelId, zb) }, sec.bf, sec.d, sec.label);
      if (!sw) return;
      const id =
        e.usage === 'brace'
          ? add$(`IFCMEMBER('${guid('member-' + e.id)}',#${ownerHistory},${ifcStr(`Brace ${sec.label}`)},$,$,#${sw.place},#${sw.shape},${ifcStr(e.id)},.BRACE.)`)
          : add$(`IFCBEAM('${guid('beam-' + e.id)}',#${ownerHistory},${ifcStr(`Beam ${sec.label}`)},$,$,#${sw.place},#${sw.shape},${ifcStr(e.id)},.BEAM.)`);
      st.elements.push(id);
      addMaterial(e.structuralMaterialId, id);
    } else if (e.type === 'beamsystem') {
      const st = storeyOf(e.levelId);
      const sec = beamSection(e);
      beamSystemJoists(e).forEach(([p, q], k) => {
        const z = relZ(e.levelId, levelElevationOf(model, e.levelId) + e.topOffset - sec.d / 2);
        const sw = sweptBox(st, { ...p, z }, { ...q, z }, sec.bf, sec.d, sec.label);
        if (!sw) return;
        const id = add$(`IFCMEMBER('${guid('joist-' + e.id + '-' + k)}',#${ownerHistory},${ifcStr(`Joist ${sec.label}`)},$,$,#${sw.place},#${sw.shape},$,.JOIST.)`);
        st.elements.push(id);
      });
    }
  });
  // reinforcing bars (IfcSweptDiskSolid along each bar centre line)
  const bars = allRebarBars(model);
  for (const e of model.entities) {
    if (e.type !== 'rebar' && e.type !== 'areareinf') continue;
    const host = model.entities.find((h) => h.id === e.hostId);
    const st = storeyOf(host?.levelId || e.levelId);
    const list = bars.get(e.id) || [];
    list.forEach((b, k) => {
      const pts = b.pts.map((p) => add$(`IFCCARTESIANPOINT((${ifcReal(mm(p.x))},${ifcReal(-mm(p.y))},${ifcReal(relZ(host?.levelId || e.levelId, p.z))}))`));
      if (pts.length < 2) return;
      const line = add$(`IFCPOLYLINE(${ref(pts)})`);
      const solid = add$(`IFCSWEPTDISKSOLID(#${line},${ifcReal(mm(b.dia / 2))},$,$,$)`);
      const rep2 = add$(`IFCSHAPEREPRESENTATION(#${body},'Body','AdvancedSweptSolid',(#${solid}))`);
      const pds = add$(`IFCPRODUCTDEFINITIONSHAPE($,$,(#${rep2}))`);
      const shear = e.type === 'rebar' && (e.placement === 'stirrup' || e.placement === 'tie');
      const id = add$(
        `IFCREINFORCINGBAR('${guid('rebar-' + e.id + '-' + k)}',#${ownerHistory},${ifcStr(`${e.mark || 'Bar'} ${b.size}`)},$,$,#${placement(st.place, 0, 0, 0)},#${pds},${ifcStr(e.mark || e.id)},$,${ifcReal(mm(b.dia))},${ifcReal(Math.PI * mm(b.dia / 2) ** 2)},${ifcReal(mm(b.length))},${shear ? '.LIGATURE.' : '.MAIN.'},.TEXTURED.)`
      );
      st.elements.push(id);
    });
  }
  // materials
  for (const [name, ids] of materialUse) {
    const mat = add$(`IFCMATERIAL(${ifcStr(name)},$,$)`);
    add$(`IFCRELASSOCIATESMATERIAL('${guid('relmat-' + name)}',#${ownerHistory},$,$,${ref(ids)},#${mat})`);
  }

  // ---- 5. Spaces ---------------------------------------------------------------------------
  rooms.forEach((room, idx) => {
    if (room.polygon.length < 3) return;
    const st = storeyOf(room.levelId);
    const place = placement(st.place, 0, 0, 0);
    const heightIn = storeyHeightIn(room.levelId);
    const shape = polygonShape(room.polygon, 0, mm(heightIn));
    const number = room.mark || `${101 + idx}`;
    const space = add$(
      `IFCSPACE('${guid('space-' + room.id)}',#${ownerHistory},${ifcStr(number)},$,$,#${place},#${shape},${ifcStr(room.name)},.ELEMENT.,.INTERNAL.,$)`
    );
    st.spaces.push(space);
    const { area, perimeter } = computePolygonAreaAndPerimeter(room.polygon);
    const qArea = add$(`IFCQUANTITYAREA('NetFloorArea',$,$,${ifcReal(area * 0.00064516)},$)`);
    const qPer = add$(`IFCQUANTITYLENGTH('GrossPerimeter',$,$,${ifcReal(mm(perimeter))},$)`);
    const qHeight = add$(`IFCQUANTITYLENGTH('Height',$,$,${ifcReal(mm(heightIn))},$)`);
    const qto = add$(`IFCELEMENTQUANTITY('${guid('qto-' + room.id)}',#${ownerHistory},'Qto_SpaceBaseQuantities',$,$,(#${qArea},#${qPer},#${qHeight}))`);
    add$(`IFCRELDEFINESBYPROPERTIES('${guid('rel-qto-' + room.id)}',#${ownerHistory},$,$,(#${space}),#${qto})`);
  });

  // ---- 6. Containment ---------------------------------------------------------------------
  for (const [lvlId, s] of storeys) {
    if (s.elements.length > 0) {
      add$(`IFCRELCONTAINEDINSPATIALSTRUCTURE('${guid('rel-contained-' + lvlId)}',#${ownerHistory},$,$,${ref(s.elements)},#${s.id})`);
    }
    if (s.spaces.length > 0) {
      add$(`IFCRELAGGREGATES('${guid('rel-spaces-' + lvlId)}',#${ownerHistory},$,$,#${s.id},${ref(s.spaces)})`);
    }
  }

  const hasStructure = model.entities.some((e) => ['footing', 'beam', 'beamsystem', 'rebar', 'areareinf', 'column'].includes(e.type));
  const nowIso = new Date().toISOString().slice(0, 19);
  const fileName = `${(model.projectName || 'archiforma').replace(/[^A-Za-z0-9 _-]+/g, '_')}.ifc`;
  return [
    'ISO-10303-21;',
    'HEADER;',
    `FILE_DESCRIPTION(('ViewDefinition [DesignTransferView]'${hasStructure ? `,${ifcStr(`Note: ${STRUCTURAL_DISCLAIMER}`)}` : ''}),'2;1');`,
    `FILE_NAME(${ifcStr(fileName)},'${nowIso}',('Architect'),('ARCHIFORMA'),'ARCHIFORMA IFC4 Exporter','ARCHIFORMA 1.0','');`,
    "FILE_SCHEMA(('IFC4'));",
    'ENDSEC;',
    'DATA;',
    ...rows,
    'ENDSEC;',
    'END-ISO-10303-21;',
    '',
  ].join('\n');
}
