const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../lib.js');

const en = { source: 'OpenAlex', doi: '10.1038/nature14539', title: 'Deep learning', title_ja: '深層学習', year: 2015, venue: 'Nature', volume: '521', issue: '7553', pages: '436-444', publisher: 'Springer',
  authors: [L.splitName('Yann LeCun'), L.splitName('山田 太郎')], abstract: 'Abs', oa: [{ url: 'https://x.example/landing', pdf: false }, { url: 'https://x.example/a.pdf', pdf: true }] };

test('書誌を Zotero の journalArticle にする', () => {
  const it = L.toZoteroItem(en, { tags: ['分数', 'bunken-hub'] });
  assert.equal(it.itemType, 'journalArticle');
  assert.equal(it.publicationTitle, 'Nature');
  assert.equal(it.DOI, '10.1038/nature14539');
  assert.equal(it.url, 'https://doi.org/10.1038/nature14539');
  assert.equal(it.date, '2015');
  assert.deepEqual(it.creators[0], { creatorType: 'author', lastName: 'LeCun', firstName: 'Yann' });
  assert.equal(it.creators[1].creatorType, 'author');
  assert.ok(it.creators[1].name.includes('山田'), '日本語の名前は1つの欄に入れる');
  assert.match(it.extra, /訳題: 深層学習/);
  assert.deepEqual(it.tags, [{ tag: 'bunken-hub' }, { tag: '分数' }]);
});

test('NDL の資料は book にする', () => {
  const it = L.toZoteroItem({ source: 'NDL', title: '本', authors: [], publisher: '出版社', venue: '叢書', landing: 'javascript:x' });
  assert.equal(it.itemType, 'book');
  assert.equal(it.publisher, '出版社');
  assert.equal(it.series, '叢書');
  assert.equal(it.url, '', '危ない URL は入れない');
  assert.equal('DOI' in it, false);
});

test('子 item：無料版の PDF へのリンクと、メモ（HTML はエスケープ）', () => {
  const ch = L.zoteroChildren(en, 'ABCD1234', 'a<b>\n次の行');
  assert.deepEqual(ch[0], { itemType: 'attachment', parentItem: 'ABCD1234', linkMode: 'linked_url', title: '無料版（PDF）', url: 'https://x.example/a.pdf', contentType: 'application/pdf' });
  assert.deepEqual(ch[1], { itemType: 'note', parentItem: 'ABCD1234', note: '<p>a&lt;b&gt;<br>次の行</p>' });
  assert.deepEqual(L.zoteroChildren({ oa: [] }, 'K', '  '), []);
});

test('書き込みの応答を、送った順の結果にする', () => {
  const r = L.parseZoteroWrite({ successful: { 0: { key: 'AAA' } }, unchanged: { 2: 'CCC' }, failed: { 1: { code: 400, message: 'bad' } } }, 3);
  assert.deepEqual(r, [{ key: 'AAA' }, { error: 'bad' }, { key: 'CCC' }]);
  assert.deepEqual(L.parseZoteroWrite({ success: { 0: 'OLD' } }, 1), [{ key: 'OLD' }]);
});

test('API キーの権限を確かめる', () => {
  assert.deepEqual(L.zoteroKeyInfo({ userID: 123, username: 'me', access: { user: { library: true, write: true } } }), { ok: true, userID: '123', username: 'me' });
  assert.equal(L.zoteroKeyInfo({ userID: 123, access: { user: { library: true } } }).ok, false);
  assert.equal(L.zoteroKeyInfo({}).ok, false);
  assert.equal(L.zoteroItemUrl('my name', 'K1'), 'https://www.zotero.org/my%20name/items/K1');
  assert.equal(L.zoteroItemUrl('', 'K1'), '');
});

test('Zotero の API キーは同期・バックアップに入れない', () => {
  const s = { email: 'a@b.jp', zoteroKey: 'secret', zoteroUser: { id: '1', name: 'me' } };
  const r = L.mergeSync({ entries: [], tombs: [], settings: { ...s, settingsUpdatedAt: '2026-10-05T00:00:00Z' } }, { app: 'bunken-hub', settings: {}, ledger: [], tombs: [] });
  const text = JSON.stringify([L.buildSyncPayload(r.next), L.buildBackup(s, [])]);
  assert.ok(!text.includes('secret'));
  assert.ok(!L.SYNC_KEYS.includes('zoteroKey'));
});
