import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  adjacentFace,
  alignedFace,
  CARDINAL_THETA,
  CUBE_FACES,
  cubeToWorld,
  directionToSpherical,
  faceHotspot,
  headingDeg,
  hotspotDirection,
  hotspotFaces,
  hotspotForCell,
  hotspotLabel,
  hotspotRank,
  lerpAngle,
  orthoHalfHeight,
  POLAR_EPS,
  rollStep,
  rotateAzimuth,
  snapTheta,
  sphericalToDirection,
  isOrthographicView,
  viewForHotspot,
  viewRotation,
  type Hotspot,
} from './viewCube';

const near = (a: number, b: number, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `${a} ≈ ${b} (±${tol})`);
const DEG = Math.PI / 180;

test('faces: view vectors, spherical angles and labels (FRONT = south)', () => {
  const dirs: Record<string, [number, number, number]> = {
    top: [0, 1, 0],
    bottom: [0, -1, 0],
    front: [0, 0, 1],
    back: [0, 0, -1],
    right: [1, 0, 0],
    left: [-1, 0, 0],
  };
  for (const f of CUBE_FACES) {
    const d = hotspotDirection(faceHotspot(f));
    assert.deepEqual([d.x, d.y, d.z].map((v) => Math.round(v)), dirs[f], f);
    assert.equal(hotspotRank(faceHotspot(f)), 1);
  }
  const front = viewForHotspot(faceHotspot('front'));
  near(front.phi, Math.PI / 2);
  near(front.theta, 0);
  near(viewForHotspot(faceHotspot('right')).theta, Math.PI / 2);
  near(Math.abs(viewForHotspot(faceHotspot('back')).theta), Math.PI);
  near(viewForHotspot(faceHotspot('left')).theta, -Math.PI / 2);
  // top looks straight down (clamped off the pole) with FRONT at the bottom; bottom looks straight up
  const top = viewForHotspot(faceHotspot('top'));
  near(top.phi, POLAR_EPS);
  near(top.theta, 0);
  near(viewForHotspot(faceHotspot('bottom')).phi, Math.PI - POLAR_EPS);
  // TOP clicked while looking from the east keeps that heading (RIGHT at the bottom)
  near(viewForHotspot(faceHotspot('top'), 0, 80 * DEG).theta, Math.PI / 2);
  assert.equal(hotspotLabel([0, 1, 0]), 'TOP');
});

test('8 corners: isometric directions (35.26° elevation, 45° azimuths) with SE/SW/NE/NW names', () => {
  const corners: Array<[Hotspot, string, number]> = [
    [[1, 1, 1], 'SE Iso', 45],
    [[-1, 1, 1], 'SW Iso', -45],
    [[1, 1, -1], 'NE Iso', 135],
    [[-1, 1, -1], 'NW Iso', -135],
    [[1, -1, 1], 'SE Iso (bottom)', 45],
    [[-1, -1, 1], 'SW Iso (bottom)', -45],
    [[1, -1, -1], 'NE Iso (bottom)', 135],
    [[-1, -1, -1], 'NW Iso (bottom)', -135],
  ];
  const isoPhi = Math.acos(1 / Math.sqrt(3)); // 54.7356°
  for (const [h, name, thetaDeg] of corners) {
    assert.equal(hotspotRank(h), 3);
    assert.equal(hotspotLabel(h), name);
    const d = hotspotDirection(h);
    near(Math.abs(d.x), 1 / Math.sqrt(3));
    near(Math.abs(d.y), 1 / Math.sqrt(3));
    const v = viewForHotspot(h);
    near(v.phi, h[1] > 0 ? isoPhi : Math.PI - isoPhi);
    near(v.theta / DEG, thetaDeg, 1e-9);
    near(90 - v.phi / DEG, h[1] > 0 ? 35.2644 : -35.2644, 1e-3); // elevation angle
  }
});

test('12 edges: 45° views between two faces; cube cells map to the right hotspots', () => {
  const e = viewForHotspot([0, 1, 1]); // TOP · FRONT
  near(e.phi, 45 * DEG);
  near(e.theta, 0);
  const fr = viewForHotspot([1, 0, 1]); // FRONT · RIGHT
  near(fr.phi, 90 * DEG);
  near(fr.theta, 45 * DEG);
  assert.deepEqual(hotspotFaces([1, 0, 1]).sort(), ['front', 'right']);
  // every face: centre = face, 4 edge cells, 4 corner cells; all 26 hotspots are reachable
  const seen = new Set<string>();
  for (const f of CUBE_FACES)
    for (const c of [-1, 0, 1])
      for (const r of [-1, 0, 1]) {
        const h = hotspotForCell(f, c, r);
        seen.add(h.join(','));
        assert.equal(hotspotRank(h), 1 + Math.abs(c) + Math.abs(r), `${f} ${c} ${r}`);
      }
  assert.equal(seen.size, 26);
  // FRONT face: top-centre cell is the TOP·FRONT edge, top-right cell the SE (top) corner
  assert.deepEqual(hotspotForCell('front', 0, -1), [0, 1, 1]);
  assert.deepEqual(hotspotForCell('front', 1, -1), [1, 1, 1]);
  // TOP face (front at the bottom): bottom-centre cell is the TOP·FRONT edge
  assert.deepEqual(hotspotForCell('top', 0, 1), [0, 1, 1]);
});

test('compass: cardinal views, heading and azimuth rotation', () => {
  assert.equal(headingDeg(CARDINAL_THETA.S), 0); // eye on the south side → facing north
  assert.equal(headingDeg(CARDINAL_THETA.E), 270); // eye east → facing west
  near(headingDeg(CARDINAL_THETA.N), 180);
  near(headingDeg(CARDINAL_THETA.W), 90);
  near(rotateAzimuth(0, 30 * DEG), 30 * DEG);
  near(rotateAzimuth(170 * DEG, 30 * DEG), -160 * DEG); // wraps
  near(headingDeg(rotateAzimuth(0, 90 * DEG)), 270);
  near(lerpAngle(170 * DEG, -170 * DEG, 0.5), 180 * DEG); // shortest way round
});

test('front offset, aligned faces, triangle arrows and roll', () => {
  // "Set current view as Front": the cube turns, FRONT now looks from the east
  const fo = Math.PI / 2;
  near(viewForHotspot(faceHotspot('front'), fo).theta, Math.PI / 2);
  const w = cubeToWorld({ x: 0, y: 0, z: 1 }, fo);
  near(w.x, 1);
  assert.equal(alignedFace(sphericalToDirection(Math.PI / 2, 0)), 'front');
  assert.equal(alignedFace(sphericalToDirection(Math.PI / 2, 0.5 * DEG)), 'front');
  assert.equal(alignedFace(sphericalToDirection(Math.PI / 2, 10 * DEG)), null);
  assert.equal(alignedFace(sphericalToDirection(POLAR_EPS, 0)), 'top');
  assert.equal(alignedFace(sphericalToDirection(Math.PI / 2, Math.PI / 2), fo), 'front');
  // looking at FRONT: up arrow → TOP, right arrow → RIGHT
  const up = { x: 0, y: 1, z: 0 };
  const right = { x: 1, y: 0, z: 0 };
  assert.equal(adjacentFace('up', up, right), 'top');
  assert.equal(adjacentFace('down', up, right), 'bottom');
  assert.equal(adjacentFace('right', up, right), 'right');
  assert.equal(adjacentFace('left', up, right), 'left');
  // roll: side faces roll the screen, top / bottom turn about the vertical
  assert.deepEqual(rollStep('front', true), { dTheta: 0, dRoll: Math.PI / 2 });
  assert.deepEqual(rollStep('top', true), { dTheta: Math.PI / 2, dRoll: 0 });
  assert.deepEqual(rollStep('top', false), { dTheta: -Math.PI / 2, dRoll: 0 });
  near(snapTheta(50 * DEG), 90 * DEG);
  near(snapTheta(-40 * DEG), 0);
  // projection modes
  assert.equal(isOrthographicView('perspective-ortho-faces', 'front'), true);
  assert.equal(isOrthographicView('perspective-ortho-faces', null), false);
  assert.equal(isOrthographicView('orthographic', null), true);
  near(orthoHalfHeight(100, 90), 100);
  // spherical round trip
  const s = directionToSpherical(sphericalToDirection(1, 2));
  near(s.phi, 1);
  near(s.theta, 2);
  // top view rotation: screen up = north (−z)
  const m = viewRotation(POLAR_EPS, 0);
  near(m[1], 0, 1e-3);
  near(m[9], -1, 1e-3); // camera y-axis z component (row 1, col 2)
});

test('NAVVCUBE answers and settings defaults', async () => {
  const { parseOnOff, loadViewCubeSettings, DEFAULT_VIEWCUBE_SETTINGS } = await import('./viewCube');
  assert.equal(parseOnOff('ON', false), true);
  assert.equal(parseOnOff('off', true), false);
  assert.equal(parseOnOff('of', true), false);
  assert.equal(parseOnOff('', true), true); // Enter keeps the current setting
  assert.equal(parseOnOff('', false), false);
  assert.equal(parseOnOff('maybe', true), null);
  // no localStorage in node: defaults
  assert.deepEqual(loadViewCubeSettings(), DEFAULT_VIEWCUBE_SETTINGS);
});
