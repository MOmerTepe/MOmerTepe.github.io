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

  // Projects hosted on this site or not (yet) published in their own repo.
  // Once one gets a separate repo, map its name in REPO_CATEGORIES instead.
  var LOCAL_PROJECTS = [
    {
      id: 'vr-fullbody-tracking',
      cat: 'cvml',
      sortYear: 2026,
      url: '/projects/vr-fullbody-tracking/',
      internal: true,
      writeup: true,
      meta: { en: '2026 · Python · OpenCV', tr: '2026 · Python · OpenCV' },
      desc: {
        en: "Low-cost full-body tracking for SteamVR. Two cameras track 17 joints in 3D with under 16 ms latency on an RTX 3080, and it works with existing VR games through SlimeVR.",
        tr: "SteamVR için düşük maliyetli tüm vücut takibi. İki kamera, RTX 3080 üzerinde 16 ms altı gecikmeyle 17 eklemi 3B olarak takip ediyor ve SlimeVR üzerinden mevcut VR oyunlarıyla çalışıyor."
      }
    },
    {
      id: 'diabetes-prediction',
      group: 'uni',
      sortYear: 2024,
      meta: { en: '2024 · Python · scikit-learn', tr: '2024 · Python · scikit-learn' },
      desc: {
        en: "Diabetes prediction model built in a team of four. It reached 82% accuracy with 5-fold cross-validation. Features were chosen with Spearman correlation and Random Forest importance, and models were compared with ROC curves.",
        tr: "Dört kişilik bir ekiple geliştirilen diyabet tahmin modeli. 5 katlı çapraz doğrulamayla %82 doğruluğa ulaştı. Öznitelikler Spearman korelasyonu ve Random Forest önem dereceleriyle seçildi, modeller ROC eğrileriyle karşılaştırıldı."
      }
    },
    {
      id: 'led-boost-converter',
      group: 'uni',
      sortYear: 2025,
      meta: { en: '2025 · ATtiny85 · LTspice', tr: '2025 · ATtiny85 · LTspice' },
      desc: {
        en: "A 32 V boost converter for an LED flashlight, designed with a teammate. Component values were calculated by hand and checked in LTspice, an ATtiny85 runs the PI control loop, and the prototype sits in a 3D-printed case.",
        tr: "LED fener için bir ekip arkadaşımla tasarladığımız 32 V boost dönüştürücü. Bileşen değerleri elle hesaplanıp LTspice'ta doğrulandı, PI kontrol döngüsünü bir ATtiny85 çalıştırıyor, prototip 3B baskı bir kutuda duruyor."
      }
    },
    {
      id: 'xbox-controller-poc',
      group: 'uni',
      sortYear: 2022,
      meta: { en: '2022 · C · Arduino', tr: '2022 · C · Arduino' },
      desc: {
        en: "An Arduino game controller that emulates an Xbox interface. The C firmware polls at a stable 100 Hz and sends input over UART to a Python host. The case is 3D-printed.",
        tr: "Xbox arayüzünü taklit eden Arduino tabanlı bir oyun kumandası. C yazılımı kararlı 100 Hz hızında örnekliyor ve girişleri UART üzerinden Python'a gönderiyor. Kutusu 3B baskı."
      }
    }
  ];

  var OPENTESLACAM_STATIC = {
    id: 'openteslacam',
    url: '/projects/openteslacam/',
    internal: true,
    writeup: true,
    meta: { en: 'Rust', tr: 'Rust' },
    desc: {
      en: "Desktop viewer for Tesla dashcam clips. It plays all six cameras in sync on one timeline, with the vehicle data next to the video.",
      tr: "Tesla araç kamerası klipleri için masaüstü oynatıcı. Altı kameranın hepsini tek zaman çizgisinde senkron oynatıyor, araç verisini videonun yanında gösteriyor."
    }
  };

  var DEATHBYMEDIA_STATIC = {
    id: 'DeathByMedia',
    url: '/projects/deathbymedia/',
    internal: true,
    writeup: true,
    meta: { en: 'Svelte · fork', tr: 'Svelte · fork' },
    desc: {
      en: "My fork of a friend's media toolbox. It converts images, video and audio and downloads from YouTube, all through one queue.",
      tr: "Bir arkadaşımın medya araç kutusunun fork'u. Görüntü, video ve ses dönüştürüyor, YouTube'dan indiriyor. Hepsi tek kuyruktan."
    }
  };

  // Curated rows for the home page (no API call needed there).
  var FEATURED = [
    OPENTESLACAM_STATIC,
    findLocal('vr-fullbody-tracking'),
    DEATHBYMEDIA_STATIC
  ];

  var strings = {
    en: {
      gamesH: "Games",
      gamesTagline: "Games for friends",
      gamesTitle: "Good company. Friendly competition.",
      gamesIntro: "Two tables, one place. Pick a game, share a room, and bring your friends.",
      gamesNote: "Free to play · no accounts needed",
      exchangeGenre: "Property & strategy",
      exchangePlayers: "2–6 players",
      exchangeModes: "Online or local",
      exchangeDesc: "Buy Istanbul neighborhoods, strike deals, and build your way across the city. A familiar property game with a local address.",
      exchangeFeature1: "3D tabletop",
      exchangeFeature2: "Custom rules",
      exchangeFeature3: "Local play",
      exchangePlay: "Play Istanbul Exchange →",
      secretGenre: "Bluffing & deduction",
      secretPlayers: "5–10 players",
      secretModes: "Online + solo practice",
      secretDesc: "Private identities, public decisions. Elect a government, pass policies, and work out whose story you can trust.",
      secretFeature1: "Hidden roles",
      secretFeature2: "Table chat",
      secretFeature3: "Practice bots",
      secretPlay: "Play Secret Hitler →",
      secretCredit: "Unofficial adaptation · original game & credits ↗",
      gamesTogether: "Getting the table together",
      gamesStep1: "Choose your game",
      gamesStep1Text: "Check the player count. Istanbul Exchange also works on one shared device; Secret Hitler has solo practice.",
      gamesStep2: "Share the invitation",
      gamesStep2Text: "Create an online room and send its invitation to your friends. Everyone joins in their own browser.",
      gamesStep3: "Keep the table open",
      gamesStep3Text: "The host keeps their tab open throughout the game. Bring a voice call for the conversation.",
      gamesHomeText: "Property deals or hidden identities. Browser games for an evening with friends.",
      gamesBrowse: "choose a game →",
      titleHome: 'Ömer Tepe',
      titleProjects: 'Projects · Ömer Tepe',
      titleResume: 'Resume · Ömer Tepe',
      titleGames: 'Games · Ömer Tepe',
      title404: '404 · Ömer Tepe',
      tagline: 'EEE student · computer vision · Istanbul, TR',
      themeSystem: 'system', themeLight: 'light', themeDark: 'dark',
      navHome: 'home', navProjects: 'projects', navResume: 'resume', navGames: 'games',
      aboutH: 'About', contactH: 'Contact',
      aboutP1: "I'm an Electrical & Electronics Engineering student at Istanbul Bilgi University, currently focused on computer vision.",
      aboutP2a: "Nearly everything I build starts as a fix for a problem I've actually run into. ",
      aboutP2b: ' began after a minor traffic accident: proving what happened meant scrubbing four dashcam feeds at once, and neither the mobile app nor the raw files made that practical. I built a tool that did, then polished it enough to publish.',
      aboutP3: 'More projects are on the way as I clean them up for open source. A few favorites are below. The full list, sorted by category, lives on the projects page.',
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
      apiError: "couldn't reach the GitHub API, so this is a cached list.",
      seeAll: 'see all on GitHub',
      noDesc: 'No description yet.',
      forkLabel: 'fork',
      forkNote: function (parent) { return "Fork of my friend's " + parent + '.'; },
      emailLabel: 'email',
      resumeLabel: 'resume', resumeView: 'view →', resumeDownload: 'download ↓',
      resumeH: 'Resume',
      resumeLede: 'The same resume I send out. Read it here or take the PDF with you.',
      resumeDownloadBtn: 'download pdf ↓',
      resumeOpenBtn: 'open in new tab ↗',
      nfMsg: "This page doesn't exist. Maybe it moved; maybe it never did.",
      backHome: 'back to home →',
      writeupLabel: 'writeup →',
      playLabel: 'play →',
      titleVrp: 'vr-fullbody-tracking · Ömer Tepe',
      vrpLede: "Commercial full-body VR trackers can cost more than the headset, and single-camera tracking fails as soon as you turn around. This project tracks the whole body in SteamVR with two ordinary cameras and the GPU already in the PC.",
      vrpStat1l: 'end-to-end latency', vrpStat2l: 'tracked joints', vrpStat3l: 'camera views', vrpStat4l: 'tensor-core inference',
      demoH: 'The idea, animated',
      whyH: 'Why',
      howH: 'How it works',
      vrpDemoCap: "Interactive demo. Drag to orbit, and drag down to look from above. The room grows and shrinks, and cameras are added and removed. Each camera points a ray at the highlighted joint. The square around the joint shows how uncertain its position is: it grows in a bigger room or when the body blocks a camera, and shrinks as cameras are added. On a wide screen the side tiles show what each camera sees. My own setup uses two cameras. The other two show how it scales.",
      vrpWhy: "SteamVR only tracks your head and hands, and games guess the rest badly. Dedicated trackers work, but they are expensive. Single-webcam solutions lose joints as soon as you face away. Two cameras looking at the play space from different angles cover most of those blind spots, as long as the math is fast enough for VR.",
      vrpStep1k: "calibrate", vrpStep1t: ": A one-time OpenCV calibration finds where each camera is. For a fixed setup it is saved and never repeated.",
      vrpStep2k: "estimate", vrpStep2t: ": Each camera feed runs pose estimation on an RTX 3080, with end-to-end latency under 16 ms.",
      vrpStep3k: "triangulate", vrpStep3t: ": The two estimates are combined into 17 joints in 3D.",
      vrpStep4k: "fuse", vrpStep4t: ": Each estimate is weighted by its confidence, so a hidden joint recovers smoothly instead of jumping.",
      vrpStep5k: "integrate", vrpStep5t: ": The result goes to SlimeVR, which SteamVR already understands. Existing games see standard trackers.",
      vrpStatus: "The code isn't public yet. It will appear on the projects page automatically when it lands on GitHub.",
      titleOtc: 'openteslacam · Ömer Tepe',
      otcLede: "After a minor traffic accident, I had to go through several dashcam feeds at once to show what happened. Tesla's mobile app and the raw files both made that hard. openteslacam is a desktop app that plays all six cameras in sync on one timeline, with the car's speed, pedals and other data next to the video. Version 2 is a native Rust app.",
      otcStat1l: 'cameras, one clock', otcStat2l: 'layouts', otcStat3l: 'cloud uploads', otcStat4v: 'Rust', otcStat4l: 'native app',
      otcDemoCap: "Interactive sketch of the app. Six cameras show one simulated drive, with the vehicle data below them and the timeline at the bottom. Pick a layout at the top, or drag the timeline. Every camera and every reading stays on the same moment.",
      otcWhy: "Tesla saves each event as a separate clip per camera. Reviewing an incident means switching between files and trying to line them up by hand. A player that puts every angle on one timeline turns minutes of searching into seconds.",
      otcStep1k: "parse", otcStep1t: ": The app reads TeslaCam folders with its own parser. It groups clips into events and reads the vehicle data stored in the video.",
      otcStep2k: "sync", otcStep2t: ": One clock drives all six cameras, so pausing, seeking and changing speed keep every angle aligned.",
      otcStep3k: "review", otcStep3t: ": Grid, Center, Driving and saved Custom layouts arrange the cameras. Vehicle data sits below the video so nothing covers the footage, and the timeline marks events and hard braking.",
      otcStep4k: "export", otcStep4t: ": Export a trimmed range as one MP4 per camera or as a single combined MP4, with the vehicle data as CSV.",
      otcStep5k: "private", otcStep5t: ": Everything runs on your machine and footage is never uploaded. The app only goes online for map tiles and update checks.",
      otcStatus: "Open source and actively developed:",
      titleDbm: 'DeathByMedia · Ömer Tepe',
      dbmLede: "A friend's media toolbox that converts images, video and audio and downloads from YouTube. I forked it to restyle it and add features. Drop files in, pick a format, and the queue does the rest.",
      dbmStat1l: 'tools in one app', dbmStat2l: 'image formats', dbmStat3l: 'shared queue', dbmStat4l: 'UI stack',
      dbmDemoCap: "Interactive sketch of the queue. Click to add a job. A couple of workers process whatever is dropped in: images, video, audio or a YouTube link.",
      dbmWhy: "Quick conversions usually mean an ad-filled website or a long command line. One local app with a queue handles most everyday jobs: a screenshot to WEBP, a recording to MP3, a talk saved for the plane.",
      dbmStep1k: "queue", dbmStep1t: ": Every task becomes a job in one shared queue, with its progress and status visible.",
      dbmStep2k: "convert", dbmStep2t: ": Conversions run locally. For images that covers PNG, JPG, WEBP, BMP, TIFF, GIF, ICO and SVG.",
      dbmStep3k: "download", dbmStep3t: ": The YouTube module saves video or audio at the quality you choose, into the folder you pick.",
      dbmStep4k: "diverge", dbmStep4t: ": This fork keeps the original engine and adds a different theme and extra features. I try changes here before sending them back to EmreSonal/DeathByMedia.",
      dbmStatus: "A fork maintained on GitHub:",
      consentText: 'No ads, no tracking cookies, nothing sold. Theme and language choices live only on this device. Optional analytics count visits anonymously and without cookies (country, referrer, page) because I like knowing where visitors come from.',
      consentEssential: 'essential: theme & language, kept on this device (always on)',
      consentAnalytics: 'analytics: anonymous, cookieless visit counts (GoatCounter)',
      consentAllowAll: 'allow all',
      consentEssentialOnly: 'essential only',
      consentSave: 'save choices',
      privacyLink: 'privacy',
      footerLoc: 'Istanbul · UTC+3',
      months: ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
    },
    tr: {
      gamesH: "Oyunlar",
      gamesTagline: "Arkadaşlar için oyunlar",
      gamesTitle: "İyi arkadaşlar. Tatlı rekabet.",
      gamesIntro: "İki masa, tek adres. Oyununu seç, bir oda paylaş ve arkadaşlarını davet et.",
      gamesNote: "Ücretsiz · hesap gerekmez",
      exchangeGenre: "Emlak & strateji",
      exchangePlayers: "2–6 oyuncu",
      exchangeModes: "Çevrimiçi veya yerel",
      exchangeDesc: "İstanbul semtlerini satın al, anlaşmalar yap ve şehre binalarını dik. Tanıdık bir emlak oyunu, bu kez İstanbul’da.",
      exchangeFeature1: "3B oyun masası",
      exchangeFeature2: "Özel kurallar",
      exchangeFeature3: "Yerel oyun",
      exchangePlay: "Istanbul Exchange oyna →",
      secretGenre: "Blöf & çıkarım",
      secretPlayers: "5–10 oyuncu",
      secretModes: "Çevrimiçi + tek kişilik alıştırma",
      secretDesc: "Gizli kimlikler, ortak kararlar. Bir hükümet seç, politikaları geçir ve kimin hikâyesine güveneceğine karar ver.",
      secretFeature1: "Gizli roller",
      secretFeature2: "Masa sohbeti",
      secretFeature3: "Alıştırma botları",
      secretPlay: "Secret Hitler oyna →",
      secretCredit: "Resmî olmayan uyarlama · orijinal oyun ve katkılar ↗",
      gamesTogether: "Masayı kurmak",
      gamesStep1: "Oyununu seç",
      gamesStep1Text: "Oyuncu sayısını kontrol et. Istanbul Exchange tek cihazda da oynanır; Secret Hitler’da tek kişilik alıştırma var.",
      gamesStep2: "Daveti paylaş",
      gamesStep2Text: "Çevrimiçi bir oda oluştur ve davetini arkadaşlarına gönder. Herkes kendi tarayıcısından katılır.",
      gamesStep3: "Masayı açık tut",
      gamesStep3Text: "Ev sahibi oyun boyunca sekmesini açık tutsun. Sohbet için bir sesli görüşme açın.",
      gamesHomeText: "Emlak pazarlıkları veya gizli kimlikler. Arkadaşlarla bir akşam için tarayıcı oyunları.",
      gamesBrowse: "bir oyun seç →",
      titleHome: 'Ömer Tepe',
      titleProjects: 'Projeler · Ömer Tepe',
      titleResume: 'Özgeçmiş · Ömer Tepe',
      titleGames: 'Oyunlar · Ömer Tepe',
      title404: '404 · Ömer Tepe',
      tagline: 'EEE öğrencisi · bilgisayarlı görü (computer vision) · İstanbul, TR',
      themeSystem: 'sistem', themeLight: 'açık', themeDark: 'koyu',
      navHome: 'ana sayfa', navProjects: 'projeler', navResume: 'özgeçmiş', navGames: 'oyunlar',
      aboutH: 'Hakkında', contactH: 'İletişim',
      aboutP1: "İstanbul Bilgi Üniversitesi'nde Elektrik-Elektronik Mühendisliği öğrencisiyim; şu sıralar ağırlıklı olarak bilgisayarlı görü (computer vision) üzerine çalışıyorum.",
      aboutP2a: 'Yaptığım hemen her şey, gerçekten karşılaştığım bir sorunu çözmek için ortaya çıkıyor. ',
      aboutP2b: ' küçük bir trafik kazasının ardından doğdu: ne olduğunu kanıtlamak dört kamera kaydını aynı anda taramayı gerektiriyordu; ne mobil uygulama ne de ham dosyalar bunu pratik kılıyordu. İşimi gören bir araç yazdım, sonra yayınlayacak hale getirdim.',
      aboutP3: 'Diğer projelerimi hazırladıkça yayınlayacağım. Öne çıkan birkaçı aşağıda. Kategorilere ayrılmış tam liste projeler sayfasında.',
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
      apiError: "GitHub API'ye ulaşılamadı, önbellekteki liste gösteriliyor.",
      seeAll: "tümünü GitHub'da gör",
      noDesc: 'Henüz açıklama yok.',
      forkLabel: 'fork',
      forkNote: function (parent) { return 'Arkadaşımın ' + parent + " projesinin fork'u."; },
      emailLabel: 'e-posta',
      resumeLabel: 'özgeçmiş', resumeView: 'görüntüle →', resumeDownload: 'indir ↓',
      resumeH: 'Özgeçmiş',
      resumeLede: 'Gönderdiğim özgeçmişin birebir aynısı. Burada okuyun ya da PDF olarak indirin.',
      resumeDownloadBtn: 'pdf indir ↓',
      resumeOpenBtn: 'yeni sekmede aç ↗',
      nfMsg: 'Böyle bir sayfa yok. Belki taşındı, belki hiç olmadı.',
      backHome: 'ana sayfaya dön →',
      writeupLabel: 'detaylar →',
      playLabel: 'oyna →',
      titleVrp: 'vr-fullbody-tracking · Ömer Tepe',
      vrpLede: "Ticari tüm vücut VR takipçileri başlığın kendisinden pahalı olabiliyor, tek kameralı takip ise arkanızı döndüğünüz anda kopuyor. Bu proje, iki sıradan kamera ve zaten kasada duran GPU ile SteamVR'da tüm vücudu takip ediyor.",
      vrpStat1l: 'uçtan uca gecikme', vrpStat2l: 'takip edilen eklem', vrpStat3l: 'kamera görüşü', vrpStat4l: 'tensor-core çıkarımı',
      demoH: 'Fikrin animasyonu',
      whyH: 'Neden',
      howH: 'Nasıl çalışıyor',
      vrpDemoCap: "Etkileşimli demo. Döndürmek için sürükleyin, yukarıdan bakmak için aşağı sürükleyin. Oda büyüyüp küçülüyor, kameralar eklenip çıkarılıyor. Her kamera vurgulanan ekleme bir ışın gönderir. Eklemin çevresindeki kare, konumunun ne kadar belirsiz olduğunu gösterir: oda büyüdüğünde ya da gövde bir kamerayı kapattığında genişler, kamera eklendikçe daralır. Geniş ekranda yandaki kutular her kameranın ne gördüğünü gösterir. Kendi kurulumum iki kamera kullanıyor. Diğer ikisi sistemin nasıl ölçeklendiğini gösteriyor.",
      vrpWhy: "SteamVR yalnızca başınızı ve ellerinizi takip eder, oyunlar gerisini kötü tahmin eder. Özel takipçiler işe yarıyor ama pahalı. Tek webcam'li çözümler, arkanızı döndüğünüz anda eklemleri kaybediyor. Oyun alanına farklı açılardan bakan iki kamera bu kör noktaların çoğunu kapatıyor, yeter ki hesap VR'a yetişecek kadar hızlı olsun.",
      vrpStep1k: "kalibrasyon", vrpStep1t: ": Tek seferlik bir OpenCV kalibrasyonu her kameranın konumunu buluyor. Sabit bir kurulumda sonuç kaydediliyor ve tekrarlanmıyor.",
      vrpStep2k: "kestirim", vrpStep2t: ": Her kamera görüntüsünde RTX 3080 üzerinde poz kestirimi çalışıyor, uçtan uca gecikme 16 ms'nin altında.",
      vrpStep3k: "üçgenleme", vrpStep3t: ": İki kestirim, 3B'de 17 eklem olarak birleştiriliyor.",
      vrpStep4k: "füzyon", vrpStep4t: ": Her kestirim güvenine göre ağırlıklandırılıyor, böylece gizlenen bir eklem sıçramadan toparlanıyor.",
      vrpStep5k: "entegrasyon", vrpStep5t: ": Sonuç, SteamVR'ın zaten tanıdığı SlimeVR'a gidiyor. Mevcut oyunlar standart takipçi görüyor.",
      vrpStatus: "Kod henüz açık değil. GitHub'a yüklendiğinde projeler sayfasında kendiliğinden görünecek.",
      titleOtc: 'openteslacam · Ömer Tepe',
      otcLede: "Küçük bir trafik kazasından sonra ne olduğunu göstermek için birkaç kamera kaydını aynı anda incelemem gerekti. Tesla'nın mobil uygulaması da ham dosyalar da bunu zorlaştırıyordu. openteslacam, altı kameranın hepsini tek zaman çizgisinde senkron oynatan, aracın hızını, pedallarını ve diğer verilerini videonun yanında gösteren bir masaüstü uygulaması. 2. sürüm, Rust ile yazılmış yerel bir uygulama.",
      otcStat1l: 'kamera, tek saat', otcStat2l: 'düzen', otcStat3l: 'buluta yükleme', otcStat4v: 'Rust', otcStat4l: 'yerel uygulama',
      otcDemoCap: "Uygulamanın etkileşimli bir taslağı. Altı kamera tek bir simüle sürüşü gösteriyor, altlarında araç verisi, en altta zaman çizgisi var. Üstten bir düzen seçin ya da zaman çizgisini sürükleyin. Her kamera ve her değer aynı anda kalır.",
      otcWhy: "Tesla her olayı kamera başına ayrı bir klip olarak kaydediyor. Bir olayı incelemek, dosyalar arasında gidip gelmek ve onları elle hizalamaya çalışmak demek. Tüm açıları tek bir zaman çizgisine koyan bir oynatıcı, dakikalarca aramayı saniyelere indiriyor.",
      otcStep1k: "ayrıştırma", otcStep1t: ": Uygulama TeslaCam klasörlerini kendi ayrıştırıcısıyla okuyor. Klipleri olaylara göre grupluyor ve videoda saklanan araç verisini okuyor.",
      otcStep2k: "senkron", otcStep2t: ": Altı kameranın hepsini tek bir saat sürüyor. Duraklatma, arama ve hız değişimi her açıyı hizalı tutuyor.",
      otcStep3k: "inceleme", otcStep3t: ": Grid, Center, Driving ve kaydedilen Custom düzenleri kameraları yerleştiriyor. Araç verisi videonun altında duruyor, görüntüyü hiçbir şey kapatmıyor. Zaman çizgisi olayları ve sert frenleri işaretliyor.",
      otcStep4k: "dışa aktarma", otcStep4t: ": Kırpılan aralığı kamera başına bir MP4 ya da tek bir birleşik MP4 olarak, araç verisini de CSV olarak dışa aktarın.",
      otcStep5k: "gizlilik", otcStep5t: ": Her şey kendi makinenizde çalışıyor, görüntüler hiçbir yere yüklenmiyor. Uygulama yalnızca harita karoları ve güncelleme denetimi için çevrimiçi oluyor.",
      otcStatus: "Açık kaynak, aktif geliştiriliyor:",
      titleDbm: 'DeathByMedia · Ömer Tepe',
      dbmLede: "Bir arkadaşımın görüntü, video ve ses dönüştüren, YouTube'dan indirme yapan medya araç kutusu. Görünümünü değiştirmek ve özellik eklemek için fork'ladım. Dosyaları bırakın, bir format seçin, gerisini kuyruk halleder.",
      dbmStat1l: 'tek uygulamada araç', dbmStat2l: 'görüntü formatı', dbmStat3l: 'ortak kuyruk', dbmStat4l: 'arayüz',
      dbmDemoCap: "Kuyruğun etkileşimli bir taslağı. İş eklemek için tıklayın. Birkaç işçi, bırakılan her şeyi işliyor: görüntü, video, ses ya da bir YouTube bağlantısı.",
      dbmWhy: "Hızlı dönüştürmeler genelde reklam dolu bir site ya da uzun bir komut satırı demek. Kuyruklu tek bir yerel uygulama gündelik işlerin çoğunu hallediyor: bir ekran görüntüsünü WEBP yapmak, bir kaydı MP3 yapmak, bir konuşmayı uçak için indirmek.",
      dbmStep1k: "kuyruk", dbmStep1t: ": Her görev, ilerlemesi ve durumu görünen tek bir ortak kuyrukta bir iş oluyor.",
      dbmStep2k: "dönüştürme", dbmStep2t: ": Dönüştürmeler yerelde çalışıyor. Görüntülerde PNG, JPG, WEBP, BMP, TIFF, GIF, ICO ve SVG destekleniyor.",
      dbmStep3k: "indirme", dbmStep3t: ": YouTube modülü, videoyu ya da sesi seçtiğiniz kalitede, belirlediğiniz klasöre kaydediyor.",
      dbmStep4k: "fork", dbmStep4t: ": Bu fork özgün motoru koruyor, farklı bir tema ve ek özellikler getiriyor. Değişiklikleri EmreSonal/DeathByMedia'ya göndermeden önce burada deniyorum.",
      dbmStatus: "GitHub'da sürdürülen bir fork:",
      consentText: 'Reklam yok, takip çerezi yok, hiçbir şey satılmıyor. Tema ve dil tercihleri yalnızca bu cihazda tutuluyor. İsteğe bağlı analitik, ziyaretleri anonim ve çerezsiz sayıyor (ülke, kaynak, sayfa) çünkü ziyaretçilerin nereden geldiğini bilmeyi seviyorum.',
      consentEssential: 'gerekli: tema ve dil, bu cihazda (her zaman açık)',
      consentAnalytics: 'analitik: anonim, çerezsiz ziyaret sayımı (GoatCounter)',
      consentAllowAll: 'tümüne izin ver',
      consentEssentialOnly: 'yalnızca gerekli',
      consentSave: 'seçimleri kaydet',
      privacyLink: 'gizlilik',
      footerLoc: 'İstanbul · UTC+3',
      months: ['Oca','Şub','Mar','Nis','May','Haz','Tem','Ağu','Eyl','Eki','Kas','Ara']
    }
  };

  var TITLE_KEYS = { home: 'titleHome', projects: 'titleProjects', resume: 'titleResume', games: 'titleGames', '404': 'title404' };

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
    name.textContent = isCatalog ? (entry.name || entry.id) : entry.name;
    var meta = document.createElement('span');
    meta.className = 'repo-meta';
    var metaText = isCatalog ? (entry.meta[state.lang] || entry.meta.en) : formatRepoMeta(entry, t);
    if (entry.actionLabel) metaText += ' · ' + t[entry.actionLabel];
    else if (hasWriteup) metaText += ' · ' + t.writeupLabel;
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
      var isCurrent = navLinks[j].getAttribute('data-nav') === page;
      navLinks[j].classList.toggle('active', isCurrent);
      if (isCurrent) navLinks[j].setAttribute('aria-current', 'page');
      else navLinks[j].removeAttribute('aria-current');
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
          language: 'Rust',
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
