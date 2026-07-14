// Interactive schematic for the quant-trading-system case study.
// One simulated price stream feeds three signal layers (classical quant,
// ML, HFT-style microstructure) that react at different speeds; an
// orchestrator fuses them into a single suggestion. Click the chart to
// inject a shock. Simulated data only — this never touches a market.
(function () {
  'use strict';

  var canvas = document.getElementById('qts-demo');
  if (!canvas || !canvas.getContext) return;
  var ctx = canvas.getContext('2d');

  var N = 120;           // points kept in the price window
  var TICK = 0.12;       // seconds per simulated tick

  var W = 0, H = 0, dpr = 1;
  var ink = '#1c1c1a';
  var reduced = false;
  try { reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}
  var t = 0, tickTimer = 0;
  var prices = [];
  var drift = 0.0004, driftTimer = 0, shockTicks = 0;
  var layers = [
    { label: 'quant', detail: '', dir: 0, flash: 0, dotSpeed: 0.07 },
    { label: 'ml', detail: '', dir: 0, flash: 0, dotSpeed: 0.18 },
    { label: 'hft', detail: '', dir: 0, flash: 0, dotSpeed: 0.5 }
  ];
  var fused = { label: 'HOLD', glyph: '▬', conf: 50 };
  var chartBox = null;
  var inView = true, pageVisible = !document.hidden;

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  function sampleInk() {
    try { ink = getComputedStyle(canvas).color || ink; } catch (e) {}
  }

  function resize() {
    var w = canvas.clientWidth || canvas.parentNode.clientWidth;
    if (!w) return;
    var h = Math.round(clamp(w * 0.5, 240, 360));
    dpr = window.devicePixelRatio || 1;
    W = w; H = h;
    canvas.style.height = h + 'px';
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function sma(n) {
    var len = prices.length;
    if (len < n) return prices[len - 1];
    var s = 0;
    for (var i = len - n; i < len; i++) s += prices[i];
    return s / n;
  }

  function glyphFor(dir) { return dir > 0 ? '▲' : (dir < 0 ? '▼' : '▬'); }

  function tick() {
    var p = prices[prices.length - 1];
    var change = drift + (Math.random() - 0.5) * 0.008;
    if (shockTicks > 0) { change -= 0.007 + Math.random() * 0.004; shockTicks--; }
    prices.push(p * (1 + change));
    if (prices.length > N) prices.shift();

    driftTimer += TICK;
    if (driftTimer > 9) { driftTimer = 0; drift = (Math.random() - 0.48) * 0.0014; }

    var len = prices.length;
    var last = prices[len - 1];

    // quant layer: slow SMA crossover
    var diff = sma(8) - sma(21);
    var qDir = diff > last * 0.0008 ? 1 : (diff < -last * 0.0008 ? -1 : 0);
    setLayer(0, qDir, 'sma 8/21');

    // ml layer: momentum squashed through a logistic, medium speed
    var mom = len > 13 ? last / prices[len - 13] - 1 : 0;
    var score = 1 / (1 + Math.exp(-(mom * 55 + Math.sin(t * 0.9) * 0.25)));
    var mDir = score > 0.55 ? 1 : (score < 0.45 ? -1 : 0);
    setLayer(1, mDir, 'conf ' + Math.round(Math.abs(score - 0.5) * 200) + '%');

    // hft layer: last-3-tick imbalance, instant and jumpy
    var imb = 0;
    for (var i = Math.max(1, len - 3); i < len; i++) imb += prices[i] > prices[i - 1] ? 1 : -1;
    var hDir = imb > 0 ? 1 : (imb < 0 ? -1 : 0);
    setLayer(2, hDir, 'imb ' + (imb > 0 ? '+' : '') + imb);

    // orchestrator: confidence-weighted vote
    var vote = qDir * 0.9 + mDir * Math.abs(score - 0.5) * 2 + hDir * 0.45;
    fused.glyph = glyphFor(vote > 0.6 ? 1 : (vote < -0.6 ? -1 : 0));
    fused.label = vote > 0.6 ? 'WATCH' : (vote < -0.6 ? 'AVOID' : 'HOLD');
    fused.conf = Math.round(clamp(Math.abs(vote) / 2.35 + 0.2, 0, 0.98) * 100);
  }

  function setLayer(i, dir, detail) {
    if (layers[i].dir !== dir) layers[i].flash = 1;
    layers[i].dir = dir;
    layers[i].detail = detail;
  }

  function drawDots(x0, y0, x1, y1, speed, count) {
    for (var i = 0; i < count; i++) {
      var k = (t * speed + i / count) % 1;
      ctx.beginPath();
      ctx.arc(x0 + (x1 - x0) * k, y0 + (y1 - y0) * k, 1.6, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    ctx.strokeStyle = ink;
    ctx.fillStyle = ink;
    ctx.lineWidth = 1;
    ctx.font = '10px "IBM Plex Mono", monospace';

    // ---- chart (left) ----
    var cx0 = 14, cy0 = 16, cx1 = W * 0.40, cy1 = H - 40;
    chartBox = [cx0, cy0, cx1, cy1];
    ctx.globalAlpha = 0.25;
    ctx.strokeRect(cx0 + 0.5, cy0 + 0.5, cx1 - cx0, cy1 - cy0);
    ctx.globalAlpha = 0.6;
    ctx.textAlign = 'left';
    ctx.fillText('sim feed', cx0 + 7, cy0 + 14);

    var lo = Infinity, hi = -Infinity, i;
    for (i = 0; i < prices.length; i++) {
      if (prices[i] < lo) lo = prices[i];
      if (prices[i] > hi) hi = prices[i];
    }
    var span = (hi - lo) || 1;
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    for (i = 0; i < prices.length; i++) {
      var px = cx0 + 8 + (cx1 - cx0 - 16) * i / (N - 1);
      var py = cy1 - 10 - (cy1 - cy0 - 34) * (prices[i] - lo) / span;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
    ctx.textAlign = 'right';
    ctx.globalAlpha = 0.7;
    ctx.fillText(prices[prices.length - 1].toFixed(2), cx1 - 7, cy0 + 14);

    // ---- layers (middle) ----
    var lx0 = W * 0.47, lx1 = W * 0.68;
    var areaH = cy1 - cy0, boxH = (areaH - 20) / 3;
    for (i = 0; i < 3; i++) {
      var ly0 = cy0 + i * (boxH + 10);
      var L = layers[i];
      ctx.globalAlpha = 0.3 + 0.6 * L.flash;
      ctx.strokeRect(lx0 + 0.5, ly0 + 0.5, lx1 - lx0, boxH);
      ctx.globalAlpha = 0.85;
      ctx.textAlign = 'left';
      ctx.fillText(L.label, lx0 + 8, ly0 + 15);
      ctx.textAlign = 'right';
      ctx.fillText(glyphFor(L.dir), lx1 - 8, ly0 + 15);
      ctx.globalAlpha = 0.55;
      ctx.textAlign = 'left';
      ctx.fillText(L.detail, lx0 + 8, ly0 + boxH - 8);
      L.flash = Math.max(0, L.flash - 0.03);

      // edges: chart -> layer, layer -> orchestrator (dot speed = layer speed)
      var eyIn = ly0 + boxH / 2;
      ctx.globalAlpha = 0.18;
      ctx.beginPath(); ctx.moveTo(cx1, (cy0 + cy1) / 2); ctx.lineTo(lx0, eyIn); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(lx1, eyIn); ctx.lineTo(W * 0.74, (cy0 + cy1) / 2); ctx.stroke();
      if (!reduced) {
        ctx.globalAlpha = 0.5;
        drawDots(cx1, (cy0 + cy1) / 2, lx0, eyIn, 0.22, 3);
        drawDots(lx1, eyIn, W * 0.74, (cy0 + cy1) / 2, L.dotSpeed, 3);
      }
    }

    // ---- orchestrator (right) ----
    var ox0 = W * 0.74, ox1 = W - 14;
    var oy0 = (cy0 + cy1) / 2 - areaH * 0.28, oy1 = (cy0 + cy1) / 2 + areaH * 0.28;
    ctx.globalAlpha = 0.35;
    ctx.strokeRect(ox0 + 0.5, oy0 + 0.5, ox1 - ox0, oy1 - oy0);
    ctx.globalAlpha = 0.55;
    ctx.textAlign = 'left';
    ctx.fillText('orchestrator', ox0 + 8, oy0 + 15);
    ctx.font = '600 15px "IBM Plex Mono", monospace';
    ctx.globalAlpha = 0.95;
    ctx.textAlign = 'center';
    var omx = (ox0 + ox1) / 2, omy = (oy0 + oy1) / 2;
    ctx.fillText(fused.label + ' ' + fused.glyph, omx, omy + 2);
    ctx.font = '10px "IBM Plex Mono", monospace';
    ctx.globalAlpha = 0.6;
    ctx.fillText('conf ' + fused.conf + '%', omx, omy + 18);
    var bw = ctx.measureText('paper').width + 10;
    ctx.globalAlpha = 0.4;
    ctx.strokeRect(omx - bw / 2 + 0.5, oy1 - 24 + 0.5, bw, 15);
    ctx.fillText('paper', omx, oy1 - 13);

    // ---- disclaimer ----
    ctx.globalAlpha = 0.45;
    ctx.textAlign = 'center';
    ctx.fillText('simulated data · suggestions only · never executes trades', W / 2, H - 14);

    ctx.globalAlpha = 1;
  }

  canvas.addEventListener('pointerdown', function (e) {
    if (!chartBox) return;
    var r = canvas.getBoundingClientRect();
    var x = e.clientX - r.left, y = e.clientY - r.top;
    if (x >= chartBox[0] && x <= chartBox[2] && y >= chartBox[1] && y <= chartBox[3]) {
      shockTicks = 8;
    }
  });

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

  // seed the series so the chart never starts empty
  prices.push(100);
  for (var s = 0; s < N - 1; s++) tick();

  var last = performance.now();
  function frame(now) {
    var dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (pageVisible && inView && !reduced) {
      t += dt;
      tickTimer += dt;
      while (tickTimer > TICK) { tickTimer -= TICK; tick(); }
      draw();
    }
    requestAnimationFrame(frame);
  }

  resize();
  sampleInk();
  if (reduced) draw();
  requestAnimationFrame(frame);
})();
