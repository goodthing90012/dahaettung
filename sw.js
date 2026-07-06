const CACHE_NAME = 'dasseottung-v141';

const ASSETS = [
    './',
    './index.html',
    './manifest.json',
    './icon-192.png',
    './icon-512.png'
];

// 설치: 핵심 파일 캐시
self.addEventListener('install', (e) => {
    e.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(ASSETS.map(url => new Request(url, { cache: 'reload' })));
        }).catch(() => {
            // 아이콘 등 일부 파일 없어도 설치 계속 진행
            return caches.open(CACHE_NAME).then(cache => cache.add('./index.html'));
        })
    );
    self.skipWaiting();
});

// 활성화: 구버전 캐시 삭제
self.addEventListener('activate', (e) => {
    e.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(
                keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
            )
        )
    );
    self.clients.claim();
});

// 요청 가로채기: 캐시 우선, 없으면 네트워크
self.addEventListener('fetch', (e) => {
    // POST 등 non-GET은 패스
    if (e.request.method !== 'GET') return;

    e.respondWith(
        caches.match(e.request).then((cached) => {
            if (cached) return cached;
            return fetch(e.request).then((response) => {
                // 유효한 응답만 캐시에 저장
                if (response && response.status === 200 && response.type === 'basic') {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
                }
                return response;
            }).catch(() => {
                // 오프라인 + 캐시 없을 때 index.html 폴백
                if (e.request.destination === 'document') {
                    return caches.match('./index.html');
                }
            });
        })
    );
});
