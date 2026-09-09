import http from 'node:http';
import https from 'node:https';
import tls from 'node:tls';
import { randomBytes } from 'node:crypto';

// Local development only. Fixed OpenAI destination, loopback listener and per-run token.
export async function startAssistantDevProxy(address) {
  const proxy = new URL(address);
  if (proxy.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(proxy.hostname) || proxy.username || proxy.password) throw new Error('ASSISTANT_HTTP_PROXY must be a local HTTP proxy.');
  const token = randomBytes(32).toString('hex');
  const agent = new https.Agent({ keepAlive: false });
  agent.createConnection = (_options, callback) => {
    const connect = http.request({ hostname: proxy.hostname, port: proxy.port || 80, method: 'CONNECT', path: 'api.openai.com:443', headers: { Host: 'api.openai.com:443' } });
    connect.setTimeout(15_000, () => connect.destroy(new Error('Proxy connection timeout')));
    connect.once('error', callback);
    connect.once('connect', (response, socket, head) => {
      if (response.statusCode !== 200) { socket.destroy(); callback(new Error('Proxy tunnel refused')); return; }
      if (head.length) socket.unshift(head);
      const secure = tls.connect({ socket, servername: 'api.openai.com', rejectUnauthorized: true });
      secure.once('secureConnect', () => { secure.removeListener('error', callback); callback(null, secure); });
      secure.once('error', callback);
    });
    connect.end();
  };
  const server = http.createServer((request, response) => {
    if (request.method !== 'POST' || request.url !== '/responses' || request.headers['x-assistant-relay-token'] !== token) { response.writeHead(403); response.end(); return; }
    const upstream = https.request('https://api.openai.com/v1/responses', { agent, method: 'POST', headers: { Authorization: request.headers.authorization || '', 'Content-Type': 'application/json' } }, result => {
      response.writeHead(result.statusCode || 502, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      result.pipe(response);
    });
    let bytes = 0;
    request.on('data', chunk => { bytes += chunk.length; if (bytes > 2_000_000) { upstream.destroy(); response.writeHead(413); response.end(); request.destroy(); } });
    upstream.setTimeout(95_000, () => upstream.destroy(new Error('OpenAI timeout')));
    upstream.on('error', () => { if (!response.headersSent) response.writeHead(502, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ error: { code: 'local_proxy_connection_failed' } })); });
    response.on('close', () => upstream.destroy());
    request.pipe(upstream);
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return { url: `http://127.0.0.1:${server.address().port}/responses`, token, close() { server.closeAllConnections(); server.close(); agent.destroy(); } };
}
