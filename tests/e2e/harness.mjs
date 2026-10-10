// ブラウザでの通しの動作確認（e2e）の共通部分。静的サーバーを立て、Chromium を起動する。
// 外部 API はすべて各テストが模したデータで返す（実際の通信はしない）。
// 使うもの: Playwright と Chromium。パスは環境変数で指定できる。
//   PLAYWRIGHT_PATH  例: $(npm root -g)/playwright/index.mjs（省略時は import 'playwright'）
//   CHROMIUM_PATH    例: /opt/pw-browsers/chromium（省略時は Playwright 付属のもの）
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png' };

export async function start() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    let file = path.join(root, decodeURIComponent(url.pathname));
    if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!fs.existsSync(file)) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' }).end(fs.readFileSync(file));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://localhost:${server.address().port}`;
  const { chromium } = await import(process.env.PLAYWRIGHT_PATH || 'playwright');
  // api.github.com などへ直接つなげるよう、CORS は無効にして起動する（実際の通信はしない）
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--disable-web-security'] });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bunken-e2e-'));
  const ok = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) process.exitCode = 1; };
  const stop = async () => { await browser.close(); server.close(); };
  return { base, browser, tmp, ok, stop };
}
