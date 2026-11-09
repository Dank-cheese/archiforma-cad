import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyCameraGrip,
  cameraEye3D,
  cameraFromEye3D,
  cameraGrips,
  focalToFov,
  fovFromCursor,
  fovToFocal,
  horizontalToVerticalFov,
  makeCamera,
  nextCameraName,
  sunPosition,
  dayOfYear,
  twoPointShift,
  verticalToHorizontalFov,
  walkthroughPose,
  wedgePoints,
  FOV_MAX,
  FOV_MIN,
} from './camera';

const near = (a: number, b: number, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `${a} ≈ ${b} (±${tol})`);

test('FOV from cursor offset: edges pass through the cursor, clamped 20°–100°', () => {
  const P = { x: 0, y: 0 };
  const T = { x: 100, y: 0 };
  // offset 100·tan(30°) at 100 along → half-angle 30° → FOV 60°
  near(fovFromCursor(P, T, { x: 100, y: 100 * Math.tan(Math.PI / 6) }), 60, 1e-9);
  // the side does not matter
  near(fovFromCursor(P, T, { x: 100, y: -100 * Math.tan(Math.PI / 6) }), 60, 1e-9);
  // on the centre line → minimum; beside / behind the camera → maximum
  assert.equal(fovFromCursor(P, T, { x: 300, y: 0 }), FOV_MIN);
  assert.equal(fovFromCursor(P, T, { x: 0, y: 50 }), FOV_MAX);
  assert.equal(fovFromCursor(P, T, { x: -40, y: 10 }), FOV_MAX);
  // works for any aim direction (aim down-left at 45°)
  const T2 = { x: -100, y: 100 };
  const d = { x: -Math.SQRT1_2, y: Math.SQRT1_2 };
  const n = { x: d.y, y: -d.x };
  const c = { x: d.x * 80 + n.x * 80 * Math.tan((35 * Math.PI) / 180), y: d.y * 80 + n.y * 80 * Math.tan((35 * Math.PI) / 180) };
  near(fovFromCursor(P, T2, c), 70, 1e-9);
});

test('lens ↔ FOV: 35 mm ≈ 54° horizontal on full frame; conversions round-trip', () => {
  near(focalToFov(35), 54.43, 0.01);
  near(focalToFov(50), 39.6, 0.05);
  near(focalToFov(24), 73.74, 0.01);
  near(focalToFov(18), 90, 1e-9);
  for (const mm of [18, 24, 35, 50, 85]) near(fovToFocal(focalToFov(mm)), mm, 1e-9);
  // THREE.PerspectiveCamera.fov is VERTICAL
  near(horizontalToVerticalFov(90, 1), 90, 1e-9);
  near(horizontalToVerticalFov(90, 16 / 9), (2 * Math.atan(9 / 16) * 180) / Math.PI, 1e-9);
  near(verticalToHorizontalFov(horizontalToVerticalFov(62, 4 / 3), 4 / 3), 62, 1e-9);
});

test('wedge points: apex at the camera, far side square to the aim at the target distance', () => {
  const P = { x: 10, y: 20 };
  const T = { x: 10, y: 220 }; // aiming +Y (south / down the screen), D = 200
  const [a, l, r] = wedgePoints(P, T, 90);
  assert.deepEqual(a, P);
  // ±45° → corners at (10 ± 200, 220)
  near(l.y, 220, 1e-9);
  near(r.y, 220, 1e-9);
  near(Math.abs(l.x - 10), 200, 1e-9);
  near(Math.abs(r.x - 10), 200, 1e-9);
  // left of the view direction: facing +Y with +Y down the screen, the camera's left is +X
  assert.ok(l.x > 10 && r.x < 10);
  // the edges reproduce the FOV
  near(fovFromCursor(P, T, l), 90, 1e-9);
  near(fovFromCursor(P, T, r), 90, 1e-9);
  // explicit distance and generic angle
  const [, l2, r2] = wedgePoints({ x: 0, y: 0 }, { x: 50, y: 0 }, 60, 300);
  near(l2.x, 300, 1e-9);
  near(r2.x, 300, 1e-9);
  near(Math.abs(l2.y - r2.y), 2 * 300 * Math.tan(Math.PI / 6), 1e-9);
});

test('camera entity: placement defaults, grips, 3D eye and save-view round trip', () => {
  const cam = makeCamera({ id: 'c1', name: nextCameraName([]), position: { x: 0, y: 0 }, target: { x: 0, y: -300 }, fov: 140, baseZ: 12 });
  assert.equal(cam.name, 'Camera 1');
  assert.equal(nextCameraName([cam]), 'Camera 2');
  assert.equal(cam.eyeHeight, 66);
  assert.equal(cam.fov, FOV_MAX);
  const { eye, look } = cameraEye3D(cam);
  assert.deepEqual(eye, { x: 0, y: 78, z: 0 });
  assert.deepEqual(look, { x: 0, y: 78, z: -300 });
  const g = cameraGrips({ ...cam, fov: 60 });
  assert.deepEqual(g.map((x) => x.gripIndex), ['position', 'target', 'fov-left', 'fov-right']);
  // dragging an edge grip outward widens the view
  const wider = applyCameraGrip({ ...cam, fov: 60 }, 'fov-left', { x: -300, y: -300 });
  assert.equal(wider.fov, 90);
  const moved = cameraFromEye3D(cam, { x: 5, y: 100, z: 6 }, { x: 5, y: 40, z: -200 });
  assert.deepEqual(moved.position, { x: 5, y: 6 });
  assert.equal(moved.eyeHeight, 88);
  assert.equal(moved.targetHeight, 28);
  // a level camera needs no shift; looking up shifts the image up
  assert.equal(twoPointShift(cam, 16 / 9), 0);
  assert.ok(twoPointShift({ ...cam, fov: 60, targetHeight: 200 }, 16 / 9) > 0);
});

test('sun: noon sun is due south and highest at the June solstice; morning sun is east', () => {
  const noon = sunPosition(40, dayOfYear(6, 21), 12);
  near(noon.azimuth, 180, 1e-6);
  near(noon.altitude, 90 - 40 + 23.44, 0.1);
  assert.ok(noon.dir.z > 0); // toward the sun = south = +plan Y = +three Z
  const am = sunPosition(40, dayOfYear(3, 21), 9);
  assert.ok(am.azimuth > 90 && am.azimuth < 180 && am.dir.x > 0);
  assert.ok(sunPosition(40, dayOfYear(12, 21), 12).altitude < 30);
});

test('walkthrough passes through every camera', () => {
  const a = makeCamera({ id: 'a', name: 'A', position: { x: 0, y: 0 }, target: { x: 100, y: 0 }, fov: 60, baseZ: 0 });
  const b = makeCamera({ id: 'b', name: 'B', position: { x: 300, y: 0 }, target: { x: 300, y: 100 }, fov: 80, baseZ: 0 });
  const c = makeCamera({ id: 'c', name: 'C', position: { x: 300, y: 300 }, target: { x: 0, y: 300 }, fov: 60, baseZ: 0 });
  const p0 = walkthroughPose([a, b, c], 0)!;
  const p1 = walkthroughPose([a, b, c], 1)!;
  const pm = walkthroughPose([a, b, c], 0.5)!;
  near(p0.eye.x, 0, 1e-9);
  near(p1.eye.x, 300, 1e-9);
  near(p1.eye.z, 300, 1e-9);
  near(pm.eye.x, 300, 1e-6);
  near(pm.eye.z, 0, 1e-6);
  near(pm.fov, 80, 1e-6);
});
