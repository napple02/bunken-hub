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

test('RIS', () => {
  const r = L.toRIS(en);
  assert.match(r, /^TY  - JOUR\nTI  - Deep learning\nAU  - LeCun, Yann/);
  assert.match(r, /SP  - 436\nEP  - 444/);
  assert.ok(r.endsWith('ER  - '));
});

test('入手しやすさの判定', () => {
  assert.equal(L.availability({ ...en, oa: [{ url: 'https://x/a.pdf', pdf: true, version: 'acceptedVersion', host: 'HAL' }] }).level, 'free');
  assert.equal(L.availability({ ...ja, digital: true }).level, 'library');
  assert.equal(L.availability(ja).level, 'library');
  assert.equal(L.availability(en).level, 'paid');
});

test('依頼文は責任著者宛てにし、署名を入れる', () => {
  const t = L.requestMail({ ...en, corresponding: 2 }, { name: 'Taro Yamada' });
  assert.match(t, /Dear Dr\. Hinton,/);
  assert.match(t, /I am Taro Yamada,/);
  assert.match(L.requestMail(ja), /山田 太郎 先生/);
});

test('メールアドレスの形', () => {
  assert.ok(L.isEmail('a@b.jp'));
  assert.ok(!L.isEmail('a@b'));
  assert.ok(!L.isEmail(''));
});

test('ブックマークレットは文献ハブの URL を含む', () => {
  const b = L.bookmarklet('https://napple02.github.io/bunken-hub/');
  assert.ok(b.startsWith('javascript:'));
  assert.ok(b.includes("'https://napple02.github.io/bunken-hub/?q='"));
});

test('台帳の絞り込みと並べ替え', () => {
  const list = [
    { id: 'a', status: 'want', memo: '', addedAt: '2026-10-01', meta: en },
    { id: 'b', status: 'read', memo: '授業で使う', addedAt: '2026-10-05', meta: ja },
  ];
  assert.deepEqual(L.filterLedger(list).map((e) => e.id), ['b', 'a']);
  assert.deepEqual(L.filterLedger(list, { status: 'want' }).map((e) => e.id), ['a']);
  assert.deepEqual(L.filterLedger(list, { text: '授業' }).map((e) => e.id), ['b']);
  assert.deepEqual(L.filterLedger(list, { text: 'hinton' }).map((e) => e.id), ['a']);
  assert.deepEqual(L.filterLedger(list, { sort: 'year' }).map((e) => e.id), ['b', 'a']);
});

test('OpenAlex の work から撤回・責任著者・参照文献を読む', () => {
  const m = L.fromOpenAlex({ id: 'https://openalex.org/W1', title: 'T', is_retracted: true,
    authorships: [{ author: { display_name: 'A B' } }, { author: { display_name: 'C D', orcid: 'https://orcid.org/0000' }, is_corresponding: true }],
    referenced_works: ['https://openalex.org/W2'], related_works: [], locations: [] });
  assert.equal(m.oaid, 'W1');
  assert.equal(m.retracted, true);
  assert.equal(m.corresponding, 1);
  assert.deepEqual(m.refIds, ['W2']);
  assert.equal(m.orcids[1], 'https://orcid.org/0000');
});

test('Europe PMC: 無料の全文リンクと abstract を取り出す', () => {
  const r = L.fromEuropePmc({ pmcid: 'PMC123', isOpenAccess: 'Y', abstractText: '<h4>Background</h4> Text   here.',
    fullTextUrlList: { fullTextUrl: [{ availability: 'Subscription required', documentStyle: 'html', url: 'https://x/paid' }, { availability: 'Open access', documentStyle: 'pdf', url: 'https://europepmc.org/a.pdf' }] } });
  assert.deepEqual(r.oa.map((l) => [l.url, l.pdf]), [['https://europepmc.org/a.pdf', true]]);
  assert.equal(r.abstract, 'Background Text here.');
  const fb = L.fromEuropePmc({ pmcid: 'PMC999', isOpenAccess: 'Y' });
  assert.equal(fb.oa[0].url, 'https://europepmc.org/article/PMC/999');
  assert.deepEqual(L.fromEuropePmc(undefined).oa, []);
});

test('Semantic Scholar: openAccessPdf と TLDR を取り出す', () => {
  const r = L.fromSemanticScholar({ openAccessPdf: { url: 'https://s2/a.pdf' }, tldr: { text: 'One line.' }, abstract: 'A' });
  assert.equal(r.oa[0].url, 'https://s2/a.pdf');
  assert.equal(r.tldr, 'One line.');
  assert.deepEqual(L.fromSemanticScholar({}).oa, []);
});

test('無料版の並べ替え: 重複を除き、PDF と出版社版を先に', () => {
  const m = L.mergeOa(
    [{ url: 'https://a', pdf: false, version: 'publishedVersion' }, { url: 'https://b', pdf: true, version: 'submittedVersion' }],
    [{ url: 'https://c', pdf: true, version: 'publishedVersion' }, { url: 'https://a', pdf: false }, null],
  );
  assert.deepEqual(m.map((l) => l.url), ['https://c', 'https://b', 'https://a']);
});

test('候補の絞り込みと並べ替え', () => {
  const a = { title: 'A study', venue: 'Nature', year: 2020, cited: 5, isOa: true, oa: [] };
  const b = { title: '分子模型の授業', venue: '化学と教育', year: 2022, cited: 1, isOa: false, oa: [] };
  const c = { title: 'Ndl book', venue: '', year: 2010, cited: 99, isOa: false, oa: [], digital: true };
  assert.deepEqual(L.filterCands([a, b, c]).length, 3);
  assert.deepEqual(L.filterCands([a, b, c], { oaOnly: true }), [a, c]);
  assert.deepEqual(L.filterCands([a, b, c], { jaOnly: true }), [b]);
  assert.deepEqual(L.filterCands([a, b, c], { sort: 'year' }), [b, a, c]);
  assert.deepEqual(L.filterCands([a, b, c], { sort: 'cited' }), [c, a, b]);
  assert.deepEqual([a, b, c].map((x) => x.title), ['A study', '分子模型の授業', 'Ndl book']);   // 元の配列は並べ替えない
});

test('ウォッチの「文献ハブ」リンクの DOI はデコードして拾う', () => {
  const md = '- 入手: [文献ハブで入手ルートを見る](https://napple02.github.io/bunken-hub/?q=10.1016/s0140-6736%2820%2930183-5)';
  assert.deepEqual(L.extractDois(md), ['10.1016/s0140-6736(20)30183-5']);
  assert.deepEqual(L.extractDois('10.1000/bad%zz'), ['10.1000/bad%zz']);
});

test('ウォッチの無料版・撤回・研究デザインを引き継ぐ', () => {
  const p = { title: 'T', journal: 'J', doi: '10.1/x', oa_status: 'green', oa_url: 'https://repo.example/x.pdf', is_retracted: true, design: ['rct', 'unknown', 'meta_review'] };
  const m = L.fromWatchPaper(p);
  assert.equal(m.isOa, true);
  assert.deepEqual(m.oa, [{ url: 'https://repo.example/x.pdf', pdf: true, version: '', host: '', license: '' }]);
  assert.equal(m.retracted, true);
  assert.equal(L.availability(m).label, '無料で PDF を読めます');
  assert.deepEqual(L.watchTags(p), ['ウォッチ', 'RCT', 'メタ分析']);
  // closed・未知の URL スキーム・旧い出力（oa_status なし）は無料版として扱わない
  assert.equal(L.fromWatchPaper({ ...p, oa_status: 'closed' }).isOa, false);
  assert.deepEqual(L.fromWatchPaper({ ...p, oa_url: 'javascript:alert(1)' }).oa, []);
  const old = L.fromWatchPaper({ title: 'T', journal: 'J' });
  assert.equal(old.isOa, false);
  assert.equal(old.retracted, false);
  assert.deepEqual(L.watchTags({}), ['ウォッチ']);
});

test('ウォッチの規則で研究デザインとサンプル数を判定する', () => {
  assert.ok(Object.keys(L.WATCH_RULES.glossary).length > 0, 'WATCH_RULES が取り込まれている');
  const rct = L.studyFacts({ title: 'A cluster randomized trial of tutoring', abstract: 'We recruited 1,250 students. N = 980.' });
  assert.deepEqual(rct.design, ['rct']);
  assert.equal(rct.n, 1250);
  // レビュー論文は、本文が言及する RCT を自分の型にしない（ウォッチの design_for と同じ）
  assert.deepEqual(L.studyFacts({ title: 'Tutoring: A systematic review', abstract: 'Included randomized controlled trials enrolled 4,835 participants.' }).design, ['meta_review']);
  assert.deepEqual(L.studyFacts({ title: 'Exercise in adolescents: A Review', abstract: 'Several randomized controlled trials.' }).design, []);
  assert.deepEqual(L.studyFacts({ title: 'Effects of tutoring', type: 'review', abstract: 'A randomized trial.' }).design, []);
  assert.deepEqual(L.studyFacts({ title: '分数の授業実践' }), { design: [], labels: [], n: null });
});

test('用語辞書：長い語を優先し、語の途中には一致しない', () => {
  const hits = L.glossaryHits('Physical education and mathematics education; refraction is not a fraction. Fractions!');
  assert.deepEqual(hits.map(([en]) => en), ['mathematics education', 'physical education', 'fractions']);
  assert.deepEqual(L.glossaryHits(''), []);
});

test('Obsidian ノートに訳題・研究の型・サンプル数を入れる', () => {
  const note = L.toObsidian({ title: 'A randomized controlled trial', title_ja: '無作為化比較試験', abstract: 'N = 1,200 pupils.', authors: [], year: '2026', venue: 'J' }, { today: '2026-10-10' });
  assert.match(note, /^title_ja: "無作為化比較試験"$/m);
  assert.match(note, /^design: \["RCT"\]$/m);
  assert.match(note, /^sample_size: 1200$/m);
});

test('sync-watch-rules.mjs で取り込んだ区間の形が保たれている', () => {
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'lib.js'), 'utf8');
  assert.match(src, /\/\/ <watch-rules>[^\n]*\nconst WATCH_RULES = \{.*\};\n\/\/ <\/watch-rules>/);
  assert.equal(L.WATCH_RULES.schema_version, 1);
});
