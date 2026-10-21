// アプリとして入れるための構成が壊れていないかを確かめる。実行: node --test tests/*.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const manifest = JSON.parse(read('manifest.webmanifest'));
const pngSize = (f) => { const b = fs.readFileSync(path.join(root, f)); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };

test('manifest: 必須の項目とアイコン（通常・maskable）がそろっている', () => {
  for (const k of ['name', 'short_name', 'start_url', 'display', 'icons', 'theme_color', 'background_color']) assert.ok(manifest[k], k);
  assert.equal(manifest.display, 'standalone');
  const purposes = manifest.icons.map((i) => i.purpose);
  assert.ok(purposes.includes('any') && purposes.includes('maskable'));
  assert.ok(manifest.icons.some((i) => i.sizes === '192x192') && manifest.icons.some((i) => i.sizes === '512x512'));
});

test('manifest: アイコンのファイルが存在し、宣言どおりの大きさ', () => {
  for (const i of manifest.icons) {
    assert.ok(fs.existsSync(path.join(root, i.src)), i.src);
    if (i.type === 'image/png') assert.deepEqual(pngSize(i.src), i.sizes.split('x').map(Number), i.src);
  }
  assert.deepEqual(pngSize('icons/apple-touch-icon.png'), [180, 180]);
});

test('manifest: 共有メニューの受け取り（GET で title・text・url）', () => {
  assert.equal(manifest.share_target.method, 'GET');
  assert.deepEqual(Object.keys(manifest.share_target.params).sort(), ['text', 'title', 'url']);
});

test('Service Worker: 控えるファイルがすべて存在する', () => {
  const sw = read('sw.js');
  const shell = JSON.parse(sw.match(/const SHELL = (\[[\s\S]*?\]);/)[1].replace(/'/g, '"'));
  for (const f of shell) { const p = f === './' ? 'index.html' : f; assert.ok(fs.existsSync(path.join(root, p)), f); }
  // index.html が読み込む自分のファイルは、すべてオフライン用の控えに含める
  const html = read('index.html');
  for (const m of html.matchAll(/(?:href|src)="((?:icons\/)?[\w.-]+\.(?:js|css|webmanifest|png|svg))"/g)) assert.ok(shell.includes(m[1]), m[1] + ' を控えに含める');
});

test('index.html: manifest・アイコン・スクリプトの参照先が存在し、読み込み順が正しい', () => {
  const html = read('index.html');
  for (const m of html.matchAll(/(?:href|src)="((?:icons\/|[\w-]+\.(?:js|css|webmanifest)))"/g)) assert.ok(fs.existsSync(path.join(root, m[1])), m[1]);
  assert.match(html, /rel="manifest" href="manifest\.webmanifest"/);
  const order = ['lib.js', 'app.js', 'pwa.js'].map((f) => html.indexOf(`src="${f}"`));
  assert.ok(order.every((n) => n > 0) && order[0] < order[1] && order[1] < order[2]);
});

test('index.html: JS から参照する id がすべて存在し、重複しない', () => {
  const html = read('index.html');
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(new Set(ids).size, ids.length, '重複した id');
  // 詳細パネルなど、JS が実行時に作る要素の id（テンプレート内の id="..."）も数える
  const made = [...read('app.js').matchAll(/\bid="([\w-]+)"/g), ...read('app.js').matchAll(/id="(\w+_)\$\{/g)].map((m) => m[1]);
  for (const f of ['app.js', 'pwa.js']) {
    for (const m of read(f).matchAll(/\$\('#([\w-]+)'\)/g)) assert.ok(ids.includes(m[1]) || made.includes(m[1]) || made.some((p) => p.endsWith('_') && m[1].startsWith(p)), `${f} が参照する #${m[1]} がない`);
  }
});

test('CSP: 外部・埋め込みのスクリプトを許さず、インラインのスクリプトも残っていない', () => {
  const html = read('index.html');
  const csp = html.match(/Content-Security-Policy" content="([^"]+)"/)[1];
  assert.match(csp, /script-src 'self'(;|$)/);
  assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval/);
  assert.match(csp, /object-src 'none'/);
  assert.equal([...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>/g)].length, 0, 'インラインの <script> がある');
  assert.doesNotMatch(html, /\son\w+="/, 'インラインのイベント属性がある');
});

test('Service Worker: ブラウザの HTTP キャッシュを通さずに最新を取りに行く', () => {
  // GitHub Pages は max-age=600 で配信する。素の fetch だと更新後も最大10分、古い app.js が使われる
  const sw = read('sw.js');
  assert.match(sw, /cache: 'no-cache'/);
  assert.match(sw, /cache: 'reload'/);
});

test('同期: GitHub API はブラウザの HTTP キャッシュを通さない', () => {
  // GET /gists/:id は max-age=60。キャッシュの古い同期データを元に push すると、他の端末の変更を上書きする
  const app = read('app.js');
  assert.match(app, /async function gh\(path, opts = \{\}\) \{[\s\S]*?fetch\(GH \+ path, \{ cache: 'no-store'/);
});
