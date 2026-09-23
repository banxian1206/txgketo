// public/sw.js —— PWA Service Worker（重构 3.3 · 最小生产策略）
// 设计要点：
//  ① 仅生产注册（main.tsx 有 import.meta.env.PROD 守卫）—— dev/e2e 环境绝不注册，防止缓存污染 HMR 与回归
//  ② /api/ 一律 network-first 不缓存：内网业务数据必须实时（AGENTS：不做假在线数据）
//  ③ 带 hash 的静态资产 cache-first（内容不可变，缓存命中即免流量）
//  ④ 导航 network-first + 缓存兜底：断网时能打开 App Shell（离线队列 3.2 的前置）
const VERSION = 'txgk-v1';
const ASSET_RE = /\.(js|css|png|jpg|jpeg|svg|webp|ico|woff2?)$/;

self.addEventListener('install', (e) => {
  e.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))),
    ).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.pathname.startsWith('/api/')) return; // 业务数据不缓存

  if (ASSET_RE.test(url.pathname)) {
    // 静态资产：cache-first（命中即返回，未命中网络并回填）
    e.respondWith(
      caches.match(e.request).then((hit) =>
        hit || fetch(e.request).then((res) => {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(e.request, copy));
          return res;
        }),
      ),
    );
    return;
  }

  if (e.request.mode === 'navigate') {
    // 导航：network-first，断网兜底缓存的 index.html（App Shell）
    e.respondWith(
      fetch(e.request).then((res) => {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put('/index.html', copy));
        return res;
      }).catch(() => caches.match('/index.html')),
    );
  }
});
