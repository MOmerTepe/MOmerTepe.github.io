// Interactive schematic for the openteslacam case study.
// One simulated drive, rendered from six camera poses into a synchronized
// grid — plus a scrubbable timeline, because sync-while-seeking is the app's
// whole reason to exist. Pure canvas, monochrome ink from the page theme.
(function () {
  'use strict';

  var canvas = document.getElementById('otc-demo');
  if (!canvas || !canvas.getContext) return;
  var ctx = canvas.getContext('2d');

  var DUR = 12;         // loop length, seconds
  var SPEED = 14;       // ego speed, m/s
  var NEAR = 0.35;      // near clip plane, meters
  var SCRUB_H = 34;     // timeline band height, px

  // camera poses relative to the ego car (x right, y up, z forward)
  // showEgo: only the repeaters see the ego car's own flank — the box just
  // clutters views whose camera sits on or inside it
  var VIEWS = [
    { label: 'left repeater', pos: [-1.05, 1.0, 0.3], yaw: Math.PI + 0.42, f: 0.55, showEgo: true },
    { label: 'front', pos: [0, 1.3, 0.8], yaw: 0, f: 0.95 },
    { label: 'right repeater', pos: [1.05, 1.0, 0.3], yaw: Math.PI - 0.42, f: 0.55, showEgo: true },
    { label: 'left pillar', pos: [-0.95, 1.25, 0.9], yaw: -1.15, f: 0.55 },
    { label: 'back', pos: [0, 1.2, -2.4], yaw: Math.PI, f: 0.7 },
    { label: 'right pillar', pos: [0.95, 1.25, 0.9], yaw: 1.15, f: 0.55 }
  ];
  VIEWS.forEach(function (v) {
    v.dir = [Math.sin(v.yaw), 0, Math.cos(v.yaw)];
    v.right = [Math.cos(v.yaw), 0, -Math.sin(v.yaw)];
  });

  var W = 0, H = 0, dpr = 1;
  var ink = '#1c1c1a';
  var reduced = false;
  try { reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}
  var t = reduced ? 4.2 : 0;
  var scrubbing = false, lastInteract = -1e9;
  var inView = true, pageVisible = !document.hidden;

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function mod(a, n) { return ((a % n) + n) % n; }

  function sampleInk() {
    try { ink = getComputedStyle(canvas).color || ink; } catch (e) {}
  }

  function resize() {
    var w = canvas.clientWidth || canvas.parentNode.clientWidth;
    if (!w) return;
    var h = Math.round(clamp(w * 0.52, 240, 400));
    dpr = window.devicePixelRatio || 1;
    W = w; H = h;
    canvas.style.height = h + 'px';
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // draw a world-space segment into the current viewport
  function seg3(view, vp, a, b) {
    var ra = [a[0] - view.pos[0], a[1] - view.pos[1], a[2] - view.pos[2]];
    var rb = [b[0] - view.pos[0], b[1] - view.pos[1], b[2] - view.pos[2]];
    var za = ra[0] * view.dir[0] + ra[2] * view.dir[2];
    var zb = rb[0] * view.dir[0] + rb[2] * view.dir[2];
    if (za < NEAR && zb < NEAR) return;
    if (za < NEAR || zb < NEAR) {
      var k = (NEAR - za) / (zb - za);
      var m = [ra[0] + (rb[0] - ra[0]) * k, ra[1] + (rb[1] - ra[1]) * k, ra[2] + (rb[2] - ra[2]) * k];
      if (za < NEAR) { ra = m; za = NEAR; } else { rb = m; zb = NEAR; }
    }
    var fp = view.f * vp.w;
    var xa = ra[0] * view.right[0] + ra[2] * view.right[2];
    var xb = rb[0] * view.right[0] + rb[2] * view.right[2];
    var ya = ra[1] - 0.10 * za, yb = rb[1] - 0.10 * zb;
    ctx.beginPath();
    ctx.moveTo(vp.cx + xa * fp / za, vp.cy - ya * fp / za);
    ctx.lineTo(vp.cx + xb * fp / zb, vp.cy - yb * fp / zb);
    ctx.stroke();
  }

  function drawBox(view, vp, cx, halfW, z0, z1, y0, y1) {
    var c = [];
    for (var zi = 0; zi < 2; zi++) {
      for (var yi = 0; yi < 2; yi++) {
        for (var xi = 0; xi < 2; xi++) {
          c.push([cx + (xi ? halfW : -halfW), yi ? y1 : y0, zi ? z1 : z0]);
        }
      }
    }
    var E = [[0,1],[2,3],[4,5],[6,7],[0,2],[1,3],[4,6],[5,7],[0,4],[1,5],[2,6],[3,7]];
    for (var i = 0; i < E.length; i++) seg3(view, vp, c[E[i][0]], c[E[i][1]]);
  }

  function drawWorld(view, vp, time) {
    var off = time * SPEED;
    var k;

    // road edges + guardrail top (translation-invariant along z)
    ctx.globalAlpha = 0.35;
    seg3(view, vp, [1.8, 0, -36], [1.8, 0, 66]);
    seg3(view, vp, [-5.4, 0, -36], [-5.4, 0, 66]);
    seg3(view, vp, [2.7, 0.9, -36], [2.7, 0.9, 66]);

    // center dashes (scroll backward as the ego moves)
    ctx.globalAlpha = 0.3;
    for (k = 0; k < 18; k++) {
      var zd = -36 + k * 6 + mod(-off, 6);
      seg3(view, vp, [-1.8, 0, zd], [-1.8, 0, zd + 2]);
    }
    // guardrail posts
    for (k = 0; k < 14; k++) {
      var zp = -36 + k * 8 + mod(-off, 8);
      seg3(view, vp, [2.7, 0, zp], [2.7, 0.9, zp]);
    }

    // ego car (repeaters only) + overtaking car
    ctx.globalAlpha = 0.75;
    if (view.showEgo) drawBox(view, vp, 0, 0.8, -2.2, 2.2, 0.35, 1.45);
    var zRel = -26 + 62 * (time / DUR);
    drawBox(view, vp, -3.6, 0.85, zRel - 2.2, zRel + 2.2, 0.35, 1.45);
  }

  function fmt(s) {
    s = Math.floor(s);
    return '0:' + (s < 10 ? '0' : '') + s;
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    ctx.strokeStyle = ink;
    ctx.fillStyle = ink;
    ctx.lineWidth = 1;
    ctx.font = '10px "IBM Plex Mono", monospace';

    var pad = 8, gap = 6;
    var vw = (W - pad * 2 - gap * 2) / 3;
    var vh = (H - SCRUB_H - pad * 2 - gap) / 2;

    for (var i = 0; i < 6; i++) {
      var vx = pad + (i % 3) * (vw + gap);
      var vy = pad + Math.floor(i / 3) * (vh + gap);
      var vp = { x: vx, y: vy, w: vw, h: vh, cx: vx + vw / 2, cy: vy + vh * 0.48 };

      ctx.save();
      ctx.beginPath();
      ctx.rect(vx, vy, vw, vh);
      ctx.clip();
      drawWorld(VIEWS[i], vp, t);
      ctx.restore();

      ctx.globalAlpha = 0.25;
      ctx.strokeRect(vx + 0.5, vy + 0.5, vw - 1, vh - 1);
      ctx.globalAlpha = 0.7;
      ctx.textAlign = 'left';
      ctx.fillText(VIEWS[i].label, vx + 7, vy + 14);
    }

    // timeline
    var bx0 = 14, bx1 = W - 74, by = H - 16;
    ctx.globalAlpha = 0.3;
    ctx.beginPath(); ctx.moveTo(bx0, by); ctx.lineTo(bx1, by); ctx.stroke();
    for (var s = 1; s < 11; s++) {
      var sx = bx0 + (bx1 - bx0) * s / 11;
      ctx.beginPath(); ctx.moveTo(sx, by - 3); ctx.lineTo(sx, by + 3); ctx.stroke();
    }
    var px = bx0 + (bx1 - bx0) * (t / DUR);
    ctx.globalAlpha = 0.9;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(bx0, by); ctx.lineTo(px, by); ctx.stroke();
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(px, by, 3.5, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 0.7;
    ctx.textAlign = 'right';
    ctx.fillText(fmt(t) + ' / ' + fmt(DUR), W - 14, by + 3);

    ctx.globalAlpha = 1;
  }

  function scrubTo(x) {
    var bx0 = 14, bx1 = W - 74;
    t = clamp((x - bx0) / (bx1 - bx0), 0, 0.999) * DUR;
    lastInteract = performance.now();
  }

  function localX(e) {
    var r = canvas.getBoundingClientRect();
    return e.clientX - r.left;
  }
  function localY(e) {
    var r = canvas.getBoundingClientRect();
    return e.clientY - r.top;
  }

  canvas.addEventListener('pointerdown', function (e) {
    if (localY(e) < H - SCRUB_H) return;
    scrubbing = true;
    try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
    scrubTo(localX(e));
    if (reduced) draw();
  });
  canvas.addEventListener('pointermove', function (e) {
    if (!scrubbing) return;
    scrubTo(localX(e));
    if (reduced) draw();
  });
  function endScrub() { scrubbing = false; }
  canvas.addEventListener('pointerup', endScrub);
  canvas.addEventListener('pointercancel', endScrub);

  document.addEventListener('omt:render', function () { sampleInk(); if (reduced) draw(); });
  try {
    var mq = window.matchMedia('(prefers-color-scheme: dark)');
    var onScheme = function () { sampleInk(); if (reduced) draw(); };
    if (mq.addEventListener) mq.addEventListener('change', onScheme);
    else if (mq.addListener) mq.addListener(onScheme);
  } catch (e) {}
  document.addEventListener('visibilitychange', function () { pageVisible = !document.hidden; });
  if (window.IntersectionObserver) {
    new IntersectionObserver(function (entries) {
      inView = entries[0].isIntersecting;
    }).observe(canvas);
  }
  window.addEventListener('resize', function () { resize(); if (reduced) draw(); });

  var last = performance.now();
  function frame(now) {
    var dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (pageVisible && inView && !reduced) {
      if (!scrubbing && now - lastInteract > 2500) t = (t + dt) % DUR;
      draw();
    }
    requestAnimationFrame(frame);
  }

  resize();
  sampleInk();
  if (reduced) draw();
  requestAnimationFrame(frame);
})();
