/**
 * WebAuthn TODO - Service Worker
 *
 * キャッシュ戦略:
 * - /api/* → ネットワークのみ（WebAuthn認証・暗号化データはキャッシュ不可）
 * - ナビゲーション → ネットワーク優先、失敗時はキャッシュにフォールバック
 * - 静的アセット → キャッシュ優先（ヒットしなければネットワーク取得してキャッシュ）
 */

const CACHE_NAME = "webauthn-todo-v1";

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(["/", "/manifest.webmanifest"])),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // API calls: never cache — WebAuthn ceremony and encrypted data must be fresh
  if (url.pathname.startsWith("/api/")) return;

  // Navigation (SPA): network first, fall back to cached shell
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => caches.match("/").then((r) => r ?? Response.error())),
    );
    return;
  }

  // Static assets: cache first, then network
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      });
    }),
  );
});
