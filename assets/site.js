(function () {
  'use strict';

  var GITHUB_USERNAME = 'MOmerTepe';
  // Forks are normally hidden; these are shown, mapped to their upstream repo.
  var INCLUDED_FORKS = { deathbymedia: 'EmreSonal/DeathByMedia' };
  // GitHub repo name (lowercase) -> category. Repos not listed here land in "other".
  var REPO_CATEGORIES = {
    openteslacam: 'tools',
    deathbymedia: 'tools'
  };
  var CATEGORY_ORDER = ['cvml', 'hw', 'tools', 'other'];
  var CATEGORY_KEYS = { cvml: 'catCvml', hw: 'catHw', tools: 'catTools', other: 'catOther' };
  var REPO_CACHE_KEY = 'omt-repos-v1';
  var REPO_CACHE_TTL = 10 * 60 * 1000;

  // Projects not (yet) published on GitHub. Rendered from this catalog;
  // once one gets a repo, delete it here and add its name to REPO_CATEGORIES.
  var LOCAL_PROJECTS = [
    {
      id: 'quant-trading-system',
      cat: 'cvml',
      sortYear: 2027,
      meta: { en: 'in progress · Python', tr: 'devam ediyor · Python' },
      desc: {
        en: 'A multi-layered, unsupervised trading system combining classical quantitative-finance methods, traditional ML models, and high-frequency techniques — fine-tuned models handle cross-layer orchestration.',
        tr: 'Klasik kantitatif finans yöntemlerini, geleneksel ML modellerini ve yüksek frekanslı işlem tekniklerini birleştiren çok katmanlı, denetimsiz bir işlem sistemi — katmanlar arası orkestrasyonu ince ayarlı modeller üstleniyor.'
      }
    },
    {
      id: 'vr-fullbody-tracking',
      cat: 'cvml',
      sortYear: 2026,
      meta: { en: '2026 · Python · OpenCV', tr: '2026 · Python · OpenCV' },
      desc: {
        en: 'Low-cost full-body tracking for SteamVR: 17 joints triangulated from two cameras with confidence-weighted fusion, at sub-16 ms end-to-end latency on an RTX 3080. Plugs into existing VR games through SlimeVR.',
        tr: 'SteamVR için düşük maliyetli tüm vücut takibi: iki kameradan üçgenlenen 17 eklem, güven ağırlıklı füzyon ve RTX 3080 üzerinde uçtan uca 16 ms altı gecikme. SlimeVR üzerinden mevcut VR oyunlarına bağlanıyor.'
      }
    },
    {
      id: 'diabetes-prediction',
      cat: 'cvml',
      sortYear: 2024,
      meta: { en: '2024 · Python · scikit-learn', tr: '2024 · Python · scikit-learn' },
      desc: {
        en: 'Diabetes-prediction classifier built in a 4-person team — 82% accuracy with 5-fold cross-validation, features picked via Spearman correlation and Random Forest importance, models benchmarked with ROC curves.',
        tr: '4 kişilik ekiple geliştirilen diyabet tahmin modeli — 5 katlı çapraz doğrulamayla %82 doğruluk; öznitelikler Spearman korelasyonu ve Random Forest önem dereceleriyle seçildi, modeller ROC eğrileriyle karşılaştırıldı.'
      }
    },
    {
      id: 'led-boost-converter',
      cat: 'hw',
      sortYear: 2025,
      meta: { en: '2025 · ATtiny85 · LTspice', tr: '2025 · ATtiny85 · LTspice' },
      desc: {
        en: 'Co-designed 32 V boost converter for an LED flashlight: hand-calculated component values validated in LTspice, PI closed-loop firmware on an ATtiny85, and a 3D-printed enclosure around the finished prototype.',
        tr: 'LED fener için 32 V boost dönüştürücü: el hesabıyla boyutlandırılıp LTspice’ta doğrulanan devre, ATtiny85 üzerinde PI kapalı çevrim yazılımı ve bitmiş prototipi saran 3B baskı muhafaza.'
      }
    },
    {
      id: 'xbox-controller-poc',
      cat: 'hw',
      sortYear: 2022,
      meta: { en: '2022 · C · Arduino', tr: '2022 · C · Arduino' },
      desc: {
        en: 'Arduino-based game controller emulating an Xbox interface in C firmware at a stable 100 Hz polling rate, streaming input over UART to a Python host — enclosure 3D-printed to fit.',
        tr: 'C yazılımıyla Xbox arayüzünü taklit eden, kararlı 100 Hz örnekleme hızında çalışan Arduino tabanlı oyun kumandası; girişleri UART üzerinden Python’a aktarıyor — muhafazası 3B baskı.'
      }
    }
  ];

  var OPENTESLACAM_STATIC = {
    id: 'openteslacam',
    url: 'https://github.com/MOmerTepe/openteslacam',
    meta: { en: 'JavaScript', tr: 'JavaScript' },
    desc: {
      en: 'Local, multi-feed viewer for Tesla dashcam clips — review all four cameras in sync without the mobile app.',
      tr: 'Tesla araç kamerası kayıtları için yerel, çok görüntülü oynatıcı — dört kamerayı mobil uygulamaya gerek kalmadan senkronize izleyin.'
    }
  };

  // Curated rows for the home page (no API call needed there).
  var FEATURED = [
    OPENTESLACAM_STATIC,
    findLocal('vr-fullbody-tracking'),
    findLocal('led-boost-converter')
  ];

  var strings = {
    en: {
      titleHome: 'Ömer Tepe',
      titleProjects: 'Projects — Ömer Tepe',
      titleResume: 'Resume — Ömer Tepe',
      title404: '404 — Ömer Tepe',
      tagline: 'EEE student · computer vision · Istanbul, TR',
      themeSystem: 'system', themeLight: 'light', themeDark: 'dark',
      navHome: 'home', navProjects: 'projects', navResume: 'resume',
      aboutH: 'About', contactH: 'Contact',
      aboutP1: "I'm an Electrical & Electronics Engineering student at Istanbul Bilgi University, currently focused on computer vision.",
      aboutP2a: "Nearly everything I build starts as a fix for a problem I've actually run into. ",
      aboutP2b: ' began after a minor traffic accident: proving what happened meant scrubbing four dashcam feeds at once, and neither the mobile app nor the raw files made that practical. I built a tool that did, then polished it enough to publish.',
      aboutP3: 'More projects are on the way as I clean them up for open source. A few favorites are below — the full list, sorted by category, lives on the projects page.',
      featuredH: 'Selected projects',
      allProjects: 'all projects →',
      projectsH: 'Projects',
      projectsIntro: 'Everything in one place, grouped by what it is. Published work links to GitHub and updates automatically; unlinked entries are still being cleaned up for release.',
      catCvml: 'Machine learning & computer vision',
      catHw: 'Hardware & embedded',
      catTools: 'Apps & tools',
      catOther: 'Other',
      fetching: 'fetching repositories…',
      apiError: "couldn't reach the GitHub API — showing a cached list.",
      seeAll: 'see all on GitHub',
      noDesc: 'No description yet.',
      forkLabel: 'fork',
      forkNote: function (parent) { return "Fork of my friend's " + parent + '.'; },
      emailLabel: 'email',
      resumeLabel: 'resume', resumeView: 'view →', resumeDownload: 'download ↓',
      resumeH: 'Resume',
      resumeLede: 'The same resume I send out — read it here or take the PDF with you.',
      resumeDownloadBtn: 'download pdf ↓',
      resumeOpenBtn: 'open in new tab ↗',
      resumeFallback: "Your browser can't display PDFs inline — use the download link above.",
      nfMsg: "This page doesn't exist. Maybe it moved; maybe it never did.",
      backHome: 'back to home →',
      footerLoc: 'Istanbul · UTC+3',
      months: ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
    },
    tr: {
      titleHome: 'Ömer Tepe',
      titleProjects: 'Projeler — Ömer Tepe',
      titleResume: 'Özgeçmiş — Ömer Tepe',
      title404: '404 — Ömer Tepe',
      tagline: 'EEE öğrencisi · bilgisayarlı görü (computer vision) · İstanbul, TR',
      themeSystem: 'sistem', themeLight: 'açık', themeDark: 'koyu',
      navHome: 'ana sayfa', navProjects: 'projeler', navResume: 'özgeçmiş',
      aboutH: 'Hakkında', contactH: 'İletişim',
      aboutP1: "İstanbul Bilgi Üniversitesi'nde Elektrik-Elektronik Mühendisliği öğrencisiyim; şu sıralar ağırlıklı olarak bilgisayarlı görü (computer vision) üzerine çalışıyorum.",
      aboutP2a: 'Yaptığım hemen her şey, gerçekten karşılaştığım bir sorunu çözmek için ortaya çıkıyor. ',
      aboutP2b: ' küçük bir trafik kazasının ardından doğdu: ne olduğunu kanıtlamak dört kamera kaydını aynı anda taramayı gerektiriyordu; ne mobil uygulama ne de ham dosyalar bunu pratik kılıyordu. İşimi gören bir araç yazdım, sonra yayınlayacak hale getirdim.',
      aboutP3: 'Diğer projelerimi hazırladıkça yayınlayacağım. Öne çıkan birkaçı aşağıda — kategorilere ayrılmış tam liste projeler sayfasında.',
      featuredH: 'Öne çıkan projeler',
      allProjects: 'tüm projeler →',
      projectsH: 'Projeler',
      projectsIntro: "Hepsi bir arada, türüne göre gruplu. Yayınlananlar GitHub'a bağlanıyor ve kendiliğinden güncelleniyor; bağlantısı olmayanlar hâlâ yayına hazırlanıyor.",
      catCvml: 'Makine öğrenmesi & bilgisayarlı görü',
      catHw: 'Donanım & gömülü sistemler',
      catTools: 'Uygulamalar & araçlar',
      catOther: 'Diğer',
      fetching: 'depolar getiriliyor…',
      apiError: "GitHub API'ye ulaşılamadı — önbellekteki liste gösteriliyor.",
      seeAll: "tümünü GitHub'da gör",
      noDesc: 'Henüz açıklama yok.',
      forkLabel: 'fork',
      forkNote: function (parent) { return 'Arkadaşımın ' + parent + " projesinin fork'u."; },
      emailLabel: 'e-posta',
      resumeLabel: 'özgeçmiş', resumeView: 'görüntüle →', resumeDownload: 'indir ↓',
      resumeH: 'Özgeçmiş',
      resumeLede: 'Gönderdiğim özgeçmişin birebir aynısı — burada okuyun ya da PDF olarak indirin.',
      resumeDownloadBtn: 'pdf indir ↓',
      resumeOpenBtn: 'yeni sekmede aç ↗',
      resumeFallback: "Tarayıcınız PDF'i sayfa içinde gösteremiyor — yukarıdaki indirme bağlantısını kullanın.",
      nfMsg: 'Böyle bir sayfa yok. Belki taşındı, belki hiç olmadı.',
      backHome: 'ana sayfaya dön →',
      footerLoc: 'İstanbul · UTC+3',
      months: ['Oca','Şub','Mar','Nis','May','Haz','Tem','Ağu','Eyl','Eki','Kas','Ara']
    }
  };

  var TITLE_KEYS = { home: 'titleHome', projects: 'titleProjects', resume: 'titleResume', '404': 'title404' };

  var page = document.body.getAttribute('data-page') || 'home';

  var state = {
    theme: 'system',
    lang: 'en',
    repos: null,
    reposLoading: true,
    reposError: false
  };

  function $(id) { return document.getElementById(id); }

  function findLocal(id) {
    for (var i = 0; i < LOCAL_PROJECTS.length; i++) {
      if (LOCAL_PROJECTS[i].id === id) return LOCAL_PROJECTS[i];
    }
    return null;
  }

  function applyTheme(theme) {
    document.documentElement.style.colorScheme = theme === 'system' ? 'light dark' : theme;
  }

  function setTheme(theme) {
    state.theme = theme;
    applyTheme(theme);
    try {
      if (theme === 'system') localStorage.removeItem('omt-theme');
      else localStorage.setItem('omt-theme', theme);
    } catch (e) {}
    render();
  }

  function setLang(lang) {
    state.lang = lang;
    document.documentElement.lang = lang;
    try { localStorage.setItem('omt-lang', lang); } catch (e) {}
    render();
  }

  function formatRepoMeta(repo, t) {
    var parts = [];
    if (repo.forkOf) parts.push(t.forkLabel);
    if (repo.language) parts.push(repo.language);
    if (repo.stars > 0) parts.push('★ ' + repo.stars);
    if (repo.pushedAt) {
      var d = new Date(repo.pushedAt);
      parts.push(t.months[d.getMonth()] + ' ' + d.getFullYear());
    }
    return parts.join(' · ');
  }

  // A row is either a fetched GitHub repo ({name, url, description, ...}) or a
  // catalog entry ({id, url?, meta: {en,tr}, desc: {en,tr}}).
  function buildRow(entry, t) {
    var isCatalog = !!entry.id;
    var url = entry.url || null;
    var row = document.createElement(url ? 'a' : 'div');
    row.className = 'repo-row' + (url ? '' : ' repo-row-static');
    if (url) {
      row.href = url;
      row.target = '_blank';
      row.rel = 'noopener';
    }

    var line1 = document.createElement('div');
    line1.className = 'repo-line1';
    var name = document.createElement('span');
    name.className = 'repo-name';
    name.textContent = isCatalog ? entry.id : entry.name;
    var meta = document.createElement('span');
    meta.className = 'repo-meta';
    meta.textContent = isCatalog ? (entry.meta[state.lang] || entry.meta.en) : formatRepoMeta(entry, t);
    line1.appendChild(name);
    line1.appendChild(meta);

    var desc = document.createElement('p');
    desc.className = 'repo-desc';
    if (isCatalog) {
      desc.textContent = entry.desc[state.lang] || entry.desc.en;
    } else {
      desc.textContent = entry.description || t.noDesc;
      if (entry.forkOf) desc.textContent += ' ' + t.forkNote(entry.forkOf);
    }

    row.appendChild(line1);
    row.appendChild(desc);
    return row;
  }

  function buildList(entries, t) {
    var list = document.createElement('div');
    list.className = 'repo-list';
    entries.forEach(function (entry) { list.appendChild(buildRow(entry, t)); });
    var end = document.createElement('div');
    end.className = 'repo-list-end';
    list.appendChild(end);
    return list;
  }

  function renderFeatured(t) {
    var host = $('featured-list');
    if (!host) return;
    host.textContent = '';
    var list = buildList(FEATURED, t);
    while (list.firstChild) host.appendChild(list.firstChild);
  }

  function renderProjectsPage(t) {
    var body = $('projects-body');
    if (!body) return;

    $('repos-loading').hidden = !state.reposLoading;
    body.hidden = state.reposLoading;
    $('repos-error').hidden = state.reposLoading || !state.reposError;

    if (state.reposLoading) return;

    var groups = { cvml: [], hw: [], tools: [], other: [] };
    LOCAL_PROJECTS.forEach(function (p) {
      groups[p.cat].push({ ts: Date.UTC(p.sortYear, 6, 1), entry: p });
    });
    (state.repos || []).forEach(function (r) {
      var cat = REPO_CATEGORIES[r.name.toLowerCase()] || 'other';
      groups[cat].push({ ts: r.pushedAt ? Date.parse(r.pushedAt) : 0, entry: r });
    });

    body.textContent = '';
    CATEGORY_ORDER.forEach(function (cat) {
      var items = groups[cat];
      if (!items.length) return;
      items.sort(function (a, b) { return b.ts - a.ts; });

      var block = document.createElement('div');
      block.className = 'cat-block';
      var h = document.createElement('h3');
      h.className = 'section-h cat-h';
      h.textContent = t[CATEGORY_KEYS[cat]];
      block.appendChild(h);
      block.appendChild(buildList(items.map(function (i) { return i.entry; }), t));
      body.appendChild(block);
    });
  }

  function render() {
    var t = strings[state.lang] || strings.en;

    document.title = t[TITLE_KEYS[page]] || t.titleHome;

    var nodes = document.querySelectorAll('[data-i18n]');
    for (var i = 0; i < nodes.length; i++) {
      nodes[i].textContent = t[nodes[i].getAttribute('data-i18n')];
    }

    var copyright = $('copyright');
    if (copyright) copyright.textContent = '© ' + new Date().getFullYear() + ' Mehmet Ömer Tepe';

    var navLinks = document.querySelectorAll('.site-nav a');
    for (var j = 0; j < navLinks.length; j++) {
      navLinks[j].classList.toggle('active', navLinks[j].getAttribute('data-nav') === page);
    }

    $('lang-en').classList.toggle('active', state.lang === 'en');
    $('lang-tr').classList.toggle('active', state.lang === 'tr');
    $('theme-system').classList.toggle('active', state.theme === 'system');
    $('theme-light').classList.toggle('active', state.theme === 'light');
    $('theme-dark').classList.toggle('active', state.theme === 'dark');

    if (page === 'home') renderFeatured(t);
    if (page === 'projects') renderProjectsPage(t);
  }

  function fetchRepos() {
    try {
      var cached = JSON.parse(sessionStorage.getItem(REPO_CACHE_KEY));
      if (cached && Date.now() - cached.t < REPO_CACHE_TTL) {
        state.repos = cached.repos;
        state.reposLoading = false;
        render();
        return;
      }
    } catch (e) {}

    fetch('https://api.github.com/users/' + GITHUB_USERNAME + '/repos?per_page=100&sort=pushed')
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (data) {
        state.repos = data
          .filter(function (r) {
            if (r.name.toLowerCase().endsWith('.github.io')) return false;
            return !r.fork || INCLUDED_FORKS[r.name.toLowerCase()];
          })
          .map(function (r) {
            return {
              name: r.name,
              url: r.html_url,
              description: r.description,
              stars: r.stargazers_count,
              language: r.language,
              pushedAt: r.pushed_at,
              forkOf: r.fork ? INCLUDED_FORKS[r.name.toLowerCase()] : null
            };
          });
        try { sessionStorage.setItem(REPO_CACHE_KEY, JSON.stringify({ t: Date.now(), repos: state.repos })); } catch (e) {}
        state.reposLoading = false;
        state.reposError = false;
        render();
      })
      .catch(function () {
        state.repos = [{
          name: 'openteslacam',
          url: 'https://github.com/MOmerTepe/openteslacam',
          description: OPENTESLACAM_STATIC.desc.en,
          stars: 0,
          language: 'JavaScript',
          pushedAt: null
        }, {
          name: 'DeathByMedia',
          url: 'https://github.com/MOmerTepe/DeathByMedia',
          description: 'My branch of DeathByMedia with an alternative theme and some additional features.',
          stars: 0,
          language: 'Svelte',
          pushedAt: null,
          forkOf: INCLUDED_FORKS.deathbymedia
        }];
        state.reposLoading = false;
        state.reposError = true;
        render();
      });
  }

  // Init
  var savedTheme = null;
  try { savedTheme = localStorage.getItem('omt-theme'); } catch (e) {}
  if (savedTheme === 'light' || savedTheme === 'dark') state.theme = savedTheme;
  applyTheme(state.theme);

  var savedLang = null;
  try { savedLang = localStorage.getItem('omt-lang'); } catch (e) {}
  if (savedLang !== 'en' && savedLang !== 'tr') {
    savedLang = (navigator.language || '').toLowerCase().indexOf('tr') === 0 ? 'tr' : 'en';
  }
  state.lang = savedLang;
  document.documentElement.lang = savedLang;

  $('lang-en').addEventListener('click', function () { setLang('en'); });
  $('lang-tr').addEventListener('click', function () { setLang('tr'); });
  $('theme-system').addEventListener('click', function () { setTheme('system'); });
  $('theme-light').addEventListener('click', function () { setTheme('light'); });
  $('theme-dark').addEventListener('click', function () { setTheme('dark'); });

  render();
  if (page === 'projects') fetchRepos();
})();
