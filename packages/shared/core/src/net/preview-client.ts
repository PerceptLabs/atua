/**
 * Preview Client — registers the preview Service Worker and sends the fs MessagePort
 */
import type { AtuaFS } from '../fs/AtuaFS.js';
import { getPreviewSWSource } from './PreviewSW.js';

/**
 * Register the preview Service Worker and connect it to AtuaFS.
 *
 * The SW receives a MessagePort for filesystem access, enabling it to
 * serve files from AtuaFS as HTTP responses.
 */
export async function registerPreviewSW(fs: AtuaFS): Promise<ServiceWorkerRegistration> {
  if (!('serviceWorker' in navigator)) {
    throw new Error('Service Workers not available');
  }

  // Create a blob URL for the SW
  const swSource = getPreviewSWSource();
  const blob = new Blob([swSource], { type: 'application/javascript' });
  const swUrl = URL.createObjectURL(blob);

  // Register the SW
  const registration = await navigator.serviceWorker.register(swUrl, {
    scope: '/',
  });

  // Wait for the SW to be active
  const sw = registration.installing || registration.waiting || registration.active;
  if (!sw) throw new Error('No service worker available after registration');

  if (sw.state !== 'activated') {
    await new Promise<void>((resolve) => {
      sw.addEventListener('statechange', () => {
        if (sw.state === 'activated') resolve();
      });
    });
  }

  // Create a MessageChannel and send one port to the SW
  const channel = new MessageChannel();

  // Set up the fs port handler on our side
  setupFsPortHandler(channel.port1, fs);

  // Send the other port to the SW
  sw.postMessage({ type: 'atua-fs-port', port: channel.port2 }, [channel.port2]);

  // Clean up blob URL
  URL.revokeObjectURL(swUrl);

  return registration;
}

/**
 * Handle filesystem requests from the Service Worker over MessagePort.
 */
function setupFsPortHandler(port: MessagePort, fs: AtuaFS): void {
  port.onmessage = (event) => {
    const { type, path } = event.data;
    const replyPort = event.ports[0];

    if (!replyPort) return;

    try {
      switch (type) {
        case 'readFile': {
          const content = fs.readFileSync(path);
          replyPort.postMessage({ content });
          break;
        }
        case 'existsSync': {
          const exists = fs.existsSync(path);
          replyPort.postMessage({ exists });
          break;
        }
        default:
          replyPort.postMessage({ error: `Unknown request type: ${type}` });
      }
    } catch (err: any) {
      replyPort.postMessage({ error: err.message || String(err) });
    }
  };
}
