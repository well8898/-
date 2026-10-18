// 인터넷이 안 될 때도 화면이 열리게: 마지막으로 연 일정 화면(/)과 글꼴·아이콘을 이 휴대폰에 보관
// (일정 내용은 화면이 따로 보관 — localStorage 'sched.mine:…')
const C = 'today-site-v1';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.method !== 'GET') return;
  const u = new URL(r.url);
  // 일정 화면: 인터넷 먼저, 안 되면 보관해 둔 화면
  if (r.mode === 'navigate' && u.origin === location.origin && u.pathname === '/') {
    e.respondWith(
      fetch(r)
        .then(res => {
          if (res.ok) {
            const cp = res.clone();
            caches.open(C).then(c => c.put('/__page', cp));
          }
          return res;
        })
        .catch(() => caches.match('/__page').then(m => m || Response.error()))
    );
    return;
  }
  // 글꼴·아이콘: 보관해 둔 것 먼저
  if (u.hostname === 'cdn.jsdelivr.net' || (u.origin === location.origin && u.pathname.startsWith('/icons/'))) {
    e.respondWith(
      caches.match(r).then(
        m =>
          m ||
          fetch(r).then(res => {
            if (res.ok) {
              const cp = res.clone();
              caches.open(C).then(c => c.put(r, cp));
            }
            return res;
          })
      )
    );
  }
});
