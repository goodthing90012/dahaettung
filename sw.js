const CACHE_NAME = 'dahaettung-v41';

const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './logo.png',
  './char-allclear.png'
];

// 설치: 핵심 파일 캐시 (항상 최신으로 받기 위해 reload 사용)
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      cache.addAll(ASSETS.map((url) => new Request(url, { cache: 'reload' })))
    ).catch(() => {
      // 일부 파일이 실패해도 핵심 파일(index.html)만은 캐시해서 설치를 이어감
      return caches.open(CACHE_NAME).then((cache) =>
        cache.add(new Request('./index.html', { cache: 'reload' }))
      );
    })
  );
  self.skipWaiting();
});

// 활성화: 구버전 캐시 삭제
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// 요청 가로채기: HTML은 항상 최신 우선, 정적 파일은 캐시 우선
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return; // POST 등은 그냥 통과

  const isHTML =
    e.request.mode === 'navigate' ||
    e.request.destination === 'document' ||
    e.request.url.endsWith('.html') ||
    e.request.url.endsWith('/');

  if (isHTML) {
    // HTML: 네트워크에서 최신을 먼저 받아오고, 실패하면 캐시 → 그것도 없으면 index.html로 대체
    e.respondWith(
      fetch(e.request, { cache: 'no-store' })
        .then((res) => {
          if (res && res.status === 200) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(e.request, copy));
          }
          return res;
        })
        .catch(() =>
          caches.match(e.request).then((cached) => cached || caches.match('./index.html'))
        )
    );
  } else {
    // 이미지 등 정적 파일: 캐시 우선, 없으면 네트워크에서 받아 검증 후 저장
    e.respondWith(
      caches.match(e.request).then((cached) => {
        if (cached) return cached;
        return fetch(e.request)
          .then((res) => {
            if (res && res.status === 200 && res.type === 'basic') {
              const copy = res.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(e.request, copy));
            }
            return res;
          })
          .catch(() => cached);
      })
    );
  }
});
