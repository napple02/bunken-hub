// 端末間の引き継ぎ（lib.js の同期・バックアップ・共有）の単体テスト。実行: node --test tests/*.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../lib.js');

const meta = (t) => ({ source: 't', doi: '', title: t, authors: [], year: '2026', venue: '', oa: [] });
const ent = (id, at, extra = {}) => ({ id, status: 'want', memo: '', addedAt: '2026-10-01', updatedAt: at, meta: meta(id), ...extra });
const NOW = new Date('2026-10-10T00:00:00Z');

test('マージ: 新しいほうを採用し、片方にしかないものは両方に入る', () => {
  const local = { entries: [ent('a', '2026-10-02T00:00:00Z', { memo: '手元' }), ent('b', '2026-10-03T00:00:00Z')], tombs: [] };
  const remote = { entries: [ent('a', '2026-10-05T00:00:00Z', { memo: 'リモート' }), ent('c', '2026-10-04T00:00:00Z')], tombs: [] };
  const m = L.mergeLedgers(local, remote, NOW);
  assert.deepEqual(m.entries.map((e) => e.id).sort(), ['a', 'b', 'c']);
  assert.equal(m.entries.find((e) => e.id === 'a').memo, 'リモート');
});

test('マージ: 削除（墓標）は古い編集に勝ち、新しい編集には負ける', () => {
  const local = { entries: [], tombs: [{ id: 'a', updatedAt: '2026-10-06T00:00:00Z' }, { id: 'b', updatedAt: '2026-10-02T00:00:00Z' }] };
  const remote = { entries: [ent('a', '2026-10-05T00:00:00Z'), ent('b', '2026-10-04T00:00:00Z')], tombs: [] };
  const m = L.mergeLedgers(local, remote, NOW);
  assert.deepEqual(m.entries.map((e) => e.id), ['b']);
  assert.deepEqual(m.tombs.map((t) => t.id), ['a']);
});

test('マージ: 同時刻なら文献を残す。古すぎる墓標は捨てる', () => {
  const t = '2026-10-05T00:00:00Z';
  const m = L.mergeLedgers({ entries: [ent('a', t)], tombs: [] }, { entries: [], tombs: [{ id: 'a', updatedAt: t }, { id: 'old', updatedAt: '2025-01-01T00:00:00Z' }] }, NOW);
  assert.deepEqual(m.entries.map((e) => e.id), ['a']);
  assert.deepEqual(m.tombs, []);
});

test('マージ: updatedAt がない古い台帳は追加日で比べる', () => {
  const old = { id: 'x', status: 'want', memo: '古い', addedAt: '2026-09-01', meta: meta('x') };
  const m = L.mergeLedgers({ entries: [old], tombs: [] }, { entries: [ent('x', '2026-10-01T00:00:00Z', { memo: '新しい' })], tombs: [] }, NOW);
  assert.equal(m.entries[0].memo, '新しい');
});

test('同期: リモートが空なら push だけ必要', () => {
  const local = { entries: [ent('a', '2026-10-02T00:00:00Z')], tombs: [], settings: { email: 'a@b.jp', settingsUpdatedAt: '2026-10-01T00:00:00Z' } };
  const r = L.mergeSync(local, null, NOW);
  assert.equal(r.push, true);
  assert.equal(r.pull, false);
});

test('同期: 変化がなければ push も pull も要らない', () => {
  const entries = [ent('a', '2026-10-02T00:00:00Z')];
  const local = { entries, tombs: [], settings: { email: 'a@b.jp', settingsUpdatedAt: '2026-10-01T00:00:00Z' } };
  const remote = L.buildSyncPayload({ entries, tombs: [], settings: { email: 'a@b.jp' }, settingsUpdatedAt: '2026-10-01T00:00:00Z' }, NOW);
  const r = L.mergeSync(local, remote, NOW);
  assert.equal(r.push, false);
  assert.equal(r.pull, false);
});

test('同期: 新しい端末はリモートの台帳と設定をそのまま受け取る', () => {
  const remote = L.buildSyncPayload({ entries: [ent('a', '2026-10-02T00:00:00Z')], tombs: [], settings: { email: 'me@x.jp', name: '山田' }, settingsUpdatedAt: '2026-10-03T00:00:00Z' }, NOW);
  const r = L.mergeSync({ entries: [], tombs: [], settings: {} }, remote, NOW);
  assert.equal(r.pull, true);
  assert.equal(r.next.entries.length, 1);
  assert.deepEqual(r.next.settings, { email: 'me@x.jp', name: '山田' });
  assert.equal(r.next.settingsUpdatedAt, '2026-10-03T00:00:00Z');
});

test('同期: 設定は新しいほうが勝つ。トークンなど秘密の値は共有しない', () => {
  const local = { entries: [], tombs: [], settings: { email: '新@x.jp', gistToken: 'ghp_secret', oakey: 'k', theme: 'dark', settingsUpdatedAt: '2026-10-05T00:00:00Z' } };
  const remote = { app: 'bunken-hub', settings: { email: '旧@x.jp', settingsUpdatedAt: '2026-10-01T00:00:00Z' }, ledger: [], tombs: [] };
  const r = L.mergeSync(local, remote, NOW);
  assert.deepEqual(r.next.settings, { email: '新@x.jp' });
  assert.equal(r.push, true);
  const payload = JSON.stringify(L.buildSyncPayload(r.next, NOW));
  assert.ok(!payload.includes('ghp_secret'));
  assert.ok(!payload.includes('"oakey"'));
});

test('同期データでは書誌から関連文献の ID を落とす', () => {
  const e = ent('a', '2026-10-02T00:00:00Z'); e.meta.refIds = ['W1']; e.meta.relIds = ['W2']; e.meta.orcids = ['x'];
  const p = L.buildSyncPayload({ entries: [e], tombs: [], settings: {}, settingsUpdatedAt: '' }, NOW);
  assert.equal(p.ledger[0].meta.refIds, undefined);
  assert.equal(p.ledger[0].meta.title, 'a');
});

test('バックアップの読み込み: 旧形式の配列・新形式・ウォッチの JSON を見分ける', () => {
  const e = ent('a', '2026-10-02T00:00:00Z');
  assert.equal(L.parseImport([e]).kind, 'backup');
  const b = L.parseImport(L.buildBackup({ email: 'a@b.jp', gistToken: 'secret' }, [e], NOW));
  assert.deepEqual(b.settings, { email: 'a@b.jp' });
  assert.equal(b.entries.length, 1);
  assert.equal(L.parseImport([{ title: 'T', journal: 'J', score: 3 }]).kind, 'watch');
  // ウォッチの週次バッファ（{schema_version, items}）もウォッチの出力として読む
  const buf = L.parseImport({ schema_version: 1, items: [{ title: 'T', journal: 'J', score: 3 }] });
  assert.equal(buf.kind, 'watch');
  assert.equal(buf.papers.length, 1);
  assert.equal(L.parseImport({ foo: 1 }), null);
  assert.equal(L.parseImport('x'), null);
});

test('共有されたテキストから検索語を決める', () => {
  const p = (o) => new URLSearchParams(o);
  assert.equal(L.sharedQuery(p({ text: 'https://doi.org/10.1038/nature14539', title: 'Deep learning' })), '10.1038/nature14539');
  assert.equal(L.sharedQuery(p({ url: 'https://onlinelibrary.wiley.com/doi/10.1002/anie.201901234' })), '10.1002/anie.201901234');
  assert.equal(L.sharedQuery(p({ title: '分子模型の授業', text: 'https://example.com/a' })), '分子模型の授業');
  assert.equal(L.sharedQuery(p({ text: 'https://arxiv.org/abs/1706.03762' })), 'https://arxiv.org/abs/1706.03762');
  assert.equal(L.sharedQuery(p({})), '');
});

test('同期: 並び順や軽量化の違いだけでは変更とみなさない', () => {
  const a = ent('a', '2026-10-02T00:00:00Z'); a.meta.refIds = ['W1'];
  const b = ent('b', '2026-10-03T00:00:00Z');
  const local = { entries: [a, b], tombs: [], settings: {} };
  const remote = L.buildSyncPayload({ entries: [b, a], tombs: [], settings: {}, settingsUpdatedAt: '' }, NOW);
  const r = L.mergeSync(local, remote, NOW);
  assert.equal(r.push, false);
  assert.equal(r.pull, false);
});

test('はじめの設定: 進み具合は設定値とアプリ表示から決まる', () => {
  const none = L.setupSteps({}, {});
  assert.deepEqual(none.map((x) => x.key), ['email', 'name', 'sync', 'install', 'folder']);
  assert.ok(none.every((x) => !x.done));
  const some = L.setupSteps({ email: 'a@b.jp', gistToken: 't' }, { standalone: true });
  assert.deepEqual(some.filter((x) => x.done).map((x) => x.key), ['email', 'sync', 'install']);
  assert.ok(L.setupSteps({ installMarked: true }).find((x) => x.key === 'install').done);
});

test('はじめの設定: 全部済むか「あとで」を選ぶと出さない', () => {
  assert.equal(L.showSetupCard({}), true);
  assert.equal(L.showSetupCard({ setupHidden: true }), false);
  assert.equal(L.showSetupCard({ setupLater: true }), false);
  assert.equal(L.showSetupCard({ email: 'a@b.jp', name: 'x', gistToken: 't', installMarked: true, folder: 'https://x' }), false);
  assert.equal(L.showSetupCard({ email: 'a@b.jp' }), true);
});

test('GitHub の 403 を、原因ごとの直し方にする', () => {
  assert.match(L.ghErrorText({ status: 403, token: 'github_pat_x' }), /Account permissions の「Gists」を「Read and write」/);
  assert.match(L.ghErrorText({ status: 403, token: 'ghp_x', scopes: 'repo, read:user' }), /gist にチェックを入れて作り直し/);
  assert.match(L.ghErrorText({ status: 403, token: 'ghp_x', remaining: '0' }), /利用制限/);
  assert.match(L.ghErrorText({ status: 403, token: 'github_pat_x', message: 'API rate limit exceeded' }), /利用制限/, '利用制限はトークンの種類より先に判定する');
  assert.match(L.ghErrorText({ status: 429 }), /利用制限/);
  // 見出しが読めない（CORS で隠れる）ときは、本文の message を添えて案内する
  assert.match(L.ghErrorText({ status: 403, token: 'ghp_x', message: 'Forbidden' }), /Forbidden/);
  assert.match(L.ghErrorText({ status: 403, token: 'ghp_x', scopes: 'gist, repo' }), /gist の権限があるか/);
  assert.match(L.ghErrorText({ status: 401 }), /期限が切れて/);
  assert.equal(L.ghErrorText({ status: 500 }), '');
});
