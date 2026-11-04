export type Language = "en" | "tr"
export type Page = "home" | "faq" | "install" | "privacy" | "license"

export const pages: Page[] = ["home", "faq", "install", "privacy", "license"]

export const routes: Record<Language, Record<Page, string>> = {
  en: {
    home: "/",
    faq: "/faq",
    install: "/install",
    privacy: "/privacy",
    license: "/license",
  },
  tr: {
    home: "/tr",
    faq: "/tr/sss",
    install: "/tr/kurulum",
    privacy: "/tr/gizlilik",
    license: "/tr/lisans",
  },
}

export const repoUrl = "https://github.com/laot7490/downly"

export const content = {
  en: {
    nav: ["Home", "FAQ", "Install", "Privacy", "Licenses"],
    download: "Download for Windows",
    themeLabel: "Theme",
    themeSystem: "System",
    themeLight: "Light",
    themeDark: "Dark",
    heroLines: ["Paste a link.", "Queue it.", "Save it."],
    intro:
      "Paste a link, pick a format, and download through a queue you control — on Windows.",
    heroNote: "Powered by yt-dlp and FFmpeg.",
    howLink: "See how it works",
    screenshot: "Downly · download queue",
    screenshotAlt:
      "Downly app showing the download queue, link input, and format controls",
    appMock: {
      headline: "Download a video",
      sub: "Paste a link, pick a format, then add it to the queue.",
      single: "Single",
      multiple: "Multiple",
      placeholder: "YouTube, Twitter, TikTok…",
      add: "Add",
      queue: "Queue",
      start: "Start",
      filters: ["All", "Pending", "Active", "Completed", "Failed", "Cancelled"],
      emptyTitle: "Nothing queued",
      empty: "Paste a link to add it to the queue.",
    },
    flowTitle: "From link to file.",
    flowIntro:
      "Three clear steps. You decide what to save and when the queue runs.",
    steps: [
      [
        "Paste a link",
        "Look up one video or add several links with a shared quality preset.",
      ],
      [
        "Choose the output",
        "Pick an available format, video or audio quality, or just a clip.",
      ],
      [
        "Run the queue",
        "Start or stop downloads. Finished and failed jobs live in history.",
      ],
    ],
    featuresTitle: "Control stays with you.",
    features: [
      [
        "Formats that fit",
        "Inspect formats for a link, or apply a quality preset across multiple links.",
      ],
      [
        "A queue you run",
        "Downloads go one at a time. Start, stop, retry, and revisit past jobs.",
      ],
      [
        "More than full videos",
        "Save audio, cut a clip, or pull a playlist from a single URL.",
      ],
      [
        "Your desktop, your language",
        "English or Turkish, with system, light, and dark themes.",
      ],
    ],
    supported:
      "Works with YouTube, X, Streamable, Twitch, Vimeo, TikTok, Reddit, SoundCloud, and other yt-dlp sites. Availability depends on the source.",
    ready: "Put the next link in your queue.",
    readyBody: "Download the latest Windows installer and run it.",
    pageTitles: [
      "",
      "Questions, answered.",
      "Install Downly.",
      "Privacy, plainly.",
      "Open source and licenses.",
    ],
    pageIntros: [
      "",
      "What Downly can do, and how the download flow works.",
      "Get the Windows installer and add your first link.",
      "What this website does, and what the desktop app keeps on your machine.",
      "Project license and the tools bundled with Downly.",
    ],
    faq: [
      [
        "Which sites does Downly support?",
        "Downly uses yt-dlp and supports YouTube, X, Streamable, Twitch, Vimeo, TikTok, Reddit, SoundCloud, and other yt-dlp sites. Some links change or need sign-in.",
      ],
      [
        "Can I download only audio or part of a video?",
        "Yes. Options can include audio, video, images, and a clip range. Exact choices depend on the source.",
      ],
      [
        "Can I add several links or a playlist?",
        "Add multiple links with a shared quality preset. A playlist URL lets you add one video or the whole list.",
      ],
      [
        "Where do my downloads go?",
        "Files go to your selected download folder. Change it in the desktop app settings.",
      ],
      [
        "Does Downly need my browser cookies?",
        "Usually no. For signed-in sources, Settings offers optional Firefox or cookies.txt import.",
      ],
      [
        "Why does Windows show a SmartScreen warning?",
        "The installer is not code-signed. Download only from this site or the official GitHub release and continue only if you trust the source.",
      ],
      [
        "Is Downly open source?",
        "Yes — GPL-3.0. Bundled yt-dlp and FFmpeg have their own licenses on the Licenses page.",
      ],
    ],
    install: [
      [
        "Download the installer",
        "Grab the current Windows setup.exe. The download starts as soon as you click.",
      ],
      [
        "Run the installer",
        "User install is recommended and does not need an administrator prompt.",
      ],
      [
        "Add your first link",
        "Open Downly, paste a link, choose a format, add it to the queue, and press Start.",
      ],
    ],
    releaseLink: "Download Windows installer",
    warningTitle: "About the Windows warning",
    warning:
      "The installer is not code-signed. SmartScreen may warn on first open. If you trust the file from this site or the official GitHub release, choose More info, then Run anyway.",
    rights:
      "Only download content when you have the right to do so, and follow the source platform's rules.",
    privacy: [
      [
        "This website",
        "No analytics, ad trackers, or contact form. Hosted for Cloudflare Pages, which processes requests to serve the site. Links to GitHub and other sites use their own policies.",
      ],
      [
        "The desktop app",
        "Settings, queue, history, downloads, and any imported cookies.txt stay on your computer. Lookups and downloads contact the source site via yt-dlp. Updates may contact GitHub. Optional cookies apply only when you enable them.",
      ],
      [
        "Questions or requests",
        "Use GitHub Issues. Issues are public — do not post passwords, cookies, or other private data.",
      ],
    ],
    contactLink: "Open GitHub Issues",
    license: [
      [
        "Downly",
        "GNU General Public License, version 3. Read the full license and source in the project repository.",
      ],
      [
        "Bundled tools",
        "yt-dlp (Unlicense) and FFmpeg (GPL build in this project). See each project for complete license details.",
      ],
    ],
    licenseLinks: [
      "Read Downly's license",
      "yt-dlp project",
      "FFmpeg licensing",
    ],
    source: "View source",
    footer: "A precise place for your next download.",
    notFound: [
      "This page isn't here.",
      "Go back to Downly home and continue from there.",
      "Back to home",
    ],
    skip: "Skip to content",
    menu: "Open menu",
    navLabel: "Main navigation",
    footerNavLabel: "Footer navigation",
    languageLabel: "Language",
  },
  tr: {
    nav: ["Ana sayfa", "SSS", "Kurulum", "Gizlilik", "Lisanslar"],
    download: "Windows için indir",
    themeLabel: "Tema",
    themeSystem: "Sistem",
    themeLight: "Açık",
    themeDark: "Koyu",
    heroLines: ["Bağlantıyı yapıştır.", "Kuyruğa al.", "Kaydet."],
    intro:
      "Bağlantıyı yapıştır, formatı seç, kontrolün sende kaldığı kuyrukla indir — Windows’ta.",
    heroNote: "yt-dlp ve FFmpeg ile çalışır.",
    howLink: "Nasıl çalışır?",
    screenshot: "Downly · indirme kuyruğu",
    screenshotAlt:
      "Downly uygulamasının kuyruk, bağlantı alanı ve format kontrollerini gösteren ekranı",
    appMock: {
      headline: "Video indir",
      sub: "Bağlantıyı yapıştır, formatı seç, kuyruğa ekle.",
      single: "Tekli",
      multiple: "Çoklu",
      placeholder: "YouTube, Twitter, TikTok…",
      add: "Ekle",
      queue: "Kuyruk",
      start: "Başlat",
      filters: ["Tümü", "Bekleyen", "Aktif", "Biten", "Başarısız", "İptal"],
      emptyTitle: "Kuyruk boş",
      empty: "Kuyruğa eklemek için bir bağlantı yapıştırın.",
    },
    flowTitle: "Bağlantıdan dosyaya.",
    flowIntro:
      "Üç net adım. Neyi kaydedeceğine ve kuyruğun ne zaman çalışacağına sen karar verirsin.",
    steps: [
      [
        "Bağlantıyı yapıştır",
        "Tek videonun bilgisini getir veya ortak kaliteyle birden fazla bağlantı ekle.",
      ],
      [
        "Çıktıyı seç",
        "Uygun formatı, video veya ses kalitesini ya da yalnızca bir kesiti seç.",
      ],
      [
        "Kuyruğu çalıştır",
        "İndirmeleri başlat veya durdur. Biten ve başarısız işler geçmişte.",
      ],
    ],
    featuresTitle: "Kontrol sende kalır.",
    features: [
      [
        "Uygun formatlar",
        "Bir bağlantıdaki formatlara bak veya çoklu bağlantılara kalite seçimi uygula.",
      ],
      [
        "Senin yönettiğin kuyruk",
        "İndirmeler sırayla gider. Başlat, durdur, yeniden dene, geçmişe dön.",
      ],
      [
        "Tam videodan fazlası",
        "Ses kaydet, kesit al veya tek URL'den oynatma listesini çek.",
      ],
      ["Masaüstün, dilin", "Türkçe veya İngilizce; sistem, açık ve koyu tema."],
    ],
    supported:
      "YouTube, X, Streamable, Twitch, Vimeo, TikTok, Reddit, SoundCloud ve yt-dlp'nin desteklediği diğer sitelerle çalışır. Kullanılabilirlik kaynağa bağlıdır.",
    ready: "Sıradaki bağlantıyı kuyruğa ekle.",
    readyBody: "En güncel Windows yükleyicisini indirip çalıştır.",
    pageTitles: [
      "",
      "Merak ettiklerin.",
      "Downly'yi kur.",
      "Açık gizlilik.",
      "Açık kaynak ve lisanslar.",
    ],
    pageIntros: [
      "",
      "Downly'nin yapabildikleri ve indirme akışı.",
      "Windows yükleyicisini al ve ilk bağlantını ekle.",
      "Bu sitenin ve masaüstü uygulamasının bilgisayarında ne tuttuğu.",
      "Proje lisansı ve Downly ile gelen araçlar.",
    ],
    faq: [
      [
        "Downly hangi siteleri destekler?",
        "Downly yt-dlp kullanır. YouTube, X, Streamable, Twitch, Vimeo, TikTok, Reddit, SoundCloud ve diğer yt-dlp siteleri. Bazı bağlantılar değişebilir veya oturum ister.",
      ],
      [
        "Yalnızca ses veya videonun bir kısmını indirebilir miyim?",
        "Evet. Ses, video, görüntü ve kesit seçenekleri kaynağa göre değişir.",
      ],
      [
        "Birden fazla bağlantı veya oynatma listesi ekleyebilir miyim?",
        "Ortak kaliteyle birden fazla bağlantı ekleyebilirsin. Oynatma listesi URL'si tek video veya tüm listeyi ekletir.",
      ],
      [
        "Dosyalarım nereye kaydedilir?",
        "Seçtiğin indirme klasörüne. Klasörü uygulama ayarlarından değiştirirsin.",
      ],
      [
        "Tarayıcı çerezlerimi vermem gerekiyor mu?",
        "Genellikle hayır. Oturum gerektiren kaynaklarda Ayarlar'dan isteğe bağlı Firefox veya cookies.txt kullanılır.",
      ],
      [
        "Windows neden SmartScreen uyarısı gösteriyor?",
        "Yükleyici kod imzalı değil. Yalnızca bu siteden veya resmi GitHub sürümünden indir ve kaynağa güveniyorsan devam et.",
      ],
      [
        "Downly açık kaynak mı?",
        "Evet — GPL-3.0. yt-dlp ve FFmpeg lisansları Lisanslar sayfasında.",
      ],
    ],
    install: [
      [
        "Yükleyiciyi indir",
        "Güncel Windows setup.exe dosyasını al. Tıklayınca indirme hemen başlar.",
      ],
      [
        "Yükleyiciyi çalıştır",
        "Kullanıcı kurulumu önerilir; yönetici izni istemez.",
      ],
      [
        "İlk bağlantını ekle",
        "Downly'yi aç, bağlantı yapıştır, format seç, kuyruğa ekle ve Başlat'a bas.",
      ],
    ],
    releaseLink: "Windows yükleyicisini indir",
    warningTitle: "Windows uyarısı hakkında",
    warning:
      "Yükleyici kod imzalı değil. SmartScreen ilk açılışta uyarı gösterebilir. Bu sitedeki veya resmi GitHub sürümündeki dosyaya güveniyorsan Daha fazla bilgi, ardından Yine de çalıştır.",
    rights:
      "Yalnızca indirme hakkına sahip olduğun içerikleri indir ve platform kurallarına uy.",
    privacy: [
      [
        "Bu web sitesi",
        "Analitik, reklam izleyicisi veya iletişim formu yok. Cloudflare Pages için hazırlanmıştır; siteyi sunmak için gerekli istekleri işler. GitHub ve diğer siteler kendi politikalarına tabidir.",
      ],
      [
        "Masaüstü uygulaması",
        "Ayarlar, kuyruk, geçmiş, indirmeler ve içe aktarılan cookies.txt bilgisayarında kalır. Bilgi ve indirme için yt-dlp kaynak siteye bağlanır. Güncellemeler GitHub'a bağlanabilir. Çerezler yalnızca sen açarsan kullanılır.",
      ],
      [
        "Sorular ve talepler",
        "GitHub Issues kullan. Issues herkese açıktır — parola, çerez veya özel veri paylaşma.",
      ],
    ],
    contactLink: "GitHub Issues'u aç",
    license: [
      [
        "Downly",
        "GNU Genel Kamu Lisansı sürüm 3. Tam metin ve kaynak proje deposunda.",
      ],
      [
        "Birlikte gelen araçlar",
        "yt-dlp (Unlicense) ve FFmpeg (bu projede GPL derlemesi). Ayrıntılar ilgili projelerde.",
      ],
    ],
    licenseLinks: [
      "Downly lisansını oku",
      "yt-dlp projesi",
      "FFmpeg lisansları",
    ],
    source: "Kaynak kodu gör",
    footer: "Sıradaki indirmen için net bir yer.",
    notFound: [
      "Bu sayfa bulunamadı.",
      "Downly ana sayfasına dönüp oradan devam et.",
      "Ana sayfaya dön",
    ],
    skip: "İçeriğe geç",
    menu: "Menüyü aç",
    navLabel: "Ana gezinme",
    footerNavLabel: "Alt gezinme",
    languageLabel: "Dil",
  },
} as const

export type SiteCopy = (typeof content)[Language]
