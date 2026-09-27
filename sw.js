const CACHE_NAME = 'dahaettung-v166';

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

// ── 저녁 알림: GitHub Actions가 매일 밤 푸시 신호를 보내면, 앱이 적어둔 스냅샷을 읽어 "아직 안 한 것"을 보여줌 ──
function openReminderDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('dahaettung-reminder', 1);
    req.onupgradeneeded = () => { req.result.createObjectStore('kv'); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function readReminderSnapshot() {
  try {
    const db = await openReminderDB();
    const snap = await new Promise((resolve) => {
      const r = db.transaction('kv', 'readonly').objectStore('kv').get('snapshot');
      r.onsuccess = () => resolve(r.result || null);
      r.onerror = () => resolve(null);
    });
    db.close();
    return snap;
  } catch (e) { return null; }
}
function localDateStr(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
// 알림 문구 결정 — 스냅샷에 오늘 데이터가 없으면(앱을 2주 넘게 안 열었거나 처음) 일반 안내로 대체
function buildReminder(snap, todayStr) {
  const day = snap && snap.days ? snap.days[todayStr] : null;
  if (!day) return { title: '다했텅 체크할 시간이에요', body: '오늘 한 일을 체크해 보세요 💚' };
  if (day.total === 0) return null; // 오늘 할 게 아예 없으면 조용히(아래서 최소 알림 처리)
  if (day.pending.length === 0) return { title: '🎉 오늘 올클리어!', body: '다 했텅! 수고했어요 💚' };
  const shown = day.pending.slice(0, 4).join(' · ');
  const more = day.pending.length > 4 ? ` 외 ${day.pending.length - 4}개` : '';
  return { title: `📋 아직 안 한 게 ${day.pending.length}개 있어요`, body: shown + more };
}
async function showDailyReminder() {
  const snap = await readReminderSnapshot();
  const msg = buildReminder(snap, localDateStr(new Date()))
    || { title: '다했텅', body: '오늘은 등록된 일정이 없어요' }; // 푸시는 반드시 알림을 띄워야 해서 최소 문구
  return self.registration.showNotification(msg.title, {
    body: msg.body,
    icon: './icon-192.png',
    badge: './icon-192.png',
    tag: 'daily-reminder', // 같은 날 여러 번 와도 하나로 덮어씀
    renotify: true,
    data: { url: './?from=reminder' },
  });
}
self.addEventListener('push', (e) => { e.waitUntil(showDailyReminder()); });
self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'reminder-preview') e.waitUntil(showDailyReminder());
});
// 알림 클릭: 이미 열린 다했텅 창이 있으면 앞으로 띄우고 "오늘 체크 탭" 신호만 보냄(새로고침 없이),
// 없거나 실패하면 새로 연다. (예전엔 navigate()로 이동하다 실패하면 아무것도 안 열리는 버그가 있었음)
async function openFromReminder(targetUrl) {
  const wins = await clients.matchAll({ type: 'window', includeUncontrolled: true });
  const win = wins.find((w) => w.url.startsWith(self.registration.scope));
  if (win) {
    win.postMessage({ type: 'open-check-today' }); // 체크 탭 전환 신호는 먼저 보내둠(포커스 성공 여부와 무관)
    try { return await win.focus(); }
    catch (err) { /* 앞으로 띄우기 실패하면 아래에서 새로 열기 */ }
  }
  return clients.openWindow(targetUrl);
}
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = new URL((e.notification.data && e.notification.data.url) || './', self.registration.scope).href;
  e.waitUntil(openFromReminder(target));
});
