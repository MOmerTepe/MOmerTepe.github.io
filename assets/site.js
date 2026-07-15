(function () {
  'use strict';

  var GITHUB_USERNAME = 'MOmerTepe';
  // Forks are normally hidden; these are shown, mapped to their upstream repo.
  var INCLUDED_FORKS = { deathbymedia: 'EmreSonal/DeathByMedia' };
  // GitHub repo name (lowercase) -> sub-category under "Personal projects".
  // Repos not listed here land in "other"; GitHub repos are always personal.
  var REPO_CATEGORIES = {
    openteslacam: 'tools',
    deathbymedia: 'tools'
  };
  // GitHub repo name (lowercase) -> case-study page on this site.
  var WRITEUPS = {
    openteslacam: '/projects/openteslacam/',
    deathbymedia: '/projects/deathbymedia/'
  };
  var SUBCAT_ORDER = ['cvml', 'tools', 'other'];
  var SUBCAT_KEYS = { cvml: 'catCvml', tools: 'catTools', other: 'catOther' };
  var REPO_CACHE_KEY = 'omt-repos-v1';
  var REPO_CACHE_TTL = 10 * 60 * 1000;
  var CONSENT_KEY = 'omt-consent-v1';
  var ANALYTICS_SRC = 'https://gc.zgo.at/count.js';
  var ANALYTICS_ENDPOINT = 'https://omertepe.goatcounter.com/count';

  // Projects not (yet) published on GitHub. Rendered from this catalog;
  // once one gets a repo, delete it here and add its name to REPO_CATEGORIES.
  var LOCAL_PROJECTS = [
    {
      id: 'quant-trading-system',
      cat: 'cvml',
      sortYear: 2027,
      url: '/projects/quant-trading-system/',
      internal: true,
      writeup: true,
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
      url: '/projects/vr-fullbody-tracking/',
      internal: true,
      writeup: true,
      meta: { en: '2026 · Python · OpenCV', tr: '2026 · Python · OpenCV' },
      desc: {
        en: 'Low-cost full-body tracking for SteamVR: 17 joints triangulated from two cameras with confidence-weighted fusion, at sub-16 ms end-to-end latency on an RTX 3080. Plugs into existing VR games through SlimeVR.',
        tr: 'SteamVR için düşük maliyetli tüm vücut takibi: iki kameradan üçgenlenen 17 eklem, güven ağırlıklı füzyon ve RTX 3080 üzerinde uçtan uca 16 ms altı gecikme. SlimeVR üzerinden mevcut VR oyunlarına bağlanıyor.'
      }
    },
    {
      id: 'diabetes-prediction',
      group: 'uni',
      sortYear: 2024,
      meta: { en: '2024 · Python · scikit-learn', tr: '2024 · Python · scikit-learn' },
      desc: {
        en: 'Diabetes-prediction classifier built in a 4-person team — 82% accuracy with 5-fold cross-validation, features picked via Spearman correlation and Random Forest importance, models benchmarked with ROC curves.',
        tr: '4 kişilik ekiple geliştirilen diyabet tahmin modeli — 5 katlı çapraz doğrulamayla %82 doğruluk; öznitelikler Spearman korelasyonu ve Random Forest önem dereceleriyle seçildi, modeller ROC eğrileriyle karşılaştırıldı.'
      }
    },
    {
      id: 'led-boost-converter',
      group: 'uni',
      sortYear: 2025,
      meta: { en: '2025 · ATtiny85 · LTspice', tr: '2025 · ATtiny85 · LTspice' },
      desc: {
        en: 'Co-designed 32 V boost converter for an LED flashlight: hand-calculated component values validated in LTspice, PI closed-loop firmware on an ATtiny85, and a 3D-printed enclosure around the finished prototype.',
        tr: 'LED fener için 32 V boost dönüştürücü: el hesabıyla boyutlandırılıp LTspice’ta doğrulanan devre, ATtiny85 üzerinde PI kapalı çevrim yazılımı ve bitmiş prototipi saran 3B baskı muhafaza.'
      }
    },
    {
      id: 'xbox-controller-poc',
      group: 'uni',
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
    url: '/projects/openteslacam/',
    internal: true,
    writeup: true,
    meta: { en: 'JavaScript', tr: 'JavaScript' },
    desc: {
      en: 'Local, multi-feed viewer for Tesla dashcam clips — review every camera in sync without the mobile app.',
      tr: 'Tesla araç kamerası kayıtları için yerel, çok görüntülü oynatıcı — tüm kameraları mobil uygulamaya gerek kalmadan senkronize izleyin.'
    }
  };

  var DEATHBYMEDIA_STATIC = {
    id: 'DeathByMedia',
    url: '/projects/deathbymedia/',
    internal: true,
    writeup: true,
    meta: { en: 'Svelte · fork', tr: 'Svelte · fork' },
    desc: {
      en: "My branch of a friend's all-in-one media toolbox — image, video and audio conversion plus a YouTube downloader, all through one queue.",
      tr: 'Bir arkadaşımın hepsi bir arada medya araç kutusunun benim sürümüm — görüntü, video ve ses dönüştürme, artı bir YouTube indirici; hepsi tek kuyruktan.'
    }
  };

  // Curated rows for the home page (no API call needed there);
  // only projects with a case-study page belong here.
  var FEATURED = [
    OPENTESLACAM_STATIC,
    findLocal('vr-fullbody-tracking'),
    DEATHBYMEDIA_STATIC
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
      groupPersonal: 'Personal projects',
      groupUni: 'University projects',
      catCvml: 'Machine learning & computer vision',
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
      nfMsg: "This page doesn't exist. Maybe it moved; maybe it never did.",
      backHome: 'back to home →',
      writeupLabel: 'writeup →',
      titleVrp: 'vr-fullbody-tracking — Ömer Tepe',
      vrpLede: 'Commercial full-body VR trackers can cost more than the headset, and single-camera tracking dies the moment you turn around. This project gets full-body presence in SteamVR from two ordinary cameras and a GPU that was already in the PC.',
      vrpStat1l: 'end-to-end latency', vrpStat2l: 'tracked joints', vrpStat3l: 'camera views', vrpStat4l: 'tensor-core inference',
      demoH: 'The idea, animated',
      whyH: 'Why',
      howH: 'How it works',
      vrpDemoCap: "Interactive schematic — drag to orbit. Each camera casts a bearing ray at the highlighted joint; where the rays nearly intersect is the triangulated position. When the body blocks a camera's view, that ray fades, its confidence drops, and the fused estimate leans on the other view.",
      vrpWhy: "SteamVR only tracks your head and hands; games guess the rest — badly. Dedicated trackers work but the cost adds up fast, and single-camera webcam solutions lose joints to occlusion and dead zones as soon as you face away. Two cameras watching the play space from different angles remove most of those blind spots — if you can triangulate fast enough to keep up with VR.",
      vrpStep1k: 'calibrate', vrpStep1t: " — A one-time OpenCV calibration recovers each camera's extrinsic pose; for a fixed setup it's saved and never repeated.",
      vrpStep2k: 'estimate', vrpStep2t: ' — Each feed runs pose estimation with Tensor Core-accelerated inference on an RTX 3080, keeping end-to-end latency under 16 ms.',
      vrpStep3k: 'triangulate', vrpStep3t: ' — 17 joints are reconstructed in 3D by triangulating the estimates from both cameras.',
      vrpStep4k: 'fuse', vrpStep4t: ' — Estimates are merged with confidence weights, so an occluded or back-facing joint recovers smoothly instead of snapping.',
      vrpStep5k: 'integrate', vrpStep5t: ' — The output feeds SlimeVR, which SteamVR already understands — existing games just see standard trackers.',
      vrpStatus: "The code isn't public yet — it's being cleaned up for release, and it will appear on the projects page automatically when it lands on GitHub.",
      titleOtc: 'openteslacam — Ömer Tepe',
      otcLede: "After a minor traffic accident, proving what happened meant scrubbing several dashcam feeds at once — and neither Tesla's mobile app nor the raw files made that practical. openteslacam is a local desktop viewer that plays every camera in sync.",
      otcStat1l: 'camera angles', otcStat2l: 'playback speeds', otcStat3l: 'cloud uploads', otcStat4v: '1-click', otcStat4l: 'clip export',
      otcDemoCap: 'Interactive schematic — six virtual cameras watching one simulated drive, rendered from a single shared world. Drag the timeline to scrub: every view stays locked to the same instant, which is the whole point.',
      otcWhy: 'Tesla stores each event as separate per-camera clips. Reviewing an incident means juggling files against a stopwatch, or squinting at the in-car viewer. A desktop player that treats all angles as one synchronized timeline turns minutes of scrubbing into seconds.',
      otcStep1k: 'parse', otcStep1t: ' — Dashcam folders are parsed locally; clips are grouped into events and segments, and camera files are matched up by timestamp.',
      otcStep2k: 'sync', otcStep2t: ' — Every feed plays against a single clock, so pausing, seeking and speed changes stay frame-aligned across all angles.',
      otcStep3k: 'review', otcStep3t: ' — Review and Driving layouts, ¼×–4× playback and per-camera fullscreen make finding the critical frame fast.',
      otcStep4k: 'export', otcStep4t: ' — The moment that matters leaves the app as a clip, one click.',
      otcStep5k: 'private', otcStep5t: ' — Everything runs locally; footage never leaves the machine.',
      otcStatus: 'Open source and actively developed —',
      titleDbm: 'DeathByMedia — Ömer Tepe',
      dbmLede: "A friend's all-in-one media toolbox — image, video and audio conversion plus a YouTube downloader — that I forked to restyle and extend. Drop files in, pick a target, let the queue do the rest.",
      dbmStat1l: 'tools in one app', dbmStat2l: 'image formats', dbmStat3l: 'shared queue', dbmStat4l: 'UI stack',
      dbmDemoCap: 'Interactive schematic of the queue — click to add a job. A couple of workers chew through whatever gets dropped in: images, video, audio or a YouTube link.',
      dbmWhy: 'Quick conversions usually end at an ad-riddled website or a five-flag CLI incantation. One local app with a queue covers the boring 95%: this screenshot as WEBP, that recording as MP3, this talk saved for the plane.',
      dbmStep1k: 'queue', dbmStep1t: ' — Every task, whatever the media type, becomes a job in one shared queue with visible progress and status.',
      dbmStep2k: 'convert', dbmStep2t: ' — Conversions run locally; on the image side alone that covers PNG, JPG, WEBP, BMP, TIFF, GIF, ICO and SVG.',
      dbmStep3k: 'download', dbmStep3t: ' — The YouTube module fetches video or audio at a chosen quality, straight into a folder you pick.',
      dbmStep4k: 'diverge', dbmStep4t: ' — This fork keeps the upstream engine, swaps in an alternative theme and adds features — a testbed before changes go back to EmreSonal/DeathByMedia.',
      dbmStatus: 'A fork maintained on GitHub —',
      titleQts: 'quant-trading-system — Ömer Tepe',
      qtsLede: 'A multi-layered trading research system — current working name ml-trader — combining classical quantitative methods, traditional ML models and high-frequency techniques, with fine-tuned models orchestrating the layers. It produces suggestions, not trades: paper only, by design.',
      qtsStat1l: 'signal layers', qtsStat2l: 'engineered features', qtsStat3l: 'broker mode', qtsStat4v: '100%', qtsStat4l: 'local-first',
      qtsDemoCap: 'Interactive schematic — one simulated price stream, three signal layers reacting at different speeds, one fused suggestion. Click the chart to inject a shock and watch fast layers flip while slow ones take their time. Simulated data — not financial advice.',
      qtsWhy: 'Single-model systems fail in boring ways: a trend model is blind to microstructure; a fast signal overreacts to noise. Layering slow classical indicators, mid-speed ML models and fast execution-level features — then letting an orchestrator weigh their confidence — gives every timescale a voice without letting any single one drive.',
      qtsStep1k: 'ingest', qtsStep1t: ' — Market data streams in and features are engineered per timescale — 34 of them and counting.',
      qtsStep2k: 'layer', qtsStep2t: ' — Three independent layers score the same stream: classical quant signals, trained ML models and HFT-style microstructure features.',
      qtsStep3k: 'orchestrate', qtsStep3t: " — A fine-tuned model weighs each layer's output and confidence into a single suggestion; dedicated sub-agents add macroeconomic context.",
      qtsStep4k: 'paper', qtsStep4t: " — Suggestions land in a paper-trading terminal for evaluation. It never executes real trades — it's research tooling, not an autotrader.",
      qtsStatus: 'In progress, targeted for early 2027; the interface is a moving target and will keep changing. Suggestions only, never executes trades — and nothing here is financial advice.',
      consentText: 'No ads, no tracking cookies, nothing sold. Theme and language choices live only on this device. Optional analytics count visits anonymously and without cookies — country, referrer, page — because I like knowing where visitors come from.',
      consentEssential: 'essential — theme & language, kept on this device (always on)',
      consentAnalytics: 'analytics — anonymous, cookieless visit counts (GoatCounter)',
      consentAllowAll: 'allow all',
      consentEssentialOnly: 'essential only',
      consentSave: 'save choices',
      privacyLink: 'privacy',
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
      groupPersonal: 'Kişisel projeler',
      groupUni: 'Üniversite projeleri',
      catCvml: 'Makine öğrenmesi & bilgisayarlı görü',
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
      nfMsg: 'Böyle bir sayfa yok. Belki taşındı, belki hiç olmadı.',
      backHome: 'ana sayfaya dön →',
      writeupLabel: 'detaylar →',
      titleVrp: 'vr-fullbody-tracking — Ömer Tepe',
      vrpLede: "Ticari tüm vücut VR takipçileri başlığın kendisinden pahalıya gelebiliyor; tek kameralı takip ise arkanızı döndüğünüz anda kopuyor. Bu proje, SteamVR'da tüm vücut varlığını iki sıradan kamera ve zaten kasada duran bir GPU ile sağlıyor.",
      vrpStat1l: 'uçtan uca gecikme', vrpStat2l: 'takip edilen eklem', vrpStat3l: 'kamera görüşü', vrpStat4l: 'tensor-core çıkarımı',
      demoH: 'Fikrin animasyonu',
      whyH: 'Neden',
      howH: 'Nasıl çalışıyor',
      vrpDemoCap: 'Etkileşimli şema — döndürmek için sürükleyin. Her kamera, vurgulanan ekleme bir yön ışını gönderir; ışınların kesişmeye en yaklaştığı nokta üçgenlenmiş konumdur. Gövde bir kameranın görüşünü kapattığında o ışın soluklaşır, güveni düşer ve birleşik kestirim diğer görüşe yaslanır.',
      vrpWhy: "SteamVR yalnızca başınızı ve ellerinizi takip eder; oyunlar gerisini tahmin eder — kötü tahmin eder. Özel takipçiler çalışıyor ama maliyet hızla katlanıyor; tek kameralı webcam çözümleri ise siz arkanızı döner dönmez eklemleri oklüzyona ve ölü bölgelere kaptırıyor. Oyun alanına farklı açılardan bakan iki kamera bu kör noktaların çoğunu ortadan kaldırıyor — yeter ki VR'a yetişecek hızda üçgenleme yapabilin.",
      vrpStep1k: 'kalibrasyon', vrpStep1t: ' — Tek seferlik OpenCV kalibrasyonu her kameranın dışsal (extrinsic) pozunu çıkarıyor; sabit bir düzen için sonuç kaydediliyor ve bir daha tekrarlanmıyor.',
      vrpStep2k: 'kestirim', vrpStep2t: " — Her görüntü akışı, RTX 3080 üzerinde Tensor Core hızlandırmalı çıkarımla poz kestirimi çalıştırıyor; uçtan uca gecikme 16 ms'nin altında kalıyor.",
      vrpStep3k: 'üçgenleme', vrpStep3t: ' — 17 eklem, iki kameranın kestirimlerinin üçgenlenmesiyle 3B olarak yeniden kuruluyor.',
      vrpStep4k: 'füzyon', vrpStep4t: ' — Kestirimler güven ağırlıklarıyla birleştiriliyor; görüşü kapanan ya da sırtı dönük bir eklem aniden sıçramak yerine yumuşakça toparlanıyor.',
      vrpStep5k: 'entegrasyon', vrpStep5t: " — Sonuç, SteamVR'ın zaten tanıdığı SlimeVR'a besleniyor; mevcut oyunlar standart takipçi görüyor.",
      vrpStatus: "Kod henüz açık değil — yayına hazırlanıyor; GitHub'a düştüğünde projeler sayfasında kendiliğinden görünecek.",
      titleOtc: 'openteslacam — Ömer Tepe',
      otcLede: "Küçük bir trafik kazasının ardından ne olduğunu kanıtlamak, birden çok kamera kaydını aynı anda taramayı gerektiriyordu — ne Tesla'nın mobil uygulaması ne de ham dosyalar bunu pratik kılıyordu. openteslacam, tüm kameraları senkronize oynatan yerel bir masaüstü oynatıcı.",
      otcStat1l: 'kamera açısı', otcStat2l: 'oynatma hızı', otcStat3l: 'buluta yükleme', otcStat4v: '1 tık', otcStat4l: 'klip dışa aktarma',
      otcDemoCap: 'Etkileşimli şema — tek bir simüle sürüşü izleyen altı sanal kamera, aynı ortak sahneden çiziliyor. Zaman çizgisini sürükleyin: her görünüm aynı âna kilitli kalır — zaten bütün mesele bu.',
      otcWhy: 'Tesla her olayı kamera başına ayrı klipler olarak kaydediyor. Bir olayı incelemek, elde kronometreyle dosya değiştirmek ya da araç içi oynatıcıya gözlerini kısarak bakmak demek. Tüm açıları tek bir senkron zaman çizgisi olarak ele alan bir masaüstü oynatıcı, dakikalarca taramayı saniyelere indiriyor.',
      otcStep1k: 'ayrıştırma', otcStep1t: ' — Kayıt klasörleri yerelde ayrıştırılıyor; klipler olaylara ve segmentlere gruplanıyor, kamera dosyaları zaman damgasıyla eşleştiriliyor.',
      otcStep2k: 'senkron', otcStep2t: ' — Tüm akışlar tek bir saate göre oynuyor; duraklatma, arama ve hız değişimi her açıda kare hizalı kalıyor.',
      otcStep3k: 'inceleme', otcStep3t: ' — İnceleme ve Sürüş düzenleri, ¼×–4× oynatma ve kamera başına tam ekran, kritik kareyi bulmayı hızlandırıyor.',
      otcStep4k: 'dışa aktarma', otcStep4t: ' — Önemli an, tek tıkla uygulamadan klip olarak çıkıyor.',
      otcStep5k: 'gizlilik', otcStep5t: ' — Her şey yerelde çalışıyor; görüntüler makineden dışarı çıkmıyor.',
      otcStatus: 'Açık kaynak, aktif geliştiriliyor —',
      titleDbm: 'DeathByMedia — Ömer Tepe',
      dbmLede: "Bir arkadaşımın hepsi bir arada medya araç kutusu — görüntü, video ve ses dönüştürme, artı bir YouTube indirici — temasını değiştirip genişletmek için fork'ladım. Dosyaları bırakın, hedefi seçin, gerisini kuyruk halletsin.",
      dbmStat1l: 'tek uygulamada araç', dbmStat2l: 'görüntü formatı', dbmStat3l: 'ortak kuyruk', dbmStat4l: 'arayüz',
      dbmDemoCap: 'Kuyruğun etkileşimli şeması — iş eklemek için tıklayın. Birkaç işçi, ne bırakılırsa onu işliyor: görüntü, video, ses ya da bir YouTube bağlantısı.',
      dbmWhy: "Hızlı dönüştürmeler genelde reklam dolu bir sitede ya da beş parametreli bir CLI büyüsünde bitiyor. Kuyruklu tek bir yerel uygulama sıkıcı %95'i karşılıyor: şu ekran görüntüsü WEBP olsun, şu kaydın sesi MP3, şu konuşma uçak için insin.",
      dbmStep1k: 'kuyruk', dbmStep1t: ' — Medya türü ne olursa olsun her görev, ilerlemesi ve durumu görünen tek bir ortak kuyrukta iş oluyor.',
      dbmStep2k: 'dönüştürme', dbmStep2t: " — Dönüştürmeler yerelde çalışıyor; yalnızca görüntü tarafı PNG, JPG, WEBP, BMP, TIFF, GIF, ICO ve SVG'yi kapsıyor.",
      dbmStep3k: 'indirme', dbmStep3t: ' — YouTube modülü, seçilen kalitede video ya da sesi doğrudan belirlediğiniz klasöre indiriyor.',
      dbmStep4k: 'fork', dbmStep4t: " — Bu fork üstteki motoru koruyor, alternatif bir tema ve birkaç ek özellik getiriyor — değişiklikler EmreSonal/DeathByMedia'ya dönmeden önce bir deneme alanı.",
      dbmStatus: "GitHub'da sürdürülen bir fork —",
      titleQts: 'quant-trading-system — Ömer Tepe',
      qtsLede: 'Çok katmanlı bir alım-satım araştırma sistemi — güncel çalışma adı ml-trader — klasik kantitatif yöntemleri, geleneksel ML modellerini ve yüksek frekans tekniklerini birleştiriyor; katmanları ince ayarlı modeller orkestre ediyor. Ürettiği şey işlem değil öneri: tasarım gereği yalnızca paper.',
      qtsStat1l: 'sinyal katmanı', qtsStat2l: 'öznitelik', qtsStat3l: 'broker modu', qtsStat4v: '%100', qtsStat4l: 'yerel öncelikli',
      qtsDemoCap: 'Etkileşimli şema — tek bir simüle fiyat akışı, farklı hızlarda tepki veren üç sinyal katmanı, tek bir birleşik öneri. Şok enjekte etmek için grafiğe tıklayın: hızlı katmanlar anında dönerken yavaşlar ağırdan alıyor. Simüle veri — yatırım tavsiyesi değildir.',
      qtsWhy: 'Tek modelli sistemler sıkıcı şekillerde başarısız olur: trend modeli mikro yapıyı görmez, hızlı sinyal gürültüye aşırı tepki verir. Yavaş klasik göstergeleri, orta hızlı ML modellerini ve hızlı işlem-düzeyi öznitelikleri katmanlamak — sonra güvenlerini tartan bir orkestratöre bırakmak — direksiyonu tek birine vermeden her zaman ölçeğine söz hakkı tanıyor.',
      qtsStep1k: 'veri', qtsStep1t: ' — Piyasa verisi akıyor; öznitelikler zaman ölçeği başına üretiliyor — şimdilik 34 tane.',
      qtsStep2k: 'katman', qtsStep2t: ' — Üç bağımsız katman aynı akışı puanlıyor: klasik kantitatif sinyaller, eğitilmiş ML modelleri ve HFT tarzı mikro yapı öznitelikleri.',
      qtsStep3k: 'orkestrasyon', qtsStep3t: ' — İnce ayarlı bir model, katman çıktılarını ve güvenlerini tek bir öneride tartıyor; özel alt-ajanlar makroekonomik bağlam ekliyor.',
      qtsStep4k: 'paper', qtsStep4t: ' — Öneriler değerlendirme için paper işlem terminaline düşüyor. Gerçek işlem asla yapılmıyor — bu bir araştırma aracı, otomatik alım-satım botu değil.',
      qtsStatus: 'Devam ediyor, hedef 2027 başı; arayüz hareketli bir hedef, değişmeye devam edecek. Yalnızca öneri üretir, asla işlem yapmaz — ve buradaki hiçbir şey yatırım tavsiyesi değildir.',
      consentText: 'Reklam yok, takip çerezi yok, hiçbir şey satılmıyor. Tema ve dil tercihleri yalnızca bu cihazda tutuluyor. İsteğe bağlı analitik, ziyaretleri anonim ve çerezsiz sayıyor — ülke, kaynak, sayfa — çünkü ziyaretçilerin nereden geldiğini bilmeyi seviyorum.',
      consentEssential: 'gerekli — tema ve dil, bu cihazda (her zaman açık)',
      consentAnalytics: 'analitik — anonim, çerezsiz ziyaret sayımı (GoatCounter)',
      consentAllowAll: 'tümüne izin ver',
      consentEssentialOnly: 'yalnızca gerekli',
      consentSave: 'seçimleri kaydet',
      privacyLink: 'gizlilik',
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
    var writeupUrl = !isCatalog && WRITEUPS[(entry.name || '').toLowerCase()];
    var url = writeupUrl || entry.url || null;
    var internal = isCatalog ? entry.internal : !!writeupUrl;
    var hasWriteup = entry.writeup || !!writeupUrl;
    var row = document.createElement(url ? 'a' : 'div');
    row.className = 'repo-row' + (url ? '' : ' repo-row-static');
    if (url) {
      row.href = url;
      if (!internal) {
        row.target = '_blank';
        row.rel = 'noopener';
      }
    }

    var line1 = document.createElement('div');
    line1.className = 'repo-line1';
    var name = document.createElement('span');
    name.className = 'repo-name';
    name.textContent = isCatalog ? entry.id : entry.name;
    var meta = document.createElement('span');
    meta.className = 'repo-meta';
    var metaText = isCatalog ? (entry.meta[state.lang] || entry.meta.en) : formatRepoMeta(entry, t);
    if (hasWriteup) metaText += ' · ' + t.writeupLabel;
    meta.textContent = metaText;
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

    var personal = { cvml: [], tools: [], other: [] };
    var uni = [];
    LOCAL_PROJECTS.forEach(function (p) {
      var item = { ts: Date.UTC(p.sortYear, 6, 1), entry: p };
      if (p.group === 'uni') uni.push(item);
      else personal[p.cat].push(item);
    });
    (state.repos || []).forEach(function (r) {
      var cat = REPO_CATEGORIES[r.name.toLowerCase()] || 'other';
      personal[cat].push({ ts: r.pushedAt ? Date.parse(r.pushedAt) : 0, entry: r });
    });

    function byTsDesc(a, b) { return b.ts - a.ts; }
    function toEntries(items) {
      items.sort(byTsDesc);
      return items.map(function (i) { return i.entry; });
    }
    function groupBlock(title) {
      var block = document.createElement('div');
      block.className = 'cat-block';
      var h = document.createElement('h3');
      h.className = 'section-h cat-h';
      h.textContent = title;
      block.appendChild(h);
      return block;
    }

    body.textContent = '';

    var personalBlock = groupBlock(t.groupPersonal);
    SUBCAT_ORDER.forEach(function (cat) {
      var items = personal[cat];
      if (!items.length) return;
      var sub = document.createElement('div');
      sub.className = 'subcat-block';
      var sh = document.createElement('h4');
      sh.className = 'subcat-h';
      sh.textContent = t[SUBCAT_KEYS[cat]];
      sub.appendChild(sh);
      sub.appendChild(buildList(toEntries(items), t));
      personalBlock.appendChild(sub);
    });
    body.appendChild(personalBlock);

    if (uni.length) {
      var uniBlock = groupBlock(t.groupUni);
      uniBlock.appendChild(buildList(toEntries(uni), t));
      body.appendChild(uniBlock);
    }
  }

  function render() {
    var t = strings[state.lang] || strings.en;

    var titleKey = document.body.getAttribute('data-title') || TITLE_KEYS[page];
    document.title = t[titleKey] || t.titleHome;

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

    // let page-local scripts (e.g. the case-study demo) react to lang/theme changes
    try { document.dispatchEvent(new CustomEvent('omt:render')); } catch (e) {}
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

  // ---- privacy: consent banner, opt-in analytics, email assembly ----
  // Analytics = GoatCounter: anonymous, cookieless visit counts. It only
  // loads after the visitor allows it; the choice is kept in localStorage
  // and can be changed any time via the "privacy" link in the footer.

  function getConsent() {
    try {
      var raw = localStorage.getItem(CONSENT_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function saveConsent(analytics) {
    try { localStorage.setItem(CONSENT_KEY, JSON.stringify({ analytics: !!analytics, t: Date.now() })); } catch (e) {}
  }

  function defaultAnalyticsChoice() {
    // honor Global Privacy Control / Do Not Track in the pre-checked default
    var optedOut = navigator.globalPrivacyControl === true || navigator.doNotTrack === '1';
    return !optedOut;
  }

  function loadAnalytics() {
    if (document.querySelector('script[data-goatcounter]')) return;
    var s = document.createElement('script');
    s.async = true;
    s.src = ANALYTICS_SRC;
    s.setAttribute('data-goatcounter', ANALYTICS_ENDPOINT);
    document.head.appendChild(s);
  }

  function padForConsent() {
    var el = $('consent');
    document.body.style.paddingBottom = el ? el.offsetHeight + 'px' : '';
  }

  function hideConsent() {
    var el = $('consent');
    if (el) el.parentNode.removeChild(el);
    padForConsent();
  }

  function applyConsent(analytics) {
    saveConsent(analytics);
    if (analytics) loadAnalytics();
    hideConsent();
  }

  function showConsent(prefillAnalytics) {
    hideConsent();
    var wrap = document.createElement('div');
    wrap.className = 'consent';
    wrap.id = 'consent';
    wrap.setAttribute('role', 'region');
    wrap.setAttribute('aria-label', 'Privacy choices');

    var inner = document.createElement('div');
    inner.className = 'consent-inner';

    var text = document.createElement('p');
    text.className = 'consent-text';
    text.setAttribute('data-i18n', 'consentText');
    inner.appendChild(text);

    var opts = document.createElement('div');
    opts.className = 'consent-opts';
    function opt(key, checked, disabled, id) {
      var label = document.createElement('label');
      label.className = 'consent-opt';
      var box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = checked;
      box.disabled = !!disabled;
      if (id) box.id = id;
      var span = document.createElement('span');
      span.setAttribute('data-i18n', key);
      label.appendChild(box);
      label.appendChild(span);
      opts.appendChild(label);
    }
    opt('consentEssential', true, true, null);
    opt('consentAnalytics', prefillAnalytics, false, 'consent-analytics');
    inner.appendChild(opts);

    var actions = document.createElement('div');
    actions.className = 'consent-actions';
    function action(key, fn) {
      var b = document.createElement('button');
      b.setAttribute('data-i18n', key);
      b.addEventListener('click', fn);
      actions.appendChild(b);
    }
    action('consentAllowAll', function () { applyConsent(true); });
    action('consentEssentialOnly', function () { applyConsent(false); });
    action('consentSave', function () { applyConsent($('consent-analytics').checked); });
    inner.appendChild(actions);

    wrap.appendChild(inner);
    document.body.appendChild(wrap);
    render();
    padForConsent();
  }

  function initPrivacy() {
    // assemble the contact email at runtime so plain-HTML harvesters miss it
    var email = $('email-link');
    if (email) {
      var addr = email.getAttribute('data-u') + '@' + email.getAttribute('data-d');
      email.href = 'mailto:' + addr;
      email.textContent = addr;
    }

    var footer = document.querySelector('footer');
    if (footer) {
      var link = document.createElement('button');
      link.className = 'privacy-link';
      link.setAttribute('data-i18n', 'privacyLink');
      link.addEventListener('click', function () {
        var c = getConsent();
        showConsent(c ? !!c.analytics : defaultAnalyticsChoice());
      });
      footer.insertBefore(link, footer.lastElementChild);
    }

    var consent = getConsent();
    if (consent === null) showConsent(defaultAnalyticsChoice());
    else if (consent.analytics) loadAnalytics();
  }

  window.addEventListener('resize', padForConsent);

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
  initPrivacy();
  if (page === 'projects') fetchRepos();
})();
