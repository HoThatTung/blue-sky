// sw.js – Cache tĩnh + API kiểu stale-while-revalidate
const CACHE_STATIC  = 'bluesky-static-v3';
const CACHE_DYNAMIC = 'bluesky-dyn-v3';

/**
 * CORE_ASSETS: liệt kê asset cốt lõi.
 * Nếu site deploy TRONG THƯ MỤC CON (vd /blue-sky/), HẠN CHẾ dùng đường dẫn bắt đầu bằng '/'.
 * Khi đó, hãy đổi các mục bên dưới thành dạng tương đối: 'index.html', 'css/…', 'images/…'
 */
const CORE_ASSETS = [
  // '/',               // ⚠️ Chỉ giữ khi site chạy ở root domain
  '/index.html',
  '/about.html',
  '/shop.html',         // ✅ đồng bộ tên trang sản phẩm
  '/coloring.html',
  '/events.html',
  '/contact.html',

  '/css/base.css',
  '/css/index.css',
  '/css/shop.css',

  '/js/main.js',
  '/js/shop.js',

  '/images/logo.png',
  '/images/hero-bg.webp'
];

// Prefix API (Google Apps Script) để nhận diện request dữ liệu
const API_PREFIX = 'https://script.google.com/macros/s/AKfycbxE5c-0KmEuSGeSJulcfSvRmoVWFOE0UzxECVMBey7KNXk7CgSVNfpLUEiypzq24QbV/exec';

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_STATIC).then((c) => c.addAll(CORE_ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', async (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter(k => ![CACHE_STATIC, CACHE_DYNAMIC].includes(k))
          .map(k => caches.delete(k))
    );
  })());
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // 0) Điều hướng (SPA-less) -> ưu tiên mạng, fallback offline về trang đã cache
  if (req.mode === 'navigate') {
    event.respondWith(handleNavigate(req));
    return;
  }

  // 1) API Google Apps Script -> stale-while-revalidate
  if (url.href.startsWith(API_PREFIX)) {
    event.respondWith(swrAPI(req));
    return;
  }

  // 2) Tài nguyên cùng origin -> cache-first (bỏ qua query để tăng tỉ lệ hit)
  if (url.origin === self.location.origin) {
    event.respondWith(cacheFirstSameOrigin(req));
    return;
  }

  // 3) Ảnh khác domain -> cache-first (ghi vào dynamic)
  if (req.destination === 'image') {
    event.respondWith(cacheFirstImage(req));
  }
});

// ===== Strategies =====
async function swrAPI(request) {
  const cache = await caches.open(CACHE_DYNAMIC);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((res) => { cache.put(request, res.clone()); return res; })
    .catch(() => null);
  return cached || (await network) || new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
}

async function cacheFirstSameOrigin(request) {
  // tăng khả năng khớp cache khi có query string
  const cached = await caches.match(request, { ignoreSearch: true });
  if (cached) return cached;
  try {
    const res = await fetch(request);
    return res;
  } catch {
    // im lặng khi lỗi mạng
    return new Response(null, { status: 504 });
  }
}

async function cacheFirstImage(request) {
  const cache = await caches.open(CACHE_DYNAMIC);
  const cached = await cache.match(request, { ignoreSearch: true });
  if (cached) return cached;
  const res = await fetch(request).catch(() => null);
  if (res) cache.put(request, res.clone());
  return res || new Response(null, { status: 504 });
}

// Điều hướng: online-first, fallback offline
async function handleNavigate(request) {
  try {
    return await fetch(request);
  } catch {
    // Thử các fallback có sẵn trong cache (ưu tiên index, sau đó shop)
    const fallbackCandidates = [
      '/index.html', 'index.html',
      '/shop.html',  'shop.html'
    ];
    for (const url of fallbackCandidates) {
      const hit = await caches.match(url);
      if (hit) return hit;
    }
    return new Response('<h1>Offline</h1>', { status: 503, headers: { 'Content-Type': 'text/html; charset=UTF-8' } });
  }
}
