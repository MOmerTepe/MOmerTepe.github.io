// Interactive schematic for the DeathByMedia case study.
// A stylized conversion queue: jobs arrive (click to add one), two workers
// process them, done rows fade out. Pure canvas, ink color from the theme.
(function () {
  'use strict';

  var canvas = document.getElementById('dbm-demo');
  if (!canvas || !canvas.getContext) return;
  var ctx = canvas.getContext('2d');

  var WORKERS = 2;
  var MAX_ROWS = 8;
  var TEMPLATES = [
    ['screenshot.png', 'png', 'webp'],
    ['talk.mp4', 'mp4', 'mp3'],
    ['clip.mov', 'mov', 'mp4'],
    ['mix.wav', 'wav', 'flac'],
    ['logo.svg', 'svg', 'ico'],
    ['yt · lecture', '1080p', 'mp4'],
    ['pano.tiff', 'tiff', 'jpg'],
    ['meme.gif', 'gif', 'webp']
  ];

  var W = 0, H = 0, dpr = 1;
  var ink = '#1c1c1a';
  var reduced = false;
  try { reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}
  var t = 0, spawnTimer = 2.5, nextTpl = 0, doneCount = 0;
  var jobs = [];
  var inView = true, pageVisible = !document.hidden;

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  function sampleInk() {
    try { ink = getComputedStyle(canvas).color || ink; } catch (e) {}
  }

  function resize() {
    var w = canvas.clientWidth || canvas.parentNode.clientWidth;
    if (!w) return;
    var h = Math.round(clamp(w * 0.52, 250, 360));
    dpr = window.devicePixelRatio || 1;
    W = w; H = h;
    canvas.style.height = h + 'px';
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function spawn(progress, state) {
    if (jobs.length >= MAX_ROWS) return;
    var tpl = TEMPLATES[nextTpl % TEMPLATES.length];
    nextTpl++;
    jobs.push({
      name: tpl[0], src: tpl[1], dst: tpl[2],
      progress: progress || 0,
      state: state || 'queued',
      speed: 0.09 + 0.1 * ((nextTpl * 7) % 5) / 5,
      seed: nextTpl * 2.3,
      doneAge: 0
    });
  }

  function update(dt) {
    var running = 0, i, j;
    for (i = 0; i < jobs.length; i++) if (jobs[i].state === 'running') running++;
    for (i = 0; i < jobs.length && running < WORKERS; i++) {
      if (jobs[i].state === 'queued') { jobs[i].state = 'running'; running++; }
    }
    for (i = 0; i < jobs.length; i++) {
      j = jobs[i];
      if (j.state === 'running') {
        j.progress += dt * j.speed * (0.75 + 0.5 * Math.sin(t * 3 + j.seed));
        if (j.progress >= 1) { j.progress = 1; j.state = 'done'; doneCount++; }
      } else if (j.state === 'done') {
        j.doneAge += dt;
      }
    }
    for (i = jobs.length - 1; i >= 0; i--) {
      if (jobs[i].state === 'done' && jobs[i].doneAge > 6) jobs.splice(i, 1);
    }
    spawnTimer += dt;
    if (spawnTimer > 3.5 && jobs.length < 5) { spawnTimer = 0; spawn(); }
  }

  function badge(text, x, y) {
    ctx.font = '9.5px "IBM Plex Mono", monospace';
    var w = ctx.measureText(text).width + 10;
    ctx.globalAlpha = 0.45;
    ctx.strokeRect(x + 0.5, y + 0.5, w, 16);
    ctx.globalAlpha = 0.85;
    ctx.textAlign = 'left';
    ctx.fillText(text, x + 5, y + 12);
    return w;
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    ctx.strokeStyle = ink;
    ctx.fillStyle = ink;
    ctx.lineWidth = 1;

    // header
    ctx.font = '10.5px "IBM Plex Mono", monospace';
    ctx.textAlign = 'left';
    ctx.globalAlpha = 0.8;
    ctx.fillText('queue', 16, 24);
    ctx.textAlign = 'right';
    ctx.globalAlpha = 0.5;
    ctx.fillText('workers: ' + WORKERS + ' · done: ' + doneCount, W - 16, 24);
    ctx.globalAlpha = 0.25;
    ctx.beginPath(); ctx.moveTo(16, 34); ctx.lineTo(W - 16, 34); ctx.stroke();

    var rowH = 34, y0 = 46;
    var barW = Math.min(170, W * 0.3);
    for (var i = 0; i < jobs.length; i++) {
      var j = jobs[i];
      var y = y0 + i * rowH;
      if (y + rowH > H - 8) break;
      var fade = j.state === 'done' ? clamp(1 - (j.doneAge - 3) / 3, 0, 1) : 1;

      ctx.save();
      ctx.globalAlpha = fade;

      // format badges: src -> dst
      var x = 16;
      var w1 = badge(j.src, x, y);
      ctx.globalAlpha = 0.5 * fade;
      ctx.fillText('→', x + w1 + 14, y + 12);
      badge(j.dst, x + w1 + 22, y);
      ctx.globalAlpha = fade;

      // filename
      ctx.font = '10.5px "IBM Plex Mono", monospace';
      ctx.textAlign = 'left';
      ctx.globalAlpha = 0.75 * fade;
      ctx.fillText(j.name, 16 + w1 + 22 + 60, y + 12);

      // progress
      var bx = W - 16 - 44 - barW;
      ctx.globalAlpha = 0.35 * fade;
      ctx.strokeRect(bx + 0.5, y + 4.5, barW, 9);
      if (j.state !== 'queued') {
        ctx.globalAlpha = (j.state === 'done' ? 0.4 : 0.8) * fade;
        ctx.fillRect(bx + 2, y + 6, (barW - 4) * j.progress, 6);
      }
      ctx.textAlign = 'right';
      ctx.globalAlpha = 0.7 * fade;
      if (j.state === 'queued') ctx.fillText('…', W - 16, y + 12);
      else if (j.state === 'done') ctx.fillText('✓', W - 16, y + 12);
      else ctx.fillText(Math.round(j.progress * 100) + '%', W - 16, y + 12);

      ctx.restore();
    }

    ctx.globalAlpha = 1;
  }

  canvas.addEventListener('pointerdown', function () {
    spawn();
    if (reduced) draw();
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

  // seed the queue so it never starts empty
  spawn(1, 'done'); spawn(0.55, 'running'); spawn(0.2, 'running'); spawn(0, 'queued');
  doneCount = 1;

  var last = performance.now();
  function frame(now) {
    var dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (pageVisible && inView && !reduced) {
      t += dt;
      update(dt);
      draw();
    }
    requestAnimationFrame(frame);
  }

  resize();
  sampleInk();
  if (reduced) draw();
  requestAnimationFrame(frame);
})();
