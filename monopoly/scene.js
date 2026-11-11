// Istanbul Exchange's locally rendered architectural board.
// Three.js 0.186.1 (MIT) is pinned in vendor/; there are no remote assets.
import * as THREE from './vendor/three.module.js';
import { BOARD, SPACE_ICONS, spaceLabel } from './board.js?v=20261111-4';
import { DICE_MS, STEP_MS } from './graphics.js?v=20261111-4';

const TOKEN_NAMES = ['ferry', 'cat', 'tower', 'tulip', 'tea', 'tram'];
const PI = Math.PI;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const ease = value => 1 - (1 - value) ** 3;
const top = .28;
const DICE = DICE_MS['3d'], STEP = STEP_MS['3d'], SIM_HZ = 120, DIE = .43;
const spread = amount => (Math.random() - .5) * 2 * amount;
// Board surface height under a die: the city disc, the inner field, then the tile ring.
const floorAt = (x, z) => Math.hypot(x, z + .95) < 2.63 ? .312 : Math.max(Math.abs(x), Math.abs(z)) < 4.42 ? .255 : top;
const HULL = new THREE.Shape();
HULL.moveTo(0, .31); HULL.quadraticCurveTo(.16, .12, .13, -.12); HULL.quadraticCurveTo(.12, -.28, 0, -.29);
HULL.quadraticCurveTo(-.12, -.28, -.13, -.12); HULL.quadraticCurveTo(-.16, .12, 0, .31);

// A box with one smooth-shaded chamfer ring, so small models catch a highlight on every edge.
function roundedBox(width, height, depth, radius, segments = 4) {
  const geometry = new THREE.BoxGeometry(width, height, depth, segments, segments, segments);
  const size = [width, height, depth], position = geometry.attributes.position, normal = geometry.attributes.normal;
  const vertex = new THREE.Vector3(), core = new THREE.Vector3();
  for (let i = 0; i < position.count; i++) {
    vertex.fromBufferAttribute(position, i);
    size.forEach((length, axis) => {
      const value = vertex.getComponent(axis), half = length / 2;
      const inner = Math.abs(value) > half - 1e-6 ? Math.sign(value) * (half - radius) : value * (half - radius) / (half - length / segments);
      core.setComponent(axis, inner);
    });
    vertex.sub(core);
    if (vertex.lengthSq() < 1e-10) vertex.fromBufferAttribute(normal, i); else vertex.normalize();
    normal.setXYZ(i, vertex.x, vertex.y, vertex.z);
    vertex.multiplyScalar(radius).add(core); position.setXYZ(i, vertex.x, vertex.y, vertex.z);
  }
  return geometry;
}
// Height of a cube's centre above the surface it rests on, for any orientation.
const matrix = new THREE.Matrix4();
function support(quaternion) {
  const e = matrix.makeRotationFromQuaternion(quaternion).elements;
  return DIE / 2 * (Math.abs(e[1]) + Math.abs(e[5]) + Math.abs(e[9]));
}
const MONO = "'IBM Plex Mono', ui-monospace, monospace";
const themes = {
  light: { stone: '#c4c4ba', table: '#d6d6cc', background: '#f3f3ee', paper: '#fafaf7', field: '#ecece6', edge: '#bdbdb3', ink: '#1a1a18', city: '#e9e9e2', roof: '#71716a', trim: '#c4c4ba' },
  dark: { stone: '#b9b8ae', table: '#0e0e0d', background: '#1b1b18', paper: '#2e2e2a', field: '#232320', edge: '#121211', ink: '#e6e6e1', city: '#aaa99f', roof: '#55554f', trim: '#6b6b64' },
};
const palettes = {
  stone: { water: '#819b9a', land: '#d5ccb9', leaf: '#87927b', accent: '#b17e57' },
  bosphorus: { water: '#679fa8', land: '#cecbb9', leaf: '#6f9685', accent: '#688f9b' },
  terracotta: { water: '#849990', land: '#dbbda3', leaf: '#8b9774', accent: '#b46f51' },
};

function pointAt(index) {
  index = ((index % 40) + 40) % 40;
  if (index <= 10) return new THREE.Vector3(5 - index, top, 5);
  if (index <= 20) return new THREE.Vector3(-5, top, 15 - index);
  if (index <= 30) return new THREE.Vector3(index - 25, top, -5);
  return new THREE.Vector3(5, top, index - 35);
}

function tileRotation(index) {
  return index < 10 ? 0 : index < 20 ? PI / 2 : index < 30 ? PI : -PI / 2;
}

function canvasTexture(width, height, draw) {
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas graphics are unavailable.');
  draw(context, width, height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8; // keeps tile text legible at the table's shallow viewing angle
  return texture;
}

function wrapText(context, text, maxWidth) {
  const lines = [];
  let line = '';
  for (const word of text.split(' ')) {
    const next = line ? line + ' ' + word : word;
    if (line && context.measureText(next).width > maxWidth) { lines.push(line); line = word; }
    else line = next;
  }
  lines.push(line);
  return lines;
}

/** A demand-rendered WebGL2 board. The surrounding HTML remains the accessible UI. */
export class BoardScene {
  constructor(container, { onSelect = () => {}, onReady, onError, onAnimationStart, onAnimationEnd } = {}) {
    this.container = container;
    this.callbacks = { onSelect, onReady, onError, onAnimationStart, onAnimationEnd };
    this.options = { selected: 1, theme: 'light', palette: 'stone', reducedMotion: false, animate: true };
    this.materials = new Map();
    this.geometries = new Map();
    this.tokens = new Map();
    this.avatars = new Map();
    this.obstacles = [];
    this.assets = new Map();
    this.deeds = new Map();
    this.focus = new THREE.Vector3(0, .28, .48); this.focusTarget = this.focus.clone(); this.focusZoom = 1; this.focusZoomTarget = 1;
    this.animations = [];
    this.listeners = [];
    this.state = null;
    this.destroyed = false;
    this.failed = false;
    this.frame = 0;
    this.actionId = null;
    this.visualKey = '';
    this.cameraState = { azimuth: .28, elevation: .88, zoom: 1 };
    this.targetCamera = { ...this.cameraState };
    this.pointer = null;
    this.raycaster = new THREE.Raycaster();
    this.pointerVector = new THREE.Vector2();
    try {
      this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'low-power' });
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.7));
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = 1.10;
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      this.renderer.shadowMap.autoUpdate = false;
      const canvas = this.renderer.domElement;
      canvas.style.cssText = 'display:block;width:100%;height:100%;touch-action:none;outline:none;cursor:grab';
      canvas.setAttribute('aria-hidden', 'true');
      canvas.dataset.boardCanvas = '3d';
      this.container.appendChild(canvas);
      this.scene = new THREE.Scene();
      this.camera = new THREE.PerspectiveCamera(39, 1, .1, 90);
      this.scene.add(new THREE.HemisphereLight('#fff7e6', '#7c8b8c', 1.25));
      // A tiny studio of light panels gives the metal pieces and dice something to reflect.
      const pmrem = new THREE.PMREMGenerator(this.renderer), studio = new THREE.Scene();
      studio.background = new THREE.Color('#6d7276');
      for (const [color, x, y, z, w, h, d] of [['#ffffff', 0, 9, 0, 12, .2, 12], ['#ffe6c4', -10, 3, 3, .2, 7, 9], ['#cfe1f0', 10, 3, -3, .2, 7, 9]]) {
        const panel = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshBasicMaterial({ color })); panel.position.set(x, y, z); studio.add(panel);
      }
      this.scene.environment = pmrem.fromScene(studio, .03).texture; this.scene.environmentIntensity = .6; pmrem.dispose();
      this.sun = new THREE.DirectionalLight('#fff4df', 2.6);
      this.sun.position.set(-7, 15, 9);
      this.sun.castShadow = true;
      Object.assign(this.sun.shadow.camera, { left: -11, right: 11, top: 11, bottom: -11, near: .5, far: 44 });
      this.sun.shadow.mapSize.set(2048, 2048);
      this.sun.shadow.bias = -.0005;
      this.sun.shadow.normalBias = .025;
      this.scene.add(this.sun);
      const fill = new THREE.DirectionalLight('#d3e2eb', .9);
      fill.position.set(5, 7, -9); this.scene.add(fill);
      this.board = new THREE.Group(); this.scene.add(this.board);
      this.tokenLayer = new THREE.Group(); this.scene.add(this.tokenLayer);
      this.effectLayer = new THREE.Group(); this.scene.add(this.effectLayer);
      this.avatarLayer = new THREE.Group(); this.scene.add(this.avatarLayer);
      this.deedLayer = new THREE.Group(); this.scene.add(this.deedLayer);
      this.buildStatic();
      this.visualKey = this.options.theme + ':' + this.options.palette;
      this.bindControls();
      this.observer = new ResizeObserver(() => this.resize());
      this.observer.observe(this.container);
      this.resize();
      this.update(null);
      this.callbacks.onReady?.();
    } catch (error) {
      this.failed = true;
      this.renderer?.dispose();
      this.renderer?.domElement.remove();
      this.callbacks.onError?.(error);
    }
  }

  material(color, { metalness = 0, roughness = .84, ...extra } = {}) {
    const key = JSON.stringify([color, metalness, roughness, extra]);
    if (!this.materials.has(key)) this.materials.set(key, new THREE.MeshStandardMaterial({ color, metalness, roughness, ...extra }));
    return this.materials.get(key);
  }

  geometry(type, args) {
    const key = type + JSON.stringify(args);
    if (!this.geometries.has(key)) this.geometries.set(key, type === 'RoundedBox' ? roundedBox(...args) : new THREE[type](...args));
    return this.geometries.get(key);
  }

  mesh(parent, type, args, color, position = [0, 0, 0], scale) {
    const mesh = new THREE.Mesh(this.geometry(type, args), typeof color === 'string' ? this.material(color) : color);
    mesh.position.set(...position);
    if (scale) mesh.scale.set(...scale);
    mesh.castShadow = true; mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  box(parent, size, color, position) { return this.mesh(parent, 'BoxGeometry', size, color, position); }
  cylinder(parent, radii, color, position) { return this.mesh(parent, 'CylinderGeometry', radii, color, position); }
  sphere(parent, radius, color, position, scale) { return this.mesh(parent, 'SphereGeometry', [radius, 32, 20], color, position, scale); }

  rbox(parent, size, color, position, radius = .02) { return this.mesh(parent, 'RoundedBox', [...size, radius, 4], color, position); }
  lathe(parent, profile, color, position, segments = 40) { return this.mesh(parent, 'LatheGeometry', [profile.map(([x, y]) => new THREE.Vector2(x, y)), segments], color, position); }

  label(parent, width, height, texture, position, rotation = 0) {
    const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    const mesh = new THREE.Mesh(this.geometry('PlaneGeometry', [width, height]), material);
    mesh.rotation.set(-PI / 2, 0, rotation);
    mesh.position.set(...position); parent.add(mesh);
    mesh.userData.ownMaterial = true;
    return mesh;
  }

  releaseGroup(group) {
    group.traverse(object => {
      if (object.userData.ownMaterial) {
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
          material?.map?.dispose(); material?.dispose();
        }
      }
      if (object.userData.ownGeometry) object.geometry?.dispose();
    });
    group.clear();
  }

  buildStatic() {
    if (this.board.children.length) this.releaseGroup(this.board);
    this.tiles = []; this.assets.clear();
    const theme = themes[this.options.theme] || themes.light;
    const palette = palettes[this.options.palette] || palettes.stone;
    this.scene.background = new THREE.Color(theme.background);
    this.box(this.board, [14.6, .4, 14.6], theme.table, [0, -.47, 0]);
    this.box(this.board, [11.5, .34, 11.5], theme.edge, [0, -.09, 0]);
    this.box(this.board, [11.37, .13, 11.37], theme.paper, [0, .115, 0]);
    this.box(this.board, [8.84, .10, 8.84], theme.field, [0, .205, 0]);
    // Fine raised border: the board reads as an object, not a tilted screenshot.
    for (const sign of [-1, 1]) {
      this.box(this.board, [11.4, .055, .035], theme.trim, [0, .23, sign * 5.66]);
      this.box(this.board, [.035, .055, 11.4], theme.trim, [sign * 5.66, .23, 0]);
    }
    for (const square of BOARD) {
      const group = new THREE.Group(); group.position.copy(pointAt(square.index)); group.rotation.y = tileRotation(square.index);
      const base = this.box(group, [.97, .07, .97], theme.paper, [0, -.035, 0]);
      base.userData.space = square.index;
      if (square.color) this.box(group, [.965, .018, .16], square.color, [0, .009, -.398]);
      const texture = this.tileTexture(square, theme);
      const label = this.label(group, .92, .92, texture, [0, .012, 0]);
      label.userData.space = square.index;
      const ownerMarker = this.box(group, [.8, .028, .047], '#888888', [0, .015, .44]);
      ownerMarker.visible = false;
      const buildings = new THREE.Group(); group.add(buildings);
      const selection = new THREE.LineSegments(this.geometry('EdgesGeometry', [this.geometry('BoxGeometry', [.99, .11, .99])]), new THREE.LineBasicMaterial({ color: theme.ink, transparent: true, opacity: .95 }));
      selection.position.y = .008; selection.visible = false; selection.userData.ownMaterial = true; group.add(selection);
      this.tiles.push({ group, base, label, ownerMarker, buildings, selection, houses: 0 });
      this.board.add(group);
    }
    this.makeCity(theme, palette);
    this.makeDice();
    this.renderer.shadowMap.needsUpdate = true;
  }

  tileTexture(square, theme) {
    return canvasTexture(256, 256, context => {
      context.textAlign = 'center'; context.textBaseline = 'middle'; context.fillStyle = theme.ink;
      const special = SPACE_ICONS[square.type];
      const name = spaceLabel(square).toLocaleUpperCase('en');
      const fontSize = name.length > 16 ? 21 : name.length > 10 ? 23 : 26;
      context.font = `600 ${fontSize}px ${MONO}`;
      const lines = wrapText(context, name, 224);
      const startY = special ? 142 : 108;
      if (special) { context.font = '52px Georgia, serif'; context.fillText(special, 128, 79); }
      context.font = `600 ${fontSize}px ${MONO}`;
      lines.forEach((line, index) => context.fillText(line, 128, startY + (index - (lines.length - 1) / 2) * 28));
      context.font = `22px ${MONO}`;
      if (square.price) context.fillText('₺' + square.price, 128, 205);
      else if (square.index === 0) context.fillText('START', 128, 205);
      context.globalAlpha = .48; context.font = `15px ${MONO}`;
      context.textAlign = 'left'; context.fillText(String(square.index).padStart(2, '0'), 13, 234);
    });
  }

  makeCity(theme, palette) {
    const city = new THREE.Group(); city.position.set(0, .26, -.95); city.scale.setScalar(.9); this.board.add(city);
    // Things a thrown die bounces off, in board coordinates.
    this.obstacles = [];
    const solid = (x, z, r, h) => this.obstacles.push({ x: x * .9, z: z * .9 - .95, r: r * .9, h });
    // A low, sculpted Bosphorus inlet beneath the architecture.
    this.cylinder(city, [2.92, 2.95, .06, 96], palette.land, [0, .028, -.02]);
    const waterShape = new THREE.Shape();
    waterShape.moveTo(-2.7, -.6); waterShape.bezierCurveTo(-1.5, -.95, -1.45, .5, -.2, .65);
    waterShape.bezierCurveTo(1.1, .75, 1.15, -.7, 2.75, -.15); waterShape.lineTo(2.55, 1.32);
    waterShape.bezierCurveTo(1.6, .94, .7, 1.6, -.45, 1.2); waterShape.bezierCurveTo(-1.55, 1.16, -1.9, .1, -2.85, .55);
    waterShape.closePath();
    const water = new THREE.Mesh(new THREE.ShapeGeometry(waterShape, 48), this.material(palette.water, { roughness: .18, metalness: .25, side: THREE.DoubleSide }));
    water.rotation.x = PI / 2; water.position.y = .069; water.receiveShadow = true; water.userData.ownGeometry = true; city.add(water);
    for (let i = 0; i < 7; i++) {
      const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(-2.32 + i * .065, .08, .2 + i * .065), new THREE.Vector3(-1.48, .08, .34 + i * .065), new THREE.Vector3(-.77, .08, .89 + i * .065)]);
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(curve.getPoints(18)), new THREE.LineBasicMaterial({ color: theme.paper, transparent: true, opacity: .28 }));
      line.userData.ownGeometry = true; line.userData.ownMaterial = true; city.add(line);
    }
    this.galata(city, theme, palette, [-1.12, .06, -.77]); solid(-1.12, -.77, .52, 3);
    this.mosque(city, theme, palette, [1.0, .06, -1.1]); solid(.6, -1.1, .66, 2); solid(1.4, -1.1, .66, 2);
    const homes = [[-2.15, -1.05, .3], [-1.9, -1.55, .26], [-.35, -1.65, .28], [-.75, -1.95, .25], [1.9, 1.75, .28], [1.2, 1.95, .26], [-1.6, 1.5, .3], [-.2, 2.0, .27]];
    homes.forEach(([x, z, size], i) => { this.townhouse(city, theme, palette, [x, .06, z], size, .40 + (i % 3) * .13); solid(x, z, size * .8, 1); });
    for (const [x, z, s] of [[-2.5, -.95, 1], [-1.75, -1.0, .8], [-.1, -1.0, .9], [.1, -.3, .8], [-.5, -.15, .75], [2.45, -.75, .9], [.6, 1.75, 1.05], [-1.0, 1.6, .85], [0, 1.6, .8], [-2.2, 1.1, .9]]) this.tree(city, theme, palette, x, z, s);
    const ferry = this.tokenModel('ferry', '#e9e6dc', 0, true); ferry.position.set(.68, .075, .86); ferry.scale.setScalar(1.15); ferry.rotation.y = 2.2; city.add(ferry);
    const bridge = new THREE.Group(); bridge.position.set(-.5, .06, .89); bridge.rotation.y = -.18; city.add(bridge);
    this.rbox(bridge, [.34, .07, 1.05], theme.city, [0, .2, 0], .02);
    for (const side of [-1, 1]) {
      this.box(bridge, [.02, .09, 1.05], theme.stone, [side * .16, .28, 0]);
      for (const z of [-.22, .22]) this.cylinder(bridge, [.045, .06, .2, 16], theme.city, [side * .12, .08, z]);
    }
    const headingTexture = canvasTexture(1024, 100, context => {
      context.fillStyle = theme.ink; context.textAlign = 'center'; context.font = `20px ${MONO}`;
      context.fillText('EST. 2026   /   A CITY TO SHARE', 512, 56);
    });
    this.label(this.board, 6.6, .64, headingTexture, [0, .275, -3.75]);
    const wordmark = canvasTexture(1536, 400, context => {
      context.fillStyle = theme.ink; context.textAlign = 'center'; context.font = `500 100px ${MONO}`;
      context.fillText('Istanbul Exchange.', 768, 151);
      context.globalAlpha = .75; context.font = `23px ${MONO}`;
      context.fillText('FORTUNES CHANGE. THE CITY REMAINS.', 768, 236);
      context.globalAlpha = .32; context.fillRect(660, 304, 216, 2);
    });
    this.label(this.board, 7.3, 1.90, wordmark, [0, .275, 2.66]);
  }

  galata(parent, theme, palette, position) {
    const group = new THREE.Group(); group.position.set(...position); parent.add(group);
    // One turned stone profile: plinth, tapering shaft, corbelled gallery, upper drum.
    this.lathe(group, [[0, 0], [.52, 0], [.52, .1], [.42, .15], [.36, 1.48], [.4, 1.55], [.48, 1.6], [.48, 1.67], [.4, 1.69], [.39, 1.98], [.45, 2.01], [.51, 2.03], [.51, 2.07], [0, 2.07]], theme.city, [0, 0, 0], 48);
    this.mesh(group, 'TorusGeometry', [.47, .012, 8, 48], theme.stone, [0, 1.74, 0]).rotation.x = PI / 2;
    this.cylinder(group, [0, .53, .86, 48], theme.roof, [0, 2.5, 0]);
    this.cylinder(group, [.012, .02, .22, 8], theme.stone, [0, 3.0, 0]);
    this.sphere(group, .035, palette.accent, [0, 3.12, 0]);
    for (let i = 0; i < 12; i++) {
      const angle = i * PI / 6;
      const window = this.rbox(group, [.09, .19, .03], theme.roof, [Math.sin(angle) * .385, 1.84, Math.cos(angle) * .385], .012); window.rotation.y = angle;
    }
    for (let row = 0; row < 3; row++) for (let i = 0; i < 6; i++) {
      const angle = i * PI / 3 + row * .5, radius = .405 - row * .013;
      const slit = this.rbox(group, [.05, .13, .03], theme.roof, [Math.sin(angle) * radius, .42 + row * .34, Math.cos(angle) * radius], .012); slit.rotation.y = angle;
    }
    const door = this.rbox(group, [.16, .26, .04], theme.roof, [0, .23, .5], .015); door.rotation.x = -.03;
    return group;
  }

  mosque(parent, theme, palette, position) {
    const group = new THREE.Group(); group.position.set(...position); parent.add(group);
    const dome = (radius, at, scaleY = 1) => { const mesh = this.mesh(group, 'SphereGeometry', [radius, 40, 20, 0, PI * 2, 0, PI / 2], theme.roof, at); mesh.scale.y = scaleY; return mesh; };
    this.rbox(group, [1.6, .58, 1.06], theme.city, [0, .29, 0], .03);
    this.rbox(group, [1.68, .06, 1.14], theme.stone, [0, .6, 0], .02);
    this.rbox(group, [1.0, .2, .86], theme.city, [0, .72, 0], .03);
    this.cylinder(group, [.5, .53, .14, 40], theme.stone, [0, .88, 0]);
    dome(.5, [0, .94, 0], .92);
    for (const [x, z] of [[-.62, 0], [.62, 0], [0, -.4], [0, .4]]) dome(.28, [x, .63, z], .8);
    for (const x of [-.6, .6]) for (const z of [-.36, .36]) dome(.13, [x, .63, z]);
    this.cylinder(group, [.012, .02, .2, 8], theme.stone, [0, 1.48, 0]);
    this.sphere(group, .04, palette.accent, [0, 1.6, 0]);
    // Four pencil minarets, each with two balconies.
    for (const x of [-.93, .93]) for (const z of [-.62, .62]) {
      this.lathe(group, [[0, 0], [.1, 0], [.075, .12], [.06, 1.0], [.11, 1.04], [.11, 1.09], [.055, 1.12], [.05, 1.5], [.095, 1.54], [.095, 1.59], [.045, 1.62], [.045, 1.82], [0, 1.82]], theme.city, [x, 0, z], 20);
      this.cylinder(group, [0, .062, .46, 20], theme.roof, [x, 2.05, z]);
    }
    for (const x of [-.6, -.3, 0, .3, .6]) {
      this.rbox(group, [.11, x ? .2 : .3, .03], theme.roof, [x, x ? .34 : .17, .535], .012);
      this.rbox(group, [.11, .2, .03], theme.roof, [x, .34, -.535], .012);
    }
    for (const z of [-.3, 0, .3]) for (const x of [-.805, .805]) this.rbox(group, [.03, .2, .11], theme.roof, [x, .34, z], .012);
    return group;
  }

  townhouse(parent, theme, palette, position, width, height) {
    const group = new THREE.Group(); group.position.set(...position); parent.add(group);
    this.box(group, [width, height, width * 1.2], theme.city, [0, height / 2, 0]);
    const roof = this.cylinder(group, [0, width * .86, width * .38, 4], palette.accent, [0, height + width * .19, 0]); roof.rotation.y = PI / 4;
    for (const x of [-.23, .23]) this.box(group, [width * .15, height * .21, .01], theme.roof, [x * width, height * .68, width * .605]);
    this.box(group, [width * .18, height * .27, .01], theme.roof, [0, height * .135, width * .605]);
    return group;
  }

  tree(parent, theme, palette, x, z, scale) {
    // Cypresses: the skyline's punctuation marks.
    this.cylinder(parent, [.02, .03, .14 * scale, 8], theme.stone, [x, .06 + .07 * scale, z]);
    this.lathe(parent, [[0, 0], [.085, .03], [.1, .16], [.07, .42], [0, .66]], palette.leaf, [x, .06 + .13 * scale, z], 16).scale.setScalar(scale);
  }

  tokenModel(kind, color, index = 0, miniature = false) {
    const group = new THREE.Group();
    // Cast, anodised metal with pale enamel and dark inlay details.
    const metal = this.material(color, { metalness: .78, roughness: .3 });
    const dark = this.material('#232627', { metalness: .55, roughness: .38 });
    const pale = this.material('#f0ece0', { metalness: .3, roughness: .32 });
    if (!miniature) this.lathe(group, [[0, 0], [.2, 0], [.216, .018], [.216, .05], [.196, .072], [.16, .083], [.15, .105], [0, .105]], metal, [0, 0, 0]);
    const body = new THREE.Group(); body.position.y = miniature ? 0 : .105; group.add(body);
    if (kind === 'cat') {
      this.lathe(body, [[0, 0], [.125, 0], [.15, .06], [.14, .17], [.09, .29], [0, .33]], metal, [0, 0, -.01]);
      this.sphere(body, .115, metal, [0, .4, .03], [1.06, .92, .96]);
      for (const side of [-1, 1]) {
        const ear = this.cylinder(body, [0, .048, .11, 16], metal, [side * .07, .5, .02]); ear.rotation.z = side * -.28;
        this.sphere(body, .017, dark, [side * .046, .425, .128]);
        this.mesh(body, 'CapsuleGeometry', [.03, .12, 6, 14], metal, [side * .05, .09, .115]);
        this.sphere(body, .034, metal, [side * .05, .025, .14], [1, .7, 1.25]);
      }
      this.sphere(body, .045, pale, [0, .374, .125], [1.3, .78, .8]);
      this.sphere(body, .014, dark, [0, .392, .163]);
      const tail = this.mesh(body, 'TorusGeometry', [.12, .026, 10, 28, PI * 1.25], metal, [.03, .03, -.05]); tail.rotation.set(PI / 2, 0, 2.2);
    } else if (kind === 'tower') {
      this.lathe(body, [[0, 0], [.14, 0], [.14, .03], [.115, .05], [.1, .34], [.12, .36], [.15, .38], [.15, .41], [.12, .42], [.115, .5], [.14, .515], [.14, .53], [0, .53]], metal, [0, 0, 0]);
      this.cylinder(body, [0, .15, .25, 40], pale, [0, .655, 0]);
      this.sphere(body, .02, metal, [0, .79, 0]);
      for (let i = 0; i < 8; i++) { const angle = i * PI / 4; this.rbox(body, [.035, .055, .02], dark, [Math.sin(angle) * .112, .46, Math.cos(angle) * .112], .008).rotation.y = angle; }
      this.rbox(body, [.05, .09, .02], dark, [0, .09, .112], .008);
    } else if (kind === 'tulip') {
      this.cylinder(body, [.02, .03, .34, 16], metal, [0, .17, 0]);
      for (const side of [-1, 1]) {
        const leaf = this.sphere(body, .11, metal, [side * .075, .17, 0], [.3, 1.4, .55]); leaf.rotation.z = side * -.5;
      }
      this.lathe(body, [[0, 0], [.055, .008], [.115, .08], [.128, .17], [.11, .25], [.085, .29], [0, .27]], metal, [0, .33, 0]);
      for (let i = 0; i < 3; i++) {
        const angle = i * PI * 2 / 3, petal = this.sphere(body, .07, pale, [Math.sin(angle) * .062, .6, Math.cos(angle) * .062], [.8, 1.5, .45]);
        petal.rotation.y = angle;
      }
    } else if (kind === 'tea') {
      this.lathe(body, [[0, 0], [.17, 0], [.215, .032], [.205, .044], [.1, .024], [0, .024]], pale, [0, 0, 0]);
      // The slim-waisted glass every ferry and tea garden serves.
      this.lathe(body, [[0, .024], [.08, .024], [.105, .07], [.1, .13], [.068, .21], [.082, .3], [.118, .4], [.108, .4], [0, .385]], metal, [0, 0, 0]);
      this.cylinder(body, [.1, .1, .012, 40], this.material('#7a2e1d', { roughness: .15, metalness: .2 }), [0, .398, 0]);
      const spoon = this.rbox(body, [.018, .3, .014], pale, [.07, .44, 0], .006); spoon.rotation.z = -.28;
      this.rbox(body, [.045, .045, .045], pale, [-.15, .055, .06], .008).rotation.y = .5;
    } else if (kind === 'tram') {
      this.rbox(body, [.27, .07, .47], dark, [0, .085, 0], .02);
      this.rbox(body, [.26, .2, .46], metal, [0, .22, 0], .035);
      this.rbox(body, [.24, .04, .44], pale, [0, .335, 0], .015);
      this.rbox(body, [.14, .03, .34], pale, [0, .365, 0], .012);
      for (const side of [-1, 1]) {
        for (const z of [-.15, -.05, .05, .15]) this.rbox(body, [.02, .075, .07], dark, [side * .124, .245, z], .008);
        this.rbox(body, [.17, .08, .02], dark, [0, .245, side * .224], .008);
        this.sphere(body, .02, pale, [0, .15, side * .232]);
        for (const z of [-.13, .13]) { const wheel = this.cylinder(body, [.045, .045, .03, 20], dark, [side * .11, .045, z]); wheel.rotation.z = PI / 2; }
      }
      const pole = this.cylinder(body, [.008, .008, .26, 8], dark, [0, .47, -.05]); pole.rotation.x = .55;
      this.rbox(body, [.16, .014, .02], dark, [0, .575, -.12], .006);
    } else {
      const hull = this.mesh(body, 'ExtrudeGeometry', [HULL, { depth: .09, bevelEnabled: true, bevelThickness: .02, bevelSize: .015, bevelSegments: 3, curveSegments: 20 }], metal, [0, .115, 0]);
      hull.rotation.x = PI / 2;
      this.rbox(body, [.2, .09, .36], pale, [0, .175, -.03], .02);
      this.rbox(body, [.22, .016, .38], metal, [0, .226, -.03], .007);
      this.rbox(body, [.15, .07, .2], pale, [0, .268, -.06], .018);
      this.rbox(body, [.17, .016, .22], metal, [0, .31, -.06], .007);
      this.rbox(body, [.1, .06, .07], pale, [0, .265, .085], .015);
      this.cylinder(body, [.036, .044, .15, 24], metal, [0, .385, -.09]);
      this.cylinder(body, [.039, .039, .03, 24], dark, [0, .45, -.09]);
      this.cylinder(body, [.005, .005, .2, 6], dark, [0, .33, .16]);
      for (const side of [-1, 1]) for (const z of [-.16, -.08, 0, .08]) this.rbox(body, [.02, .035, .045], dark, [side * .094, .18, z], .006);
    }
    group.rotation.y = index * .25;
    return group;
  }

  // A seated friend for every player, dressed in their piece's colour.
  avatarModel(player, theme) {
    const group = new THREE.Group();
    const cloth = this.material(player.bankrupt ? theme.trim : player.color || '#a75542', { roughness: .72 });
    const skin = this.material(player.skin || '#dfb38f', { roughness: .55 });
    const hair = this.material(player.hairColor || '#26241f', { roughness: .65 });
    const dark = this.material('#26241f', { roughness: .4 }), white = this.material('#f4f1e8', { roughness: .4 });
    this.lathe(group, [[0, -.95], [.36, -.95], [.38, -.3], [.44, .2], [.47, .42], [.4, .56], [.2, .64], [.1, .66], [0, .66]], cloth, [0, 0, 0]).scale.set(1.18, 1, .62);
    this.mesh(group, 'TorusGeometry', [.13, .035, 10, 28], cloth, [0, .66, 0]).rotation.x = PI / 2;
    this.cylinder(group, [.095, .11, .22, 24], skin, [0, .76, 0]);
    const head = new THREE.Group(); head.position.set(0, 1.1, 0); head.rotation.x = player.bankrupt ? .45 : 0; group.add(head);
    this.sphere(head, .27, skin, [0, 0, 0], [.92, 1.1, .98]);
    this.sphere(head, .2, skin, [0, -.14, .03], [.95, .9, .95]);
    this.sphere(head, .036, skin, [0, -.05, .262], [.85, 1.25, 1]);
    this.rbox(head, [.1, .018, .02], this.material('#8a4b40', { roughness: .5 }), [0, -.17, .212], .008);
    for (const side of [-1, 1]) {
      this.sphere(head, .05, skin, [side * .25, -.02, -.01], [.5, 1, .8]);
      this.sphere(head, .04, white, [side * .095, .03, .222]);
      this.sphere(head, .022, dark, [side * .095, .03, .252]);
      this.rbox(head, [.09, .02, .02], hair, [side * .095, .1, .243], .008);
    }
    const style = player.hair || 'short';
    if (style === 'curly') {
      for (let i = 0; i < 14; i++) {
        const lift = .1 + i / 14 * .9, ring = Math.sqrt(1 - lift * lift) * .27, angle = i * 2.4;
        const at = [Math.sin(angle) * ring, lift * .3 + .03, Math.cos(angle) * ring - .04];
        if (at[2] < .15 || at[1] > .16) this.sphere(head, .115, hair, at);
      }
    } else if (style !== 'bald') {
      const cap = this.mesh(head, 'SphereGeometry', [.285, 32, 16, 0, PI * 2, 0, PI * .5], hair, [0, .03, -.02]); cap.rotation.x = -.38; cap.scale.set(.96, 1.12, 1.02);
      if (style === 'long') this.mesh(head, 'CapsuleGeometry', [.2, .34, 8, 20], hair, [0, -.2, -.13]).scale.set(1.28, 1, .6);
      if (style === 'bun') this.sphere(head, .12, hair, [0, .31, -.15]);
    }
    const arms = [-1, 1].map(side => {
      const arm = new THREE.Group(); arm.position.set(side * .56, .4, 0); arm.rotation.set(-.35, 0, side * .1); group.add(arm);
      this.sphere(arm, .13, cloth, [0, 0, 0]);
      this.mesh(arm, 'CapsuleGeometry', [.1, .42, 8, 16], cloth, [0, -.3, 0]);
      const fore = new THREE.Group(); fore.position.set(0, -.6, 0); fore.rotation.x = -1.15; arm.add(fore);
      this.mesh(fore, 'CapsuleGeometry', [.085, .4, 8, 16], cloth, [0, -.27, 0]);
      this.sphere(fore, .095, skin, [0, -.56, 0], [1, 1.15, .8]);
      return arm;
    });
    const tag = canvasTexture(512, 112, context => {
      context.font = `600 44px ${MONO}`; context.textAlign = 'center'; context.textBaseline = 'middle';
      const width = Math.min(500, context.measureText(player.name).width + 56);
      context.fillStyle = theme.paper; context.beginPath(); context.roundRect(256 - width / 2, 12, width, 88, 12); context.fill();
      context.strokeStyle = player.color || theme.ink; context.lineWidth = 6; context.stroke();
      context.fillStyle = theme.ink; context.fillText(player.name, 256, 58, 450);
    });
    const name = new THREE.Sprite(new THREE.SpriteMaterial({ map: tag, transparent: true })); name.userData.ownMaterial = true;
    name.scale.set(2.1, .46, 1); name.position.set(0, 1.85, 0); group.add(name);
    const marker = this.mesh(group, 'OctahedronGeometry', [.13], theme.ink, [0, 2.28, 0]); marker.castShadow = false;
    return { mesh: group, arm: arms[1], marker };
  }

  // Seats run around the square table; the viewer always sits nearest the camera.
  seat(index, count, viewer = 0) {
    const angle = (index - viewer) / count * PI * 2, x = Math.sin(angle), z = Math.cos(angle), reach = 7.9 / Math.max(Math.abs(x), Math.abs(z));
    return new THREE.Vector3(x * reach, .25, z * reach);
  }

  // A player's deeds, dealt in a row on the table in front of their seat.
  layDeeds(seat, owned, state, theme, fresh) {
    const group = new THREE.Group(), sideways = Math.abs(seat.x) >= Math.abs(seat.z);
    group.position.set(seat.x, -.262, seat.z);
    group.rotation.y = sideways ? (seat.x > 0 ? -PI / 2 : PI / 2) : seat.z > 0 ? PI : 0; // local +z points at the board
    const gap = Math.min(.3, 2.9 / Math.max(1, owned.length - 1));
    owned.forEach((square, order) => {
      const card = new THREE.Group(), home = new THREE.Vector3((order - (owned.length - 1) / 2) * gap, .012 + order * .007, 1.3);
      card.position.copy(home); card.rotation.y = (order % 2 ? 1 : -1) * .03; group.add(card);
      this.rbox(card, [.42, .02, .6], theme.paper, [0, 0, 0], .008);
      const face = this.label(card, .42, .6, canvasTexture(128, 184, context => {
        context.fillStyle = square.color; context.fillRect(0, 0, 128, 44);
        context.fillStyle = theme.ink; context.textAlign = 'center'; context.textBaseline = 'middle'; context.font = `600 15px ${MONO}`;
        wrapText(context, square.name.toLocaleUpperCase('en'), 116).forEach((line, row) => context.fillText(line, 64, 74 + row * 19));
        context.font = `15px ${MONO}`; context.fillText(state.properties[square.index].mortgaged ? 'MORTGAGED' : '₺' + square.price, 64, 158);
      }), [0, .012, 0], PI);
      face.material.opacity = state.properties[square.index].mortgaged ? .4 : 1;
      if (fresh.has(square.index)) {
        // A new deed sails over from its square.
        group.updateMatrixWorld(true);
        const from = group.worldToLocal(pointAt(square.index));
        this.animate(750, progress => { card.position.lerpVectors(from, home, ease(progress)); card.position.y += Math.sin(progress * PI) * 1.4; }, () => card.position.copy(home));
      }
    });
    return group;
  }

  makeDice() {
    this.dice = [];
    const faces = [3, 4, 1, 6, 2, 5];
    const pips = { 1: [[0, 0]], 2: [[-1, -1], [1, 1]], 3: [[-1, -1], [0, 0], [1, 1]], 4: [[-1, -1], [1, -1], [-1, 1], [1, 1]], 5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]], 6: [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]] };
    for (let index = 0; index < 2; index++) {
      // Ivory in both themes, so the pips read from across the table.
      const materials = faces.map(value => new THREE.MeshStandardMaterial({ roughness: .28, metalness: .05, map: canvasTexture(128, 128, context => {
        context.fillStyle = '#f5f2e9'; context.fillRect(0, 0, 128, 128);
        context.fillStyle = value === 1 ? '#a8432f' : '#1a1a18';
        for (const [x, y] of pips[value]) { context.beginPath(); context.arc(64 + x * 30, 64 + y * 30, value === 1 ? 15 : 11, 0, PI * 2); context.fill(); }
      }) }));
      const die = new THREE.Mesh(this.geometry('RoundedBox', [DIE, DIE, DIE, .06, 4]), materials);
      die.position.set(index === 0 ? -.38 : .38, .255 + DIE / 2, 3.75); die.castShadow = true; die.receiveShadow = true; die.userData.ownMaterial = true;
      die.quaternion.copy(this.diceOrientation(1, index));
      this.board.add(die); this.dice.push(die);
    }
  }

  // Simulate the whole throw first, then pick the starting spin that makes it land on the rolled faces.
  throwDice(values, origin, rollerId) {
    const steps = Math.round(DICE / 1000 * SIM_HZ), dt = 1 / SIM_HZ, radius = .3;
    // shortcut: houses and hotels are not obstacles; add them here if dice passing through them shows.
    const obstacles = [...this.obstacles, ...[...this.tokens].map(([id, entry]) => ({ x: entry.mesh.position.x, z: entry.mesh.position.z, r: .2, h: .8, id }))];
    const aim = new THREE.Vector3(-origin.x * .1 + spread(1.1), 0, -origin.z * .1 + spread(1.1));
    const sideways = new THREE.Vector3(-origin.z, 0, origin.x).normalize();
    const bodies = values.map((value, index) => {
      const p = origin.clone().multiplyScalar(.84).addScaledVector(sideways, index ? .32 : -.32); p.y = 1.45;
      const v = aim.clone().sub(p).setY(0).normalize().multiplyScalar(6.6 + Math.random() * 1.6); v.y = 1.4;
      return { p, v, w: new THREE.Vector3(spread(14), spread(14), spread(14)), q: new THREE.Quaternion(), P: new Float32Array(steps * 3), Q: new Float32Array(steps * 4) };
    });
    const hits = [], roll = new THREE.Vector3(), spin = new THREE.Quaternion(), normal = new THREE.Vector3();
    for (let step = 0; step < steps; step++) {
      const drag = 7 * (step > steps * .7 ? 3 : 1) * dt;
      for (const body of bodies) {
        const { p, v, w } = body;
        v.y -= 30 * dt; p.addScaledVector(v, dt);
        const ground = floorAt(p.x, p.z) + radius;
        if (p.y <= ground) {
          p.y = ground;
          roll.set(v.z, 0, -v.x).divideScalar(radius);
          if (v.y < -1.2) { v.y *= -.42; v.x *= .84; v.z *= .84; w.lerp(roll, .6); w.y += spread(5); }
          else {
            v.y = 0;
            const speed = Math.hypot(v.x, v.z), next = Math.max(0, speed - drag);
            if (speed > 0) { v.x *= next / speed; v.z *= next / speed; }
            w.lerp(roll, .35);
          }
        }
        for (const axis of ['x', 'z']) if (Math.abs(p[axis]) > 5.3 && p[axis] * v[axis] > 0) v[axis] *= -.5; // the rail only stops dice on their way out
        for (const obstacle of obstacles) {
          if (p.y - radius > top + obstacle.h) continue;
          normal.set(p.x - obstacle.x, 0, p.z - obstacle.z);
          const distance = normal.length(), reach = obstacle.r + radius * .75;
          if (distance >= reach || distance < 1e-4) continue;
          normal.divideScalar(distance); p.addScaledVector(normal, reach - distance);
          const closing = v.dot(normal);
          if (closing < 0) {
            v.addScaledVector(normal, -1.5 * closing); w.y += spread(9);
            if (obstacle.id && !hits.some(hit => hit.id === obstacle.id && step - hit.step < 40)) hits.push({ step, id: obstacle.id });
          }
        }
      }
      const [a, b] = bodies;
      normal.copy(b.p).sub(a.p);
      const gap = normal.length();
      if (gap < radius * 1.6 && gap > 1e-4) {
        normal.divideScalar(gap); a.p.addScaledVector(normal, (gap - radius * 1.6) / 2); b.p.addScaledVector(normal, (radius * 1.6 - gap) / 2);
        const closing = b.v.dot(normal) - a.v.dot(normal);
        if (closing < 0) { a.v.addScaledVector(normal, .8 * closing); b.v.addScaledVector(normal, -.8 * closing); }
      }
      for (const body of bodies) {
        const rate = body.w.length();
        if (rate > 1e-5) body.q.premultiply(spin.setFromAxisAngle(roll.copy(body.w).divideScalar(rate), rate * dt));
        body.p.toArray(body.P, step * 3); body.q.toArray(body.Q, step * 4);
      }
    }
    // Spin is independent of the starting pose, so this pose is guaranteed to end on the rolled face.
    bodies.forEach((body, index) => { body.start = body.q.clone().invert().multiply(this.diceOrientation(values[index], index)); });
    const place = step => bodies.forEach((body, index) => {
      const die = this.dice[index];
      die.quaternion.fromArray(body.Q, step * 4).multiply(body.start);
      die.position.fromArray(body.P, step * 3); die.position.y += support(die.quaternion) - radius;
    });
    this.animate(DICE, (progress, elapsed) => {
      const step = Math.min(steps - 1, Math.floor(elapsed / 1000 * SIM_HZ));
      place(step);
      while (hits.length && hits[0].step <= step) this.wobble(hits.shift().id);
    }, () => place(steps - 1));
    const arm = this.avatars.get(rollerId)?.arm;
    if (arm) this.animate(450, progress => { arm.rotation.x = -.35 - Math.sin(progress * PI) * 1.7; }, () => { arm.rotation.x = -.35; });
  }

  wobble(id) {
    const mesh = this.tokens.get(id)?.mesh;
    if (mesh) this.animate(520, progress => { mesh.rotation.x = Math.sin(progress * PI * 4) * (1 - progress) * .24; }, () => { mesh.rotation.x = 0; });
  }

  diceOrientation(value, index) {
    const rotation = { 1: [0, 0, 0], 2: [-PI / 2, 0, 0], 3: [0, 0, PI / 2], 4: [0, 0, -PI / 2], 5: [PI / 2, 0, 0], 6: [PI, 0, 0] }[value] || [0, 0, 0];
    const result = new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation));
    return new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), index ? -.22 : .2).multiply(result);
  }

  rebuildBuildings(index, asset) {
    const tile = this.tiles[index];
    this.releaseGroup(tile.buildings);
    tile.houses = asset.houses || 0;
    const theme = themes[this.options.theme] || themes.light;
    const palette = palettes[this.options.palette] || palettes.stone;
    if (tile.houses === 5) {
      const hotel = new THREE.Group(); hotel.position.set(0, .016, -.28); tile.buildings.add(hotel);
      this.box(hotel, [.5, .38, .29], palette.accent, [0, .19, 0]);
      this.box(hotel, [.53, .055, .33], theme.roof, [0, .408, 0]);
      this.box(hotel, [.11, .17, .014], theme.paper, [0, .085, .153]);
      for (const x of [-.16, 0, .16]) this.box(hotel, [.067, .073, .014], theme.paper, [x, .285, .153]);
      this.box(hotel, [.09, .027, .075], theme.trim, [0, .455, 0]);
    } else {
      for (let n = 0; n < tile.houses; n++) {
        const house = new THREE.Group(); house.position.set((n - (tile.houses - 1) / 2) * .205, .016, -.29); tile.buildings.add(house);
        this.box(house, [.16, .15, .21], palette.leaf, [0, .075, 0]);
        const roof = this.cylinder(house, [0, .156, .13, 4], theme.roof, [0, .21, 0]); roof.rotation.y = PI / 4; roof.scale.z = 1.16;
        this.box(house, [.038, .07, .01], theme.paper, [0, .035, .111]);
      }
    }
  }

  tokenPosition(player, state) {
    const position = pointAt(player.position || 0);
    const peers = (state?.players || []).filter(other => !other.bankrupt && other.position === player.position);
    const index = peers.findIndex(other => other.id === player.id);
    // Two comfortable rows when friends share a square, including START.
    if (peers.length > 1) { position.x += ((index % 3) - (Math.min(peers.length, 3) - 1) / 2) * .24; position.z += index < 3 ? .14 : -.14; }
    position.y += .036;
    return position;
  }

  motionDuration(state) {
    if (this.options.reducedMotion || !this.options.animate) return 0;
    return (state?.lastAction?.type === 'ROLL' ? DICE : 0) + (state?.lastMove?.path?.length || 0) * STEP;
  }

  update(state, options = {}) {
    if (this.destroyed || this.failed) return;
    const previous = this.state;
    const previousReducedMotion = this.options.reducedMotion;
    this.options = { ...this.options, ...options };
    const allowMotion = this.options.animate && !this.options.reducedMotion;
    const key = [this.options.theme, this.options.palette].join(':');
    const rebuilt = this.visualKey !== key;
    if (rebuilt) {
      this.finishAnimations();
      this.visualKey = key;
      this.buildStatic();
    } else if (!previousReducedMotion && this.options.reducedMotion) this.finishAnimations();
    const isGame = state && state.kind !== 'lobby';
    const incomingId = state?.lastAction?.id ?? state?.revision ?? null;
    const isNew = incomingId !== this.actionId;
    const animate = Boolean(allowMotion && isNew && previous && isGame && !rebuilt);
    // A newer authoritative action supersedes any unfinished visual transition.
    // Selecting a deed and re-rendering controls keeps the current transition alive.
    if (isNew && previous && !rebuilt) this.finishAnimations();
    this.state = state; this.actionId = incomingId;
    for (const square of BOARD) {
      const tile = this.tiles[square.index];
      const asset = state?.properties?.[square.index] || { owner: null, houses: 0 };
      tile.selection.visible = this.options.selected === square.index;
      tile.ownerMarker.visible = Boolean(asset.owner);
      const owner = state?.players?.find(player => player.id === asset.owner);
      if (owner) tile.ownerMarker.material = this.material(asset.mortgaged ? '#777777' : owner.color || '#69817a');
      const changed = tile.houses !== (asset.houses || 0);
      if (changed || rebuilt) {
        this.rebuildBuildings(square.index, asset);
        if (animate && changed && (asset.houses || 0) > (previous?.properties?.[square.index]?.houses || 0)) {
          const target = tile.buildings;
          this.animate(500, progress => { target.scale.y = .12 + .88 * ease(progress) + Math.sin(progress * PI) * .19; }, () => target.scale.y = 1);
        }
      }
      tile.label.material.opacity = asset.mortgaged ? .42 : 1;
    }
    const liveIds = new Set();
    for (const [index, player] of (isGame ? state.players : []).entries()) {
      if (player.bankrupt) continue;
      liveIds.add(player.id);
      const kind = TOKEN_NAMES.includes(player.token) ? player.token : TOKEN_NAMES[index % TOKEN_NAMES.length];
      const style = kind + ':' + player.color;
      let entry = this.tokens.get(player.id);
      if (!entry || entry.style !== style) {
        if (entry) { this.releaseGroup(entry.mesh); entry.mesh.removeFromParent(); }
        const mesh = this.tokenModel(kind, player.color || '#a75542', index); this.tokenLayer.add(mesh);
        const halo = this.mesh(mesh, 'RingGeometry', [.215, .252, 32], this.material(player.color || '#a75542', { side: THREE.DoubleSide }), [0, .008, 0]);
        halo.rotation.x = -PI / 2; halo.castShadow = false;
        entry = { mesh, halo, style, moving: false, position: player.position }; this.tokens.set(player.id, entry);
      }
      entry.halo.visible = state.players[state.turn]?.id === player.id;
      const destination = this.tokenPosition(player, state);
      const move = state.lastMove?.playerId === player.id ? state.lastMove : null;
      if (animate && move?.path?.length) {
        const path = [pointAt(move.from ?? previous.players.find(p => p.id === player.id)?.position ?? 0), ...move.path.map(pointAt)];
        path[0].copy(entry.mesh.position); path[path.length - 1].copy(destination);
        entry.moving = true;
        const diceDelay = state.lastAction?.type === 'ROLL' ? DICE : 0;
        const duration = diceDelay + move.path.length * STEP;
        this.animate(duration, (progress, elapsed) => {
          const moved = Math.max(0, elapsed - diceDelay) / STEP;
          const step = Math.min(path.length - 2, Math.floor(moved));
          const local = clamp(moved - step, 0, 1);
          entry.mesh.position.lerpVectors(path[step], path[step + 1], local);
          const teleport = move.teleports?.some(jump => jump.at === step);
          entry.mesh.position.y = top + .036 + Math.sin(local * PI) * (teleport ? 1.6 : .22);
          entry.mesh.rotation.z = Math.sin(local * PI * 2) * .08;
          if (elapsed >= diceDelay) {
            if (!teleport) entry.mesh.rotation.y = Math.atan2(path[step + 1].x - path[step].x, path[step + 1].z - path[step].z);
            this.focusTarget.set(entry.mesh.position.x, top, entry.mesh.position.z); this.focusZoomTarget = 2.1;
          }
          if (elapsed < diceDelay) entry.mesh.position.copy(path[0]);
        }, () => {
          entry.mesh.position.copy(destination); entry.mesh.rotation.z = 0; entry.moving = false;
          // Linger on the landing square, then pull back to the whole table.
          this.animate(900, () => {}, () => { this.focusTarget.set(0, .28, .48); this.focusZoomTarget = 1; });
        });
      } else if (!entry.moving || rebuilt || this.options.reducedMotion) entry.mesh.position.copy(destination);
      entry.position = player.position;
      if (animate) {
        const old = previous.players?.find(item => item.id === player.id);
        const difference = old ? player.cash - old.cash : 0;
        if (difference) this.cashEffect(destination, difference, player.color || '#69817a', this.motionDuration(state));
      }
    }
    for (const [id, entry] of this.tokens) {
      if (!liveIds.has(id)) { this.releaseGroup(entry.mesh); entry.mesh.removeFromParent(); this.tokens.delete(id); }
    }
    const theme = themes[this.options.theme] || themes.light, seated = state?.players || [];
    const viewer = Math.max(0, seated.findIndex(player => player.id === this.options.viewer));
    const turnId = isGame && state.phase !== 'finished' ? state.players[state.turn]?.id : null;
    for (const [index, player] of seated.entries()) {
      const seat = this.seat(index, seated.length, viewer), place = seat.x.toFixed(2) + ':' + seat.z.toFixed(2);
      const style = [player.name, player.color, player.hair, player.hairColor, player.skin, Boolean(player.bankrupt), place, this.options.theme].join('|');
      let entry = this.avatars.get(player.id);
      if (entry?.style !== style) {
        if (entry) { this.releaseGroup(entry.mesh); entry.mesh.removeFromParent(); }
        entry = { ...this.avatarModel(player, theme), style }; this.avatars.set(player.id, entry); this.avatarLayer.add(entry.mesh);
        entry.mesh.position.copy(seat); entry.mesh.lookAt(0, seat.y, 0);
      }
      entry.marker.visible = player.id === turnId;
      const owned = isGame ? BOARD.filter(square => state.properties[square.index]?.owner === player.id) : [];
      const key = [place, this.options.theme, ...owned.map(square => square.index + (state.properties[square.index].mortgaged ? 'm' : ''))].join();
      let pile = this.deeds.get(player.id);
      if (pile?.key !== key) {
        const fresh = new Set(animate && pile ? owned.map(square => square.index).filter(i => !pile.held.includes(i)) : []);
        if (pile) { this.releaseGroup(pile.group); pile.group.removeFromParent(); }
        pile = { key, held: owned.map(square => square.index), group: this.layDeeds(seat, owned, state, theme, fresh) };
        this.deeds.set(player.id, pile); this.deedLayer.add(pile.group);
      }
    }
    for (const [id, entry] of this.avatars) {
      if (seated.some(player => player.id === id)) continue;
      this.releaseGroup(entry.mesh); entry.mesh.removeFromParent(); this.avatars.delete(id);
      const pile = this.deeds.get(id); if (pile) { this.releaseGroup(pile.group); pile.group.removeFromParent(); this.deeds.delete(id); }
    }
    const rolled = animate && state?.lastAction?.type === 'ROLL';
    for (const [index, die] of this.dice.entries()) {
      die.visible = Boolean(isGame);
      if (!rolled && (!this.animations.length || rebuilt || this.options.reducedMotion)) die.quaternion.copy(this.diceOrientation(state?.dice?.[index] || 1, index));
    }
    if (rolled) {
      const roller = Math.max(0, state.players.findIndex(player => player.id === state.lastAction.playerId));
      this.throwDice(state.dice, this.seat(roller, state.players.length, viewer), state.lastAction.playerId);
    }
    if (animate && state.winner && state.winner !== previous.winner) this.confetti();
    if (animate && this.motionDuration(state)) {
      this.motionActive = true;
      this.motionDeadline = performance.now() + this.motionDuration(state);
      this.callbacks.onAnimationStart?.(this.motionDuration(state));
    }
    this.renderer.shadowMap.needsUpdate = true;
    this.requestFrame();
  }

  animate(duration, tick, finish = () => {}) {
    const animation = { start: performance.now(), duration, tick, finish };
    this.animations.push(animation); tick(0, 0);
    this.requestFrame();
    return animation;
  }

  finishAnimations() {
    for (const animation of this.animations) animation.finish();
    this.animations = [];
    if (this.motionActive) { this.motionActive = false; this.callbacks.onAnimationEnd?.(); }
  }

  cashEffect(position, amount, color, delay = 0) {
    const texture = canvasTexture(256, 80, context => {
      context.fillStyle = themes[this.options.theme]?.paper || '#f4f0e7'; context.fillRect(0, 0, 256, 80);
      context.fillStyle = amount > 0 ? color : themes[this.options.theme]?.ink || '#343b3a';
      context.textAlign = 'center'; context.font = `bold 34px ${MONO}`;
      context.fillText((amount > 0 ? '+' : '−') + '₺' + Math.abs(amount), 128, 52);
    });
    const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false, opacity: 0 });
    const sprite = new THREE.Sprite(material); sprite.scale.set(1.22, .38, 1); sprite.position.copy(position); sprite.position.y += .8; this.effectLayer.add(sprite);
    const finish = () => { sprite.removeFromParent(); material.map.dispose(); material.dispose(); };
    this.animate(delay + 1000, (progress, elapsed) => {
      const local = clamp((elapsed - delay) / 1000, 0, 1);
      material.opacity = elapsed < delay ? 0 : Math.sin(local * PI) ** .5;
      sprite.position.y = position.y + .75 + local * .8;
    }, finish);
  }

  confetti() {
    const pieces = [];
    const colors = ['#b58b54', '#769795', '#a86f59', '#f0e7d4', '#808d76'];
    for (let i = 0; i < 64; i++) {
      const piece = this.mesh(this.effectLayer, 'PlaneGeometry', [.08, .17], this.material(colors[i % colors.length], { side: THREE.DoubleSide }), [0, 0, 0]);
      piece.castShadow = false;
      pieces.push({ piece, x: (Math.random() - .5) * 10, z: (Math.random() - .5) * 10, speed: 1.5 + Math.random(), phase: Math.random() * PI * 2 });
    }
    this.animate(3000, progress => {
      pieces.forEach(({ piece, x, z, speed, phase }) => {
        piece.position.set(x + Math.sin(progress * 6 + phase) * .4, 6 - progress * 7 * speed / 2, z + Math.cos(progress * 7 + phase) * .4);
        piece.rotation.set(progress * 11 + phase, progress * 9, phase); piece.visible = piece.position.y > .3;
      });
    }, () => pieces.forEach(({ piece }) => piece.removeFromParent()));
  }

  bindControls() {
    const canvas = this.renderer.domElement;
    const listen = (target, name, handler, options) => { target.addEventListener(name, handler, options); this.listeners.push(() => target.removeEventListener(name, handler, options)); };
    listen(canvas, 'pointerdown', event => {
      if (event.button !== 0 || this.pointer) return;
      this.pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, initialX: event.clientX, initialY: event.clientY, dragged: false };
      canvas.setPointerCapture(event.pointerId); canvas.style.cursor = 'grabbing';
    });
    listen(canvas, 'pointermove', event => {
      if (!this.pointer || event.pointerId !== this.pointer.id) return;
      const dx = event.clientX - this.pointer.x, dy = event.clientY - this.pointer.y;
      this.pointer.dragged ||= Math.hypot(event.clientX - this.pointer.initialX, event.clientY - this.pointer.initialY) > 5;
      if (this.pointer.dragged) {
        this.targetCamera.azimuth -= dx * .008;
        this.targetCamera.elevation = clamp(this.targetCamera.elevation + dy * .006, .48, 1.42);
        this.requestFrame();
      }
      this.pointer.x = event.clientX; this.pointer.y = event.clientY;
    });
    const release = event => {
      if (!this.pointer || this.pointer.id !== event.pointerId) return;
      const select = !this.pointer.dragged && event.type === 'pointerup'; this.pointer = null; canvas.style.cursor = 'grab';
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
      if (select) this.selectAt(event.clientX, event.clientY);
    };
    listen(canvas, 'pointerup', release); listen(canvas, 'pointercancel', release); listen(canvas, 'lostpointercapture', release);
    listen(canvas, 'wheel', event => { event.preventDefault(); this.zoom(clamp(-event.deltaY * .01, -2, 2)); }, { passive: false });
    listen(canvas, 'webglcontextlost', event => {
      event.preventDefault(); this.failed = true; cancelAnimationFrame(this.frame); this.frame = 0;
      this.callbacks.onError?.(new Error('The 3D graphics context was lost. Use the 2D board to continue.'));
    });
  }

  selectAt(clientX, clientY) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointerVector.set((clientX - rect.left) / rect.width * 2 - 1, -(clientY - rect.top) / rect.height * 2 + 1);
    this.raycaster.setFromCamera(this.pointerVector, this.camera);
    const intersections = this.raycaster.intersectObjects(this.tiles.map(tile => tile.base), false);
    if (intersections.length) this.callbacks.onSelect(intersections[0].object.userData.space);
  }

  zoom(delta) {
    if (this.destroyed || this.failed) return;
    this.targetCamera.zoom = clamp(this.targetCamera.zoom * Math.exp(delta * .13), .74, 1.65); this.requestFrame();
  }

  rotate(delta) {
    if (this.destroyed || this.failed) return;
    this.targetCamera.azimuth += delta; this.requestFrame();
  }

  resetCamera() {
    if (this.destroyed || this.failed) return;
    this.targetCamera = { azimuth: .28, elevation: .88, zoom: 1 }; this.requestFrame();
  }

  resize() {
    if (this.destroyed || this.failed || !this.renderer) return;
    const width = this.container.clientWidth, height = this.container.clientHeight;
    if (width < 1 || height < 1) return;
    this.renderer.setSize(width, height, false); this.camera.aspect = width / height; this.camera.updateProjectionMatrix(); this.requestFrame();
  }

  requestFrame() {
    if (!this.frame && !this.destroyed && !this.failed) this.frame = requestAnimationFrame(time => this.render(time));
  }

  render(time) {
    this.frame = 0;
    if (this.destroyed || this.failed) return;
    let moving = false;
    const factor = this.options.reducedMotion ? 1 : .22;
    for (const key of ['azimuth', 'elevation', 'zoom']) {
      const difference = this.targetCamera[key] - this.cameraState[key];
      if (Math.abs(difference) > .0001) { this.cameraState[key] += difference * factor; moving = true; }
      else this.cameraState[key] = this.targetCamera[key];
    }
    const { azimuth, elevation, zoom } = this.cameraState;
    const zoomGap = this.focusZoomTarget - this.focusZoom;
    if (Math.abs(zoomGap) > .002 || this.focus.distanceToSquared(this.focusTarget) > 1e-5) {
      this.focus.lerp(this.focusTarget, factor * .45); this.focusZoom += zoomGap * factor * .45; moving = true;
    }
    const distance = 27 / Math.min(1.1, this.camera.aspect) / zoom / this.focusZoom;
    this.camera.position.set(Math.sin(azimuth) * Math.cos(elevation) * distance, Math.sin(elevation) * distance, Math.cos(azimuth) * Math.cos(elevation) * distance).add(this.focus);
    this.camera.lookAt(this.focus);
    const finished = [];
    for (const animation of this.animations) {
      const elapsed = Math.max(0, time - animation.start), progress = clamp(elapsed / animation.duration, 0, 1);
      animation.tick(progress, elapsed);
      if (progress >= 1) finished.push(animation);
    }
    for (const animation of finished) { animation.finish(); this.animations.splice(this.animations.indexOf(animation), 1); }
    if (this.motionActive && time >= this.motionDeadline) { this.motionActive = false; this.callbacks.onAnimationEnd?.(); }
    if (this.animations.length || finished.length) this.renderer.shadowMap.needsUpdate = true;
    this.renderer.render(this.scene, this.camera);
    if (this.animations.length || moving) this.requestFrame();
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true; cancelAnimationFrame(this.frame); this.frame = 0;
    this.observer?.disconnect(); this.listeners.forEach(remove => remove()); this.finishAnimations();
    if (this.scene) this.releaseGroup(this.scene);
    this.geometries.forEach(geometry => geometry.dispose()); this.materials.forEach(material => material.dispose());
    this.renderer?.dispose(); this.renderer?.forceContextLoss(); this.renderer?.domElement.remove();
    this.tokens.clear(); this.geometries.clear(); this.materials.clear();
  }
}
