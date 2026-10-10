// lib.js の単体テスト。実行: node --test tests/*.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../lib.js');

const en = { source: 't', doi: '10.1038/nature14539', title: 'Deep learning', authors: ['Yann LeCun', 'Yoshua Bengio', 'Geoffrey Hinton'].map(L.splitName), year: 2015, venue: 'Nature', volume: '521', issue: '7553', pages: '436-444', publisher: 'Springer', oa: [] };
const ja = { source: 't', doi: '', title: '分子模型を用いた化学教育の実践', authors: [L.splitName('山田 太郎'), L.splitName('佐藤花子')], year: 2020, venue: '化学と教育', volume: '68', issue: '3', pages: '100-103', oa: [] };

test('入力の解釈: DOI・URL・arXiv・タイトル', () => {
  assert.deepEqual(L.parseInput('https://doi.org/10.1038/NATURE14539.'), { kind: 'doi', doi: '10.1038/nature14539' });
  assert.deepEqual(L.parseInput('https://onlinelibrary.wiley.com/doi/full/10.1002/anie.201901234'), { kind: 'doi', doi: '10.1002/anie.201901234' });
  assert.deepEqual(L.parseInput('https://arxiv.org/abs/1706.03762v5'), { kind: 'doi', doi: '10.48550/arxiv.1706.03762' });
  assert.equal(L.parseInput('https://example.com/x').kind, 'url');
  assert.deepEqual(L.parseInput('分子模型 教育'), { kind: 'title', q: '分子模型 教育' });
  assert.equal(L.parseInput('   '), null);
});

test('名前の分割', () => {
  assert.deepEqual(L.splitName('Yann LeCun'), { family: 'LeCun', given: 'Yann' });
  assert.deepEqual(L.splitName('LeCun, Yann'), { family: 'LeCun', given: 'Yann' });
  assert.equal(L.nameStr(L.splitName('山田 太郎')), '山田 太郎');
  assert.equal(L.nameStr(L.splitName('佐藤花子')), '佐藤花子');
});

test('BibTeX', () => {
  const b = L.toBibTeX(en);
  assert.match(b, /^@article\{lecun2015deep,/);
  assert.match(b, /author = \{LeCun, Yann and Bengio, Yoshua and Hinton, Geoffrey\}/);
  assert.match(b, /pages = \{436--444\}/);
  assert.match(L.toBibTeX(ja), /author = \{\{山田 太郎\} and \{佐藤花子\}\}/);
});

test('参考文献表記は日本語と英語で切り替わる', () => {
  assert.equal(L.toCitation(en), 'LeCun, Y., Bengio, Y., & Hinton, G. (2015). Deep learning. Nature, 521(7553), 436-444. https://doi.org/10.1038/nature14539');
  assert.equal(L.toCitation(ja), '山田 太郎・佐藤花子 (2020)「分子模型を用いた化学教育の実践」『化学と教育』68(3), pp. 100-103');
});

test('保存用ファイル名', () => {
  assert.equal(L.fileName(en), '2015_LeCun_Deep-learning.pdf');
  assert.equal(L.fileName(ja), '2020_山田_分子模型を用いた化学教育の実践.pdf');
  assert.equal(L.fileName({ ...en, title: 'A/B: test?' }), '2015_LeCun_AB-test.pdf');
});

test('文章から DOI をすべて拾う', () => {
  const md = '- リンク: https://doi.org/10.1007/s10649-026-10563-9\n- (10.1016/j.learninstruc.2026.102480).\n- 重複 10.1007/S10649-026-10563-9';
  assert.deepEqual(L.extractDois(md), ['10.1007/s10649-026-10563-9', '10.1016/j.learninstruc.2026.102480']);
});

test('OpenAlex の abstract を復元', () => {
  assert.equal(L.reconstructAbstract({ Hello: [0], world: [1, 3], big: [2] }), 'Hello world big world');
  assert.equal(L.reconstructAbstract(null), '');
});

test('edu-research-watch の Paper を取り込む', () => {
  const m = L.fromWatchPaper({ title: 'Arithmetic development', journal: 'Learning and Instruction', published: '2026-09-29', doi: 'https://doi.org/10.1016/J.LEARNINSTRUC.2026.102480', authors: ['Susanne M. M. de Mooij', 'I. Molenaar'], title_ja: '算数の発達', score: 9 });
  assert.equal(m.doi, '10.1016/j.learninstruc.2026.102480');
  assert.equal(m.year, '2026');
  assert.equal(m.venue, 'Learning and Instruction');
  assert.equal(m.authors.length, 2);
});

test('NDL の著者表記から生没年や役割を落とす', () => {
  const m = L.fromNdlItem({ title: '分子模型の作り方', creators: ['山田, 太郎, 1950-', '佐藤花子 著'], date: '1985.4', link: 'https://dl.ndl.go.jp/pid/123' });
  assert.equal(m.year, '1985');
  assert.equal(m.digital, true);
  assert.equal(L.nameStr(m.authors[0]), '山田 太郎');
});

test('Obsidian ノートの frontmatter', () => {
  const n = L.toObsidian(en, { today: '2026-10-10', status: 'want' });
  assert.ok(n.startsWith('---\ntitle: "Deep learning"\ncreated: 2026-10-10\nupdated: 2026-10-10\n'));
  assert.match(n, /doi: "10.1038\/nature14539"/);
  assert.match(n, /status: want/);
  assert.match(n, /- PDF: 2015_LeCun_Deep-learning\.pdf/);
});

test('検索リンクに NDL デジタルコレクションとジャパンサーチを含む', () => {
  const names = L.searchLinks(ja).map(([n]) => n);
  assert.ok(names.includes('NDLデジタルコレクション'));
  assert.ok(names.includes('ジャパンサーチ'));
});
