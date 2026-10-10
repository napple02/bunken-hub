// 台帳（タグ・★・書き出し）の単体テスト。実行: node --test tests/*.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../lib.js');

const meta = (title, extra = {}) => ({ source: 't', doi: '', title, authors: [L.splitName('Yann LeCun')], year: 2015, venue: 'Nature', volume: '', issue: '', pages: '', oa: [], ...extra });
const ent = (id, o = {}) => ({ id, status: 'want', memo: '', addedAt: '2026-10-01', updatedAt: '2026-10-01T00:00:00Z', tags: [], meta: meta(id), ...o });

test('タグの正規化', () => {
  assert.equal(L.normTag('  #分数  教育 '), '分数 教育');
  assert.equal(L.normTag('＃授業'), '授業');
  assert.equal(L.normTag('a'.repeat(50)).length, 30);
  assert.equal(L.normTag('  # '), '');
});

test('タグの集計は多い順', () => {
  const t = L.allTags([ent('a', { tags: ['分数', '授業'] }), ent('b', { tags: ['授業'] }), ent('c')]);
  assert.deepEqual(t, [['授業', 2], ['分数', 1]]);
});

test('台帳の絞り込み: タグ・★・検索語にタグも含む', () => {
  const list = [ent('a', { tags: ['分数'], star: true }), ent('b', { tags: ['授業'] }), ent('c')];
  assert.deepEqual(L.filterLedger(list, { tag: '授業' }).map((e) => e.id), ['b']);
  assert.deepEqual(L.filterLedger(list, { star: true }).map((e) => e.id), ['a']);
  assert.deepEqual(L.filterLedger(list, { text: '分数' }).map((e) => e.id), ['a']);
  assert.deepEqual(L.filterLedger(list, { tag: '分数', status: 'read' }), []);
});

test('CSL JSON と Markdown リンク', () => {
  const m = meta('Deep learning', { doi: '10.1038/nature14539', authors: [L.splitName('Yann LeCun'), L.splitName('山田 太郎')], volume: '521', pages: '436-444' });
  const csl = JSON.parse(L.toCSL(m))[0];
  assert.equal(csl.type, 'article-journal');
  assert.deepEqual(csl.author, [{ family: 'LeCun', given: 'Yann' }, { literal: '山田 太郎' }]);
  assert.deepEqual(csl.issued, { 'date-parts': [[2015]] });
  assert.equal(csl.DOI, '10.1038/nature14539');
  assert.equal(L.toMarkdownLink(m), 'LeCun・山田 (2015) [Deep learning](https://doi.org/10.1038/nature14539)');
});

test('Obsidian ノートにタグと★が入る', () => {
  const n = L.toObsidian(meta('T'), { today: '2026-10-10', status: 'read', tags: ['分数', '授業'], star: true });
  assert.match(n, /tags: \["文献", "bunken-hub", "分数", "授業"\]/);
  assert.match(n, /\nstar: true\n/);
});

test('CRC32 は標準の検査値と一致する', () => {
  assert.equal(L.crc32(new TextEncoder().encode('123456789')), 0xCBF43926);
});

test('ZIP: 署名・件数・UTF-8 の名前と中身が正しい', () => {
  const z = L.makeZip([{ name: '文献/あ.md', data: 'こんにちは' }, { name: 'b.md', data: 'B' }]);
  const v = new DataView(z.buffer, z.byteOffset, z.byteLength);
  assert.equal(v.getUint32(0, true), 0x04034b50);
  const end = z.length - 22;
  assert.equal(v.getUint32(end, true), 0x06054b50);
  assert.equal(v.getUint16(end + 10, true), 2);              // エントリ数
  assert.equal(v.getUint16(6, true) & 0x0800, 0x0800);        // UTF-8 名のフラグ
  const nameLen = v.getUint16(26, true);
  assert.equal(new TextDecoder().decode(z.slice(30, 30 + nameLen)), '文献/あ.md');
  assert.ok(Buffer.from(z).includes(Buffer.from('こんにちは')));
});

test('Obsidian ノートの ZIP: 一覧つきで、同名は連番にする', () => {
  const list = [ent('a', { status: 'want', star: true, meta: meta('Same', { year: 2020 }) }), ent('b', { status: 'read', meta: meta('Same', { year: 2020 }) })];
  const z = Buffer.from(L.ledgerNotesZip(list, { today: '2026-10-10' }));
  const text = z.toString('utf8');
  assert.ok(text.includes('文献ハブ/00_文献一覧.md'));
  assert.ok(text.includes('文献ハブ/2020_LeCun_Same.md') && text.includes('文献ハブ/2020_LeCun_Same_2.md'));
  assert.ok(text.includes('- [[2020_LeCun_Same]] ★ — Same（Nature, 2020）'));
});
