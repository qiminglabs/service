import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const clientRoot = resolve(root, 'dist/client');
const workerPath = new URL('../dist/server/index.js', import.meta.url);

const contentTypes = new Map([
  ['.avif', 'image/avif'],
  ['.css', 'text/css; charset=utf-8'],
  ['.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  ['.gif', 'image/gif'],
  ['.htm', 'text/html; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.jpeg', 'image/jpeg'],
  ['.jpg', 'image/jpeg'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.map', 'application/json; charset=utf-8'],
  ['.md', 'text/markdown; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml; charset=utf-8'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.webp', 'image/webp'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
]);

function firstHeader(value) {
  return value?.split(',')[0]?.trim() || '';
}

function requestUrl(request) {
  const protocol = firstHeader(request.headers['x-forwarded-proto']) || 'http';
  const host = firstHeader(request.headers['x-forwarded-host']) || request.headers.host || 'localhost';
  return new URL(request.url || '/', `${protocol}://${host}`);
}

function assetPath(url) {
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return null;
  }
  if (pathname.includes('\0')) return null;
  const candidate = resolve(clientRoot, `.${pathname}`);
  return candidate === clientRoot || candidate.startsWith(`${clientRoot}${sep}`) ? candidate : null;
}

async function assetResponse(input) {
  const request = input instanceof Request ? input : new Request(input);
  if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method Not Allowed', { status: 405 });
  const target = assetPath(new URL(request.url));
  if (!target || target === clientRoot) return new Response('Not Found', { status: 404 });
  try {
    const details = await stat(target);
    if (!details.isFile()) return new Response('Not Found', { status: 404 });
    const headers = new Headers({
      'Content-Length': String(details.size),
      'Content-Type': contentTypes.get(extname(target).toLowerCase()) || 'application/octet-stream',
      'Cache-Control': new URL(request.url).pathname.startsWith('/_next/static/')
        ? 'public, max-age=31536000, immutable'
        : 'public, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
    });
    return new Response(request.method === 'HEAD' ? null : await readFile(target), { status: 200, headers });
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return new Response('Not Found', { status: 404 });
    throw error;
  }
}

function webRequest(request, url) {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (Array.isArray(value)) value.forEach(item => headers.append(name, item));
    else if (value !== undefined) headers.set(name, value);
  }
  const body = request.method === 'GET' || request.method === 'HEAD' ? undefined : Readable.toWeb(request);
  return new Request(url, {
    method: request.method,
    headers,
    body,
    ...(body ? { duplex: 'half' } : {}),
  });
}

async function sendResponse(response, outgoing, method) {
  response.headers.forEach((value, name) => {
    if (name !== 'set-cookie') outgoing.setHeader(name, value);
  });
  const cookies = response.headers.getSetCookie?.() || [];
  if (cookies.length) outgoing.setHeader('set-cookie', cookies);
  outgoing.statusCode = response.status;
  outgoing.statusMessage = response.statusText;
  if (method === 'HEAD' || !response.body || [204, 205, 304].includes(response.status)) {
    outgoing.end();
    return;
  }
  await new Promise((resolvePromise, reject) => {
    const stream = Readable.fromWeb(response.body);
    stream.once('error', reject);
    outgoing.once('error', reject);
    outgoing.once('finish', resolvePromise);
    stream.pipe(outgoing);
  });
}

const { default: worker } = await import(workerPath.href);
if (!worker || typeof worker.fetch !== 'function') throw new Error('The Vinext worker build does not export fetch().');

const server = createServer(async (incoming, outgoing) => {
  try {
    const url = requestUrl(incoming);
    if (url.pathname === '/healthz') {
      await sendResponse(new Response('ok', { headers: { 'Cache-Control': 'no-store' } }), outgoing, incoming.method);
      return;
    }

    const directAsset = incoming.method === 'GET' || incoming.method === 'HEAD'
      ? await assetResponse(new Request(url, { method: incoming.method }))
      : new Response('Not Found', { status: 404 });
    const response = directAsset.status === 404
      ? await worker.fetch(
          webRequest(incoming, url),
          { ASSETS: { fetch: assetResponse } },
          { waitUntil(promise) { Promise.resolve(promise).catch(error => console.error('Background task failed', error)); } },
        )
      : directAsset;
    await sendResponse(response, outgoing, incoming.method);
  } catch (error) {
    console.error('Request failed', error);
    if (!outgoing.headersSent) {
      outgoing.statusCode = 500;
      outgoing.setHeader('Content-Type', 'text/plain; charset=utf-8');
    }
    outgoing.end('Internal Server Error');
  }
});

const port = Number.parseInt(process.env.PORT || '8080', 10);
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('PORT must be an integer between 0 and 65535.');

server.listen(port, '0.0.0.0', () => {
  const address = server.address();
  const activePort = typeof address === 'object' && address ? address.port : port;
  console.log(`Cloud Run server listening on 0.0.0.0:${activePort}`);
});

function shutdown(signal) {
  console.log(`Received ${signal}; closing HTTP server.`);
  server.close(error => {
    if (error) {
      console.error('Server shutdown failed', error);
      process.exitCode = 1;
    }
  });
}

process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));
