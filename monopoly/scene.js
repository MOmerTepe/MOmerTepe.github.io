// Istanbul Exchange's locally rendered architectural board.
// Three.js 0.186.1 (MIT) is pinned in vendor/; there are no remote assets.
import * as THREE from './vendor/three.module.js';
import { BOARD } from './board.js?v=20261006-4';

const TOKEN_NAMES = ['ferry', 'cat', 'tower', 'tulip', 'tea', 'tram'];
const PI = Math.PI;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const ease = value => 1 - (1 - value) ** 3;
const top = .28;
const themes = {
  light: { background: '#eeeae1', paper: '#f4f0e7', field: '#e3dbcd', edge: '#b6afa2', ink: '#343b3a', light: '#fff9ee', city: '#e3dbcd', roof: '#737971', trim: '#b0a794' },
  dark: { background: '#171c20', paper: '#424743', field: '#303a39', edge: '#20292c', ink: '#ece5d7', light: '#dadace', city: '#aaa99b', roof: '#475852', trim: '#777d71' },
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
    this.assets = new Map();
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
      this.renderer.shadowMap.type = THREE.PCFShadowMap;
      this.renderer.shadowMap.autoUpdate = false;
      const canvas = this.renderer.domElement;
      canvas.style.cssText = 'display:block;width:100%;height:100%;touch-action:none;outline:none;cursor:grab';
      canvas.setAttribute('aria-hidden', 'true');
      canvas.dataset.boardCanvas = '3d';
      this.container.appendChild(canvas);
      this.scene = new THREE.Scene();
      this.camera = new THREE.PerspectiveCamera(39, 1, .1, 90);
      this.scene.add(new THREE.HemisphereLight('#fff7e6', '#7c8b8c', 1.8));
      this.sun = new THREE.DirectionalLight('#fff4df', 2.6);
      this.sun.position.set(-7, 15, 9);
      this.sun.castShadow = true;
      Object.assign(this.sun.shadow.camera, { left: -9, right: 9, top: 9, bottom: -9, near: .5, far: 40 });
      this.sun.shadow.mapSize.set(1024, 1024);
      this.sun.shadow.bias = -.0005;
      this.sun.shadow.normalBias = .025;
      this.scene.add(this.sun);
      const fill = new THREE.DirectionalLight('#d3e2eb', .9);
      fill.position.set(5, 7, -9); this.scene.add(fill);
      this.board = new THREE.Group(); this.scene.add(this.board);
      this.tokenLayer = new THREE.Group(); this.scene.add(this.tokenLayer);
      this.effectLayer = new THREE.Group(); this.scene.add(this.effectLayer);
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
    if (!this.geometries.has(key)) this.geometries.set(key, new THREE[type](...args));
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
  sphere(parent, radius, color, position, scale) { return this.mesh(parent, 'SphereGeometry', [radius, 16, 10], color, position, scale); }

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
      const color = square.color ? new THREE.Color(square.color).lerp(new THREE.Color(theme.paper), .18).getStyle() : theme.trim;
      if (square.color) this.box(group, [.965, .018, .16], color, [0, .009, -.398]);
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
    this.makeDice(theme);
    this.renderer.shadowMap.needsUpdate = true;
  }

  tileTexture(square, theme) {
    return canvasTexture(256, 256, context => {
      context.textAlign = 'center'; context.textBaseline = 'middle'; context.fillStyle = theme.ink;
      const special = { go: '↗', jail: 'Ⅱ', parking: '☕', goToJail: '→', chance: '?', community: '◇', tax: '−', railroad: '↔', utility: '⌁' }[square.type];
      const names = { jail: 'DETOUR', goToJail: 'TAKE A DETOUR', chance: 'OPPORTUNITY', community: 'CITY FUND', parking: 'TEA BREAK' };
      let name = names[square.type] || square.name.toLocaleUpperCase('en');
      const fontSize = name.length > 16 ? 21 : name.length > 10 ? 23 : 26;
      context.font = `600 ${fontSize}px ui-monospace, monospace`;
      const lines = wrapText(context, name, 224);
      const startY = special ? 142 : 108;
      if (special) { context.font = '52px Georgia, serif'; context.fillText(special, 128, 79); }
      context.font = `600 ${fontSize}px ui-monospace, monospace`;
      lines.forEach((line, index) => context.fillText(line, 128, startY + (index - (lines.length - 1) / 2) * 28));
      context.font = '22px ui-monospace, monospace';
      if (square.price) context.fillText('₺' + square.price, 128, 205);
      else if (square.index === 0) context.fillText('START', 128, 205);
      context.globalAlpha = .48; context.font = '15px ui-monospace, monospace';
      context.textAlign = 'left'; context.fillText(String(square.index).padStart(2, '0'), 13, 234);
    });
  }

  makeCity(theme, palette) {
    const city = new THREE.Group(); city.position.set(0, .26, -.95); city.scale.setScalar(.9); this.board.add(city);
    // A low, sculpted Bosphorus inlet beneath the architecture.
    this.cylinder(city, [2.92, 2.95, .06, 64], palette.land, [0, .028, -.02]);
    const waterShape = new THREE.Shape();
    waterShape.moveTo(-2.7, -.6); waterShape.bezierCurveTo(-1.5, -.95, -1.45, .5, -.2, .65);
    waterShape.bezierCurveTo(1.1, .75, 1.15, -.7, 2.75, -.15); waterShape.lineTo(2.55, 1.32);
    waterShape.bezierCurveTo(1.6, .94, .7, 1.6, -.45, 1.2); waterShape.bezierCurveTo(-1.55, 1.16, -1.9, .1, -2.85, .55);
    waterShape.closePath();
    const water = new THREE.Mesh(new THREE.ShapeGeometry(waterShape, 32), this.material(palette.water, { roughness: .55, metalness: .08, side: THREE.DoubleSide }));
    water.rotation.x = PI / 2; water.position.y = .069; water.userData.ownGeometry = true; city.add(water);
    for (let i = 0; i < 7; i++) {
      const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(-2.32 + i * .065, .08, .2 + i * .065), new THREE.Vector3(-1.48, .08, .34 + i * .065), new THREE.Vector3(-.77, .08, .89 + i * .065)]);
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(curve.getPoints(18)), new THREE.LineBasicMaterial({ color: theme.paper, transparent: true, opacity: .28 }));
      line.userData.ownGeometry = true; line.userData.ownMaterial = true; city.add(line);
    }
    this.galata(city, theme, [-1.12, .10, -.77], 1);
    const mosque = new THREE.Group(); mosque.position.set(1.0, .1, -.94); city.add(mosque);
    this.box(mosque, [1.55, .65, .94], theme.city, [0, .325, 0]);
    this.box(mosque, [1.67, .095, 1.05], theme.trim, [0, .67, 0]);
    this.sphere(mosque, .57, theme.roof, [0, .72, 0], [1, .8, .88]);
    this.cylinder(mosque, [.018, .025, .3, 8], theme.trim, [0, 1.3, 0]);
    this.sphere(mosque, .045, palette.accent, [0, 1.49, 0]);
    for (const x of [-.56, .56]) this.sphere(mosque, .27, theme.roof, [x, .71, .12], [1, .75, 1]);
    for (const x of [-.98, .98]) {
      this.cylinder(mosque, [.065, .09, 1.65, 12], theme.city, [x, .82, -.15]);
      this.cylinder(mosque, [.115, .115, .065, 12], theme.trim, [x, 1.1, -.15]);
      this.cylinder(mosque, [0, .08, .42, 12], theme.roof, [x, 1.82, -.15]);
    }
    for (const x of [-.5, -.25, 0, .25, .5]) this.box(mosque, [.095, .23, .02], theme.roof, [x, .37, .481]);
    const homes = [[-2.02, -.26, .34], [-1.83, .30, .26], [-.35, -1.65, .28], [.12, -1.78, .25], [2.06, .0, .29], [1.83, .65, .28]];
    homes.forEach(([x, z, size], i) => this.townhouse(city, theme, palette, [x, .085, z], size, .40 + (i % 3) * .13));
    for (const [x, z] of [[-2.3, -.8], [-.4, -1.0], [.22, -1.35], [2.33, -.55], [1.53, .94], [-1.2, 1.55], [.6, 1.63]]) this.tree(city, theme, palette, x, z, .75);
    const ferry = this.tokenModel('ferry', theme.paper, 0, true); ferry.position.set(.68, .12, .86); ferry.scale.setScalar(1.15); ferry.rotation.y = -.5; city.add(ferry);
    const bridge = new THREE.Group(); bridge.position.set(-.55, .1, .54); bridge.rotation.y = -.48; city.add(bridge);
    this.box(bridge, [.34, .09, 1.23], theme.city, [0, .20, 0]);
    for (const side of [-1, 1]) {
      this.box(bridge, [.033, .16, 1.24], theme.trim, [side * .17, .30, 0]);
      for (const z of [-.4, .4]) this.box(bridge, [.07, .26, .11], theme.city, [side * .14, .1, z]);
    }
    const headingTexture = canvasTexture(1024, 100, context => {
      context.fillStyle = theme.ink; context.textAlign = 'center'; context.font = '20px ui-monospace, monospace';
      context.fillText('EST. 2026   /   A CITY TO SHARE', 512, 56);
    });
    this.label(this.board, 6.6, .64, headingTexture, [0, .275, -3.75]);
    const wordmark = canvasTexture(1536, 400, context => {
      context.fillStyle = theme.ink; context.textAlign = 'center'; context.font = '112px Georgia, serif';
      context.fillText('Istanbul Exchange.', 768, 151);
      context.globalAlpha = .75; context.font = '23px ui-monospace, monospace';
      context.fillText('FORTUNES CHANGE. THE CITY REMAINS.', 768, 236);
      context.globalAlpha = .32; context.fillRect(660, 304, 216, 2);
    });
    this.label(this.board, 7.3, 1.90, wordmark, [0, .275, 2.66]);
  }

  galata(parent, theme, position, scale) {
    const group = new THREE.Group(); group.position.set(...position); group.scale.setScalar(scale); parent.add(group);
    this.cylinder(group, [.46, .53, .16, 20], theme.trim, [0, .08, 0]);
    this.cylinder(group, [.33, .40, 1.50, 20], theme.city, [0, .86, 0]);
    this.cylinder(group, [.47, .43, .12, 20], theme.trim, [0, 1.56, 0]);
    this.cylinder(group, [.39, .39, .28, 20], theme.city, [0, 1.74, 0]);
    this.cylinder(group, [0, .53, .86, 24], theme.roof, [0, 2.29, 0]);
    this.cylinder(group, [.018, .023, .2, 8], theme.trim, [0, 2.78, 0]);
    for (let i = 0; i < 10; i++) {
      const angle = i * PI / 5;
      const window = this.box(group, [.115, .18, .025], theme.roof, [Math.sin(angle) * .393, 1.72, Math.cos(angle) * .393]);
      window.rotation.y = angle;
    }
    for (let row = 0; row < 3; row++) {
      for (let i = 0; i < 6; i++) {
        const angle = i * PI / 3 + row * .13;
        const slit = this.box(group, [.055, .12, .014], theme.roof, [Math.sin(angle) * .371, .44 + row * .32, Math.cos(angle) * .371]); slit.rotation.y = angle;
      }
    }
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
    this.cylinder(parent, [.025, .035, .32 * scale, 6], theme.trim, [x, .16 * scale, z]);
    this.sphere(parent, .18 * scale, palette.leaf, [x, .37 * scale, z], [.9, 1.5, .9]);
  }

  tokenModel(kind, color, index = 0, miniature = false) {
    const group = new THREE.Group();
    const metal = this.material(color, { metalness: .25, roughness: .45 });
    const dark = this.material('#303b3b', { metalness: .2, roughness: .5 });
    const pale = this.material('#eee7d6', { metalness: .12, roughness: .6 });
    if (!miniature) {
      this.cylinder(group, [.185, .21, .075, 24], metal, [0, .04, 0]);
      this.cylinder(group, [.148, .17, .034, 24], pale, [0, .091, 0]);
    }
    const body = new THREE.Group(); body.position.y = miniature ? 0 : .105; group.add(body);
    if (kind === 'cat') {
      this.sphere(body, .16, metal, [0, .20, 0], [.77, 1.22, .8]);
      this.sphere(body, .14, metal, [0, .40, -.016], [1, .93, .85]);
      for (const x of [-.085, .085]) this.cylinder(body, [0, .065, .145, 3], metal, [x, .52, -.022]);
      for (const x of [-.052, .052]) this.sphere(body, .015, pale, [x, .414, .112]);
      const tail = this.mesh(body, 'TorusGeometry', [.13, .033, 6, 16, PI * 1.55], metal, [.12, .17, -.028]); tail.rotation.y = PI / 2; tail.rotation.z = -.55;
    } else if (kind === 'tower') {
      this.cylinder(body, [.105, .135, .32, 16], metal, [0, .16, 0]);
      this.cylinder(body, [.16, .14, .052, 16], pale, [0, .33, 0]);
      this.cylinder(body, [.117, .117, .10, 16], metal, [0, .405, 0]);
      this.cylinder(body, [0, .18, .26, 16], metal, [0, .58, 0]);
      for (const x of [-.057, .057]) this.box(body, [.03, .055, .02], dark, [x, .407, .11]);
    } else if (kind === 'tulip') {
      this.cylinder(body, [.025, .036, .35, 8], metal, [0, .18, 0]);
      for (const side of [-1, 1]) {
        const leaf = this.sphere(body, .10, metal, [side * .067, .18, 0], [.35, 1.35, .4]); leaf.rotation.z = side * -.57;
      }
      this.sphere(body, .135, metal, [0, .42, 0], [.9, 1.02, .75]);
      for (const x of [-.082, 0, .082]) this.cylinder(body, [0, .067, .19, 5], metal, [x, .53 + (x === 0 ? .025 : 0), 0]);
    } else if (kind === 'tea') {
      this.cylinder(body, [.21, .19, .027, 24], pale, [0, .025, 0]);
      const points = [[.09, 0], [.135, .05], [.085, .19], [.125, .35], [.137, .38]].map(([x, y]) => new THREE.Vector2(x, y));
      const glass = new THREE.Mesh(new THREE.LatheGeometry(points, 24), metal); glass.position.y = .04; glass.castShadow = true; glass.userData.ownGeometry = true; body.add(glass);
      this.cylinder(body, [.118, .118, .025, 24], dark, [0, .412, 0]);
      const spoon = this.box(body, [.019, .37, .024], pale, [.095, .39, 0]); spoon.rotation.z = -.17;
    } else if (kind === 'tram') {
      this.box(body, [.29, .27, .43], metal, [0, .205, 0]);
      this.box(body, [.33, .04, .47], pale, [0, .362, 0]);
      for (const z of [-.22, .22]) {
        this.box(body, [.20, .095, .014], dark, [0, .255, z]);
        this.sphere(body, .028, pale, [0, .137, z]);
      }
      for (const x of [-.15, .15]) {
        for (const z of [-.12, .12]) { const wheel = this.cylinder(body, [.053, .053, .03, 12], dark, [x, .063, z]); wheel.rotation.z = PI / 2; }
        for (const z of [-.1, .065]) this.box(body, [.009, .095, .103], dark, [x, .263, z]);
      }
      const pickup = this.box(body, [.018, .22, .018], metal, [0, .48, 0]); pickup.rotation.z = -.42;
      this.box(body, [.18, .019, .045], dark, [.045, .576, 0]);
    } else {
      const hull = this.cylinder(body, [.235, .16, .14, 4], metal, [0, .09, 0]); hull.rotation.y = PI / 4; hull.scale.set(1.0, 1, 1.8);
      this.box(body, [.26, .145, .43], pale, [0, .225, -.02]);
      this.box(body, [.285, .025, .47], metal, [0, .31, -.02]);
      this.box(body, [.15, .10, .19], metal, [0, .367, -.10]);
      this.cylinder(body, [.038, .047, .15, 10], dark, [0, .43, .038]);
      for (const x of [-.133, .133]) for (const z of [-.15, -.02, .11]) this.box(body, [.012, .044, .069], dark, [x, .255, z]);
    }
    group.rotation.y = index * .25;
    return group;
  }

  makeDice(theme) {
    this.dice = [];
    const faces = [3, 4, 1, 6, 2, 5];
    const pips = { 1: [[0, 0]], 2: [[-1, -1], [1, 1]], 3: [[-1, -1], [0, 0], [1, 1]], 4: [[-1, -1], [1, -1], [-1, 1], [1, 1]], 5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]], 6: [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]] };
    for (let index = 0; index < 2; index++) {
      const materials = faces.map(value => new THREE.MeshStandardMaterial({ roughness: .55, map: canvasTexture(128, 128, context => {
        context.fillStyle = '#f6f0df'; context.fillRect(0, 0, 128, 128); context.strokeStyle = '#c4bba8'; context.lineWidth = 5; context.strokeRect(2, 2, 124, 124);
        context.fillStyle = '#343b3a';
        for (const [x, y] of pips[value]) { context.beginPath(); context.arc(64 + x * 32, 64 + y * 32, 10, 0, PI * 2); context.fill(); }
      }) }));
      const die = new THREE.Mesh(this.geometry('BoxGeometry', [.43, .43, .43]), materials);
      die.position.set(index === 0 ? -.38 : .38, .52, 3.75); die.castShadow = true; die.userData.ownMaterial = true;
      die.rotation.y = index === 0 ? .2 : -.15;
      this.board.add(die); this.dice.push(die);
    }
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
    return (state?.lastAction?.type === 'ROLL' ? 650 : 0) + (state?.lastMove?.path?.length || 0) * 70;
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
        const diceDelay = state.lastAction?.type === 'ROLL' ? 650 : 0;
        const duration = diceDelay + move.path.length * 70;
        this.animate(duration, (progress, elapsed) => {
          const moved = Math.max(0, elapsed - diceDelay) / 70;
          const step = Math.min(path.length - 2, Math.floor(moved));
          const local = clamp(moved - step, 0, 1);
          entry.mesh.position.lerpVectors(path[step], path[step + 1], local);
          const teleport = move.teleports?.some(jump => jump.at === step);
          entry.mesh.position.y = top + .036 + Math.sin(local * PI) * (teleport ? 1.6 : .22);
          entry.mesh.rotation.z = Math.sin(local * PI * 2) * .08;
          if (elapsed < diceDelay) entry.mesh.position.copy(path[0]);
        }, () => { entry.mesh.position.copy(destination); entry.mesh.rotation.z = 0; entry.moving = false; });
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
    for (const [index, die] of this.dice.entries()) {
      die.visible = Boolean(isGame);
      const target = this.diceOrientation(state?.dice?.[index] || 1, index);
      if (animate && state?.lastAction?.type === 'ROLL') {
        const spin = new THREE.Quaternion();
        this.animate(650, progress => {
          spin.setFromEuler(new THREE.Euler(progress * PI * (8 + index), progress * PI * 5, progress * PI * (6 - index)));
          die.quaternion.copy(spin).slerp(target, ease(clamp((progress - .62) / .38, 0, 1)));
          die.position.y = .52 + Math.sin(progress * PI) * .85 + Math.abs(Math.sin(progress * PI * 3)) * .14 * (1 - progress);
        }, () => { die.quaternion.copy(target); die.position.y = .52; });
      } else if (!this.animations.length || rebuilt || this.options.reducedMotion) die.quaternion.copy(target);
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
      context.textAlign = 'center'; context.font = 'bold 34px ui-monospace, monospace';
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
    const distance = 23.8 / Math.min(1.1, this.camera.aspect) / zoom;
    this.camera.position.set(Math.sin(azimuth) * Math.cos(elevation) * distance, Math.sin(elevation) * distance, Math.cos(azimuth) * Math.cos(elevation) * distance);
    this.camera.lookAt(0, .28, .48);
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
