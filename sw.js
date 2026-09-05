const CACHE_NAME = 'dahaettung-v158';

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

// ── 공유 대상(Share Target): 다른 앱에서 "다했텅"으로 사진을 공유했을 때 받는 곳 ──
// GitHub Pages는 정적 호스팅이라 서버 코드가 없어서, 서비스워커가 POST를 직접 가로채 처리한다.
const SHARE_DB_NAME = 'dahaettung-share-tmp';
function openShareDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(SHARE_DB_NAME, 1);
    req.onupgradeneeded = () => { req.result.createObjectStore('pending', { autoIncrement: true }); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function storePendingShareFiles(files) {
  const db = await openShareDB();
  await new Promise((resolve, reject) => {
    const tx = db.transaction('pending', 'readwrite');
    const store = tx.objectStore('pending');
    files.forEach((f) => store.add({ blob: f, name: f.name || '', type: f.type || '', sharedAt: Date.now() }));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

// 요청 가로채기: HTML은 항상 최신 우선, 정적 파일은 캐시 우선
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // 다른 앱의 공유 시트에서 "다했텅"을 선택했을 때 오는 요청
  if (e.request.method === 'POST' && url.pathname.endsWith('/share-target')) {
    e.respondWith((async () => {
      try {
        const formData = await e.request.formData();
        const files = formData.getAll('photos').filter((f) => f && typeof f === 'object' && f.size > 0);
        if (files.length) await storePendingShareFiles(files);
      } catch (err) { /* 실패해도 앱은 정상적으로 열리게 그냥 진행 */ }
      return Response.redirect('./?shared=1', 303);
    })());
    return;
  }

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
