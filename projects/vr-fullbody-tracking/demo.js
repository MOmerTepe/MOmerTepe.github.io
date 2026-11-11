// Interactive schematic for the vr-fullbody-tracking case study.
// A scripted demo in a wireframe room: the room scales up and down, cameras
// are added and removed in its corners, and the fused joint estimate tightens
// or loosens with the views it has. On wide screens each camera's own 2D pose
// estimate sits in a tile at the side. Drag to orbit.
// Pure canvas, no dependencies. Monochrome: every mark uses the page's ink
// color at varying alpha so it follows the light/dark theme automatically.
(function () {
  'use strict';

  var canvas = document.getElementById('vr-demo');
  if (!canvas || !canvas.getContext) return;
  var ctx = canvas.getContext('2d');

  // ---- small vector helpers ([x, y, z], y up, meters) ----
  function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  function add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
  function mul(a, s) { return [a[0] * s, a[1] * s, a[2] * s]; }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function cross(a, b) {
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  }
  function len(a) { return Math.sqrt(dot(a, a)); }
  function norm(a) { var l = len(a) || 1; return mul(a, 1 / l); }
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function smooth(a, b, x) { var u = clamp((x - a) / (b - a), 0, 1); return u * u * (3 - 2 * u); }

  // ---- the subject: COCO-17 skeleton, standing pose ----
  var BASE = [
    [0, 1.60, 0.06],                          //  0 nose
    [0.035, 1.64, 0.05], [-0.035, 1.64, 0.05], //  1,2 eyes
    [0.08, 1.61, 0.00], [-0.08, 1.61, 0.00],   //  3,4 ears
    [0.19, 1.40, 0.00], [-0.19, 1.40, 0.00],   //  5,6 shoulders
    [0.25, 1.14, 0.01], [-0.25, 1.14, 0.01],   //  7,8 elbows
    [0.27, 0.90, 0.05], [-0.27, 0.90, 0.05],   //  9,10 wrists
    [0.10, 0.96, 0.00], [-0.10, 0.96, 0.00],   // 11,12 hips
    [0.12, 0.52, 0.01], [-0.12, 0.52, 0.01],   // 13,14 knees
    [0.13, 0.07, 0.00], [-0.13, 0.07, 0.00]    // 15,16 ankles
  ];
  var BONES = [
    [0, 1], [0, 2], [1, 3], [2, 4], [3, 5], [4, 6],
    [5, 6], [5, 7], [7, 9], [6, 8], [8, 10],
    [5, 11], [6, 12], [11, 12], [11, 13], [13, 15], [12, 14], [14, 16]
  ];
  var HIGHLIGHTS = [
    [9, 'left_wrist'], [16, 'right_ankle'], [0, 'nose'], [10, 'right_wrist'], [13, 'left_knee']
  ];
  var HIGHLIGHT_PERIOD = 4.5;

  // ---- the demo script: one 32 s loop ----
  var LOOP = 32, ROOM_H = 2.5;
  var PHASES = [
    [6, 'two cameras'], [8, 'scaling the room up'], [12, 'larger room, same two cameras'],
    [13, 'adding a camera'], [17, 'three cameras'], [18, 'adding a camera'], [23, 'four cameras'],
    [25, 'scaling the room down'], [28, 'four cameras'], [29, 'removing a camera'],
    [30, 'three cameras'], [31, 'removing a camera'], [LOOP, 'two cameras']
  ];
  // cameras sit in the room's upper corners (sx, sz = which corner), so they
  // move with the walls; `on` is how present each one is right now (0..1)
  var LOOK = [0, 1.0, 0];
  var CAMS = [
    { label: 'cam 0', sx: -1, sz: 1 }, { label: 'cam 1', sx: 1, sz: 1 },
    { label: 'cam 2', sx: -1, sz: -1 }, { label: 'cam 3', sx: 1, sz: -1 }
  ];
  var hx = 1.6, hz = 1.6;  // room half-width and half-depth

  function updateRig(time) {
    var s = time % LOOP;
    var grow = smooth(6, 8, s) - smooth(23, 25, s);
    hx = 1.6 + 0.7 * grow;
    hz = 1.6 + 0.4 * grow;
    CAMS[0].on = CAMS[1].on = 1;
    CAMS[2].on = smooth(12, 12.8, s) - smooth(30, 30.8, s);
    CAMS[3].on = smooth(17, 17.8, s) - smooth(28, 28.8, s);
    CAMS.forEach(function (c) {
      c.pos = [c.sx * (hx - 0.12), 2.15, c.sz * (hz - 0.12)];
      c.dir = norm(sub(LOOK, c.pos));
      c.right = norm(cross(c.dir, [0, 1, 0]));
      c.up = cross(c.right, c.dir);
    });
  }
  function phaseText(time) {
    var s = time % LOOP;
    for (var i = 0; i < PHASES.length; i++) if (s < PHASES[i][0]) return PHASES[i][1];
    return '';
  }

  // ---- viewer (orbit) state ----
  var TARGET = [0, 1.0, 0];
  var ORBIT_R = 7;
  var yaw = -0.5, pitch = 0.42;  // pitch: 0 = level, up to nearly top-down
  var W = 0, H = 0, dpr = 1;
  var ink = '#1a1a18';
  var panelW = 0;  // width of each column of camera tiles; 0 on narrow screens

  var reduced = false;
  try { reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}

  var t = reduced ? 14.5 : 0;
  var dragging = false, lastInteract = -1e9;
  var inView = true, pageVisible = !document.hidden;

  function sampleInk() {
    try { ink = getComputedStyle(canvas).color || ink; } catch (e) {}
  }

  function resize() {
    var w = canvas.clientWidth || canvas.parentNode.clientWidth;
    if (!w) return;
    var h = Math.round(clamp(w * 0.5, 300, 600));
    panelW = w >= 760 ? Math.round(Math.min(w * 0.22, 260)) : 0;
    dpr = window.devicePixelRatio || 1;
    W = w; H = h;
    canvas.style.height = h + 'px';
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // The viewer orbits TARGET; positive pitch lifts the viewer above the scene.
  function project(p) {
    var d = sub(p, TARGET);
    var cy = Math.cos(yaw), sy = Math.sin(yaw);
    var x1 = d[0] * cy - d[2] * sy;
    var z1 = d[0] * sy + d[2] * cy;
    var cp = Math.cos(pitch), sp = Math.sin(pitch);
    var y2 = d[1] * cp + z1 * sp;
    var z2 = -d[1] * sp + z1 * cp;
    var depth = z2 + ORBIT_R;
    if (depth < 0.4) return null;
    var k = Math.min(1.45 * H, (W - panelW * 2) * 1.25);
    return [W / 2 + x1 * k / depth, H * 0.5 - y2 * k / depth];
  }

  function line3(a, b) {
    var pa = project(a), pb = project(b);
    if (!pa || !pb) return;
    ctx.beginPath();
    ctx.moveTo(pa[0], pa[1]);
    ctx.lineTo(pb[0], pb[1]);
    ctx.stroke();
  }
  function loop3(pts) {
    for (var i = 0; i < pts.length; i++) line3(pts[i], pts[(i + 1) % pts.length]);
  }
  function box3(x0, x1, y0, y1, z0, z1) {
    loop3([[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]]);
    loop3([[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]]);
    line3([x0, y0, z0], [x0, y1, z0]); line3([x1, y0, z0], [x1, y1, z0]);
    line3([x1, y0, z1], [x1, y1, z1]); line3([x0, y0, z1], [x0, y1, z1]);
  }
  function text3(str, p, dx, dy) {
    var s = project(p);
    if (s) ctx.fillText(str, s[0] + (dx || 0), s[1] + (dy || 0));
  }

  function dot2(p, r) {
    var s = project(p);
    if (!s) return null;
    ctx.fillRect(s[0] - r, s[1] - r, r * 2, r * 2);
    return s;
  }

  // ---- procedural march-in-place + slow body turn ----
  var J = [];
  for (var i = 0; i < 17; i++) J.push([0, 0, 0]);

  function liftLeg(knee, ankle, s) {
    var u = Math.max(0, s);
    J[ankle][1] += 0.16 * u; J[ankle][2] += 0.06 * s;
    J[knee][1] += 0.08 * u; J[knee][2] += 0.07 * u;
  }
  function swingArm(elbow, wrist, s) {
    J[wrist][2] += 0.12 * s; J[wrist][1] += 0.02 * Math.abs(s);
    J[elbow][2] += 0.06 * s;
  }

  function pose(time) {
    var p = time * 2.4;
    var bob = 0.02 * (0.5 + 0.5 * Math.cos(2 * p));
    var L = Math.sin(p), R = Math.sin(p + Math.PI);
    for (var i = 0; i < 17; i++) {
      J[i][0] = BASE[i][0]; J[i][1] = BASE[i][1]; J[i][2] = BASE[i][2];
    }
    liftLeg(13, 15, L); liftLeg(14, 16, R);
    swingArm(7, 9, R); swingArm(8, 10, L);
    for (i = 0; i <= 12; i++) J[i][1] += bob;
    // slow turn so joints periodically get occluded from one camera
    var b = 1.15 * Math.sin(time * 0.32), cb = Math.cos(b), sb = Math.sin(b);
    for (i = 0; i < 17; i++) {
      var x = J[i][0], z = J[i][2];
      J[i][0] = x * cb - z * sb;
      J[i][2] = x * sb + z * cb;
    }
  }

  // smooth deterministic "noise" for per-camera measurement error
  function wobble(time, seed) {
    return Math.sin(1.7 * time + seed) * 0.6 + Math.sin(2.9 * time + seed * 1.7) * 0.4;
  }

  // how much the body blocks this camera's view of a point (0..1);
  // the trunk is approximated by spheres from shoulders down to the hips
  function occlusion(cam, point, blockers) {
    var d = sub(point, cam.pos);
    var L = len(d), dn = mul(d, 1 / L);
    var worst = 0;
    for (var i = 0; i < blockers.length; i++) {
      var v = sub(blockers[i].c, cam.pos);
      var s = dot(v, dn);
      if (s < 0.2 || s > L - 0.1) continue;
      var perp = len(sub(v, mul(dn, s)));
      var occ = clamp((blockers[i].r - perp) / 0.10, 0, 1);
      if (occ > worst) worst = occ;
    }
    return worst;
  }

  function drawRoom() {
    var g;
    // floor grid, one line every half meter, growing with the room
    ctx.globalAlpha = 0.1;
    for (g = -Math.floor(hx * 2) / 2; g <= hx; g += 0.5) line3([g, 0, -hz], [g, 0, hz]);
    for (g = -Math.floor(hz * 2) / 2; g <= hz; g += 0.5) line3([-hx, 0, g], [hx, 0, g]);
    // walls and ceiling
    ctx.globalAlpha = 0.3;
    loop3([[-hx, 0, -hz], [hx, 0, -hz], [hx, 0, hz], [-hx, 0, hz]]);
    ctx.globalAlpha = 0.16;
    loop3([[-hx, ROOM_H, -hz], [hx, ROOM_H, -hz], [hx, ROOM_H, hz], [-hx, ROOM_H, hz]]);
    for (var sx = -1; sx <= 1; sx += 2) for (var sz = -1; sz <= 1; sz += 2) line3([sx * hx, 0, sz * hz], [sx * hx, ROOM_H, sz * hz]);

    // door in the left wall, window in the right one
    ctx.globalAlpha = 0.28;
    loop3([[-hx, 0, 0.5], [-hx, 2.0, 0.5], [-hx, 2.0, 1.35], [-hx, 0, 1.35]]);
    line3([-hx, 1.0, 1.22], [-hx, 1.0, 1.28]);
    loop3([[hx, 0.95, -0.7], [hx, 2.0, -0.7], [hx, 2.0, 0.7], [hx, 0.95, 0.7]]);
    line3([hx, 0.95, 0], [hx, 2.0, 0]);

    // desk, monitor and the PC that runs the tracking, against the back wall
    var dx0 = hx - 1.55, dx1 = hx - 0.25, dz0 = -hz + 0.05, dz1 = -hz + 0.65;
    loop3([[dx0, 0.74, dz0], [dx1, 0.74, dz0], [dx1, 0.74, dz1], [dx0, 0.74, dz1]]);
    line3([dx0, 0, dz0], [dx0, 0.74, dz0]); line3([dx1, 0, dz0], [dx1, 0.74, dz0]);
    line3([dx0, 0, dz1], [dx0, 0.74, dz1]); line3([dx1, 0, dz1], [dx1, 0.74, dz1]);
    loop3([[dx0 + 0.3, 0.86, dz0 + 0.2], [dx0 + 0.95, 0.86, dz0 + 0.2], [dx0 + 0.95, 1.24, dz0 + 0.2], [dx0 + 0.3, 1.24, dz0 + 0.2]]);
    line3([dx0 + 0.625, 0.74, dz0 + 0.2], [dx0 + 0.625, 0.86, dz0 + 0.2]);
    box3(dx1 - 0.24, dx1 - 0.04, 0, 0.45, dz0 + 0.08, dz1 - 0.08);
    ctx.globalAlpha = 0.55;
    ctx.textAlign = 'center';
    text3('pc', [dx1 - 0.14, 0.45, dz0 + 0.3], 0, -5);

    // play area marked on the floor
    ctx.globalAlpha = 0.4;
    ctx.setLineDash([3, 4]);
    loop3([[-1, 0, -1], [1, 0, -1], [1, 0, 1], [-1, 0, 1]]);
    ctx.setLineDash([]);

    // room dimensions along two floor edges
    ctx.globalAlpha = 0.6;
    text3((hx * 2).toFixed(1) + ' m', [0, 0, hz], 0, 14);
    text3((hz * 2).toFixed(1) + ' m', [hx, 0, 0], 22, 4);
  }

  function drawCamera(cam, conf) {
    var a = cam.on, sc = 0.4 + 0.6 * a;
    var n = add(cam.pos, mul(cam.dir, 0.36 * sc));
    var corners = [];
    for (var sx = -1; sx <= 1; sx += 2) {
      for (var sy = -1; sy <= 1; sy += 2) {
        corners.push(add(n, add(mul(cam.right, 0.15 * sc * sx), mul(cam.up, 0.1 * sc * sy))));
      }
    }
    ctx.globalAlpha = 0.6 * a;
    // pyramid edges + near-plane rectangle (corner order: --, -+, +-, ++)
    var rect = [corners[0], corners[1], corners[3], corners[2]];
    for (var i = 0; i < 4; i++) {
      line3(cam.pos, rect[i]);
      line3(rect[i], rect[(i + 1) % 4]);
    }
    // mount up to the ceiling corner
    line3(cam.pos, [cam.sx * hx, ROOM_H, cam.sz * hz]);
    var sp = project(cam.pos);
    if (sp) {
      var left = sp[0] < W / 2;
      ctx.textAlign = left ? 'right' : 'left';
      var tx = sp[0] + (left ? -8 : 8);
      ctx.globalAlpha = 0.75 * a;
      ctx.fillText(cam.label, tx, sp[1] - 4);
      ctx.globalAlpha = (0.4 + 0.5 * conf) * a;
      ctx.fillText('c=' + conf.toFixed(2), tx, sp[1] + 9);
    }
  }

  // one camera's image: the 2D pose it estimates on its own. Joints the body
  // hides from this camera are unlit; the highlighted joint is boxed.
  // A camera that is not in the room yet is an empty dashed tile.
  function drawCamView(c, x, y, w, h, est, conf, blockers) {
    var cam = CAMS[c];
    ctx.lineWidth = 1;
    ctx.textAlign = 'left';
    if (cam.on < 0.5) {
      ctx.globalAlpha = 0.3;
      ctx.setLineDash([4, 4]);
      ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
      ctx.setLineDash([]);
      ctx.globalAlpha = 0.45;
      ctx.fillText(cam.label + ' · off', x + 7, y + 15);
      return;
    }
    var f = h * 1.15, cx = x + w / 2, cy = y + h * 0.52;
    function px(p) {
      var d = sub(p, cam.pos), z = dot(d, cam.dir);
      return [cx + dot(d, cam.right) / z * f, cy - dot(d, cam.up) / z * f];
    }
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    // the floor's play area, so the tile reads as a view into the room
    ctx.globalAlpha = 0.2;
    var pa = [px([-1, 0, -1]), px([1, 0, -1]), px([1, 0, 1]), px([-1, 0, 1])];
    ctx.beginPath();
    for (var q = 0; q < 4; q++) { if (q) ctx.lineTo(pa[q][0], pa[q][1]); else ctx.moveTo(pa[q][0], pa[q][1]); }
    ctx.closePath();
    ctx.stroke();
    ctx.globalAlpha = 0.45;
    for (var b = 0; b < BONES.length; b++) {
      var a2 = px(J[BONES[b][0]]), b2 = px(J[BONES[b][1]]);
      ctx.beginPath(); ctx.moveTo(a2[0], a2[1]); ctx.lineTo(b2[0], b2[1]); ctx.stroke();
    }
    for (var j = 0; j < 17; j++) {
      var p = px(J[j]);
      if (occlusion(cam, J[j], blockers) > 0.5) {
        ctx.globalAlpha = 0.35; ctx.strokeRect(p[0] - 2.5, p[1] - 2.5, 5, 5);
      } else {
        ctx.globalAlpha = 0.95; ctx.fillRect(p[0] - 2, p[1] - 2, 4, 4);
      }
    }
    var e = px(est);
    ctx.globalAlpha = 0.3 + 0.65 * conf;
    ctx.strokeRect(Math.round(e[0]) - 7.5, Math.round(e[1]) - 7.5, 15, 15);
    ctx.restore();

    ctx.globalAlpha = 0.25;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    ctx.globalAlpha = 0.7;
    ctx.fillText(cam.label + ' · 2d pose', x + 7, y + 15);
    ctx.globalAlpha = 0.45 + 0.5 * conf;
    ctx.fillText('c=' + conf.toFixed(2), x + 7, y + h - 8);
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    ctx.strokeStyle = ink;
    ctx.fillStyle = ink;
    ctx.lineWidth = 1;
    ctx.font = '11px "IBM Plex Mono", monospace';

    ctx.save();
    ctx.beginPath();
    ctx.rect(panelW, 0, W - panelW * 2, H);
    ctx.clip();

    drawRoom();

    // highlighted joint of the moment
    var slot = Math.floor(t / HIGHLIGHT_PERIOD) % HIGHLIGHTS.length;
    var hlIdx = HIGHLIGHTS[slot][0];
    var hlName = HIGHLIGHTS[slot][1];
    var fadeIn = clamp((t % HIGHLIGHT_PERIOD) / 0.5, 0, 1);
    var joint = J[hlIdx];

    var chest = mul(add(J[5], J[6]), 0.5);
    var pelvis = mul(add(J[11], J[12]), 0.5);
    var blockers = [
      { c: chest, r: 0.20 },
      { c: mul(add(chest, pelvis), 0.5), r: 0.24 },
      { c: pelvis, r: 0.22 }
    ];

    // per-camera measurement: noisy estimate + confidence. Confidence falls
    // when the body blocks the view, and a little with distance, so a bigger
    // room costs each camera some certainty.
    var ests = [], confs = [], c;
    for (c = 0; c < CAMS.length; c++) {
      var cam = CAMS[c];
      var dist = len(sub(joint, cam.pos));
      var off = add(
        mul(cam.right, 0.008 * dist * wobble(t, c * 3.1)),
        mul(cam.up, 0.006 * dist * wobble(t, c * 5.7 + 1))
      );
      var est = add(joint, off);
      var occ = occlusion(cam, est, blockers);
      var conf = clamp((1.22 - 0.1 * dist) - 0.8 * occ + 0.02 * Math.sin(7 * t + c * 3), 0.08, 0.98);
      ests.push(est); confs.push(conf);
    }

    // skeleton
    ctx.globalAlpha = 0.9;
    ctx.lineWidth = 1.4;
    for (var b = 0; b < BONES.length; b++) line3(J[BONES[b][0]], J[BONES[b][1]]);
    for (var j = 0; j < 17; j++) dot2(J[j], j === hlIdx ? 3 : 1.8);
    ctx.lineWidth = 1;

    // cameras and their bearing rays (dashed, alpha follows confidence)
    for (c = 0; c < CAMS.length; c++) if (CAMS[c].on > 0.01) drawCamera(CAMS[c], confs[c]);
    ctx.setLineDash([4, 4]);
    for (c = 0; c < CAMS.length; c++) {
      ctx.globalAlpha = fadeIn * CAMS[c].on * (0.12 + 0.55 * confs[c]);
      line3(CAMS[c].pos, add(CAMS[c].pos, mul(sub(ests[c], CAMS[c].pos), 1.12)));
    }
    ctx.setLineDash([]);

    // fused estimate: confidence-weighted blend of every camera in the room
    var wsum = 0, fused = [0, 0, 0], views = 0;
    for (c = 0; c < CAMS.length; c++) {
      var wgt = confs[c] * CAMS[c].on;
      wsum += wgt;
      fused = add(fused, mul(ests[c], wgt));
      if (CAMS[c].on >= 0.5) views++;
    }
    fused = mul(fused, 1 / wsum);
    var sf = project(fused);
    if (sf) {
      var uncertainty = 4 + 30 * Math.pow(clamp(1 - wsum / 2.4, 0, 1), 1.3);
      ctx.globalAlpha = fadeIn * 0.5;
      ctx.strokeRect(sf[0] - uncertainty, sf[1] - uncertainty, uncertainty * 2, uncertainty * 2);
      ctx.globalAlpha = fadeIn * 0.95;
      ctx.fillRect(sf[0] - 2.6, sf[1] - 2.6, 5.2, 5.2);
      ctx.textAlign = 'left';
      ctx.fillText(hlName, sf[0] + uncertainty + 6, sf[1] + 3);
    }

    // what the demo is doing right now
    ctx.textAlign = 'left';
    ctx.globalAlpha = 0.95;
    ctx.fillText(phaseText(t), panelW + 12, 20);
    ctx.globalAlpha = 0.6;
    ctx.fillText(views + ' views · room ' + (hx * 2).toFixed(1) + ' × ' + (hz * 2).toFixed(1) + ' m', panelW + 12, 35);
    ctx.restore();

    if (panelW) {
      var pad = 10, tw = panelW - pad * 2, th = (H - pad * 3) / 2;
      for (c = 0; c < CAMS.length; c++) {
        drawCamView(c, (c % 2 ? W - panelW : 0) + pad, pad + (c > 1 ? th + pad : 0), tw, th, ests[c], confs[c], blockers);
      }
    }

    ctx.globalAlpha = 1;
  }

  // ---- interaction: drag to orbit. Dragging down tips the scene toward
  // you, so you look at it from higher up. ----
  canvas.addEventListener('pointerdown', function (e) {
    dragging = true;
    lastInteract = performance.now();
    try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
    canvas.style.cursor = 'grabbing';
  });
  canvas.addEventListener('pointermove', function (e) {
    if (!dragging) return;
    yaw += (e.movementX || 0) * 0.006;
    pitch = clamp(pitch + (e.movementY || 0) * 0.005, 0.03, 1.4);
    lastInteract = performance.now();
    if (reduced) draw();
  });
  function endDrag() { dragging = false; canvas.style.cursor = 'grab'; }
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  // ---- lifecycle: theme, visibility, resize ----
  document.addEventListener('omt:render', sampleInk);
  try {
    var mq = window.matchMedia('(prefers-color-scheme: dark)');
    if (mq.addEventListener) mq.addEventListener('change', sampleInk);
    else if (mq.addListener) mq.addListener(sampleInk);
  } catch (e) {}
  document.addEventListener('visibilitychange', function () { pageVisible = !document.hidden; });
  if (window.IntersectionObserver) {
    new IntersectionObserver(function (entries) {
      inView = entries[0].isIntersecting;
    }).observe(canvas);
  }
  window.addEventListener('resize', resize);

  var last = performance.now();
  function frame(now) {
    var dt = clamp((now - last) / 1000, 0, 0.05);  // the first rAF stamp can precede `last`
    last = now;
    if (pageVisible && inView) {
      if (!reduced) {
        t += dt;
        if (!dragging && now - lastInteract > 3000) yaw += dt * 0.1;
      }
      updateRig(t);
      pose(t);
      draw();
    }
    requestAnimationFrame(frame);
  }

  resize();
  sampleInk();
  requestAnimationFrame(frame);
})();
