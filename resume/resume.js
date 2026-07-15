// Softly inverts the resume preview when the page is in dark mode, so a
// bright white sheet doesn't glare in an otherwise dark layout.
(function () {
  'use strict';

  var box = document.getElementById('resume-embed');
  if (!box) return;

  var mq = null;
  try { mq = window.matchMedia('(prefers-color-scheme: dark)'); } catch (e) {}

  function apply() {
    var cs = document.documentElement.style.colorScheme;
    var dark = cs === 'dark' || (cs !== 'light' && mq && mq.matches);
    box.classList.toggle('dark-adapt', dark);
  }

  document.addEventListener('omt:render', apply);
  if (mq) {
    if (mq.addEventListener) mq.addEventListener('change', apply);
    else if (mq.addListener) mq.addListener(apply);
  }
  apply();
})();
