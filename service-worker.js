const DRAFT_CACHE_NAME = 'infoarchdiagram-drafts-v1';
const DRAFT_CACHE_KEY = new URL('__draft__/current', self.registration.scope).toString();

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

async function saveDraft(text) {
  const cache = await caches.open(DRAFT_CACHE_NAME);
  const body = JSON.stringify({
    text: typeof text === 'string' ? text : '',
    updatedAt: Date.now()
  });

  await cache.put(
    DRAFT_CACHE_KEY,
    new Response(body, {
      headers: {
        'Content-Type': 'application/json'
      }
    })
  );

  return { saved: true };
}

async function loadDraft() {
  const cache = await caches.open(DRAFT_CACHE_NAME);
  const response = await cache.match(DRAFT_CACHE_KEY);

  if (!response) {
    return { text: '', updatedAt: null };
  }

  return response.json();
}

async function clearDraft() {
  const cache = await caches.open(DRAFT_CACHE_NAME);
  await cache.delete(DRAFT_CACHE_KEY);
  return { cleared: true };
}

self.addEventListener('message', (event) => {
  const { type, payload } = event.data || {};
  const replyPort = event.ports && event.ports[0];

  const respond = (message) => {
    if (replyPort) {
      replyPort.postMessage(message);
    }
  };

  event.waitUntil((async () => {
    try {
      switch (type) {
        case 'save-draft': {
          const result = await saveDraft(payload && payload.text);
          respond({ ok: true, payload: result });
          break;
        }
        case 'load-draft': {
          const result = await loadDraft();
          respond({ ok: true, payload: result });
          break;
        }
        case 'clear-draft': {
          const result = await clearDraft();
          respond({ ok: true, payload: result });
          break;
        }
        default:
          respond({ ok: false, error: `Unsupported service worker message type: ${type}` });
      }
    } catch (error) {
      respond({
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  })());
});
