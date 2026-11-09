import React, { useEffect, useRef, useImperativeHandle, forwardRef, useState } from 'react';
import {
  aspectRatio,
  CAMERA_ASPECTS,
  cameraEye3D,
  cameraFromEye3D,
  dayOfYear,
  DEFAULT_SUN,
  fovLabel,
  formatSunTime,
  horizontalToVerticalFov,
  sunPosition,
  walkthroughDuration,
  walkthroughPose,
} from '../engine/camera';
import type { CameraEntity, CameraSun } from '../types/model';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { ViewCube, type ViewCubeHandle } from './ViewCube';
import { buildStair3D } from './stair3d';
import {
  adjacentFace,
  alignedFace,
  CARDINAL_THETA,
  directionToSpherical,
  easeInOut,
  faceHotspot,
  isOrthographicView,
  lerpAngle,
  loadViewCubeSettings,
  orthoHalfHeight,
  POLAR_EPS,
  rollStep,
  rotateAzimuth,
  saveViewCubeSettings,
  sphericalToDirection,
  viewForHotspot,
  wrapAngle,
  type ArrowDir,
  type Cardinal,
  type Hotspot,
  type Projection,
} from '../engine/viewCube';
import { AlertTriangle, Box as BoxIcon, Camera as CameraIcon, Download, Layers as LayersIcon, RotateCcw, Save, Sun as SunIcon, X } from 'lucide-react';
import {
  axisValueFromRay,
  belowGradeBadge,
  belowGradeChecks,
  BOX_FACES,
  dragSectionBoxFace,
  faceAxis,
  faceCenter,
  formatElevation,
  GRADE_Z,
  GRID3D_STEP,
  groundAppearance,
  insideSectionBox,
  issueCounts,
  orbitPolarLimits,
  sectionBoxAround,
  sectionBoxPlanes,
  stepVertical,
  surfaceReadout,
  verticalPan,
  worldPerPixel,
  XRAY_OPACITY,
  DEFAULT_GROUND_STATE,
  type BelowGradeIssue,
  type BoxFace,
  type GroundState,
  type SectionBox,
} from '../engine/view';
import { joinHubs } from '../engine/wallJoins';
import { buildLibrary3D } from './library3d';
import { getRoofGeometry } from '../engine/roof';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  ArchEntity,
  ArchModel,
  BlockInstanceEntity,
  ColumnEntity,
  DoorEntity,
  FloorEntity,
  GridEntity,
  RoofEntity,
  RoomEntity,
  SkylightEntity,
  StairEntity,
  VisibilityCategory,
  WallEntity,
  WindowEntity,
  WallOpeningEntity,
} from '../types/model';
import {
  buildBalcony3D,
  buildDormer3D,
  buildRailing3D,
  buildRoof3D,
  buildSkylight3D,
  buildSweep3D,
  buildWall3D,
  buildJoinHub3D,
  wallIsExterior,
} from './facade3d';
import { isCurtainWall } from '../engine/facade';
import {
  buildAnalytical3D,
  buildBeam3D,
  buildBeamSystem3D,
  buildTruss3D,
  buildColumn3D,
  buildConnection3D,
  buildFooting3D,
  buildLintels3D,
  buildLoad3D,
  buildRebar3D,
  buildSlab3D,
} from './struct3d';
import {
  allRebarBars,
  columnMaterialId,
  isConcrete,
  isStructuralEntity,
  rebarHostOf,
  STRUCTURAL_ONLY_TYPES,
  wallStructuralMaterialId,
} from '../engine/structure';
import type { Discipline } from '../types/model';
import {
  computeModelExtents,
  dist,
  normalize,
  sub,
} from '../engine/geometry';

export type CameraPreset3D = 'top' | 'bottom' | 'front' | 'back' | 'left' | 'right' | 'iso' | 'fit';

export interface Canvas3DHandle {
  capturePngDataUrl: () => string | null;
  setCameraPreset: (preset: CameraPreset3D) => void;
  /** Off-screen render of a camera view at an exact pixel size (PNG unless mime given). */
  renderCameraImage: (cam: CameraEntity, width: number, height: number, mime?: string) => string | null;
  /** Fly through the cameras in order; with record = true resolves to a WebM video. */
  playWalkthrough: (cams: CameraEntity[], opts?: { record?: boolean; seconds?: number }) => Promise<Blob | null>;
  stopWalkthrough: () => void;
}

const DEG3 = Math.PI / 180;
const camPoseSig = (c: CameraEntity | null | undefined) =>
  c ? [c.id, c.position.x, c.position.y, c.target.x, c.target.y, c.eyeHeight, c.targetHeight, c.baseZ, c.fov, c.near, c.far, c.twoPoint !== false, c.aspect].join('|') : '';
const sunSig = (c: CameraEntity | null | undefined) => (c?.sun?.enabled ? [c.sun.month, c.sun.day, c.sun.hour, c.sun.latitude].join('|') : 'off');
const extentsNoCameras = (m: ArchModel) => computeModelExtents(m.entities.filter((e) => e.type !== 'camera'));
export const CAMERA_EXPORT_BASE_PX = 1600;

interface Canvas3DProps {
  model: ArchModel;
  selectedIds: string[];
  onSelectIds: (ids: string[]) => void;
  darkMode: boolean;
  tempHiddenIds?: string[];
  tempIsolatedIds?: string[];
  onResetTempHideIsolate?: () => void;
  /** PAINT (PT): when true, clicking a wall face reports the wall and the clicked height instead of selecting. */
  paintMode?: boolean;
  onPaintWall?: (wallId: string, zAbs: number) => void;
  discipline?: Discipline;
  viewRebar?: boolean;
  analytical?: boolean;
  onToggleViewRebar?: () => void;
  onToggleAnalytical?: () => void;
  /** CAMERA view: look through this camera (letterboxed to its crop) */
  cameraView?: CameraEntity | null;
  /** minimal renderer for the live placement preview / thumbnails: no UI, no picking */
  preview?: boolean;
  onSaveCameraView?: (cam: CameraEntity) => void;
  onCameraChange?: (cam: CameraEntity, label: string) => void;
  onCloseCameraView?: () => void;
  onLog?: (msg: string, kind?: 'info' | 'result' | 'error') => void;
  /** BELOW GRADE: ground opacity / hide / X-ray (kept by the app across view switches) */
  ground?: GroundState;
  onGroundChange?: (g: GroundState) => void;
  /** SECTION BOX (BX) on / off */
  sectionBox?: boolean;
  onToggleSectionBox?: () => void;
  /** VIEWCUBE on / off (NAVVCUBE) */
  viewCube?: boolean;
  /** a view requested from elsewhere (the plan's ViewCube); applied once per nonce */
  viewRequest?: { nonce: number; kind: 'hotspot'; h: Hotspot } | { nonce: number; kind: 'home' } | { nonce: number; kind: 'cardinal'; c: Cardinal } | null;
}

function getEntityCategory3D(ent: ArchEntity): VisibilityCategory {
  switch (ent.type) {
    case 'wall':
      return 'walls';
    case 'door':
    case 'wallopening':
      return 'doors';
    case 'window':
      return 'windows';
    case 'floor':
      return 'floors';
    case 'roof':
    case 'skylight':
    case 'dormer':
      return 'roofs';
    case 'sweep':
    case 'balcony':
    case 'railing':
      return 'walls';
    case 'stair':
      return 'stairs';
    case 'column':
      return 'columns';
    case 'grid':
      return 'grids';
    case 'room':
      return 'rooms';
    case 'block':
      return 'furniture';
    case 'dimension':
    case 'text':
    case 'leader':
    case 'tag':
    case 'hatch':
      return 'annotations';
    default:
      return 'lines';
  }
}

export const Canvas3D = forwardRef<Canvas3DHandle, Canvas3DProps>(
  (
    {
      model,
      selectedIds,
      onSelectIds,
      darkMode,
      tempHiddenIds = [],
      tempIsolatedIds = [],
      onResetTempHideIsolate,
      paintMode,
      onPaintWall,
      discipline = 'combined',
      viewRebar = false,
      analytical = false,
      onToggleViewRebar,
      onToggleAnalytical,
      cameraView = null,
      preview = false,
      onSaveCameraView,
      onCameraChange,
      onCloseCameraView,
      onLog,
      ground = DEFAULT_GROUND_STATE,
      onGroundChange,
      sectionBox = false,
      onToggleSectionBox,
      viewCube = true,
      viewRequest = null,
    },
    ref
  ) => {
    // VIEWCUBE: projection, home and front are remembered in localStorage
    const [cubeSettings, setCubeSettings] = useState(() => loadViewCubeSettings());
    const cubeSettingsRef = useRef(cubeSettings);
    cubeSettingsRef.current = cubeSettings;
    const viewCubeRef = useRef<ViewCubeHandle>(null);
    const cubeApiRef = useRef<{
      hotspot: (h: Hotspot) => void;
      arrow: (a: ArrowDir) => void;
      roll: (cw: boolean) => void;
      orbit: (dx: number, dy: number) => void;
      compass: (d: number) => void;
      cardinal: (c: Cardinal) => void;
      home: () => void;
      setHome: () => void;
      setFront: () => void;
    } | null>(null);
    // BELOW GRADE navigation state shared with the (mount-once) render loop
    const [groundOpen, setGroundOpen] = useState(false);
    const [issuesOpen, setIssuesOpen] = useState(false);
    const navRef = useRef({ ground, sectionBox, showMarkers: false, issuesOpen: false });
    navRef.current = { ground, sectionBox, showMarkers: navRef.current.showMarkers, issuesOpen };
    const applyNavRef = useRef<() => void>(() => {});
    const applyXrayRef = useRef<() => void>(() => {});
    const applySectionBoxRef = useRef<() => void>(() => {});
    const zoomToRef = useRef<(at: { x: number; y: number; z: number }, entityId?: string) => void>(() => {});
    const badgeRef = useRef<HTMLDivElement>(null);
    const hoverTipRef = useRef<HTMLDivElement>(null);
    const markersRef = useRef<HTMLDivElement>(null);
    const unitsRef = useRef(model.settings.units);
    unitsRef.current = model.settings.units;
    const issues: BelowGradeIssue[] = React.useMemo(
      () => (preview ? [] : belowGradeChecks(model)),
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [model.entities, model.levels, model.settings.units, preview]
    );
    const issuesRef = useRef(issues);
    issuesRef.current = issues;
    // live sun edits (slider drag) override the camera's saved sun until committed
    const [sunDraft, setSunDraft] = useState<CameraSun | null>(null);
    const [camDirty, setCamDirty] = useState(false);
    const [sunOpen, setSunOpen] = useState(false);
    const [exportOpen, setExportOpen] = useState(false);
    const [walkProgress, setWalkProgress] = useState<number | null>(null);
    const effectiveCam: CameraEntity | null = cameraView ? (sunDraft ? { ...cameraView, sun: sunDraft } : cameraView) : null;
    const camViewRef = useRef<CameraEntity | null>(effectiveCam);
    camViewRef.current = effectiveCam;
    const previewRef = useRef(preview);
    previewRef.current = preview;
    const camDirtyRef = useRef<(v: boolean) => void>(() => {});
    camDirtyRef.current = setCamDirty;
    const walkProgressRef = useRef<(v: number | null) => void>(() => {});
    walkProgressRef.current = setWalkProgress;
    const applyCamRef = useRef<(cam: CameraEntity | null) => void>(() => {});
    const applyLightingRef = useRef<() => void>(() => {});
    const readPoseRef = useRef<() => { eye: { x: number; y: number; z: number }; look: { x: number; y: number; z: number } } | null>(() => null);
    const renderCamRef = useRef<Canvas3DHandle['renderCameraImage']>(() => null);
    const walkRef = useRef<Canvas3DHandle['playWalkthrough']>(async () => null);
    const stopWalkRef = useRef<() => void>(() => {});
    const mountRef = useRef<HTMLDivElement>(null);
    const requestRenderRef = useRef<() => void>(() => {});
    const setPresetRef = useRef<(preset: CameraPreset3D, animate?: boolean) => void>(
      () => {}
    );
    const capturePngRef = useRef<() => string | null>(() => null);
    const rebuildSceneRef = useRef<() => void>(() => {});

    // Keep latest props in refs so WebGLRenderer mounts once and never tears down
    const modelRef = useRef(model);
    modelRef.current = model;
    const selectedIdsRef = useRef(selectedIds);
    selectedIdsRef.current = selectedIds;
    const onSelectIdsRef = useRef(onSelectIds);
    onSelectIdsRef.current = onSelectIds;
    const paintRef = useRef<{ on: boolean; cb?: (wallId: string, zAbs: number) => void }>({ on: false });
    paintRef.current = { on: !!paintMode, cb: onPaintWall };
    const darkModeRef = useRef(darkMode);
    darkModeRef.current = darkMode;
    const structRef = useRef({ discipline, viewRebar, analytical });
    structRef.current = { discipline, viewRebar, analytical };
    const tempHiddenRef = useRef(tempHiddenIds);
    tempHiddenRef.current = tempHiddenIds;
    const tempIsolatedRef = useRef(tempIsolatedIds);
    tempIsolatedRef.current = tempIsolatedIds;

    useImperativeHandle(ref, () => ({
      capturePngDataUrl: () => capturePngRef.current(),
      setCameraPreset: (preset) => setPresetRef.current(preset),
      renderCameraImage: (cam, w, h, mime) => renderCamRef.current(cam, w, h, mime),
      playWalkthrough: (cams, opts) => walkRef.current(cams, opts),
      stopWalkthrough: () => stopWalkRef.current(),
    }));

    useEffect(() => {
      const container = mountRef.current;
      if (!container) return;

      // Detect software WebGL per threejs skill instructions
      const isSoftwareGl = (() => {
        const gl = document.createElement('canvas').getContext('webgl2');
        if (!gl) return true;
        const ext = gl.getExtension('WEBGL_debug_renderer_info');
        const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
        const gpu = String(gl.getParameter(param));
        gl.getExtension('WEBGL_lose_context')?.loseContext();
        return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
      })();

      const renderer = new THREE.WebGLRenderer({
        antialias: !isSoftwareGl,
        powerPreference: 'high-performance',
      });
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.08;
      renderer.localClippingEnabled = true; // exterior finish bands are clipped per band
      renderer.setPixelRatio(
        isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2)
      );
      renderer.shadowMap.enabled = !isSoftwareGl;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;

      const width = container.clientWidth || 800;
      const height = container.clientHeight || 600;
      renderer.setSize(width, height);
      container.appendChild(renderer.domElement);

      const scene = new THREE.Scene();
      scene.background = new THREE.Color(
        darkModeRef.current ? 0x141210 : 0xe5e7eb
      );
      scene.fog = new THREE.FogExp2(
        darkModeRef.current ? 0x141210 : 0xe5e7eb,
        0.0003
      );

      // Studio environment reflections
      const pmremGenerator = new THREE.PMREMGenerator(renderer);
      scene.environment = pmremGenerator.fromScene(
        new RoomEnvironment(),
        0.04
      ).texture;
      pmremGenerator.dispose();

      const camera = new THREE.PerspectiveCamera(42, width / height, 2, 10000);
      camera.position.set(480, 360, 500);
      // VIEWCUBE projection: an orthographic camera that follows the perspective one (same pose,
      // frustum matched at the orbit target, so the wheel still zooms)
      const orthoCam = new THREE.OrthographicCamera(-1, 1, 1, -1, -50000, 50000);
      let viewRoll = 0; // screen roll (ViewCube roll arrows on side faces)
      function wantOrtho(): boolean {
        if (camViewRef.current || previewRef.current) return false;
        const p = cubeSettingsRef.current.projection;
        if (p === 'perspective') return false;
        const off = camera.position.clone().sub(controls.target);
        return isOrthographicView(p, alignedFace({ x: off.x, y: off.y, z: off.z }, cubeSettingsRef.current.frontOffset, 0.6));
      }
      /** The camera actually used to draw, pick and project. */
      function viewCam(): THREE.Camera {
        if (!wantOrtho()) return camera;
        const dist = camera.position.distanceTo(controls.target);
        const hh = orthoHalfHeight(dist, camera.fov);
        orthoCam.left = -hh * camera.aspect;
        orthoCam.right = hh * camera.aspect;
        orthoCam.top = hh;
        orthoCam.bottom = -hh;
        orthoCam.position.copy(camera.position);
        orthoCam.quaternion.copy(camera.quaternion);
        orthoCam.updateProjectionMatrix();
        orthoCam.updateMatrixWorld();
        return orthoCam;
      }

      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = !isSoftwareGl;
      controls.dampingFactor = 0.08;
      controls.target.set(168, 48, 108);
      // BELOW GRADE: no ground stop — orbit all the way under the building and look up
      controls.minPolarAngle = orbitPolarLimits().min;
      controls.maxPolarAngle = orbitPolarLimits().max;
      controls.screenSpacePanning = true; // pan follows the screen, also straight down through the ground
      controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.PAN };

      // Balanced studio lighting rig (warm key light + cool HemisphereLight fill)
      const hemiLight = new THREE.HemisphereLight(0xffffff, 0xa8a29e, 0.85);
      hemiLight.position.set(0, 600, 0);
      scene.add(hemiLight);

      const dirLight = new THREE.DirectionalLight(0xfffbeb, 1.45);
      dirLight.position.set(420, 640, 380);
      dirLight.castShadow = !isSoftwareGl;
      const d = 500;
      dirLight.shadow.camera.left = -d;
      dirLight.shadow.camera.right = d;
      dirLight.shadow.camera.top = d;
      dirLight.shadow.camera.bottom = -d;
      dirLight.shadow.camera.near = 10;
      dirLight.shadow.camera.far = 1800;
      dirLight.shadow.mapSize.set(1024, 1024);
      dirLight.shadow.bias = -0.0005;
      dirLight.shadow.normalBias = 0.02;
      scene.add(dirLight);

      // Ground reference plane + architectural grid
      const groundGeo = new THREE.PlaneGeometry(2800, 2800);
      groundGeo.rotateX(-Math.PI / 2);
      const groundMat = new THREE.MeshStandardMaterial({
        color: darkModeRef.current ? 0x1c1917 : 0xd6d3d1,
        roughness: 0.95,
        metalness: 0.02,
      });
      const groundMesh = new THREE.Mesh(groundGeo, groundMat);
      groundMesh.position.y = -0.5;
      groundMesh.receiveShadow = true;
      scene.add(groundMesh);

      const gridHelper = new THREE.GridHelper(
        1440,
        60,
        0x78716c,
        darkModeRef.current ? 0x292524 : 0xcbd5e1
      );
      gridHelper.position.set(168, -0.2, 108);
      // grid: thin lines visible from both sides, never writing depth (no flicker with the ground)
      {
        const gm = gridHelper.material as THREE.LineBasicMaterial;
        gm.transparent = true;
        gm.depthWrite = false;
        gm.polygonOffset = true;
        gm.polygonOffsetFactor = -1;
        gm.polygonOffsetUnits = -1;
      }
      gridHelper.renderOrder = 1;
      scene.add(gridHelper);
      groundMat.side = THREE.FrontSide;
      let hasFoundations = false;

      // GRADE outline (shown below grade): a thin dashed rectangle at elevation 0 + label
      const gradeGroup = new THREE.Group();
      gradeGroup.visible = false;
      scene.add(gradeGroup);
      const gradeLineMat = new THREE.LineDashedMaterial({ color: 0x92400e, dashSize: 18, gapSize: 10, transparent: true, opacity: 0.9, depthWrite: false });
      const gradeLabel = (() => {
        const cv = document.createElement('canvas');
        cv.width = 256;
        cv.height = 64;
        const g = cv.getContext('2d');
        if (g) {
          g.fillStyle = 'rgba(146,64,14,0.92)';
          g.beginPath();
          g.roundRect?.(4, 10, 248, 44, 10);
          g.fill();
          g.fillStyle = '#ffffff';
          g.font = 'bold 26px Inter, Helvetica, Arial, sans-serif';
          g.textAlign = 'center';
          g.textBaseline = 'middle';
          g.fillText(`GRADE ±0'-0"`, 128, 33);
        }
        const tex = new THREE.CanvasTexture(cv);
        tex.colorSpace = THREE.SRGBColorSpace;
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
        sp.scale.set(64, 16, 1);
        sp.renderOrder = 5;
        return sp;
      })();
      function rebuildGradeOutline() {
        for (const ch of [...gradeGroup.children]) {
          if (ch !== gradeLabel) {
            gradeGroup.remove(ch);
            (ch as THREE.Line).geometry?.dispose();
          }
        }
        const ext = extentsNoCameras(modelRef.current);
        const m = 72;
        const x0 = (Number.isFinite(ext.minX) ? ext.minX : 0) - m;
        const x1 = (Number.isFinite(ext.maxX) ? ext.maxX : 336) + m;
        const z0 = (Number.isFinite(ext.minY) ? ext.minY : 0) - m;
        const z1 = (Number.isFinite(ext.maxY) ? ext.maxY : 216) + m;
        const y = GRADE_Z;
        const geo = new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(x0, y, z0), new THREE.Vector3(x1, y, z0), new THREE.Vector3(x1, y, z1), new THREE.Vector3(x0, y, z1), new THREE.Vector3(x0, y, z0),
        ]);
        const line = new THREE.Line(geo, gradeLineMat);
        line.computeLineDistances();
        line.renderOrder = 4;
        gradeGroup.add(line);
        gradeLabel.position.set(x0 + 40, y, z1);
        if (!gradeLabel.parent) gradeGroup.add(gradeLabel);
      }

      // OVERLAY (never clipped by the section box): box wireframe + face handles
      const overlayScene = new THREE.Scene();
      const sbGroup = new THREE.Group();
      sbGroup.visible = false;
      overlayScene.add(sbGroup);
      const sbEdges = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)),
        new THREE.LineBasicMaterial({ color: 0x0284c7, transparent: true, opacity: 0.9, depthTest: false })
      );
      sbEdges.renderOrder = 10;
      sbGroup.add(sbEdges);
      const handleGeo = new THREE.SphereGeometry(1, 16, 12);
      const handleMat = new THREE.MeshBasicMaterial({ color: 0x0284c7, depthTest: false, transparent: true, opacity: 0.95 });
      const handleHotMat = new THREE.MeshBasicMaterial({ color: 0xf59e0b, depthTest: false });
      const handles = new Map<BoxFace, THREE.Mesh>();
      for (const f of BOX_FACES) {
        const h = new THREE.Mesh(handleGeo, handleMat);
        h.userData = { face: f };
        h.renderOrder = 11;
        handles.set(f, h);
        sbGroup.add(h);
      }
      let sbox: SectionBox | null = null;
      const clipPlanes = Array.from({ length: 6 }, () => new THREE.Plane());
      // cut surfaces: back faces seen through the cut are painted with a hatched solid colour
      const capMat = new THREE.MeshBasicMaterial({ color: 0xb45309, side: THREE.BackSide });
      capMat.onBeforeCompile = (sh) => {
        sh.fragmentShader = sh.fragmentShader.replace(
          '#include <dithering_fragment>',
          `#include <dithering_fragment>
           float hatch = step(0.62, fract((gl_FragCoord.x + gl_FragCoord.y) / 9.0));
           gl_FragColor.rgb = mix(gl_FragColor.rgb, gl_FragColor.rgb * 0.62, hatch);`
        );
      };

      const bimGroup = new THREE.Group();
      scene.add(bimGroup);

      const interactables: THREE.Object3D[] = [];

      // On-demand render scheduler with software-WebGL fence pacing
      let frameId = 0;
      let renderBusy = false;
      let renderDirty = false;

      function afterDraw(cb: () => void) {
        const gl = renderer.getContext() as WebGL2RenderingContext;
        if (!gl || !gl.fenceSync) {
          frameId = window.setTimeout(cb, 80);
          return;
        }
        const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
        gl.flush();
        const poll = () => {
          const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
          if (state === gl.UNSIGNALED) {
            frameId = window.setTimeout(poll, 5);
          } else {
            if (sync) gl.deleteSync(sync);
            frameId = window.setTimeout(cb, 80);
          }
        };
        frameId = window.setTimeout(poll, 5);
      }

      function requestRender() {
        if (renderBusy) {
          renderDirty = true;
          return;
        }
        renderBusy = true;
        frameId = requestAnimationFrame(() => {
          renderDirty = false;
          controls.update();
          if (camViewRef.current) applyCameraProjection(camViewRef.current);
          else if (viewRoll) {
            camera.rotateZ(viewRoll);
            camera.updateMatrixWorld();
          }
          applyNavRef.current();
          renderFrame();
          const done = () => {
            renderBusy = false;
            if (renderDirty) requestRender();
          };
          if (isSoftwareGl) afterDraw(done);
          else done();
        });
      }

      requestRenderRef.current = requestRender;
      controls.addEventListener('change', requestRender);

      /** Hide everything that must not paint the cut caps (ground, grid, lines, see-through meshes). */
      function renderFrame() {
        if (!sbox) {
          renderer.clippingPlanes = [];
          renderer.render(scene, viewCam());
        } else {
          renderer.clippingPlanes = clipPlanes;
          // pass 1: the model as usual
          renderer.render(scene, viewCam());
          // pass 2: inside faces of the solids the box actually cuts → hatched cap colour.
          // Drawn after the model (same depth buffer) so double-sided faces cannot paint over it.
          const hidden: THREE.Object3D[] = [];
          scene.traverseVisible((o) => {
            if ((o as THREE.Group).isGroup || o === scene || (o as THREE.Light).isLight) return;
            const mesh = o as THREE.Mesh;
            let hide = !mesh.isMesh || o === groundMesh || !o.userData.__cut;
            if (!hide) {
              const m = mesh.material as THREE.Material | THREE.Material[];
              hide = (Array.isArray(m) ? m : [m]).some((mm) => mm.transparent && mm.opacity < 0.99);
            }
            if (hide) {
              o.visible = false;
              hidden.push(o);
            }
          });
          const autoClear = renderer.autoClear;
          const autoShadow = renderer.shadowMap.autoUpdate;
          const bg = scene.background;
          renderer.autoClear = false;
          renderer.shadowMap.autoUpdate = false;
          scene.background = null;
          scene.overrideMaterial = capMat;
          renderer.render(scene, viewCam());
          scene.overrideMaterial = null;
          scene.background = bg;
          renderer.shadowMap.autoUpdate = autoShadow;
          renderer.autoClear = autoClear;
          for (const o of hidden) o.visible = true;
        }
        // overlay: handles / box edges, never clipped
        if (sbGroup.visible) {
          const autoClear = renderer.autoClear;
          renderer.clippingPlanes = [];
          renderer.autoClear = false;
          renderer.render(overlayScene, viewCam());
          renderer.autoClear = autoClear;
        }
        updateOverlayDom();
      }

      /** Badge, view cube and issue markers follow the camera without React re-renders. */
      const tmpV = new THREE.Vector3();
      function updateOverlayDom() {
        const vc = viewCubeRef.current;
        if (vc) {
          const vcam = viewCam();
          vcam.updateMatrixWorld();
          const off = tmpV.subVectors(camera.position, controls.target);
          const dirN = { x: off.x, y: off.y, z: off.z };
          vc.setOrientation(vcam.matrixWorldInverse.elements, cubeSettingsRef.current.frontOffset, alignedFace(dirN, cubeSettingsRef.current.frontOffset, 0.6), off.y < 0);
        }
        const mk = markersRef.current;
        if (mk) {
          const show = navRef.current.showMarkers;
          mk.style.display = show ? '' : 'none';
          if (show) {
            const W = renderer.domElement.clientWidth;
            const H = renderer.domElement.clientHeight;
            const offL = renderer.domElement.offsetLeft;
            const offT = renderer.domElement.offsetTop;
            for (const el of Array.from(mk.children) as HTMLElement[]) {
              const x = Number(el.dataset.x);
              const y = Number(el.dataset.y);
              const z = Number(el.dataset.z);
              tmpV.set(x, z, y).project(viewCam());
              const vis = tmpV.z < 1 && Math.abs(tmpV.x) <= 1.05 && Math.abs(tmpV.y) <= 1.05;
              el.style.display = vis ? '' : 'none';
              if (vis) el.style.transform = `translate(${Math.round(offL + ((tmpV.x + 1) / 2) * W)}px, ${Math.round(offT + ((1 - tmpV.y) / 2) * H)}px)`;
            }
          }
        }
      }

      /** Ground / grid / grade line / badge for the current eye height (material changes only). */
      let lastGroundKey = '';
      applyNavRef.current = () => {
        const inCam = !!camViewRef.current;
        const g = navRef.current.ground;
        const app = groundAppearance(camera.position.y, g, hasFoundations);
        groundMesh.visible = app.visible;
        const transparent = app.opacity < 0.999;
        const key = `${transparent}|${app.doubleSided}`;
        groundMat.opacity = app.opacity;
        if (key !== lastGroundKey) {
          lastGroundKey = key;
          groundMat.transparent = transparent;
          groundMat.depthWrite = !transparent;
          groundMat.side = app.doubleSided ? THREE.DoubleSide : THREE.FrontSide;
          groundMat.needsUpdate = true;
        }
        (gridHelper.material as THREE.LineBasicMaterial).opacity = app.gridOpacity;
        gridHelper.visible = !inCam && !g.hidden;
        gradeGroup.visible = app.below && !inCam;
        if (app.below && !inCam) {
          const dist = camera.position.distanceTo(gradeLabel.position);
          const k = Math.max(0.4, dist / 900);
          gradeLabel.scale.set(64 * k, 16 * k, 1);
        }
        const badge = badgeRef.current;
        if (badge) {
          badge.style.display = app.below ? '' : 'none';
          if (app.below) badge.textContent = belowGradeBadge(camera.position.y, unitsRef.current);
        }
        const show = app.below || g.xray || navRef.current.sectionBox || navRef.current.issuesOpen;
        navRef.current.showMarkers = show;
        // section-box handles keep a constant on-screen size
        if (sbox) {
          for (const [f, h] of handles) {
            const c = faceCenter(sbox, f);
            h.position.set(c.x, c.y, c.z);
            const k = Math.max(1.5, camera.position.distanceTo(h.position) * 0.011);
            h.scale.setScalar(k);
          }
        }
      };

      // ---------------- CAMERA VIEWS ----------------
      let applyingPose = false;
      let walking = false;
      controls.addEventListener('change', () => {
        if (camViewRef.current && !applyingPose && !walking) camDirtyRef.current(true);
      });
      dirLight.target.position.set(168, 0, 108);
      scene.add(dirLight.target);

      /** Two-point perspective: keep the camera level and shift the image like a shift lens. */
      function applyCameraProjection(c: CameraEntity) {
        camera.updateProjectionMatrix();
        if (c.twoPoint === false) return;
        const dx = controls.target.x - camera.position.x;
        const dz = controls.target.z - camera.position.z;
        const H = Math.max(1, Math.hypot(dx, dz));
        const tanPitch = (controls.target.y - camera.position.y) / H;
        const shift = Math.max(-1.5, Math.min(1.5, tanPitch / Math.tan((camera.fov * DEG3) / 2)));
        camera.up.set(0, 1, 0);
        camera.lookAt(controls.target.x, camera.position.y, controls.target.z);
        camera.updateMatrixWorld();
        camera.projectionMatrix.elements[9] += shift;
        camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
      }

      /** Letterbox the canvas to the camera crop (or fill the container in the normal 3D view). */
      function fitCanvas() {
        const cw = container!.clientWidth || 800;
        const ch = container!.clientHeight || 600;
        const c = camViewRef.current;
        let w = cw;
        let h = ch;
        if (c) {
          const a = aspectRatio(c.aspect);
          if (cw / ch > a) {
            h = ch;
            w = Math.round(ch * a);
          } else {
            w = cw;
            h = Math.round(cw / a);
          }
        }
        renderer.setSize(Math.max(1, w), Math.max(1, h));
        const st = renderer.domElement.style;
        st.position = 'absolute';
        st.left = `${Math.round((cw - w) / 2)}px`;
        st.top = `${Math.round((ch - h) / 2)}px`;
        camera.aspect = w / Math.max(1, h);
        if (c) camera.fov = horizontalToVerticalFov(c.fov, camera.aspect);
        camera.updateProjectionMatrix();
      }

      function setPose(c: CameraEntity) {
        const { eye, look } = cameraEye3D(c);
        applyingPose = true;
        camera.position.set(eye.x, eye.y, eye.z);
        controls.target.set(look.x, look.y, look.z);
        camera.near = Math.max(0.5, c.near || 6);
        camera.far = Math.max(camera.near + 100, c.far || 6000);
        camera.fov = horizontalToVerticalFov(c.fov, camera.aspect);
        controls.update();
        applyingPose = false;
      }

      applyCamRef.current = (c) => {
        const inCam = !!c;
        gridHelper.visible = !inCam;
        controls.maxPolarAngle = orbitPolarLimits().max;
        applySectionBoxRef.current();
        controls.enabled = !previewRef.current;
        controls.enableDamping = !isSoftwareGl && !inCam;
        fitCanvas();
        if (c) {
          setPose(c);
        } else {
          camera.fov = 42;
          camera.near = 2;
          camera.far = 10000;
          camera.updateProjectionMatrix();
          setPresetRef.current('iso', false);
        }
        camDirtyRef.current(false);
        applyLightingRef.current();
        requestRender();
      };

      readPoseRef.current = () => ({
        eye: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
        look: { x: controls.target.x, y: controls.target.y, z: controls.target.z },
      });

      let shadowsOn = renderer.shadowMap.enabled;
      function ensureShadows(on: boolean) {
        if (shadowsOn !== on) {
          shadowsOn = on;
          renderer.shadowMap.enabled = on;
          scene.traverse((o) => {
            const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
            if (m) (Array.isArray(m) ? m : [m]).forEach((mm) => (mm.needsUpdate = true));
          });
        }
        dirLight.castShadow = on;
        if (on) {
          bimGroup.traverse((o) => {
            const mesh = o as THREE.Mesh;
            if (!mesh.isMesh) return;
            const m = mesh.material as THREE.Material | THREE.Material[];
            const transparent = (Array.isArray(m) ? m : [m]).every((mm) => mm.transparent && mm.opacity < 0.9);
            mesh.castShadow = !transparent;
            mesh.receiveShadow = true;
          });
        }
      }

      /** Sun for camera views (date + time → direction, warm low sun, live shadows). */
      applyLightingRef.current = () => {
        const c = camViewRef.current;
        const sun = c?.sun?.enabled ? c.sun : null;
        if (sun) {
          const sp = sunPosition(sun.latitude, dayOfYear(sun.month, sun.day), sun.hour);
          const ext = extentsNoCameras(modelRef.current);
          const cx = (ext.minX + ext.maxX) / 2;
          const cz = (ext.minY + ext.maxY) / 2;
          const span = Math.max(300, ext.maxX - ext.minX, ext.maxY - ext.minY);
          const R = span * 2 + 900;
          const up = Math.max(0.02, sp.dir.y);
          dirLight.position.set(cx + sp.dir.x * R, Math.max(20, sp.dir.y * R), cz + sp.dir.z * R);
          dirLight.target.position.set(cx, 0, cz);
          dirLight.target.updateMatrixWorld();
          const day = sp.altitude > 0;
          const lowSun = Math.min(1, Math.max(0, sp.altitude / 25));
          dirLight.color.setRGB(1, 0.72 + 0.26 * lowSun, 0.48 + 0.44 * lowSun);
          dirLight.intensity = day ? 0.5 + 2.1 * Math.sqrt(up) : 0;
          hemiLight.intensity = day ? 0.35 + 0.45 * Math.sqrt(up) : 0.18;
          const half = span * 0.9 + 300;
          const sc = dirLight.shadow.camera;
          sc.left = -half;
          sc.right = half;
          sc.top = half;
          sc.bottom = -half;
          sc.near = 10;
          sc.far = R * 2 + span;
          sc.updateProjectionMatrix();
          dirLight.shadow.mapSize.set(2048, 2048);
          dirLight.shadow.map?.dispose();
          dirLight.shadow.map = null as unknown as THREE.WebGLRenderTarget;
          ensureShadows(day);
        } else {
          dirLight.position.set(420, 640, 380);
          dirLight.target.position.set(0, 0, 0);
          dirLight.target.updateMatrixWorld();
          dirLight.color.setHex(0xfffbeb);
          dirLight.intensity = 1.45;
          hemiLight.intensity = 0.85;
          const sc = dirLight.shadow.camera;
          sc.left = -d;
          sc.right = d;
          sc.top = d;
          sc.bottom = -d;
          sc.near = 10;
          sc.far = 1800;
          sc.updateProjectionMatrix();
          ensureShadows(!isSoftwareGl);
        }
        requestRender();
      };

      // Incremental 3D entity cache: avoids rebuilding unchanged meshes when editing or selecting with 2,000 objects
      const entityCache = new Map<
        string,
        { sig: string; obj: THREE.Object3D; meshes: THREE.Object3D[] }
      >();

      const edgeLineMat = new THREE.LineBasicMaterial({
        color: darkModeRef.current ? 0x78716c : 0x57534e,
      });
      const gridLineMat = new THREE.LineBasicMaterial({
        color: 0x0891b2,
      });

      // Build/Update 3D BIM meshes incrementally from model state (Stacking All Building Levels!)
      function rebuildScene() {
        const currentModel = modelRef.current;
        const currSelected = new Set(selectedIdsRef.current);
        const hiddenSet = new Set(tempHiddenRef.current);
        const isolatedSet = new Set(tempIsolatedRef.current);
        const visibleLayers = new Set(
          currentModel.layers.filter((l) => l.visible).map((l) => l.id)
        );

        scene.background = new THREE.Color(
          darkModeRef.current ? 0x141210 : 0xe5e7eb
        );
        groundMat.color.setHex(darkModeRef.current ? 0x1c1917 : 0xd6d3d1);
        edgeLineMat.color.setHex(darkModeRef.current ? 0x78716c : 0x57534e);
        // see foundations below grade: the ground turns translucent when there is structure under it
        // (automatic opacity; the Ground control and the below-grade fade are applied every frame)
        hasFoundations =
          structRef.current.discipline !== 'architectural' &&
          currentModel.entities.some((e) => e.type === 'footing' || (e.type === 'floor' && e.foundation));
        rebuildGradeOutline();

        const levelElevMap = new Map<string, number>();
        for (const lvl of currentModel.levels ?? []) {
          levelElevMap.set(lvl.id, lvl.elevation);
        }
        const getLevelElev = (levelId?: string): number =>
          levelElevMap.get(levelId || 'level-1') ?? 0;

        const knownLayers = new Set(currentModel.layers.map((l) => l.id));
        const { discipline: disc, viewRebar: showRebar, analytical: showAnalytical } = structRef.current;
        const entities = currentModel.entities.filter((e) => {
          if (knownLayers.has(e.layer) && !visibleLayers.has(e.layer)) return false;
          if (disc === 'architectural' && STRUCTURAL_ONLY_TYPES.has(e.type)) return false;
          const cat = getEntityCategory3D(e);
          if (
            currentModel.visibility?.view3d &&
            currentModel.visibility.view3d[cat] === false
          ) {
            return false;
          }
          if (isolatedSet.size > 0 && !isolatedSet.has(e.id)) return false;
          if (hiddenSet.has(e.id)) return false;
          return true;
        });

        const walls = entities.filter(
          (e): e is WallEntity => e.type === 'wall'
        );
        const doors = entities.filter(
          (e): e is DoorEntity => e.type === 'door'
        );
        const windows = entities.filter(
          (e): e is WindowEntity => e.type === 'window'
        );
        const rooms = entities.filter(
          (e): e is RoomEntity => e.type === 'room'
        );
        const floors = entities.filter(
          (e): e is FloorEntity => e.type === 'floor'
        );
        const roofs = entities.filter(
          (e): e is RoofEntity => e.type === 'roof'
        );
        const stairs = entities.filter(
          (e): e is StairEntity => e.type === 'stair'
        );
        const columns = entities.filter(
          (e): e is ColumnEntity => e.type === 'column'
        );
        const grids = entities.filter(
          (e): e is GridEntity => e.type === 'grid'
        );
        const blocks = entities.filter(
          (e): e is BlockInstanceEntity => e.type === 'block'
        );

        // Pre-index doors and windows by host wallId for O(1) lookup
        const doorsByWall = new Map<string, DoorEntity[]>();
        for (const d of doors) {
          const list = doorsByWall.get(d.wallId);
          if (list) list.push(d);
          else doorsByWall.set(d.wallId, [d]);
        }
        const wallOpeningsByWall = new Map<string, WallOpeningEntity[]>();
        for (const e of entities) {
          if (e.type !== 'wallopening') continue;
          const list = wallOpeningsByWall.get(e.wallId);
          if (list) list.push(e);
          else wallOpeningsByWall.set(e.wallId, [e]);
        }
        const windowsByWall = new Map<string, WindowEntity[]>();
        for (const w of windows) {
          const list = windowsByWall.get(w.wallId);
          if (list) list.push(w);
          else windowsByWall.set(w.wallId, [w]);
        }

        const nextKeys = new Set<string>();
        const entById = new Map(currentModel.entities.map((e) => [e.id, e] as const));
        const rebarHosts = new Set(currentModel.entities.filter((e) => e.type === 'rebar' || e.type === 'areareinf').map((e) => (e as { hostId: string }).hostId));
        const globalSig = `${disc}|${showRebar}`;
        /** Structural discipline: architecture fades to light gray. View rebar: concrete hosts turn see-through. */
        const ghost = (obj: THREE.Object3D, opacity: number, gray: boolean) => {
          obj.traverse((o) => {
            const m = o as THREE.Mesh;
            if (!m.material) return;
            const conv = (mat: THREE.Material) => {
              const c = mat.clone() as THREE.MeshStandardMaterial;
              if (gray && (c as THREE.MeshStandardMaterial).color) {
                c.color = c.color.clone().lerp(new THREE.Color(0xe7e5e4), 0.85);
                if ('map' in c) c.map = null;
              }
              c.transparent = true;
              c.opacity = Math.min(c.opacity ?? 1, opacity);
              c.depthWrite = false;
              return c;
            };
            m.material = Array.isArray(m.material) ? m.material.map(conv) : conv(m.material);
            if (o instanceof THREE.Mesh) o.castShadow = false;
          });
        };
        const isConcreteHost = (e: { id: string; type: string }) => {
          const ent = entById.get(e.id);
          if (!ent) return false;
          if (ent.type === 'column') return isConcrete(columnMaterialId(ent));
          if (ent.type === 'beam') return isConcrete(ent.structuralMaterialId);
          if (ent.type === 'wall') return !!ent.structural && (isConcrete(wallStructuralMaterialId(ent)) || wallStructuralMaterialId(ent) === 'cmu');
          return ent.type === 'footing' || (ent.type === 'floor' && !!rebarHostOf(currentModel, ent.id));
        };
        const upsertCached = (
          key: string,
          sig0: string,
          builder0: () => { obj: THREE.Object3D; meshes: THREE.Object3D[] } | null
        ) => {
          const sig = `${globalSig}|${sig0}`;
          const ent = entById.get(key);
          const builder = () => {
            const built = builder0();
            if (built && ent) {
              if (disc === 'structural' && !isStructuralEntity(ent)) ghost(built.obj, 0.16, true);
              else if (showRebar && rebarHosts.has(ent.id) && isConcreteHost(ent)) ghost(built.obj, 0.24, false);
            }
            return built;
          };
          nextKeys.add(key);
          const existing = entityCache.get(key);
          if (existing && existing.sig === sig) {
            return;
          }
          if (existing) {
            bimGroup.remove(existing.obj);
            entityCache.delete(key);
          }
          const built = builder();
          if (built) {
            bimGroup.add(built.obj);
            entityCache.set(key, { sig, obj: built.obj, meshes: built.meshes });
          }
        };

        // 0. STRUCTURAL GRIDS IN 3D (Cyan datum lines on ground)
        for (const g of grids) {
          const sig = `${g.start.x},${g.start.y},${g.end.x},${g.end.y}`;
          upsertCached(g.id, sig, () => {
            const pts = [
              new THREE.Vector3(g.start.x, 0.3, g.start.y),
              new THREE.Vector3(g.end.x, 0.3, g.end.y),
            ];
            const lineGeo = new THREE.BufferGeometry().setFromPoints(pts);
            const lineObj = new THREE.Line(lineGeo, gridLineMat);
            return { obj: lineObj, meshes: [] };
          });
        }

        // 1. FLOOR SLABS UNDER EACH ROOM
        for (const room of rooms) {
          if (room.polygon.length < 3) continue;
          const levelElev = getLevelElev(room.levelId);
          const isSel = currSelected.has(room.id);
          const sig = `${levelElev}|${isSel}|${room.floorMaterial}|${room.polygon.map((p) => `${p.x},${p.y}`).join(';')}`;
          upsertCached(room.id, sig, () => {
            const shape = new THREE.Shape();
            shape.moveTo(room.polygon[0].x, room.polygon[0].y);
            for (let i = 1; i < room.polygon.length; i++) {
              shape.lineTo(room.polygon[i].x, room.polygon[i].y);
            }
            shape.closePath();

            const slabGeo = new THREE.ExtrudeGeometry(shape, {
              depth: 4,
              bevelEnabled: false,
            });
            slabGeo.rotateX(Math.PI / 2);

            const floorColor = isSel
              ? 0xf59e0b
              : room.floorMaterial === 'stone'
              ? 0xcbd5e1
              : room.floorMaterial === 'tile'
              ? 0xe2e8f0
              : room.floorMaterial === 'concrete'
              ? 0x9ca3af
              : 0xd4a373;

            const slabMat = new THREE.MeshStandardMaterial({
              color: floorColor,
              roughness: 0.6,
              metalness: 0.05,
            });
            const slabMesh = new THREE.Mesh(slabGeo, slabMat);
            slabMesh.position.y = levelElev + 4;
            slabMesh.receiveShadow = true;
            slabMesh.userData = { entityId: room.id };
            return { obj: slabMesh, meshes: [slabMesh] };
          });
        }

        // 1.5 FLOOR SLABS (SB) / STRUCTURAL FLOORS / SLABS ON GRADE (expansion-joint pieces, thickened edges, joints)
        const jointSig = currentModel.entities.filter((e) => e.type === 'sjoint').map((j) => JSON.stringify(j)).join('|');
        for (const fl of floors) {
          if (fl.polygon.length < 3) continue;
          const levelElev = getLevelElev(fl.levelId);
          const ft = (currentModel.floorTypes ?? []).find((t) => t.id === fl.floorTypeId);
          const isSel = currSelected.has(fl.id);
          const color = fl.foundation || fl.structural ? '#b9b5ad' : ft?.color || '#b48a60';
          const sig = JSON.stringify([levelElev, isSel, color, fl.thickness, fl.polygon, fl.openings, fl.thickenedEdge, fl.foundation, jointSig]);
          upsertCached(fl.id, sig, () => buildSlab3D(currentModel, fl, { selected: isSel, shadows: !isSoftwareGl, color, edgeMat: edgeLineMat }));
        }

        // 2. WALLS: roof-attached profiles, exterior finish bands, styled openings, curtain walls
        const wallsByLevel = new Map<string, WallEntity[]>();
        for (const w of currentModel.entities) {
          if (w.type !== 'wall') continue;
          const k = w.levelId || 'level-1';
          const list = wallsByLevel.get(k);
          if (list) list.push(w);
          else wallsByLevel.set(k, [w]);
        }
        const roofSigById = new Map<string, string>();
        for (const e of currentModel.entities) {
          if (e.type === 'roof') roofSigById.set(e.id, JSON.stringify([e.polygon, e.roofStyle, e.slope, e.overhang, e.thickness, e.baseOffset, e.edgeSlopes, e.levelId, e.mansardLowerSlope, e.mansardBreakInset, e.roofVersion]));
        }
        // neighbour geometry drives the joined ends (miter / butt / T / crossing), so it is part of each wall's signature
        const levelJoinSig = new Map<string, string>();
        for (const [k, list] of wallsByLevel) levelJoinSig.set(k, JSON.stringify(list.map((w) => [w.id, w.start, w.end, w.thickness, w.justification, w.joins, w.wallTypeId])));
        for (const wall of walls) {
          const wallLen = dist(wall.start, wall.end);
          if (wallLen < 1) continue;
          const levelElev = getLevelElev(wall.levelId);
          const wallType = (currentModel.wallTypes ?? []).find((wt) => wt.id === wall.wallTypeId);
          const isGlassWall = Boolean((wallType?.isCurtainOrGlass || wall.wallTypeId === 'wt-glass') && !isCurtainWall(wall));
          const coreColor = wallType && wallType.layers.length > 0 ? wallType.layers[Math.floor(wallType.layers.length / 2)].color : '#d6d3d1';
          const sameLevel = wallsByLevel.get(wall.levelId || 'level-1') ?? [wall];
          const isExt = wallIsExterior(currentModel, wall, sameLevel);
          const wallDoors = doorsByWall.get(wall.id) ?? [];
          const wallWins = windowsByWall.get(wall.id) ?? [];
          const wallWos = wallOpeningsByWall.get(wall.id) ?? [];
          const opSig = JSON.stringify([
            wallDoors.map((d) => [d.id, d.offset, d.width, d.height, d.frameWidth, d.divisions, d.glazed, d.trim, d.swing, d.kind, d.depthPosition, d.frameMaterial, currSelected.has(d.id)]),
            wallWins.map((w) => [w.id, w.offset, w.width, w.height, w.sillHeight, w.frameWidth, w.divisions, w.trim, w.shutters, w.operation, w.depthPosition, w.flipFacing, w.frameMaterial, currSelected.has(w.id)]),
            wallWos.map((w) => [w.id, w.offset, w.width, w.height, w.sillHeight, w.shape]),
          ]);
          const sig = JSON.stringify([wall.start, wall.end, wall.thickness, wall.height, wall.baseOffset, levelElev, currSelected.has(wall.id), isGlassWall, coreColor, wall.exteriorFinish, wall.interiorFinish, wall.finishBands, wall.exteriorSide, wall.parapetHeight, wall.curtain, wall.wallTypeId, isExt, wall.attachedRoofId ? roofSigById.get(wall.attachedRoofId) : null, levelJoinSig.get(wall.levelId || 'level-1'), opSig, isSoftwareGl]);
          upsertCached(wall.id, sig, () =>
            buildWall3D(wall, {
              model: currentModel,
              levelElev,
              doors: wallDoors,
              windows: wallWins,
              wallOpenings: wallWos,
              selectedIds: currSelected,
              sameLevelWalls: sameLevel,
              isExteriorWall: isExt,
              glassWall: isGlassWall,
              coreColor,
              shadows: !isSoftwareGl,
              edgeMat: edgeLineMat,
            })
          );
        }

        // 2.1 STAR-JOIN HUBS (3+ walls meeting at one point): fill the centre so the corner is solid
        for (const [lvl, list] of wallsByLevel) {
          const shown = list.filter((w) => walls.includes(w));
          if (shown.length < 3) continue;
          for (const h of joinHubs(shown)) {
            const ws = shown.filter((w) => h.wallIds.includes(w.id));
            const z0 = getLevelElev(lvl) + Math.min(...ws.map((w) => w.baseOffset || 0));
            const ht = Math.min(...ws.map((w) => w.height || 108));
            const wt = (currentModel.wallTypes ?? []).find((t) => t.id === ws[0]?.wallTypeId);
            const color = wt && wt.layers.length ? wt.layers[Math.floor(wt.layers.length / 2)].color : '#d6d3d1';
            upsertCached(`hub:${h.key}`, JSON.stringify([h.poly, z0, ht, color]), () => buildJoinHub3D(`hub:${h.key}`, h.poly, z0, ht, color, !isSoftwareGl));
          }
        }

        // 2.2 STRUCTURAL COLUMNS (CL): concrete / steel W & HSS / wood profiles; steel base plates + anchor bolts
        const beamSig = currentModel.entities.filter((e) => e.type === 'beam').map((b) => JSON.stringify(b)).join('|');
        for (const colEnt of columns) {
          const isSel = currSelected.has(colEnt.id);
          const sig = JSON.stringify([colEnt, isSel, currentModel.levels, colEnt.topBeamId ? beamSig : '']);
          upsertCached(colEnt.id, sig, () => buildColumn3D(currentModel, colEnt, { selected: isSel, shadows: !isSoftwareGl, edgeMat: edgeLineMat }));
        }

        // 2.3 STRUCTURE: footings & piles, beams / braces, joists, connections, lintels, rebar, loads, analytical
        const colSig = columns.map((c) => JSON.stringify(c)).join('|');
        const joinSig = JSON.stringify(currentModel.structureJoins || {});
        const wallSigAll = currentModel.entities.filter((e) => e.type === 'wall').map((w) => JSON.stringify([w.id, (w as WallEntity).start, (w as WallEntity).end, (w as WallEntity).thickness])).join('|');
        for (const e of entities) {
          const isSel = currSelected.has(e.id);
          if (e.type === 'footing') {
            upsertCached(e.id, JSON.stringify([e, isSel, currentModel.levels, e.columnId ? colSig : '', e.wallId ? wallSigAll : '']), () => buildFooting3D(currentModel, e, { selected: isSel, shadows: !isSoftwareGl, edgeMat: edgeLineMat }));
          } else if (e.type === 'beam') {
            upsertCached(e.id, JSON.stringify([e, isSel, currentModel.levels, colSig, joinSig]), () => buildBeam3D(currentModel, e, { selected: isSel, shadows: !isSoftwareGl, edgeMat: edgeLineMat }));
          } else if (e.type === 'truss') {
            upsertCached(e.id, JSON.stringify([e, isSel, currentModel.levels]), () => buildTruss3D(currentModel, e, { selected: isSel, shadows: !isSoftwareGl, edgeMat: edgeLineMat }));
          } else if (e.type === 'beamsystem') {
            upsertCached(e.id, JSON.stringify([e, isSel, currentModel.levels]), () => buildBeamSystem3D(currentModel, e, { selected: isSel, shadows: !isSoftwareGl }));
          } else if (e.type === 'connection') {
            upsertCached(e.id, JSON.stringify([e, isSel, beamSig, colSig, joinSig]), () => buildConnection3D(currentModel, e, { selected: isSel, shadows: !isSoftwareGl }));
          } else if (e.type === 'load') {
            if (!showAnalytical) continue;
            upsertCached(e.id, JSON.stringify([e, isSel, currentModel.levels]), () => buildLoad3D(currentModel, e, isSel));
          }
        }
        if (disc !== 'architectural') {
          // lintels / headers over openings (visible where walls are see-through: Structural discipline)
          if (disc === 'structural') {
            for (const w of walls) {
              const ops = currentModel.entities.filter((o) => (o.type === 'door' || o.type === 'window') && o.wallId === w.id);
              if (!ops.length) continue;
              upsertCached(`lintel-${w.id}`, JSON.stringify([w, ops, currSelected.has(w.id)]), () => buildLintels3D(currentModel, w, { selected: currSelected.has(w.id) }));
            }
          }
          if (showRebar) {
            const bars = allRebarBars(currentModel);
            for (const e of entities) {
              if (e.type !== 'rebar' && e.type !== 'areareinf') continue;
              const host = currentModel.entities.find((h) => h.id === e.hostId);
              const isSel = currSelected.has(e.id);
              upsertCached(`rb3d-${e.id}`, JSON.stringify([e, isSel, host, colSig, joinSig, currentModel.levels]), () => buildRebar3D(e.id, bars.get(e.id) || [], isSel));
            }
          }
          if (showAnalytical) {
            const sig = JSON.stringify([currentModel.entities.filter((e) => e.type === 'beam' || e.type === 'column' || e.type === 'footing'), currentModel.levels]);
            upsertCached('analytical-model', sig, () => ({ obj: buildAnalytical3D(currentModel), meshes: [] }));
          }
        }

        // 2.4 STAIRS (ST — Multi-Run, Landings, Winder, Spiral, 5 Construction Styles, Continuous 3D Railings)
        for (const st of stairs) {
          const isSel = currSelected.has(st.id);
          const sig = JSON.stringify([st, currentModel.levels, isSel, isSoftwareGl]);
          upsertCached(st.id, sig, () =>
            buildStair3D(st, {
              levels: currentModel.levels ?? [],
              selected: isSel,
              shadows: !isSoftwareGl,
              edgeMat: edgeLineMat,
            })
          );
        }

        // 2.6 ROOFS (straight-skeleton geometry: thickness, fascia, soffit, gutters, material texture, skylight cut-outs)
        const skylightsByRoof = new Map<string, SkylightEntity[]>();
        for (const e of entities) {
          if (e.type !== 'skylight') continue;
          const list = skylightsByRoof.get(e.roofId);
          if (list) list.push(e);
          else skylightsByRoof.set(e.roofId, [e]);
        }
        const roofById = new Map<string, RoofEntity>();
        for (const e of currentModel.entities) if (e.type === 'roof') roofById.set(e.id, e);
        for (const rf of roofs) {
          if (rf.polygon.length < 3) continue;
          const levelElev = getLevelElev(rf.levelId);
          const sk = skylightsByRoof.get(rf.id) ?? [];
          const sig = JSON.stringify([levelElev, currSelected.has(rf.id), roofSigById.get(rf.id), rf.material, rf.fasciaDepth, rf.gutter, rf.parapetHeight, sk.map((s) => [s.position, s.width, s.length]), isSoftwareGl]);
          upsertCached(rf.id, sig, () =>
            buildRoof3D(rf, { levelElev, selectedIds: currSelected, skylights: sk, shadows: !isSoftwareGl, edgeMat: edgeLineMat })
          );
        }

        // 2.7 SKYLIGHTS, DORMERS, SWEEPS / REVEALS, BALCONIES, RAILINGS
        for (const e of entities) {
          const isSel = currSelected.has(e.id);
          if (e.type === 'skylight' || e.type === 'dormer') {
            const rf = roofById.get(e.roofId);
            if (!rf) continue;
            const levelElev = getLevelElev(rf.levelId);
            const sig = JSON.stringify([e, roofSigById.get(rf.id), rf.material, levelElev, isSel]);
            upsertCached(e.id, sig, () =>
              e.type === 'skylight'
                ? buildSkylight3D(rf, e, levelElev, isSel)
                : buildDormer3D(rf, e, levelElev, isSel, !isSoftwareGl)
            );
          } else if (e.type === 'sweep' || e.type === 'balcony') {
            const wall = currentModel.entities.find((w): w is WallEntity => w.type === 'wall' && w.id === e.wallId);
            if (!wall) continue;
            const sameLevel = wallsByLevel.get(wall.levelId || 'level-1') ?? [wall];
            const levelElev = getLevelElev(wall.levelId);
            const sig = JSON.stringify([e, wall.start, wall.end, wall.thickness, wall.baseOffset, wall.exteriorSide, levelElev, sameLevel.length, isSel]);
            upsertCached(e.id, sig, () =>
              e.type === 'sweep'
                ? buildSweep3D(currentModel, e, wall, sameLevel, isSel, !isSoftwareGl)
                : buildBalcony3D(e, wall, sameLevel, levelElev, isSel, !isSoftwareGl)
            );
          } else if (e.type === 'railing') {
            if (e.path.length < 2) continue;
            const levelElev = getLevelElev(e.levelId);
            const sig = JSON.stringify([e, levelElev, isSel]);
            upsertCached(e.id, sig, () => {
              const g = new THREE.Group();
              const ms = buildRailing3D(e.id, e.path, levelElev + (e.baseOffset || 0), e.height, e.style, e.balusterSpacing, isSel, !isSoftwareGl);
              ms.forEach((m) => g.add(m));
              return { obj: g, meshes: ms };
            });
          }
        }

        // 3. 3D COMPONENTS & BLOCK INSTANCES (Uses width, depth, height & material color + Level Elevation)
        for (const blk of blocks) {
          const levelElev = getLevelElev(blk.levelId);
          const blockDef = (currentModel.blocks ?? []).find(
            (b) => b.id === blk.blockId
          );
          const kind = blockDef?.kind ?? 'custom';
          const sc = blk.scale || 1;
          const w = Math.max(4, blk.width * sc);
          const d = Math.max(4, blk.depth * sc);
          const h = Math.max(2, blk.height * sc);
          const isSelected = currSelected.has(blk.id);
          // library components: chimneys / flues run up through the roof above them
          let chimneyTop: number | undefined;
          if (blockDef?.libKind === 'fireplace-stone' || blockDef?.libKind === 'woodstove') {
            for (const rf of currentModel.entities) {
              if (rf.type !== 'roof') continue;
              const tz = getRoofGeometry(rf, getLevelElev(rf.levelId)).topAt(blk.position);
              if (tz !== null) chimneyTop = Math.max(chimneyTop ?? 0, tz - (levelElev + 4) + 30);
            }
          }
          const ceiling = (() => {
            const lv = [...(currentModel.levels || [])].sort((a, b) => a.elevation - b.elevation);
            const i = lv.findIndex((l) => l.id === (blk.levelId || 'level-1'));
            return i >= 0 && i + 1 < lv.length ? lv[i + 1].elevation - lv[i].elevation - 4 : 104;
          })();
          const sig = `${blk.position.x},${blk.position.y}|${blk.rotation}|${w},${d},${h}|${blk.color}|${kind}|${blockDef?.libKind ?? ''}|${chimneyTop ?? ''}|${ceiling}|${levelElev}|${isSelected}|${blockDef?.entities.length ?? 0}`;

          upsertCached(blk.id, sig, () => {
            const localMeshes: THREE.Object3D[] = [];
            const baseColor = new THREE.Color(
              isSelected ? '#f59e0b' : blk.color || '#0d9488'
            );
            const primaryMat = new THREE.MeshStandardMaterial({
              color: baseColor,
              roughness: 0.55,
              metalness: 0.08,
            });
            const lightAccentMat = new THREE.MeshStandardMaterial({
              color: isSelected ? 0xfde68a : 0xf5f5f4,
              roughness: 0.65,
              metalness: 0.05,
            });
            const darkAccentMat = new THREE.MeshStandardMaterial({
              color: isSelected ? 0xb45309 : 0x334155,
              roughness: 0.4,
              metalness: 0.35,
            });
            const woodMat = new THREE.MeshStandardMaterial({
              color: isSelected ? 0xd97706 : 0x78350f,
              roughness: 0.65,
              metalness: 0.05,
            });

            const compGroup = new THREE.Group();
            compGroup.position.set(blk.position.x, levelElev + 4, blk.position.y);
            compGroup.rotation.y = (blk.rotation * Math.PI) / 180;

            const addPart = (
              geo: THREE.BufferGeometry,
              mat: THREE.Material,
              px: number,
              py: number,
              pz: number
            ) => {
              const mesh = new THREE.Mesh(geo, mat);
              mesh.position.set(px, py, pz);
              mesh.castShadow = !isSoftwareGl;
              mesh.receiveShadow = true;
              mesh.userData = { entityId: blk.id };
              compGroup.add(mesh);
              localMeshes.push(mesh);
              return mesh;
            };

            if (blockDef?.libKind) {
              const built = buildLibrary3D(blockDef.libKind, w, d, h, blk.color || blockDef.color, { selected: isSelected, shadows: !isSoftwareGl, chimneyTop, ceiling });
              for (const m of built.meshes) m.userData = { entityId: blk.id };
              compGroup.add(built.group);
              localMeshes.push(...built.meshes);
            } else if (kind === 'bed') {
              addPart(
                new THREE.BoxGeometry(w, h * 0.32, d),
                woodMat,
                0,
                h * 0.16,
                0
              );
              addPart(
                new THREE.BoxGeometry(w, h, Math.max(3, d * 0.07)),
                woodMat,
                0,
                h * 0.5,
                -d * 0.465
              );
              addPart(
                new THREE.BoxGeometry(w * 0.94, h * 0.28, d * 0.88),
                lightAccentMat,
                0,
                h * 0.44,
                d * 0.03
              );
              addPart(
                new THREE.BoxGeometry(w * 0.95, h * 0.29, d * 0.56),
                primaryMat,
                0,
                h * 0.45,
                d * 0.19
              );
              addPart(
                new THREE.BoxGeometry(w * 0.36, h * 0.12, d * 0.18),
                lightAccentMat,
                -w * 0.22,
                h * 0.62,
                -d * 0.28
              );
              addPart(
                new THREE.BoxGeometry(w * 0.36, h * 0.12, d * 0.18),
                lightAccentMat,
                w * 0.22,
                h * 0.62,
                -d * 0.28
              );
            } else if (kind === 'sofa') {
              addPart(
                new THREE.BoxGeometry(w, h * 0.42, d),
                primaryMat,
                0,
                h * 0.21,
                0
              );
              addPart(
                new THREE.BoxGeometry(w, h * 0.58, d * 0.24),
                primaryMat,
                0,
                h * 0.71,
                -d * 0.38
              );
              addPart(
                new THREE.BoxGeometry(w * 0.11, h * 0.34, d),
                primaryMat,
                -w * 0.445,
                h * 0.59,
                0
              );
              addPart(
                new THREE.BoxGeometry(w * 0.11, h * 0.34, d),
                primaryMat,
                w * 0.445,
                h * 0.59,
                0
              );
            } else if (kind === 'table-chairs') {
              const tw = w * 0.68;
              const td = d * 0.58;
              addPart(
                new THREE.BoxGeometry(tw, h * 0.08, td),
                primaryMat,
                0,
                h * 0.96,
                0
              );
              const legW = Math.max(1.5, w * 0.03);
              for (const sx of [-1, 1]) {
                for (const sz of [-1, 1]) {
                  addPart(
                    new THREE.BoxGeometry(legW, h * 0.92, legW),
                    woodMat,
                    sx * (tw * 0.44),
                    h * 0.46,
                    sz * (td * 0.42)
                  );
                }
              }
              const chairSeatH = h * 0.55;
              for (const sz of [-1, 1]) {
                addPart(
                  new THREE.BoxGeometry(w * 0.22, h * 0.06, d * 0.16),
                  woodMat,
                  0,
                  chairSeatH,
                  sz * (d * 0.41)
                );
                addPart(
                  new THREE.BoxGeometry(w * 0.22, h * 0.45, d * 0.04),
                  woodMat,
                  0,
                  chairSeatH + h * 0.22,
                  sz * (d * 0.48)
                );
              }
              for (const sx of [-1, 1]) {
                addPart(
                  new THREE.BoxGeometry(w * 0.16, h * 0.06, d * 0.22),
                  woodMat,
                  sx * (w * 0.41),
                  chairSeatH,
                  0
                );
                addPart(
                  new THREE.BoxGeometry(w * 0.04, h * 0.45, d * 0.22),
                  woodMat,
                  sx * (w * 0.48),
                  chairSeatH + h * 0.22,
                  0
                );
              }
            } else if (kind === 'toilet') {
              addPart(
                new THREE.BoxGeometry(w * 0.92, h * 0.58, d * 0.32),
                primaryMat,
                0,
                h * 0.71,
                -d * 0.34
              );
              addPart(
                new THREE.BoxGeometry(w * 0.65, h * 0.48, d * 0.75),
                primaryMat,
                0,
                h * 0.24,
                -d * 0.05
              );
              addPart(
                new THREE.CylinderGeometry(w * 0.42, w * 0.34, h * 0.52, 16),
                lightAccentMat,
                0,
                h * 0.26,
                d * 0.14
              );
            } else if (kind === 'sink') {
              addPart(
                new THREE.BoxGeometry(w, h * 0.88, d),
                primaryMat,
                0,
                h * 0.44,
                0
              );
              addPart(
                new THREE.BoxGeometry(w * 1.03, h * 0.12, d * 1.03),
                lightAccentMat,
                0,
                h * 0.94,
                0
              );
              addPart(
                new THREE.CylinderGeometry(
                  Math.min(w, d) * 0.3,
                  Math.min(w, d) * 0.25,
                  2,
                  16
                ),
                darkAccentMat,
                0,
                h + 0.5,
                d * 0.05
              );
              addPart(
                new THREE.BoxGeometry(1.5, 5, 4),
                darkAccentMat,
                0,
                h + 2.5,
                -d * 0.28
              );
            } else if (kind === 'bathtub') {
              addPart(
                new THREE.BoxGeometry(w, h, d),
                primaryMat,
                0,
                h * 0.5,
                0
              );
              addPart(
                new THREE.BoxGeometry(w * 0.86, h * 0.08, d * 0.78),
                lightAccentMat,
                0,
                h * 0.98,
                0
              );
              addPart(
                new THREE.BoxGeometry(3, 5, 3),
                darkAccentMat,
                -w * 0.42,
                h + 2.5,
                0
              );
            } else if (kind === 'kitchen-counter') {
              addPart(
                new THREE.BoxGeometry(w, h * 0.9, d),
                primaryMat,
                0,
                h * 0.45,
                0
              );
              addPart(
                new THREE.BoxGeometry(w * 1.02, h * 0.1, d * 1.04),
                lightAccentMat,
                0,
                h * 0.95,
                0
              );
              addPart(
                new THREE.BoxGeometry(w * 0.24, 1.5, d * 0.58),
                darkAccentMat,
                -w * 0.14,
                h + 0.4,
                0.04 * d
              );
              addPart(
                new THREE.BoxGeometry(w * 0.24, 1.5, d * 0.58),
                darkAccentMat,
                w * 0.14,
                h + 0.4,
                0.04 * d
              );
            } else if (kind === 'fridge') {
              addPart(
                new THREE.BoxGeometry(w, h, d * 0.92),
                primaryMat,
                0,
                h * 0.5,
                -d * 0.04
              );
              addPart(
                new THREE.BoxGeometry(w * 0.48, h * 0.96, d * 0.08),
                lightAccentMat,
                -w * 0.25,
                h * 0.5,
                d * 0.46
              );
              addPart(
                new THREE.BoxGeometry(w * 0.48, h * 0.96, d * 0.08),
                lightAccentMat,
                w * 0.25,
                h * 0.5,
                d * 0.46
              );
            } else if (kind === 'stove') {
              addPart(
                new THREE.BoxGeometry(w, h * 0.92, d),
                primaryMat,
                0,
                h * 0.46,
                0
              );
              addPart(
                new THREE.BoxGeometry(w, h * 0.18, d * 0.14),
                darkAccentMat,
                0,
                h * 1.01,
                -d * 0.43
              );
              const br = Math.min(w, d) * 0.13;
              for (const sx of [-1, 1]) {
                for (const sz of [-1, 1]) {
                  addPart(
                    new THREE.CylinderGeometry(br, br, 1.2, 16),
                    darkAccentMat,
                    sx * (w * 0.26),
                    h * 0.93,
                    sz * (d * 0.22)
                  );
                }
              }
            } else if (kind === 'stairs') {
              const steps = 10;
              const treadD = d / steps;
              const stepH = h / steps;
              for (let s = 0; s < steps; s++) {
                const curH = stepH * (s + 1);
                const zCenter = d / 2 - treadD * (s + 0.5);
                addPart(
                  new THREE.BoxGeometry(w * 0.92, curH, treadD * 0.98),
                  primaryMat,
                  0,
                  curH / 2,
                  zCenter
                );
              }
              addPart(
                new THREE.BoxGeometry(w * 0.04, h, d),
                woodMat,
                -w * 0.48,
                h * 0.5,
                0
              );
              addPart(
                new THREE.BoxGeometry(w * 0.04, h, d),
                woodMat,
                w * 0.48,
                h * 0.5,
                0
              );
            } else if (kind === 'tree') {
              const trunkR = Math.max(3, Math.min(w, d) * 0.08);
              const canopyR = Math.min(w, d) * 0.42;
              addPart(
                new THREE.CylinderGeometry(trunkR * 0.75, trunkR, h * 0.45, 12),
                woodMat,
                0,
                h * 0.225,
                0
              );
              addPart(
                new THREE.SphereGeometry(canopyR, 16, 14),
                primaryMat,
                0,
                h * 0.68,
                0
              );
              addPart(
                new THREE.SphereGeometry(canopyR * 0.72, 14, 12),
                primaryMat,
                -canopyR * 0.45,
                h * 0.58,
                canopyR * 0.25
              );
              addPart(
                new THREE.SphereGeometry(canopyR * 0.72, 14, 12),
                primaryMat,
                canopyR * 0.45,
                h * 0.6,
                -canopyR * 0.25
              );
            } else {
              let addedAny = false;
              if (blockDef && blockDef.entities.length > 0) {
                const sx = w / Math.max(1, blockDef.width);
                const sy = d / Math.max(1, blockDef.depth);
                for (const subEnt of blockDef.entities) {
                  if (subEnt.type === 'rectangle') {
                    const rw = Math.abs(subEnt.p2.x - subEnt.p1.x) * sx;
                    const rd = Math.abs(subEnt.p2.y - subEnt.p1.y) * sy;
                    const cx = ((subEnt.p1.x + subEnt.p2.x) / 2) * sx;
                    const cz = ((subEnt.p1.y + subEnt.p2.y) / 2) * sy;
                    if (rw > 0.5 && rd > 0.5) {
                      addPart(
                        new THREE.BoxGeometry(rw, h, rd),
                        primaryMat,
                        cx,
                        h / 2,
                        cz
                      );
                      addedAny = true;
                    }
                  } else if (subEnt.type === 'circle') {
                    const cr = subEnt.radius * ((sx + sy) / 2);
                    const cx = subEnt.center.x * sx;
                    const cz = subEnt.center.y * sy;
                    if (cr > 0.5) {
                      addPart(
                        new THREE.CylinderGeometry(cr, cr, h, 20),
                        primaryMat,
                        cx,
                        h / 2,
                        cz
                      );
                      addedAny = true;
                    }
                  }
                }
              }
              if (!addedAny) {
                addPart(
                  new THREE.BoxGeometry(w, h, d),
                  primaryMat,
                  0,
                  h / 2,
                  0
                );
              }
            }

            return { obj: compGroup, meshes: localMeshes };
          });
        }

        // 7. CUSTOM / REGISTERED ELEMENT CATEGORIES (e.g. TestBox)
        const customEntities = currentModel.entities.filter(
          (e) => e.type === 'custom'
        );
        for (const ce of customEntities) {
          const isSel = currSelected.has(ce.id);
          const levelElev = getLevelElev(ce.levelId);
          const w = (ce as any).width || 36;
          const d = (ce as any).depth || 36;
          const h = (ce as any).height || 48;
          const elevOff = (ce as any).elevationOffset || 0;
          const colorHex = (ce as any).boxColor || '#6366f1';
          const sig = `${ce.id}|${levelElev}|${elevOff}|${w}|${d}|${h}|${colorHex}|${isSel}|${(ce as any).testParam}`;

          upsertCached(ce.id, sig, () => {
            const boxGeo = new THREE.BoxGeometry(w, h, d);
            const boxMat = new THREE.MeshStandardMaterial({
              color: isSel ? 0xf59e0b : new THREE.Color(colorHex),
              roughness: 0.5,
              metalness: 0.1,
            });
            const mesh = new THREE.Mesh(boxGeo, boxMat);
            mesh.position.set(
              ce.position.x,
              levelElev + elevOff + h / 2,
              ce.position.y
            );
            mesh.castShadow = !isSoftwareGl;
            mesh.receiveShadow = true;
            mesh.userData = { entityId: ce.id };

            const edges = new THREE.EdgesGeometry(boxGeo);
            mesh.add(new THREE.LineSegments(edges, edgeLineMat));

            return { obj: mesh, meshes: [mesh] };
          });
        }

        // Remove stale 3D objects that were deleted or hidden
        for (const [key, entry] of entityCache.entries()) {
          if (!nextKeys.has(key)) {
            bimGroup.remove(entry.obj);
            entityCache.delete(key);
          }
        }

        // Rebuild interactables array from active cached meshes
        interactables.length = 0;
        for (const entry of entityCache.values()) {
          for (const m of entry.meshes) {
            interactables.push(m);
          }
        }

        if (camViewRef.current?.sun?.enabled) applyLightingRef.current();
        objToKey.clear();
        for (const [key, entry] of entityCache.entries()) objToKey.set(entry.obj, key);
        applyXrayRef.current();
        if (sbox) applySectionBoxRef.current();
        requestRender();
      }

      // ---------------- X-RAY (material swap only, never a geometry rebuild) ----------------
      const objToKey = new Map<THREE.Object3D, string>();
      const xrayCache = new WeakMap<THREE.Material, THREE.Material>();
      const xrayMat = (m: THREE.Material) => {
        let x = xrayCache.get(m);
        if (!x) {
          x = m.clone();
          x.transparent = true;
          x.opacity = Math.min(m.opacity ?? 1, 1) * XRAY_OPACITY;
          x.depthWrite = false;
          xrayCache.set(m, x);
        }
        return x;
      };
      const keyOf = (o: THREE.Object3D | null): string | undefined => {
        for (let p = o; p; p = p.parent) {
          const k = objToKey.get(p);
          if (k) return k;
        }
        return undefined;
      };
      applyXrayRef.current = () => {
        const on = navRef.current.ground.xray && !camViewRef.current;
        const ents = new Map(modelRef.current.entities.map((e) => [e.id, e] as const));
        const box = new THREE.Box3();
        for (const [key, entry] of entityCache.entries()) {
          const ent = ents.get(key);
          let want = false;
          if (on) {
            if (ent) {
              if (!isStructuralEntity(ent)) {
                if (ent.type === 'room' || ent.type === 'floor') want = true;
                else {
                  box.setFromObject(entry.obj);
                  want = box.max.y > GRADE_Z + 0.5;
                }
              }
            } else want = key.startsWith('hub:'); // wall join hubs follow the walls
          }
          entry.obj.traverse((o) => {
            const mo = o as THREE.Mesh;
            if (!mo.material) return;
            const ud = o.userData as { __orig?: THREE.Material | THREE.Material[]; __cast?: boolean };
            if (want && !ud.__orig) {
              ud.__orig = mo.material;
              ud.__cast = mo.castShadow;
              mo.material = Array.isArray(mo.material) ? mo.material.map(xrayMat) : xrayMat(mo.material);
              mo.castShadow = false;
            } else if (!want && ud.__orig) {
              mo.material = ud.__orig;
              mo.castShadow = !!ud.__cast;
              delete ud.__orig;
            }
          });
        }
        requestRender();
      };

      // ---------------- SECTION BOX (clip planes only) ----------------
      applySectionBoxRef.current = () => {
        const on = navRef.current.sectionBox && !camViewRef.current && !previewRef.current;
        if (on && !sbox) {
          const b = new THREE.Box3();
          for (const entry of entityCache.values()) b.expandByObject(entry.obj);
          if (b.isEmpty()) b.set(new THREE.Vector3(0, -24, 0), new THREE.Vector3(336, 216, 216));
          sbox = sectionBoxAround({ x: b.min.x, y: b.min.y, z: b.min.z }, { x: b.max.x, y: b.max.y, z: b.max.z }, 12);
        }
        if (!on) sbox = null;
        if (sbox) {
          sectionBoxPlanes(sbox).forEach((p, i) => clipPlanes[i].set(new THREE.Vector3(p.normal.x, p.normal.y, p.normal.z), p.constant));
          // which meshes the box cuts (world bounds cached per mesh: no geometry work while dragging)
          const b = sbox;
          bimGroup.traverse((o) => {
            const mesh = o as THREE.Mesh;
            if (!mesh.isMesh || !mesh.geometry) return;
            let wb = o.userData.__wbb as THREE.Box3 | undefined;
            if (!wb) {
              if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
              mesh.updateWorldMatrix(true, false);
              wb = mesh.geometry.boundingBox!.clone().applyMatrix4(mesh.matrixWorld);
              o.userData.__wbb = wb;
            }
            const overlaps = wb.max.x >= b.min.x && wb.min.x <= b.max.x && wb.max.y >= b.min.y && wb.min.y <= b.max.y && wb.max.z >= b.min.z && wb.min.z <= b.max.z;
            const inside = wb.min.x >= b.min.x && wb.max.x <= b.max.x && wb.min.y >= b.min.y && wb.max.y <= b.max.y && wb.min.z >= b.min.z && wb.max.z <= b.max.z;
            o.userData.__cut = overlaps && !inside;
          });
          sbEdges.position.set((sbox.min.x + sbox.max.x) / 2, (sbox.min.y + sbox.max.y) / 2, (sbox.min.z + sbox.max.z) / 2);
          sbEdges.scale.set(sbox.max.x - sbox.min.x, sbox.max.y - sbox.min.y, sbox.max.z - sbox.min.z);
        }
        sbGroup.visible = !!sbox;
        requestRender();
      };

      // Camera Presets ("Top", "Front", "Iso", "Fit")
      // ---------------- POSES, SMOOTH VIEW CHANGES & VIEWCUBE ----------------
      type Pose = { target: THREE.Vector3; dist: number; phi: number; theta: number; roll: number };
      const currentPose = (): Pose => {
        const off = camera.position.clone().sub(controls.target);
        // same convention as OrbitControls: phi from +Y, theta = atan2(x, z) (never exactly vertical)
        const sph = new THREE.Spherical().setFromVector3(off);
        return { target: controls.target.clone(), dist: Math.max(1, off.length()), phi: sph.phi, theta: sph.theta, roll: viewRoll };
      };
      const poseFromEye = (eye: THREE.Vector3, target: THREE.Vector3): Pose => {
        const off = eye.clone().sub(target);
        const sp = directionToSpherical({ x: off.x, y: off.y, z: off.z }, 0);
        return { target: target.clone(), dist: Math.max(1, off.length()), phi: sp.phi, theta: sp.theta, roll: 0 };
      };
      const applyPose = (p: Pose) => {
        const d = sphericalToDirection(Math.min(Math.PI - POLAR_EPS, Math.max(POLAR_EPS, p.phi)), p.theta);
        controls.target.copy(p.target);
        camera.position.set(p.target.x + d.x * p.dist, p.target.y + d.y * p.dist, p.target.z + d.z * p.dist);
        viewRoll = p.roll;
        controls.update();
      };
      let animId = 0;
      const animateTo = (to: Pose, ms = 450) => {
        cancelAnimationFrame(animId);
        if (camViewRef.current) return;
        const from = currentPose();
        const t0 = performance.now();
        const step = () => {
          const k = Math.min(1, (performance.now() - t0) / ms);
          const e = easeInOut(k);
          applyPose({
            target: from.target.clone().lerp(to.target, e),
            dist: from.dist + (to.dist - from.dist) * e,
            phi: from.phi + (to.phi - from.phi) * e,
            theta: lerpAngle(from.theta, to.theta, e),
            roll: lerpAngle(from.roll, to.roll, e),
          });
          requestRender();
          if (k < 1) animId = requestAnimationFrame(step);
        };
        animId = requestAnimationFrame(step);
      };
      const presetPose = (preset: CameraPreset3D): Pose => {
        const ext = extentsNoCameras(modelRef.current);
        const cx = (ext.minX + ext.maxX) / 2;
        const cz = (ext.minY + ext.maxY) / 2;
        const span = Math.max(260, ext.maxX - ext.minX, ext.maxY - ext.minY);
        const t = new THREE.Vector3(cx, 54, cz);
        const eye = new THREE.Vector3();
        if (preset === 'top') eye.set(cx, span * 1.55, cz + 0.1);
        else if (preset === 'bottom') {
          // look straight up at the underside (footings, piles, slab bottoms)
          const b = new THREE.Box3();
          for (const entry of entityCache.values()) b.expandByObject(entry.obj);
          const low = b.isEmpty() ? -24 : Math.min(-12, b.min.y);
          t.set(cx, low + 1, cz);
          eye.set(cx, low - span * 1.45, cz + 0.1);
        } else if (preset === 'front') eye.set(cx, 64, cz + span * 1.4);
        else if (preset === 'back') eye.set(cx, 64, cz - span * 1.4);
        else if (preset === 'right') eye.set(cx + span * 1.4, 64, cz);
        else if (preset === 'left') eye.set(cx - span * 1.4, 64, cz);
        else eye.set(cx + span * 0.85, span * 0.85, cz + span * 1.05);
        const p = poseFromEye(eye, t);
        if (preset === 'top' || preset === 'bottom') p.theta = cubeSettingsRef.current.frontOffset;
        return p;
      };
      setPresetRef.current = (preset, animate = true) => {
        const p = presetPose(preset);
        if (animate && !camViewRef.current) animateTo(p);
        else {
          cancelAnimationFrame(animId);
          applyPose(p);
          requestRender();
        }
      };
      const homePose = (): Pose => {
        const h = cubeSettingsRef.current.home;
        return h ? poseFromEye(new THREE.Vector3(h.eye.x, h.eye.y, h.eye.z), new THREE.Vector3(h.target.x, h.target.y, h.target.z)) : presetPose('iso');
      };
      const alignedNow = () => {
        const off = camera.position.clone().sub(controls.target);
        return alignedFace({ x: off.x, y: off.y, z: off.z }, cubeSettingsRef.current.frontOffset, 0.6);
      };
      cubeApiRef.current = {
        hotspot: (h) => {
          const cur = currentPose();
          const v = viewForHotspot(h, cubeSettingsRef.current.frontOffset, cur.theta);
          animateTo({ ...cur, phi: v.phi, theta: v.theta, roll: 0 });
        },
        arrow: (a) => {
          camera.updateMatrixWorld();
          const m = camera.matrixWorld.elements;
          const right = { x: m[0], y: m[1], z: m[2] };
          const up = { x: m[4], y: m[5], z: m[6] };
          const f = adjacentFace(a, up, right, cubeSettingsRef.current.frontOffset);
          const cur = currentPose();
          const v = viewForHotspot(faceHotspot(f), cubeSettingsRef.current.frontOffset, cur.theta);
          animateTo({ ...cur, phi: v.phi, theta: v.theta, roll: 0 });
        },
        roll: (cw) => {
          const f = alignedNow();
          if (!f) return;
          const st = rollStep(f, cw);
          const cur = currentPose();
          animateTo({ ...cur, theta: wrapAngle(cur.theta + st.dTheta), roll: wrapAngle(cur.roll + st.dRoll) }, 350);
        },
        orbit: (dx, dy) => {
          cancelAnimationFrame(animId);
          const cur = currentPose();
          applyPose({ ...cur, theta: cur.theta - dx * 0.012, phi: Math.min(Math.PI - POLAR_EPS, Math.max(POLAR_EPS, cur.phi - dy * 0.012)), roll: 0 });
          requestRender();
        },
        compass: (d) => {
          cancelAnimationFrame(animId);
          const cur = currentPose();
          applyPose({ ...cur, theta: rotateAzimuth(cur.theta, d) });
          requestRender();
        },
        cardinal: (c) => {
          const cur = currentPose();
          animateTo({ ...cur, theta: CARDINAL_THETA[c], phi: cur.phi < 0.05 || cur.phi > Math.PI - 0.05 ? Math.PI / 2 - 0.35 : cur.phi, roll: 0 });
        },
        home: () => animateTo(homePose(), 550),
        setHome: () => {
          const t = controls.target;
          const e = camera.position;
          setCubeSettings(saveViewCubeSettings({ home: { eye: { x: e.x, y: e.y, z: e.z }, target: { x: t.x, y: t.y, z: t.z } } }));
        },
        setFront: () => {
          const cur = currentPose();
          setCubeSettings(saveViewCubeSettings({ frontOffset: wrapAngle(cur.theta) }));
          requestRender();
        },
      };
      // a left-drag orbit cancels any roll / running animation (OrbitControls works un-rolled)
      const onOrbitStart = (e: PointerEvent) => {
        if (e.button === 0 && !e.shiftKey && !e.ctrlKey && !e.metaKey && controls.mouseButtons.LEFT === THREE.MOUSE.ROTATE) {
          cancelAnimationFrame(animId);
          viewRoll = 0;
        }
      };
      renderer.domElement.addEventListener('pointerdown', onOrbitStart);

      (window as unknown as { __af3d?: unknown[] }).__af3d = [...(((window as unknown as { __af3d?: unknown[] }).__af3d) || []), { renderer, scene, dirLight, hemiLight, camera, bimGroup, controls, handles, groundMat, gridHelper, get sbox() { return sbox; }, isOrtho: () => wantOrtho(), get roll() { return viewRoll; } }]; // DEBUG
      rebuildSceneRef.current = rebuildScene;
      rebuildScene();
      setPresetRef.current('iso', false);

      // PNG Export helper
      capturePngRef.current = () => {
        renderFrame();
        return renderer.domElement.toDataURL('image/png');
      };

      renderCamRef.current = (cam, W, H, mime = 'image/png') => {
        const gl = renderer.getContext();
        const maxDim = Math.min(
          renderer.capabilities.maxTextureSize || 4096,
          (gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) as number) || 4096,
          ((gl.getParameter(gl.MAX_VIEWPORT_DIMS) as Int32Array) || [4096])[0]
        );
        const k = Math.min(1, maxDim / Math.max(W, H));
        const w = Math.max(16, Math.floor(W * k));
        const h = Math.max(16, Math.floor(H * k));
        const prevSize = renderer.getSize(new THREE.Vector2());
        const prevPr = renderer.getPixelRatio();
        const prevPos = camera.position.clone();
        const prevTarget = controls.target.clone();
        const prev = { fov: camera.fov, aspect: camera.aspect, near: camera.near, far: camera.far };
        const prevCam = camViewRef.current;
        const prevGrid = gridHelper.visible;
        const prevStyle = { left: renderer.domElement.style.left, top: renderer.domElement.style.top };
        let url: string | null = null;
        try {
          camViewRef.current = cam;
          applyLightingRef.current();
          gridHelper.visible = false;
          renderer.setPixelRatio(1);
          renderer.setSize(w, h, false);
          camera.aspect = w / h;
          setPose(cam);
          applyCameraProjection(cam);
          renderer.clippingPlanes = [];
          renderer.render(scene, camera);
          url = renderer.domElement.toDataURL(mime, 0.92);
        } catch {
          url = null;
        } finally {
          camViewRef.current = prevCam;
          applyLightingRef.current();
          gridHelper.visible = prevGrid;
          renderer.setPixelRatio(prevPr);
          renderer.setSize(prevSize.x, prevSize.y);
          renderer.domElement.style.left = prevStyle.left;
          renderer.domElement.style.top = prevStyle.top;
          applyingPose = true;
          camera.position.copy(prevPos);
          controls.target.copy(prevTarget);
          Object.assign(camera, prev);
          camera.updateProjectionMatrix();
          controls.update();
          applyingPose = false;
          requestRender();
        }
        return url;
      };

      let stopWalk: (() => void) | null = null;
      stopWalkRef.current = () => stopWalk?.();
      walkRef.current = (cams, opts = {}) =>
        new Promise<Blob | null>((resolve) => {
          if (!cams.length) return resolve(null);
          stopWalk?.();
          const seconds = opts.seconds ?? walkthroughDuration(cams);
          let recorder: MediaRecorder | null = null;
          const chunks: Blob[] = [];
          if (opts.record && typeof MediaRecorder !== 'undefined' && (renderer.domElement as HTMLCanvasElement).captureStream) {
            try {
              const stream = renderer.domElement.captureStream(30);
              const mimeType = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m)) || '';
              recorder = new MediaRecorder(stream, mimeType ? { mimeType, videoBitsPerSecond: 8_000_000 } : undefined);
              recorder.ondataavailable = (e) => e.data && e.data.size && chunks.push(e.data);
              recorder.start(200);
            } catch {
              recorder = null;
            }
          }
          walking = true;
          controls.enabled = false;
          const first = cams[0];
          const prevCam = camViewRef.current;
          camViewRef.current = { ...(prevCam || first), twoPoint: first.twoPoint, aspect: prevCam?.aspect ?? first.aspect, sun: prevCam?.sun ?? first.sun };
          applyLightingRef.current();
          const t0 = performance.now();
          let done = false;
          const finish = () => {
            if (done) return;
            done = true;
            walking = false;
            stopWalk = null;
            controls.enabled = !previewRef.current;
            camViewRef.current = prevCam;
            walkProgressRef.current(null);
            if (prevCam) {
              setPose(prevCam);
              camDirtyRef.current(false);
            }
            applyLightingRef.current();
            requestRender();
            if (recorder) {
              const r = recorder;
              r.onstop = () => resolve(chunks.length ? new Blob(chunks, { type: 'video/webm' }) : null);
              try {
                r.stop();
              } catch {
                resolve(null);
              }
            } else resolve(null);
          };
          stopWalk = finish;
          const step = () => {
            if (done) return;
            const u = Math.min(1, (performance.now() - t0) / 1000 / Math.max(0.5, seconds));
            const pose = walkthroughPose(cams, u);
            if (pose) {
              applyingPose = true;
              camera.position.set(pose.eye.x, pose.eye.y, pose.eye.z);
              controls.target.set(pose.look.x, pose.look.y, pose.look.z);
              camera.fov = horizontalToVerticalFov(pose.fov, camera.aspect);
              camera.lookAt(controls.target);
              applyingPose = false;
              applyCameraProjection(camViewRef.current || first);
              renderer.clippingPlanes = [];
              renderer.render(scene, camera);
            }
            walkProgressRef.current(u);
            if (u >= 1) {
              // hold the last frame briefly so the recording ends on it
              window.setTimeout(finish, recorder ? 400 : 0);
              return;
            }
            requestAnimationFrame(step);
          };
          requestAnimationFrame(step);
        });

      // Raycasting for 3D click selection synced with 2D
      const raycaster = new THREE.Raycaster();
      const mouse = new THREE.Vector2();
      let downPos = { x: 0, y: 0 };

      const onPointerDown = (e: PointerEvent) => {
        downPos = { x: e.clientX, y: e.clientY };
      };

      const onPointerUp = (e: PointerEvent) => {
        if (previewRef.current) return;
        if (Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y) > 5) {
          return;
        }
        const rect = renderer.domElement.getBoundingClientRect();
        mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

        raycaster.setFromCamera(mouse, viewCam());
        if (suppressClick) return;
        const hits = raycaster.intersectObjects(interactables, false).filter((h) => !sbox || insideSectionBox(h.point, sbox, 0.5));
        if (paintRef.current.on) {
          // only the surface actually under the cursor (never a wall hidden behind the roof)
          const wh = hits.find((h) => !(h.object as THREE.Mesh).material || !((h.object as THREE.Mesh).material as THREE.Material).transparent);
          if (wh?.object.userData?.wallId) paintRef.current.cb?.(wh.object.userData.wallId as string, wh.point.y);
          return;
        }
        if (hits.length > 0) {
          const hitId = hits[0].object.userData?.entityId;
          if (hitId) {
            if (e.shiftKey) {
              const cur = selectedIdsRef.current;
              onSelectIdsRef.current(
                cur.includes(hitId)
                  ? cur.filter((id) => id !== hitId)
                  : [...cur, hitId]
              );
            } else {
              onSelectIdsRef.current([hitId]);
            }
          }
        } else if (!e.shiftKey) {
          onSelectIdsRef.current([]);
        }
      };

      renderer.domElement.addEventListener('pointerdown', onPointerDown);
      renderer.domElement.addEventListener('pointerup', onPointerUp);

      // ---------------- BELOW GRADE NAVIGATION & SECTION BOX HANDLES ----------------
      let suppressClick = false;
      const rayFrom = (e: { clientX: number; clientY: number }) => {
        const rect = renderer.domElement.getBoundingClientRect();
        mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.setFromCamera(mouse, viewCam());
        return raycaster.ray;
      };
      const handleAt = (e: PointerEvent): BoxFace | null => {
        if (!sbox || !sbGroup.visible) return null;
        rayFrom(e);
        const hit = raycaster.intersectObjects([...handles.values()], false)[0];
        return hit ? (hit.object.userData.face as BoxFace) : null;
      };
      let hotHandle: BoxFace | null = null;
      const setHot = (f: BoxFace | null) => {
        if (f === hotHandle) return;
        if (hotHandle) handles.get(hotHandle)!.material = handleMat;
        hotHandle = f;
        if (f) handles.get(f)!.material = handleHotMat;
        renderer.domElement.style.cursor = f ? 'grab' : '';
        requestRender();
      };
      let drag: null | { kind: 'face'; face: BoxFace } | { kind: 'vertical'; lastY: number } = null;
      const onCapturePointerDown = (e: PointerEvent) => {
        if (previewRef.current) return;
        // section box face handle
        if (e.button === 0) {
          const f = handleAt(e);
          if (f) {
            e.stopImmediatePropagation();
            e.preventDefault();
            drag = { kind: 'face', face: f };
            suppressClick = true;
            controls.enabled = false;
            setHot(f);
            renderer.domElement.style.cursor = 'grabbing';
            return;
          }
        }
        // Shift + middle drag: the view moves straight up / down
        if (e.button === 1 && e.shiftKey && !camViewRef.current) {
          e.stopImmediatePropagation();
          e.preventDefault();
          drag = { kind: 'vertical', lastY: e.clientY };
          controls.enabled = false;
          renderer.domElement.style.cursor = 'ns-resize';
        }
      };
      const onWindowPointerMove = (e: PointerEvent) => {
        if (!drag) return;
        if (drag.kind === 'face' && sbox) {
          const r = rayFrom(e);
          const { axis } = faceAxis(drag.face);
          const v = axisValueFromRay(faceCenter(sbox, drag.face), axis, r.origin, r.direction);
          if (v !== null) {
            sbox = dragSectionBoxFace(sbox, drag.face, v);
            applySectionBoxRef.current();
          }
        } else if (drag.kind === 'vertical') {
          const dy = e.clientY - drag.lastY;
          drag.lastY = e.clientY;
          const per = worldPerPixel(camera.position.distanceTo(controls.target), camera.fov, renderer.domElement.clientHeight);
          const next = verticalPan(camera.position, controls.target, -dy, per);
          camera.position.set(next.eye.x, next.eye.y, next.eye.z);
          controls.target.set(next.target.x, next.target.y, next.target.z);
          requestRender();
        }
      };
      const onWindowPointerUp = () => {
        if (!drag) return;
        drag = null;
        controls.enabled = !previewRef.current;
        renderer.domElement.style.cursor = hotHandle ? 'grab' : '';
        controls.update();
        requestRender();
        window.setTimeout(() => (suppressClick = false), 0);
      };
      container.addEventListener('pointerdown', onCapturePointerDown, true);
      window.addEventListener('pointermove', onWindowPointerMove);
      window.addEventListener('pointerup', onWindowPointerUp);

      // HOVER READOUT: what the surface is and its elevation
      let hoverPending = false;
      let lastHoverEvt: PointerEvent | null = null;
      const tip = () => hoverTipRef.current;
      const hideTip = () => {
        const t = tip();
        if (t) t.style.display = 'none';
      };
      const doHover = () => {
        hoverPending = false;
        const e = lastHoverEvt;
        const t = tip();
        if (!e || !t || previewRef.current || walking) return;
        if (e.buttons || drag) {
          hideTip();
          return;
        }
        setHot(handleAt(e));
        if (hotHandle) {
          t.textContent = hotHandle.startsWith('y') ? (hotHandle === 'ymax' ? 'Drag the top down to slice the building' : 'Drag the bottom up') : 'Drag to move this side of the section box';
        } else {
          rayFrom(e);
          const hits = raycaster.intersectObjects(interactables, false);
          const visibleChain = (o: THREE.Object3D) => {
            for (let p: THREE.Object3D | null = o; p; p = p.parent) if (!p.visible) return false;
            return true;
          };
          let best: THREE.Intersection | undefined;
          for (const h of hits) {
            if (!visibleChain(h.object)) continue;
            if (sbox && !insideSectionBox(h.point, sbox, 0.5)) continue;
            const ud = h.object.userData as { __orig?: unknown };
            if (ud.__orig && hits.some((o) => o !== h && !(o.object.userData as { __orig?: unknown }).__orig && (!sbox || insideSectionBox(o.point, sbox, 0.5)))) continue; // X-ray: read through ghosted parts
            best = h;
            break;
          }
          if (!best || !best.face) {
            hideTip();
            return;
          }
          const key = keyOf(best.object) ?? (best.object.userData?.entityId as string | undefined);
          const ent = key ? modelRef.current.entities.find((x) => x.id === key) : undefined;
          const n = best.face.normal.clone().transformDirection(best.object.matrixWorld);
          let part: string | undefined;
          if (ent?.type === 'footing' && ent.kind === 'pilecap') {
            const b = new THREE.Box3().setFromObject(best.object);
            if (b.max.y - b.min.y > ent.thickness + 6 && best.point.y < (b.max.y - ent.thickness - 1)) part = 'pile';
          }
          t.textContent = surfaceReadout(ent, n.y, best.point.y, unitsRef.current, part);
        }
        const rect = container.getBoundingClientRect();
        t.style.display = '';
        t.style.transform = `translate(${Math.round(e.clientX - rect.left + 14)}px, ${Math.round(e.clientY - rect.top + 16)}px)`;
      };
      const onHoverMove = (e: PointerEvent) => {
        lastHoverEvt = e;
        if (!hoverPending) {
          hoverPending = true;
          window.setTimeout(doHover, 40);
        }
      };
      const onHoverLeave = () => {
        lastHoverEvt = null;
        hideTip();
        setHot(null);
        overCanvas = false;
      };
      let overCanvas = false;
      const onHoverEnter = () => (overCanvas = true);
      renderer.domElement.addEventListener('pointermove', onHoverMove);
      renderer.domElement.addEventListener('pointerleave', onHoverLeave);
      renderer.domElement.addEventListener('pointerenter', onHoverEnter);

      // SPACE + drag pans (like the plan); PageUp / PageDown move the view one grid step
      let spacePan = false;
      const isTyping = (t: EventTarget | null) => {
        const el = t as HTMLElement | null;
        return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
      };
      const onNavKeyDown = (e: KeyboardEvent) => {
        if (previewRef.current || isTyping(e.target)) return;
        if (e.code === 'Space' && overCanvas && !camViewRef.current) {
          e.preventDefault();
          if (!spacePan) {
            spacePan = true;
            controls.mouseButtons = { ...controls.mouseButtons, LEFT: THREE.MOUSE.PAN };
            renderer.domElement.style.cursor = 'grab';
          }
          return;
        }
        if ((e.key === 'PageUp' || e.key === 'PageDown') && !camViewRef.current && container.offsetParent !== null) {
          e.preventDefault();
          const next = stepVertical(camera.position, controls.target, e.key === 'PageUp' ? 1 : -1, GRID3D_STEP);
          camera.position.set(next.eye.x, next.eye.y, next.eye.z);
          controls.target.set(next.target.x, next.target.y, next.target.z);
          controls.update();
          requestRender();
        }
      };
      const onNavKeyUp = (e: KeyboardEvent) => {
        if (e.code === 'Space' && spacePan) {
          spacePan = false;
          controls.mouseButtons = { ...controls.mouseButtons, LEFT: THREE.MOUSE.ROTATE };
          renderer.domElement.style.cursor = '';
        }
      };
      window.addEventListener('keydown', onNavKeyDown);
      window.addEventListener('keyup', onNavKeyUp);

      // ISSUE MARKERS: click → zoom there
      zoomToRef.current = (at, entityId) => {
        const dir = new THREE.Vector3().subVectors(camera.position, controls.target);
        if (dir.lengthSq() < 1e-6) dir.set(1, -0.6, 1);
        dir.normalize();
        controls.target.set(at.x, at.z, at.y);
        camera.position.copy(controls.target).add(dir.multiplyScalar(150));
        controls.update();
        if (entityId) onSelectIdsRef.current([entityId]);
        requestRender();
      };

      const resizeObserver = new ResizeObserver(() => {
        const w = container.clientWidth;
        const h = container.clientHeight;
        if (w > 0 && h > 0) {
          fitCanvas();
          requestRender();
        }
      });
      resizeObserver.observe(container);

      // WALK inside a camera view: ↑/↓ forward / back, ←/→ turn, Shift+←/→ step sideways,
      // PgUp / PgDn raise / lower the eye. Shift = bigger steps.
      const onWalkKey = (e: KeyboardEvent) => {
        if (!camViewRef.current || previewRef.current || walking) return;
        const t = e.target as HTMLElement | null;
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
        const keys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown'];
        if (!keys.includes(e.key)) return;
        e.preventDefault();
        e.stopPropagation();
        const stepLen = e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key.startsWith('Page')) ? 48 : 12;
        const fwd = new THREE.Vector3(controls.target.x - camera.position.x, 0, controls.target.z - camera.position.z);
        if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1);
        fwd.normalize();
        const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
        const move = new THREE.Vector3();
        if (e.key === 'ArrowUp') move.copy(fwd).multiplyScalar(stepLen);
        if (e.key === 'ArrowDown') move.copy(fwd).multiplyScalar(-stepLen);
        if (e.key === 'PageUp') move.set(0, stepLen / 2, 0);
        if (e.key === 'PageDown') move.set(0, -stepLen / 2, 0);
        if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && e.shiftKey) move.copy(right).multiplyScalar(e.key === 'ArrowRight' ? 12 : -12);
        if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !e.shiftKey) {
          const a = (e.key === 'ArrowLeft' ? -5 : 5) * DEG3;
          const off = new THREE.Vector3().subVectors(controls.target, camera.position);
          off.applyAxisAngle(new THREE.Vector3(0, 1, 0), -a);
          controls.target.copy(camera.position).add(off);
        }
        camera.position.add(move);
        controls.target.add(move);
        controls.update();
        camDirtyRef.current(true);
        requestRender();
      };
      window.addEventListener('keydown', onWalkKey, true);

      return () => {
        window.removeEventListener('keydown', onWalkKey, true);
        stopWalk?.();
        resizeObserver.disconnect();
        cancelAnimationFrame(frameId);
        clearTimeout(frameId);
        renderer.domElement.removeEventListener('pointerdown', onPointerDown);
        renderer.domElement.removeEventListener('pointerup', onPointerUp);
        renderer.domElement.removeEventListener('pointerdown', onOrbitStart);
        cancelAnimationFrame(animId);
        container.removeEventListener('pointerdown', onCapturePointerDown, true);
        window.removeEventListener('pointermove', onWindowPointerMove);
        window.removeEventListener('pointerup', onWindowPointerUp);
        renderer.domElement.removeEventListener('pointermove', onHoverMove);
        renderer.domElement.removeEventListener('pointerleave', onHoverLeave);
        renderer.domElement.removeEventListener('pointerenter', onHoverEnter);
        window.removeEventListener('keydown', onNavKeyDown);
        window.removeEventListener('keyup', onNavKeyUp);
        controls.dispose();
        renderer.dispose();
        if (renderer.domElement.parentNode === container) {
          container.removeChild(renderer.domElement);
        }
      };
    }, []);

    // Trigger scene rebuild whenever model, selection, darkMode, or temporary hide/isolate updates
    useEffect(() => {
      rebuildSceneRef.current();
    }, [model, selectedIds, darkMode, tempHiddenIds, tempIsolatedIds, discipline, viewRebar, analytical]);

    // CAMERA view: (re)apply the saved pose whenever the camera itself changes
    const poseSig = camPoseSig(cameraView);
    useEffect(() => {
      applyCamRef.current(camViewRef.current);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [poseSig]);
    const liveSunSig = sunSig(effectiveCam);
    useEffect(() => {
      applyLightingRef.current();
    }, [liveSunSig]);
    useEffect(() => {
      setSunDraft(null);
      setSunOpen(false);
      setExportOpen(false);
    }, [cameraView?.id]);

    // BELOW GRADE: ground / X-ray / section box changes only touch materials and clip planes
    const xrayOn = ground.xray;
    useEffect(() => {
      applyXrayRef.current();
    }, [xrayOn, cameraView?.id]);
    useEffect(() => {
      requestRenderRef.current();
    }, [ground.opacity, ground.hidden, issuesOpen, issues]);
    useEffect(() => {
      applySectionBoxRef.current();
    }, [sectionBox]);
    // VIEWCUBE: projection / front changes redraw; a request from the plan's cube runs once
    useEffect(() => {
      requestRenderRef.current();
    }, [cubeSettings, viewCube]);
    const lastRequest = useRef(0);
    useEffect(() => {
      if (!viewRequest || viewRequest.nonce === lastRequest.current) return;
      lastRequest.current = viewRequest.nonce;
      const api = cubeApiRef.current;
      if (!api) return;
      if (viewRequest.kind === 'hotspot') api.hotspot(viewRequest.h);
      else if (viewRequest.kind === 'cardinal') api.cardinal(viewRequest.c);
      else api.home();
    }, [viewRequest]);

    const autoGroundOpacity = groundAppearance(1e6, { ...DEFAULT_GROUND_STATE }, discipline !== 'architectural' && model.entities.some((e) => e.type === 'footing' || (e.type === 'floor' && e.foundation))).opacity;
    const sun: CameraSun = effectiveCam?.sun ?? DEFAULT_SUN;
    const commitSun = (next: CameraSun, label: string) => {
      setSunDraft(null);
      if (cameraView && onCameraChange) onCameraChange({ ...cameraView, sun: next }, label);
    };
    const saveView = () => {
      const p = readPoseRef.current();
      if (!cameraView || !p || !onSaveCameraView) return;
      onSaveCameraView(cameraFromEye3D(cameraView, p.eye, p.look));
      setCamDirty(false);
    };
    const exportPng = (scale: 1 | 2 | 4) => {
      if (!cameraView) return;
      const a = aspectRatio(cameraView.aspect);
      const W = Math.round(CAMERA_EXPORT_BASE_PX * scale * (a >= 1 ? 1 : a));
      const H = Math.round(W / a);
      const p = readPoseRef.current();
      const cam = p && camDirty ? cameraFromEye3D(effectiveCam!, p.eye, p.look) : effectiveCam!;
      const url = renderCamRef.current(cam, W, H, 'image/png');
      setExportOpen(false);
      if (!url) {
        onLog?.('Camera PNG export failed (the graphics card could not render that size).', 'error');
        return;
      }
      const link = document.createElement('a');
      link.href = url;
      link.download = `${(cameraView.name || 'camera').replace(/[^a-z0-9-_]+/gi, '_').toLowerCase()}_${scale}x.png`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      const img = new Image();
      img.onload = () => onLog?.(`Exported ${cameraView.name} as PNG (${img.width} × ${img.height} px, ${scale}×).`, 'result');
      img.src = url;
    };

    if (preview) {
      return (
        <div className="relative w-full h-full overflow-hidden select-none bg-stone-900" data-testid="camera-preview-3d">
          <div ref={mountRef} className="w-full h-full relative" />
        </div>
      );
    }

    const btn = `px-2 py-1 rounded text-[11px] font-semibold cursor-pointer inline-flex items-center gap-1 ${darkMode ? 'bg-stone-800 hover:bg-stone-700 text-stone-100' : 'bg-stone-100 hover:bg-stone-200 text-stone-800'}`;
    const panel = darkMode ? 'bg-stone-900/95 border-stone-700 text-stone-100' : 'bg-white/95 border-stone-200 text-stone-800';
    const sp = effectiveCam?.sun?.enabled ? sunPosition(sun.latitude, dayOfYear(sun.month, sun.day), sun.hour) : null;
    return (
      <div className={`relative w-full h-full overflow-hidden select-none ${cameraView ? 'bg-stone-800' : ''}`}>
        {cameraView && (
          <div className="absolute top-2.5 left-3 right-3 z-20 flex flex-wrap items-start gap-2 pointer-events-none">
            <div data-testid="camera-view-bar" className={`pointer-events-auto flex flex-wrap items-center gap-1.5 px-2 py-1.5 rounded-lg border shadow-md ${panel}`}>
              <CameraIcon className="w-4 h-4 text-blue-600" />
              <span className="text-xs font-bold">{cameraView.name}</span>
              <span className="text-[11px] font-mono text-stone-500" data-testid="camera-view-fov">
                {fovLabel(cameraView.fov)} · {CAMERA_ASPECTS.find((a) => a.id === cameraView.aspect)?.label ?? cameraView.aspect}
                {cameraView.twoPoint !== false ? ' · 2-point' : ''}
              </span>
              {camDirty && <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-700 dark:text-amber-300 font-semibold">moved — not saved</span>}
              <button type="button" className={btn} aria-label="Save camera view" title="Store the current position and direction in this camera" disabled={!camDirty} style={{ opacity: camDirty ? 1 : 0.5 }} onClick={saveView}>
                <Save className="w-3.5 h-3.5" /> Save view
              </button>
              <button type="button" className={btn} aria-label="Reset camera view" title="Go back to the saved camera position" onClick={() => applyCamRef.current(camViewRef.current)}>
                <RotateCcw className="w-3.5 h-3.5" /> Reset
              </button>
              <button type="button" className={`${btn} ${sun.enabled ? '!bg-amber-500 !text-white' : ''}`} aria-label="Sun settings" aria-pressed={!!effectiveCam?.sun?.enabled} onClick={() => setSunOpen((v) => !v)}>
                <SunIcon className="w-3.5 h-3.5" /> Sun
              </button>
              <div className="relative">
                <button type="button" className={btn} aria-label="Export camera PNG" onClick={() => setExportOpen((v) => !v)}>
                  <Download className="w-3.5 h-3.5" /> PNG ▾
                </button>
                {exportOpen && (
                  <div className={`absolute left-0 top-full mt-1 w-44 rounded-lg border shadow-lg p-1 z-30 ${panel}`} data-testid="camera-export-menu">
                    {([1, 2, 4] as const).map((k) => {
                      const a = aspectRatio(cameraView.aspect);
                      const W = Math.round(CAMERA_EXPORT_BASE_PX * k * (a >= 1 ? 1 : a));
                      return (
                        <button key={k} type="button" aria-label={`Export PNG ${k}x`} className={`w-full text-left px-2 py-1 rounded text-xs hover:bg-amber-500 hover:text-white`} onClick={() => exportPng(k)}>
                          <b>{k}×</b> <span className="font-mono text-[11px]">{W} × {Math.round(W / a)} px</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
              {onCloseCameraView && (
                <button type="button" className={btn} aria-label="Close camera view" title="Back to the free 3D view" onClick={onCloseCameraView}>
                  <X className="w-3.5 h-3.5" /> 3D
                </button>
              )}
            </div>
            {sunOpen && (
              <div data-testid="camera-sun-panel" className={`pointer-events-auto w-64 px-3 py-2 rounded-lg border shadow-md text-xs space-y-2 ${panel}`}>
                <label className="flex items-center gap-2 font-semibold">
                  <input type="checkbox" aria-label="Sun and shadows" checked={!!sun.enabled} onChange={(e) => commitSun({ ...sun, enabled: e.target.checked }, e.target.checked ? 'Camera Sun On' : 'Camera Sun Off')} />
                  Sun &amp; shadows
                </label>
                <label className="flex items-center justify-between gap-2">
                  <span>Date</span>
                  <input
                    type="date"
                    aria-label="Sun date"
                    className="px-1 py-0.5 rounded border border-stone-300 dark:border-stone-700 bg-transparent"
                    value={`2026-${String(sun.month).padStart(2, '0')}-${String(sun.day).padStart(2, '0')}`}
                    onChange={(e) => {
                      const [, m, dd] = e.target.value.split('-').map(Number);
                      if (m && dd) commitSun({ ...sun, enabled: true, month: m, day: dd }, 'Camera Sun Date');
                    }}
                  />
                </label>
                <div>
                  <div className="flex justify-between"><span>Time of day</span><b data-testid="camera-sun-time">{formatSunTime(sun.hour)}</b></div>
                  <input
                    type="range"
                    aria-label="Time of day"
                    min={5}
                    max={21}
                    step={0.25}
                    value={sun.hour}
                    className="w-full accent-amber-500"
                    onChange={(e) => setSunDraft({ ...sun, enabled: true, hour: Number(e.target.value) })}
                    onPointerUp={(e) => commitSun({ ...sun, enabled: true, hour: Number((e.target as HTMLInputElement).value) }, 'Camera Sun Time')}
                    onKeyUp={(e) => commitSun({ ...sun, enabled: true, hour: Number((e.target as HTMLInputElement).value) }, 'Camera Sun Time')}
                  />
                </div>
                {sp && (
                  <div className="text-[11px] text-stone-500 font-mono">
                    sun {Math.round(sp.altitude)}° high · from {Math.round(sp.azimuth)}° {sp.altitude <= 0 ? '(below horizon)' : ''}
                  </div>
                )}
                <details>
                  <summary className="cursor-pointer text-amber-600">More…</summary>
                  <label className="flex items-center justify-between gap-2 mt-1">
                    <span>Latitude (°N)</span>
                    <input
                      type="number"
                      aria-label="Sun latitude"
                      className="w-20 px-1 py-0.5 rounded border border-stone-300 dark:border-stone-700 bg-transparent"
                      value={sun.latitude}
                      min={-90}
                      max={90}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        if (Number.isFinite(v)) commitSun({ ...sun, latitude: Math.max(-90, Math.min(90, v)) }, 'Camera Sun Latitude');
                      }}
                    />
                  </label>
                  <p className="text-[10px] text-stone-500 mt-1">Plan north is up. Time is local solar time.</p>
                </details>
              </div>
            )}
          </div>
        )}
        {/* Top-Left Stacked Levels & Temp Hide/Isolate Banner */}
        <div className={`absolute top-2.5 left-3 z-10 flex items-center gap-2 pointer-events-auto ${cameraView ? 'hidden' : ''}`}>
          <div
            className={`px-2 py-1 rounded border text-[11px] font-mono font-medium shadow-xs ${
              darkMode
                ? 'bg-stone-900/90 border-stone-800 text-stone-300'
                : 'bg-white/90 border-stone-300 text-stone-700'
            }`}
          >
            3D BIM: <span className="font-bold text-amber-600 dark:text-amber-400">All Levels Stacked ({(model.levels ?? []).length})</span>
          </div>
          {(tempHiddenIds.length > 0 || tempIsolatedIds.length > 0) && (
            <div className="flex items-center gap-2 px-2.5 py-1 rounded border border-cyan-500/60 bg-cyan-950/90 text-cyan-200 text-[11px] font-mono shadow-sm">
              <span>
                {tempIsolatedIds.length > 0
                  ? `ISOLATED (${tempIsolatedIds.length})`
                  : `HIDDEN (${tempHiddenIds.length})`}
              </span>
              {onResetTempHideIsolate && (
                <button
                  type="button"
                  aria-label="Reset temporary hide or isolate"
                  onClick={onResetTempHideIsolate}
                  className="px-1.5 py-0.5 rounded bg-cyan-600 hover:bg-cyan-500 text-white font-sans font-semibold text-[10px]"
                >
                  Reset (HR)
                </button>
              )}
            </div>
          )}
        </div>

        {/* Dedicated empty mount ref for Three.js WebGL canvas */}
        <div
          ref={mountRef}
          data-testid="cad-3d-canvas"
          className="w-full h-full"
        />

        {/* BELOW GRADE badge (text set by the render loop) */}
        <div
          ref={badgeRef}
          data-testid="below-grade-badge"
          style={{ display: 'none' }}
          className="absolute top-12 left-1/2 -translate-x-1/2 z-10 px-2.5 py-1 rounded-full bg-amber-900/90 text-amber-50 text-[11px] font-mono font-semibold shadow-md pointer-events-none whitespace-nowrap"
        />
        {/* HOVER readout */}
        <div
          ref={hoverTipRef}
          data-testid="hover-readout"
          style={{ display: 'none', left: 0, top: 0 }}
          className={`absolute z-20 px-2 py-0.5 rounded border text-[11px] font-mono shadow-md pointer-events-none whitespace-pre ${panel}`}
        />
        {/* ISSUE markers (positions set by the render loop) */}
        <div ref={markersRef} className="absolute inset-0 z-10 pointer-events-none" data-testid="issue-markers" style={{ display: 'none' }}>
          {issues.map((it) => (
            <button
              key={it.id}
              type="button"
              data-x={it.at.x}
              data-y={it.at.y}
              data-z={it.at.z}
              data-testid={`issue-marker-${it.id}`}
              aria-label={`Issue: ${it.message}`}
              title={`${it.message} — click to zoom there`}
              onClick={() => zoomToRef.current(it.at, it.entityId)}
              className="absolute left-0 top-0 -ml-2.5 -mt-2.5 w-5 h-5 rounded-full bg-orange-500 border-2 border-white text-white text-[10px] font-bold leading-none shadow-md pointer-events-auto cursor-pointer flex items-center justify-center hover:scale-125 transition-transform"
              style={{ display: 'none' }}
            >
              !
            </button>
          ))}
        </div>
        {/* VIEWCUBE (NAVVCUBE) — free 3D view only */}
        {viewCube && !cameraView && (
          <ViewCube
            ref={viewCubeRef}
            darkMode={darkMode}
            projection={cubeSettings.projection}
            onHotspot={(h) => cubeApiRef.current?.hotspot(h)}
            onArrow={(a) => cubeApiRef.current?.arrow(a)}
            onRoll={(cw) => cubeApiRef.current?.roll(cw)}
            onOrbitDrag={(dx, dy) => cubeApiRef.current?.orbit(dx, dy)}
            onCompassRotate={(d) => cubeApiRef.current?.compass(d)}
            onCardinal={(c) => cubeApiRef.current?.cardinal(c)}
            onHome={() => cubeApiRef.current?.home()}
            onSetProjection={(p: Projection) => {
              setCubeSettings(saveViewCubeSettings({ projection: p }));
              onLog?.(`ViewCube: ${p === 'orthographic' ? 'orthographic' : p === 'perspective' ? 'perspective' : 'perspective with orthographic face views'} projection.`, 'info');
            }}
            onSetHome={() => {
              cubeApiRef.current?.setHome();
              onLog?.('ViewCube: the current view is now Home.', 'result');
            }}
            onSetFront={() => {
              cubeApiRef.current?.setFront();
              onLog?.('ViewCube: FRONT now looks from the current direction.', 'result');
            }}
            onResetFront={() => {
              setCubeSettings(saveViewCubeSettings({ frontOffset: 0 }));
              onLog?.('ViewCube: FRONT reset to south.', 'info');
            }}
          />
        )}
        {walkProgress !== null && (
          <div data-testid="walkthrough-progress" className={`absolute bottom-16 left-1/2 -translate-x-1/2 z-20 w-80 px-3 py-2 rounded-lg border shadow-md text-xs ${panel}`}>
            <div className="flex items-center justify-between mb-1">
              <b>Walkthrough</b>
              <button type="button" className={btn} aria-label="Stop walkthrough" onClick={() => stopWalkRef.current()}>Stop</button>
            </div>
            <div className="h-1.5 rounded bg-stone-300 dark:bg-stone-700 overflow-hidden">
              <div className="h-full bg-blue-600" style={{ width: `${Math.round(walkProgress * 100)}%` }} />
            </div>
          </div>
        )}
        {cameraView && (
          <div className={`absolute bottom-4 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded-lg border shadow-md text-[11px] whitespace-nowrap z-10 ${panel}`} data-testid="camera-walk-hint">
            Drag = look around · ↑ ↓ walk · ← → turn · Shift+← → sidestep · PgUp / PgDn height · then <b>Save view</b>
          </div>
        )}
        {/* Bottom-Center Camera Preset Dock (Top, Front, Iso, Fit) */}
        <div
          style={cameraView ? { display: 'none' } : undefined}
          className={`absolute bottom-4 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded-lg border shadow-md flex items-center gap-1.5 whitespace-nowrap z-10 ${
            darkMode
              ? 'bg-stone-900/95 border-stone-700 text-stone-100'
              : 'bg-white/95 border-stone-200 text-stone-800'
          }`}
        >
          <span className="text-[11px] font-semibold text-stone-400 mr-1 whitespace-nowrap">
            3D View:
          </span>
          {(
            [
              { id: 'top', label: 'Top' },
              { id: 'bottom', label: 'Bottom' },
              { id: 'front', label: 'Front' },
              { id: 'iso', label: 'Iso' },
              { id: 'fit', label: 'Fit' },
            ] as const
          ).map((btn) => (
            <button
              key={btn.id}
              type="button"
              aria-label={`Set 3D camera to ${btn.label} view`}
              onClick={() => setPresetRef.current(btn.id)}
              className={`px-2.5 py-1 rounded text-xs font-semibold transition-colors cursor-pointer ${
                darkMode
                  ? 'hover:bg-amber-600 hover:text-white bg-stone-800 text-stone-200'
                  : 'hover:bg-amber-600 hover:text-white bg-stone-100 text-stone-700'
              }`}
              title={`Set 3D camera to ${btn.label} view`}
            >
              {btn.label}
            </button>
          ))}
          {discipline !== 'architectural' && onToggleViewRebar && (
            <button
              type="button"
              aria-pressed={viewRebar}
              aria-label="View rebar"
              onClick={onToggleViewRebar}
              title="View rebar (VR): concrete hosts turn semi-transparent; bars show as rods coloured by size"
              className={`ml-1 px-2.5 py-1 rounded text-xs font-semibold cursor-pointer ${viewRebar ? 'bg-red-700 text-white' : darkMode ? 'bg-stone-800 text-stone-200' : 'bg-stone-100 text-stone-700'}`}
            >
              View rebar
            </button>
          )}
          {discipline !== 'architectural' && onToggleAnalytical && (
            <button
              type="button"
              aria-pressed={analytical}
              aria-label="Analytical view"
              onClick={onToggleAnalytical}
              title="Analytical view (AN): centrelines, nodes, supports and loads"
              className={`px-2.5 py-1 rounded text-xs font-semibold cursor-pointer ${analytical ? 'bg-purple-600 text-white' : darkMode ? 'bg-stone-800 text-stone-200' : 'bg-stone-100 text-stone-700'}`}
            >
              Analytical
            </button>
          )}
          <span className="w-px h-5 bg-stone-300 dark:bg-stone-700 mx-1" />
          <div className="relative">
            <button
              type="button"
              aria-label="Ground settings"
              aria-expanded={groundOpen}
              title="Ground: opacity, hide, X-ray"
              onClick={() => {
                setGroundOpen((v) => !v);
                setIssuesOpen(false);
              }}
              className={`px-2.5 py-1 rounded text-xs font-semibold cursor-pointer inline-flex items-center gap-1 ${
                ground.hidden || ground.xray || ground.opacity !== null ? 'bg-amber-600 text-white' : darkMode ? 'bg-stone-800 text-stone-200' : 'bg-stone-100 text-stone-700'
              }`}
            >
              <LayersIcon className="w-3.5 h-3.5" /> Ground ▾
            </button>
            {groundOpen && (
              <div data-testid="ground-popover" className={`absolute bottom-full mb-2 left-1/2 -translate-x-1/2 w-60 px-3 py-2.5 rounded-lg border shadow-lg text-xs space-y-2 whitespace-normal ${panel}`}>
                <div>
                  <div className="flex justify-between">
                    <span>Ground opacity</span>
                    <b className="font-mono" data-testid="ground-opacity-value">{ground.opacity === null ? `Auto (${Math.round(autoGroundOpacity * 100)}%)` : `${Math.round(ground.opacity * 100)}%`}</b>
                  </div>
                  <input
                    type="range"
                    aria-label="Ground opacity"
                    min={0}
                    max={100}
                    step={5}
                    value={Math.round((ground.opacity ?? autoGroundOpacity) * 100)}
                    className="w-full accent-amber-500"
                    onChange={(e) => onGroundChange?.({ ...ground, opacity: Number(e.target.value) / 100 })}
                  />
                  {ground.opacity !== null && (
                    <button type="button" className="text-[10px] text-amber-600 underline cursor-pointer" onClick={() => onGroundChange?.({ ...ground, opacity: null })}>
                      Back to automatic
                    </button>
                  )}
                </div>
                <label className="flex items-center gap-2">
                  <input type="checkbox" aria-label="Hide ground" checked={ground.hidden} onChange={(e) => onGroundChange?.({ ...ground, hidden: e.target.checked })} />
                  Hide ground
                </label>
                <label className="flex items-center gap-2" title="Everything above grade turns see-through so foundations and structure stand out">
                  <input type="checkbox" aria-label="X-ray" checked={ground.xray} onChange={(e) => onGroundChange?.({ ...ground, xray: e.target.checked })} />
                  X-ray (above grade see-through)
                </label>
                <p className="text-[10px] text-stone-500 leading-snug">
                  Orbit under the grid to look up at footings and slabs — the ground fades to 15% automatically. Shift + middle-drag or PgUp / PgDn moves the view up / down.
                </p>
              </div>
            )}
          </div>
          <button
            type="button"
            aria-pressed={sectionBox}
            aria-label="Section box"
            onClick={onToggleSectionBox}
            title="Section box (BX): drag the blue handles to cut the model — pull the top down to look into the foundations"
            className={`px-2.5 py-1 rounded text-xs font-semibold cursor-pointer inline-flex items-center gap-1 ${sectionBox ? 'bg-sky-600 text-white' : darkMode ? 'bg-stone-800 text-stone-200' : 'bg-stone-100 text-stone-700'}`}
          >
            <BoxIcon className="w-3.5 h-3.5" /> Section box
          </button>
          <div className="relative">
            <button
              type="button"
              aria-label="Below-grade issues"
              aria-expanded={issuesOpen}
              title="Checks under the building: footings, column bases, wall footings, slab support, floating elements"
              onClick={() => {
                setIssuesOpen((v) => !v);
                setGroundOpen(false);
              }}
              className={`px-2.5 py-1 rounded text-xs font-semibold cursor-pointer inline-flex items-center gap-1 ${
                issues.length ? 'bg-orange-500 text-white' : darkMode ? 'bg-stone-800 text-stone-200' : 'bg-stone-100 text-stone-700'
              }`}
            >
              <AlertTriangle className="w-3.5 h-3.5" /> Issues <span data-testid="issues-count" className="font-mono">{issues.length}</span>
            </button>
            {issuesOpen && (
              <div data-testid="issues-popover" className={`absolute bottom-full mb-2 right-0 w-80 max-h-80 overflow-auto px-3 py-2.5 rounded-lg border shadow-lg text-xs whitespace-normal ${panel}`}>
                <div className="font-bold mb-1">Below-grade checks</div>
                {issues.length === 0 ? (
                  <div className="text-green-700 dark:text-green-400">No issues: every column has a footing and every slab and wall sits on something.</div>
                ) : (
                  <>
                    <div className="flex flex-wrap gap-1 mb-2">
                      {issueCounts(issues).map((c) => (
                        <span key={c.kind} className="px-1.5 py-0.5 rounded bg-orange-500/15 text-orange-700 dark:text-orange-300 font-semibold">
                          {c.label}: {c.count}
                        </span>
                      ))}
                    </div>
                    <ul className="space-y-0.5">
                      {issues.map((it) => (
                        <li key={it.id}>
                          <button
                            type="button"
                            className="w-full text-left px-1.5 py-1 rounded hover:bg-orange-500/15 cursor-pointer flex items-start gap-1.5"
                            onClick={() => zoomToRef.current(it.at, it.entityId)}
                            title="Zoom there and select it"
                          >
                            <span className="mt-0.5 w-2.5 h-2.5 rounded-full bg-orange-500 shrink-0" />
                            <span>
                              {it.message} <span className="text-stone-500 font-mono">@ {formatElevation(it.at.z, model.settings.units)}</span>
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }
);
