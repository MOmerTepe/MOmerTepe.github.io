// Interactive schematic for the vr-fullbody-tracking case study.
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

  // ---- tracking cameras ----
  var LOOK = [0, 1.0, 0];
  var CAMS = [
    { pos: [-1.9, 1.55, 2.2], label: 'cam 0' },
    { pos: [1.9, 1.55, 2.2], label: 'cam 1' }
  ];
  CAMS.forEach(function (c) {
    c.dir = norm(sub(LOOK, c.pos));
    c.right = norm(cross(c.dir, [0, 1, 0]));
    c.up = cross(c.right, c.dir);
  });

  // ---- viewer (orbit) state ----
  var TARGET = [0, 0.95, 0];
  var ORBIT_R = 4.6;
  var yaw = -0.5, pitch = 0.34;
  var W = 0, H = 0, dpr = 1;
  var ink = '#1c1c1a';

  var reduced = false;
  try { reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}

  var t = reduced ? 2.3 : 0;
  var dragging = false, lastInteract = -1e9;
  var inView = true, pageVisible = !document.hidden;

  function sampleInk() {
    try { ink = getComputedStyle(canvas).color || ink; } catch (e) {}
  }

  function resize() {
    var w = canvas.clientWidth || canvas.parentNode.clientWidth;
    if (!w) return;
    var h = Math.round(clamp(w * 0.58, 260, 440));
    dpr = window.devicePixelRatio || 1;
    W = w; H = h;
    canvas.style.height = h + 'px';
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function project(p) {
    var d = sub(p, TARGET);
    var cy = Math.cos(yaw), sy = Math.sin(yaw);
    var x1 = d[0] * cy - d[2] * sy;
    var z1 = d[0] * sy + d[2] * cy;
    var cp = Math.cos(pitch), sp = Math.sin(pitch);
    var y2 = d[1] * cp - z1 * sp;
    var z2 = d[1] * sp + z1 * cp;
    var depth = z2 + ORBIT_R;
    if (depth < 0.4) return null;
    var k = 1.5 * H;
    return [W / 2 + x1 * k / depth, H * 0.52 - y2 * k / depth];
  }

  function line3(a, b) {
    var pa = project(a), pb = project(b);
    if (!pa || !pb) return;
    ctx.beginPath();
    ctx.moveTo(pa[0], pa[1]);
    ctx.lineTo(pb[0], pb[1]);
    ctx.stroke();
  }

  function dot2(p, r) {
    var s = project(p);
    if (!s) return null;
    ctx.beginPath();
    ctx.arc(s[0], s[1], r, 0, Math.PI * 2);
    ctx.fill();
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

  function drawFrustum(cam) {
    var n = add(cam.pos, mul(cam.dir, 0.42));
    var corners = [];
    for (var sx = -1; sx <= 1; sx += 2) {
      for (var sy = -1; sy <= 1; sy += 2) {
        corners.push(add(n, add(mul(cam.right, 0.17 * sx), mul(cam.up, 0.11 * sy))));
      }
    }
    // pyramid edges + near-plane rectangle (corner order: --, -+, +-, ++)
    var rect = [corners[0], corners[1], corners[3], corners[2]];
    for (var i = 0; i < 4; i++) {
      line3(cam.pos, rect[i]);
      line3(rect[i], rect[(i + 1) % 4]);
    }
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    ctx.strokeStyle = ink;
    ctx.fillStyle = ink;
    ctx.lineWidth = 1;
    ctx.font = '10.5px "IBM Plex Mono", monospace';

    // floor grid
    ctx.globalAlpha = 0.15;
    for (var g = -1.6; g <= 1.61; g += 0.8) {
      line3([g, 0, -1.6], [g, 0, 1.6]);
      line3([-1.6, 0, g], [1.6, 0, g]);
    }

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

    // per-camera measurement: noisy estimate + confidence
    var ests = [], confs = [];
    for (var c = 0; c < 2; c++) {
      var cam = CAMS[c];
      var off = add(
        mul(cam.right, 0.022 * wobble(t, c * 3.1)),
        mul(cam.up, 0.016 * wobble(t, c * 5.7 + 1))
      );
      var est = add(joint, off);
      var occ = occlusion(cam, est, blockers);
      var conf = clamp(0.96 - 0.8 * occ + 0.02 * Math.sin(7 * t + c * 3), 0.08, 0.98);
      ests.push(est); confs.push(conf);
    }

    // skeleton
    ctx.globalAlpha = 0.9;
    ctx.lineWidth = 1.4;
    for (var b = 0; b < BONES.length; b++) line3(J[BONES[b][0]], J[BONES[b][1]]);
    for (var j = 0; j < 17; j++) dot2(J[j], j === hlIdx ? 3.2 : 2);

    // cameras
    ctx.lineWidth = 1;
    for (c = 0; c < 2; c++) {
      ctx.globalAlpha = 0.55;
      drawFrustum(CAMS[c]);
      var sp = project(CAMS[c].pos);
      if (sp) {
        ctx.globalAlpha = 0.75;
        ctx.textAlign = CAMS[c].pos[0] < 0 ? 'left' : 'right';
        var tx = sp[0] + (CAMS[c].pos[0] < 0 ? -2 : 2);
        ctx.fillText(CAMS[c].label, tx, sp[1] + 20);
        ctx.globalAlpha = 0.45 + 0.5 * confs[c];
        ctx.fillText('c=' + confs[c].toFixed(2), tx, sp[1] + 33);
      }
    }

    // bearing rays (dashed, alpha follows confidence)
    ctx.setLineDash([4, 4]);
    for (c = 0; c < 2; c++) {
      ctx.globalAlpha = fadeIn * (0.12 + 0.55 * confs[c]);
      var beyond = add(CAMS[c].pos, mul(sub(ests[c], CAMS[c].pos), 1.18));
      line3(CAMS[c].pos, beyond);
    }
    ctx.setLineDash([]);

    // fused estimate: confidence-weighted blend of the two measurements
    var wsum = confs[0] + confs[1];
    var fused = mul(add(mul(ests[0], confs[0]), mul(ests[1], confs[1])), 1 / wsum);
    var sf = project(fused);
    if (sf) {
      var uncertainty = 5 + 26 * Math.pow(1 - wsum / 2, 1.4);
      ctx.globalAlpha = fadeIn * 0.5;
      ctx.beginPath();
      ctx.arc(sf[0], sf[1], uncertainty, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = fadeIn * 0.95;
      ctx.beginPath();
      ctx.arc(sf[0], sf[1], 2.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.textAlign = 'left';
      ctx.fillText(hlName, sf[0] + uncertainty + 6, sf[1] + 3);
    }

    ctx.globalAlpha = 1;
  }

  // ---- interaction: drag to orbit ----
  canvas.addEventListener('pointerdown', function (e) {
    dragging = true;
    lastInteract = performance.now();
    canvas.setPointerCapture(e.pointerId);
    canvas.style.cursor = 'grabbing';
  });
  canvas.addEventListener('pointermove', function (e) {
    if (!dragging) return;
    yaw += (e.movementX || 0) * 0.006;
    pitch = clamp(pitch + (e.movementY || 0) * 0.004, 0.08, 0.75);
    lastInteract = performance.now();
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
    var dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (pageVisible && inView) {
      if (!reduced) {
        t += dt;
        if (!dragging && now - lastInteract > 3000) yaw += dt * 0.1;
      }
      pose(t);
      draw();
    }
    requestAnimationFrame(frame);
  }

  resize();
  sampleInk();
  requestAnimationFrame(frame);
})();
