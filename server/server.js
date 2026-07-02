// HTTPサーバ本体（Node.js標準の node:http のみ使用、外部依存なし）
// - /api/* : routes.js の JSON API
// - /*     : public/ の静的ファイル（フロントの置き場所。ChatGPT作成のHTML等をここに置く）
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { routes, HttpError } from './routes.js';

const PORT = Number(process.env.PORT ?? 3000);
const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

// "/api/users/:id/schedule" のようなパスパターンをマッチさせる
function matchPath(pattern, actual) {
  const p = pattern.split('/');
  const a = actual.split('/');
  if (p.length !== a.length) return null;
  const params = {};
  for (let i = 0; i < p.length; i++) {
    if (p[i].startsWith(':')) params[p[i].slice(1)] = decodeURIComponent(a[i]);
    else if (p[i] !== a[i]) return null;
  }
  return params;
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (chunks.length === 0) return null;
  const text = Buffer.concat(chunks).toString('utf-8');
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, 'リクエストボディが JSON として解釈できません');
  }
}

function sendJson(res, status, data, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
  res.end(JSON.stringify(data));
}

async function serveStatic(res, pathname) {
  const safePath = normalize(pathname).replace(/^(\.\.[/\\])+/, '');
  let filePath = join(PUBLIC_DIR, safePath);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    return sendJson(res, 403, { error: 'forbidden' });
  }
  if (pathname === '/' || pathname === '') filePath = join(PUBLIC_DIR, 'index.html');
  try {
    const data = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': MIME[extname(filePath)] ?? 'application/octet-stream' });
    res.end(data);
  } catch {
    sendJson(res, 404, { error: 'not found' });
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
  const query = Object.fromEntries(url.searchParams);

  if (!url.pathname.startsWith('/api/')) {
    return serveStatic(res, url.pathname);
  }

  try {
    for (const route of routes) {
      if (route.method !== req.method) continue;
      const params = matchPath(route.path, url.pathname);
      if (!params) continue;
      const body = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) ? await readBody(req) : null;
      const result = await route.handler(req, { params, query, body });
      return sendJson(res, result.status ?? 200, result.json, result.headers ?? {});
    }
    sendJson(res, 404, { error: `no route: ${req.method} ${url.pathname}` });
  } catch (err) {
    if (err instanceof HttpError) {
      sendJson(res, err.status, { error: err.message });
    } else {
      console.error(err);
      sendJson(res, 500, { error: 'internal server error' });
    }
  }
});

server.listen(PORT, () => {
  console.log(`受講科目登録・閲覧システム APIサーバ起動: http://localhost:${PORT}`);
  console.log(`認証プロバイダ: ${process.env.OLAB_AUTH ?? 'password'}`);
});
