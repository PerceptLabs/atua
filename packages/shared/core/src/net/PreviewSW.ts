/**
 * Preview Service Worker
 *
 * Intercepts fetch requests to serve files from AtuaFS.
 * Receives a MessagePort from the main thread for filesystem access.
 */
import { getMimeMap } from './mime.js';

/**
 * Returns the Service Worker source code as a string.
 * This gets registered as a blob URL or written to a file served by the host.
 */
export function getPreviewSWSource(): string {
  return `
// Atua Preview Service Worker
// Serves files from AtuaFS via MessagePort

const MIME_MAP = ${JSON.stringify(getMimeMap())};

let fsPort = null;
let fsReady = false;
let pendingRequests = [];
let apiHandlerLoaded = false;

// Message handler — receives MessagePort for fs access
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'atua-fs-port') {
    fsPort = event.data.port;
    fsReady = true;
    // Process any pending requests
    for (const resolve of pendingRequests) {
      resolve();
    }
    pendingRequests = [];
  }
  if (event.data && event.data.type === 'atua-api-code') {
    try {
      // Load the API handler code (IIFE that sets self.atuaApiHandler)
      new Function(event.data.code)();
      apiHandlerLoaded = typeof self.atuaApiHandler === 'function';
    } catch (e) {
      console.error('[Atua SW] Failed to load API handler:', e);
    }
  }
  if (event.data && event.data.type === 'atua-api-env') {
    self.__atuaEnv = event.data.env || {};
  }
});

// Activate immediately
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Install immediately
self.addEventListener('install', () => {
  self.skipWaiting();
});

function getMimeType(path) {
  const ext = path.substring(path.lastIndexOf('.')).toLowerCase();
  return MIME_MAP[ext] || 'application/octet-stream';
}

function waitForFs() {
  if (fsReady) return Promise.resolve();
  return new Promise((resolve) => {
    pendingRequests.push(resolve);
  });
}

// Read a file from AtuaFS via MessagePort
function readFile(path) {
  return new Promise((resolve, reject) => {
    if (!fsPort) {
      reject(new Error('No filesystem port available'));
      return;
    }
    const channel = new MessageChannel();
    channel.port1.onmessage = (event) => {
      if (event.data.error) {
        reject(new Error(event.data.error));
      } else {
        resolve(event.data.content);
      }
    };
    fsPort.postMessage({ type: 'readFile', path }, [channel.port2]);
  });
}

// Check if a file exists in AtuaFS
function fileExists(path) {
  return new Promise((resolve) => {
    if (!fsPort) {
      resolve(false);
      return;
    }
    const channel = new MessageChannel();
    channel.port1.onmessage = (event) => {
      resolve(event.data.exists);
    };
    fsPort.postMessage({ type: 'existsSync', path }, [channel.port2]);
  });
}

// Fetch interceptor
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Only intercept same-origin requests
  if (url.origin !== self.location.origin) return;

  // Route /api/* through Hono handler if loaded, otherwise pass through
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/api?')) {
    if (apiHandlerLoaded && typeof self.atuaApiHandler === 'function') {
      event.respondWith(self.atuaApiHandler(event.request));
    }
    return;
  }

  // Pass through /__vitest* and other framework routes
  if (url.pathname.startsWith('/__') || url.pathname.startsWith('/node_modules/') || url.pathname.startsWith('/@')) {
    return;
  }

  event.respondWith(handleRequest(url.pathname));
});

async function handleRequest(pathname) {
  await waitForFs();

  // Try exact file match in /dist/
  const distPath = '/dist' + pathname;
  try {
    if (await fileExists(distPath)) {
      const content = await readFile(distPath);
      return new Response(content, {
        status: 200,
        headers: { 'Content-Type': getMimeType(distPath) },
      });
    }
  } catch {}

  // Try exact file match at root
  try {
    if (await fileExists(pathname)) {
      const content = await readFile(pathname);
      return new Response(content, {
        status: 200,
        headers: { 'Content-Type': getMimeType(pathname) },
      });
    }
  } catch {}

  // SPA fallback — return /dist/index.html for non-file routes
  try {
    if (await fileExists('/dist/index.html')) {
      const content = await readFile('/dist/index.html');
      return new Response(content, {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      });
    }
  } catch {}

  return new Response('Not Found', { status: 404 });
}
`;
}

