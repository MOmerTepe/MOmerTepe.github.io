// Interactive schematic for the openteslacam case study, drawn as the v2 app:
// layout tabs and the clock on top, six camera tiles of one simulated drive,
// the vehicle-data strip below the video, then the timeline with its
// telemetry lanes and markers. Every part reads the same clock `t`.
// Pure canvas, monochrome ink from the page theme.
(function () {
  'use strict';

  var canvas = document.getElementById('otc-demo');
  if (!canvas || !canvas.getContext) return;
  var ctx = canvas.getContext('2d');
  canvas.style.cursor = 'default';

  var DUR = 12;         // loop length, seconds
  var NEAR = 0.35;      // near clip plane, meters
  var TOP_H = 26;       // tabs + clock
  var STRIP_H = 28;     // vehicle-data strip
  var TL_H = 96;        // timeline lanes + axis
  var PAD = 10;
  var BRAKE0 = 7, BRAKE1 = 8.2, EVENT = 7.6;

  // camera poses relative to the ego car (x right, y up, z forward)
  // showEgo: only the repeaters see the ego car's own flank
  var VIEWS = {
    lr: { label: 'left repeater', pos: [-1.05, 1.0, 0.3], yaw: Math.PI + 0.42, f: 0.55, showEgo: true },
    f: { label: 'front', pos: [0, 1.3, 0.8], yaw: 0, f: 0.95 },
    rr: { label: 'right repeater', pos: [1.05, 1.0, 0.3], yaw: Math.PI - 0.42, f: 0.55, showEgo: true },
    lp: { label: 'left pillar', pos: [-0.95, 1.25, 0.9], yaw: -1.15, f: 0.55 },
    b: { label: 'back', pos: [0, 1.2, -2.4], yaw: Math.PI, f: 0.7 },
    rp: { label: 'right pillar', pos: [0.95, 1.25, 0.9], yaw: 1.15, f: 0.55 }
  };
  Object.keys(VIEWS).forEach(function (k) {
    var v = VIEWS[k];
    v.dir = [Math.sin(v.yaw), 0, Math.cos(v.yaw)];
    v.right = [Math.cos(v.yaw), 0, -Math.sin(v.yaw)];
  });

  // the app's layouts, as [view, x, y, w, h] fractions of the camera area
  var T = 1 / 3;
  var LAYOUTS = [
    { name: 'grid', tiles: [['lr', 0, 0, T, 0.5], ['f', T, 0, T, 0.5], ['rr', 2 * T, 0, T, 0.5],
                            ['lp', 0, 0.5, T, 0.5], ['b', T, 0.5, T, 0.5], ['rp', 2 * T, 0.5, T, 0.5]] },
    { name: 'center', tiles: [['lp', 0, 0, 0.25, 0.5], ['lr', 0, 0.5, 0.25, 0.5], ['f', 0.25, 0, 0.5, 0.62],
                              ['b', 0.25, 0.62, 0.5, 0.38], ['rp', 0.75, 0, 0.25, 0.5], ['rr', 0.75, 0.5, 0.25, 0.5]] },
    { name: 'driving', tiles: [['f', 0, 0, 0.72, 1], ['b', 0.72, 0, 0.28, T],
                               ['lr', 0.72, T, 0.28, T], ['rr', 0.72, 2 * T, 0.28, T]] }
  ];

  // ---- simulated vehicle data, all functions of the clock ----
  function speedAt(s) {  // m/s: cruise, one hard brake, recover by the loop's end
    if (s < BRAKE0) return 17;
    if (s < BRAKE1) return 17 - 8 * (s - BRAKE0) / (BRAKE1 - BRAKE0);
    return 9 + 8 * (s - BRAKE1) / (DUR - BRAKE1);
  }
  function accelAt(s) { return s < BRAKE0 ? 0.3 : (s < BRAKE1 ? 0 : (s < 11.4 ? 0.6 : 0.3)); }
  function brakeAt(s) { return s >= BRAKE0 && s < BRAKE1; }
  function steerAt(s) { return 4 * Math.sin(s * Math.PI / 3); }
  function blinkAt(s) { return s >= 9 && s < 11; }
  function autopilotAt(s) { return s < BRAKE0; }

  // distance travelled, scaled so the road markings line up when the loop wraps
  var STEPS = 240, DIST = [0];
  for (var i = 1; i <= STEPS; i++) DIST.push(DIST[i - 1] + speedAt((i - 0.5) * DUR / STEPS) * DUR / STEPS);
  var DIST_SCALE = Math.round(DIST[STEPS] / 24) * 24 / DIST[STEPS];
  function distAt(s) {
    var x = clamp(s / DUR, 0, 1) * STEPS, k = Math.min(STEPS - 1, Math.floor(x));
    return (DIST[k] + (DIST[k + 1] - DIST[k]) * (x - k)) * DIST_SCALE;
  }

  var W = 0, H = 0, dpr = 1;
  var ink = '#1a1a18';
  var reduced = false;
  try { reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}
  var t = reduced ? 7.4 : 0;
  var layout = 0, userPicked = false, tabRects = [];
  var scrubbing = false, lastInteract = -1e9;
  var inView = true, pageVisible = !document.hidden;

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function mod(a, n) { return ((a % n) + n) % n; }
  function two(n) { return (n < 10 ? '0' : '') + n; }

  function sampleInk() {
    try { ink = getComputedStyle(canvas).color || ink; } catch (e) {}
  }

  function resize() {
    var w = canvas.clientWidth || canvas.parentNode.clientWidth;
    if (!w) return;
    var h = Math.round(clamp(w * 0.56, 330, 640));
    dpr = window.devicePixelRatio || 1;
    W = w; H = h;
    canvas.style.height = h + 'px';
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function hline(x0, x1, y) { ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke(); }

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
    var fp = view.f * vp.f;
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
    var off = distAt(time);
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

  function drawTop() {
    var x = PAD, y = 17;
    tabRects = [];
    ctx.textAlign = 'left';
    for (var i = 0; i < LAYOUTS.length; i++) {
      var w = ctx.measureText(LAYOUTS[i].name).width;
      ctx.globalAlpha = i === layout ? 0.95 : 0.5;
      ctx.fillText(LAYOUTS[i].name, x, y);
      if (i === layout) hline(x, x + w, y + 5.5);
      tabRects.push([x - 6, x + w + 6]);
      x += w + 16;
    }
    // real time of day, as the app shows it
    ctx.globalAlpha = 0.7;
    ctx.textAlign = 'right';
    ctx.fillText('18:51:' + two(Math.floor(t)), W - PAD, y);
  }

  function drawCameras(y0, h) {
    var tiles = LAYOUTS[layout].tiles, aw = W - PAD * 2;
    for (var i = 0; i < tiles.length; i++) {
      var tl = tiles[i];
      var vx = Math.round(PAD + tl[1] * aw) + 1, vy = Math.round(y0 + tl[2] * h) + 1;
      var vw = Math.round(PAD + (tl[1] + tl[3]) * aw) - vx - 1, vh = Math.round(y0 + (tl[2] + tl[4]) * h) - vy - 1;
      var vp = { cx: vx + vw / 2, cy: vy + vh * 0.48, f: Math.min(vw, vh * 1.9) };

      ctx.save();
      ctx.beginPath();
      ctx.rect(vx, vy, vw, vh);
      ctx.clip();
      drawWorld(VIEWS[tl[0]], vp, t);
      ctx.restore();

      ctx.globalAlpha = 0.25;
      ctx.strokeRect(vx + 0.5, vy + 0.5, vw - 1, vh - 1);
      ctx.globalAlpha = 0.7;
      ctx.textAlign = 'left';
      ctx.fillText(VIEWS[tl[0]].label, vx + 7, vy + 15);
    }
  }

  // lit is full ink, unlit is a dim outline
  function lamp(x, y, s, on) {
    if (on) { ctx.globalAlpha = 0.95; ctx.fillRect(x, y, s, s); }
    else { ctx.globalAlpha = 0.3; ctx.strokeRect(x + 0.5, y + 0.5, s - 1, s - 1); }
  }

  function drawStrip(y0) {
    var y = y0 + 18, x = PAD;
    var kmh = Math.round(speedAt(t) * 3.6), steer = Math.round(steerAt(t));
    var blinkOn = blinkAt(t) && mod(t * 3, 2) < 1;
    var items = [
      [86, function () {
        ctx.globalAlpha = 0.95; ctx.fillText(kmh + '', x, y);
        ctx.globalAlpha = 0.6; ctx.fillText('KM/H', x + ctx.measureText(kmh + ' ').width, y);
      }],
      [34, function () { ctx.globalAlpha = 0.95; ctx.fillText('D', x, y); }],
      [50, function () { lamp(x, y - 9, 10, blinkOn); lamp(x + 16, y - 9, 10, false); }],
      [126, function () {
        var on = autopilotAt(t);
        ctx.globalAlpha = on ? 0.95 : 0.5;
        ctx.fillText('autopilot ' + (on ? 'on' : 'off'), x, y);
      }],
      [128, function () {  // pedals: brake is a lamp, accelerator a share of a bar
        ctx.globalAlpha = 0.6; ctx.fillText('brake', x, y);
        lamp(x + 40, y - 9, 10, brakeAt(t));
        ctx.globalAlpha = 0.3; ctx.strokeRect(x + 62.5, y - 8.5, 47, 9);
        ctx.globalAlpha = 0.95; ctx.fillRect(x + 63, y - 8, 46 * accelAt(t), 8);
      }],
      [70, function () {
        ctx.globalAlpha = 0.6; ctx.fillText('steer', x, y);
        ctx.globalAlpha = 0.95;
        ctx.fillText((steer < 0 ? '−' : '') + Math.abs(steer) + '°', x + 42, y);
      }]
    ];
    ctx.textAlign = 'left';
    for (var i = 0; i < items.length; i++) {
      if (x + items[i][0] > W - PAD) break;  // narrow screens keep the first few readings
      items[i][1]();
      x += items[i][0];
    }
  }

  function tlRange() {
    return [W >= 560 ? PAD + 76 : PAD, W - PAD];
  }

  function drawTimeline(y0) {
    var r = tlRange(), x0 = r[0], x1 = r[1];
    function X(s) { return x0 + (x1 - x0) * s / DUR; }
    function lane(name, y, h) {
      ctx.globalAlpha = 0.15;
      hline(x0, x1, y + h + 0.5);
      if (x0 > PAD) { ctx.globalAlpha = 0.6; ctx.textAlign = 'left'; ctx.fillText(name, PAD, y + h); }
    }
    var s;

    // speed lane
    var ys = y0 + 6, hs = 18;
    lane('speed', ys, hs);
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    for (s = 0; s <= DUR + 0.001; s += 0.1) {
      var py = ys + hs - hs * speedAt(Math.min(s, DUR)) / 19;
      if (s === 0) ctx.moveTo(X(s), py); else ctx.lineTo(X(s), py);
    }
    ctx.stroke();

    // pedal lane: accelerator as a level, brake as a solid block
    var yp = ys + hs + 5, hp = 10;
    lane('pedals', yp, hp);
    ctx.globalAlpha = 0.45;
    ctx.beginPath();
    for (s = 0; s <= DUR + 0.001; s += 0.1) {
      var ay = yp + hp - hp * accelAt(Math.min(s, DUR - 0.01));
      if (s === 0) ctx.moveTo(X(s), ay); else ctx.lineTo(X(s), ay);
    }
    ctx.stroke();
    ctx.globalAlpha = 0.9;
    ctx.fillRect(X(BRAKE0), yp, X(BRAKE1) - X(BRAKE0), hp);

    // blinker and autopilot lanes: filled while on
    var yb = yp + hp + 7, ya = yb + 14;
    lane('blinker', yb, 6);
    ctx.globalAlpha = 0.7;
    ctx.fillRect(X(9), yb, X(11) - X(9), 6);
    lane('autopilot', ya, 6);
    ctx.globalAlpha = 0.7;
    ctx.fillRect(X(0), ya, X(BRAKE0) - X(0), 6);

    // axis with second ticks and the two markers
    var yx = ya + 16;
    ctx.globalAlpha = 0.3;
    hline(x0, x1, yx + 0.5);
    for (s = 0; s <= DUR; s++) {
      ctx.beginPath(); ctx.moveTo(Math.round(X(s)) + 0.5, yx - 3); ctx.lineTo(Math.round(X(s)) + 0.5, yx + 3); ctx.stroke();
    }
    ctx.globalAlpha = 0.9;
    ctx.fillRect(X(BRAKE0) - 3, yx - 3, 6, 6);                       // hard brake: square
    ctx.beginPath();                                                 // event: triangle
    ctx.moveTo(X(EVENT) - 4, yx - 4); ctx.lineTo(X(EVENT) + 4, yx - 4); ctx.lineTo(X(EVENT), yx + 3);
    ctx.fill();
    if (W >= 760) {
      ctx.globalAlpha = 0.6;
      ctx.textAlign = 'right'; ctx.fillText('hard brake', X(BRAKE0) - 8, yx + 13);
      ctx.textAlign = 'left'; ctx.fillText('event', X(EVENT) + 8, yx + 13);
    }

    // playhead through every lane
    var px = Math.round(X(t)) + 0.5;
    ctx.globalAlpha = 0.95;
    ctx.beginPath(); ctx.moveTo(px, y0 + 2); ctx.lineTo(px, yx + 6); ctx.stroke();
    ctx.fillRect(px - 3.5, y0 - 1, 7, 5);
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    ctx.strokeStyle = ink;
    ctx.fillStyle = ink;
    ctx.lineWidth = 1;
    ctx.font = '11px "IBM Plex Mono", monospace';

    var camH = H - TOP_H - STRIP_H - TL_H;
    drawTop();
    drawCameras(TOP_H, camH);
    ctx.globalAlpha = 0.25;
    hline(PAD, W - PAD, TOP_H + camH + STRIP_H + 0.5);
    drawStrip(TOP_H + camH);
    drawTimeline(H - TL_H);
    ctx.globalAlpha = 1;
  }

  function scrubTo(x) {
    var r = tlRange();
    t = clamp((x - r[0]) / (r[1] - r[0]), 0, 0.999) * DUR;
    lastInteract = performance.now();
  }

  function local(e) {
    var r = canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }
  function tabAt(p) {
    if (p[1] > TOP_H) return -1;
    for (var i = 0; i < tabRects.length; i++) if (p[0] >= tabRects[i][0] && p[0] <= tabRects[i][1]) return i;
    return -1;
  }

  canvas.addEventListener('pointerdown', function (e) {
    var p = local(e), tab = tabAt(p);
    if (tab >= 0) { layout = tab; userPicked = true; draw(); return; }
    if (p[1] < H - TL_H) return;
    scrubbing = true;
    try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
    scrubTo(p[0]);
    if (reduced) draw();
  });
  canvas.addEventListener('pointermove', function (e) {
    var p = local(e);
    if (!scrubbing) {
      canvas.style.cursor = tabAt(p) >= 0 ? 'pointer' : (p[1] >= H - TL_H ? 'ew-resize' : 'default');
      return;
    }
    scrubTo(p[0]);
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
    var dt = clamp((now - last) / 1000, 0, 0.05);  // the first rAF stamp can precede `last`
    last = now;
    if (pageVisible && inView && !reduced) {
      if (!scrubbing && now - lastInteract > 2500) {
        t += dt;
        if (t >= DUR) {
          t -= DUR;
          // show each layout in turn until the visitor picks one
          if (!userPicked) layout = (layout + 1) % LAYOUTS.length;
        }
      }
      draw();
    }
    requestAnimationFrame(frame);
  }

  resize();
  sampleInk();
  if (reduced) draw();
  requestAnimationFrame(frame);
})();
