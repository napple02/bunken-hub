// 文献ハブ：DOM に依存しない処理（書誌の正規化・整形・入力解釈）。ブラウザと node のテストで共用する。
'use strict';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const safeUrl = (u) => (/^https?:\/\//i.test(u || '') ? u : '');
const first = (v) => (Array.isArray(v) ? v[0] : v);
const hasJa = (s) => /[぀-ヿ㐀-鿿]/.test(s || '');
// ---------- 入力の解釈 ----------
function parseInput(raw) {
  let s = (raw || '').trim();
  try { s = decodeURIComponent(s); } catch {}
  const ax = s.match(/arxiv\.org\/(?:abs|pdf)\/(\d{4}\.\d{4,5})(v\d+)?/i) || s.match(/^arxiv:\s*(\d{4}\.\d{4,5})/i);
  if (ax) return { kind: 'doi', doi: '10.48550/arxiv.' + ax[1] };
  const m = s.match(/10\.\d{4,9}\/[^\s"<>]+/);
  if (m) return { kind: 'doi', doi: m[0].replace(/[.,;:)\]]+$/, '').replace(/\/(full|abstract|pdf|epdf)$/i, '').toLowerCase() };
  if (/^https?:\/\//i.test(s)) return { kind: 'url', url: s };
  return s ? { kind: 'title', q: s } : null;
}

// ---------- 名前の扱い ----------
function splitName(n) {
  n = (n || '').trim();
  if (!n) return { family: '', given: '' };
  if (hasJa(n) && !/\s/.test(n)) return { family: n, given: '', cjk: true };
  if (n.includes(',')) { const [f, g] = n.split(','); const r = { family: f.trim(), given: (g || '').trim() }; if (hasJa(n)) r.cjk = true; return r; }
  const p = n.split(/\s+/);
  if (hasJa(n)) return { family: p[0], given: p.slice(1).join(' '), cjk: true };
  return { family: p.pop(), given: p.join(' ') };
}
const nameStr = (a) => (a.cjk ? a.family + (a.given ? ' ' + a.given : '') : [a.given, a.family].filter(Boolean).join(' '));

// ---------- 各サービスからの書誌の正規化 ----------
function fromOpenAlex(w) {
  const pl = w.primary_location || {};
  const b = w.biblio || {};
  const locs = (w.locations || []).filter((l) => l.is_oa).map((l) => ({
    url: l.pdf_url || l.landing_page_url, pdf: !!l.pdf_url, version: l.version, host: l.source?.display_name || '', license: l.license || '',
  }));
  return {
    source: 'OpenAlex',
    doi: (w.doi || '').replace(/^https?:\/\/doi\.org\//i, '').toLowerCase(),
    title: w.title || w.display_name || '',
    authors: (w.authorships || []).map((a) => splitName(a.author?.display_name || a.raw_author_name)),
    year: w.publication_year || '',
    venue: pl.source?.display_name || '',
    volume: b.volume || '', issue: b.issue || '',
    pages: b.first_page ? b.first_page + (b.last_page && b.last_page !== b.first_page ? '-' + b.last_page : '') : '',
    publisher: pl.source?.host_organization_name || '',
    landing: pl.landing_page_url || '',
    isOa: !!w.open_access?.is_oa,
    oa: locs,
    cited: w.cited_by_count,
    abstract: reconstructAbstract(w.abstract_inverted_index),
  };
}
function fromCSL(m, src) {
  const dp = (m.issued || m.published || m['published-print'] || m['published-online'] || {})['date-parts'];
  return {
    source: src,
    doi: (m.DOI || '').toLowerCase(),
    title: first(m.title) || '',
    authors: (m.author || []).map((a) => (a.family ? { family: a.family, given: a.given || '', cjk: hasJa(a.family) } : splitName(a.name || a.literal))),
    year: dp && dp[0] ? dp[0][0] || '' : '',
    venue: first(m['container-title']) || '',
    volume: m.volume || '', issue: m.issue || '', pages: m.page || '',
    publisher: m.publisher || '',
    landing: m.URL || (m.resource?.primary?.URL) || '',
    isOa: false, oa: [],
  };
}
function fromCiNii(it) {
  const creators = [].concat(it['dc:creator'] || []).map((c) => (typeof c === 'string' ? c : c['@value'] || c.name || '')).filter(Boolean);
  const ids = [].concat(it['dc:identifier'] || []);
  const doiId = ids.find((i) => (i['@type'] || '').toUpperCase() === 'DOI');
  const date = it['prism:publicationDate'] || it['dc:date'] || '';
  return {
    source: 'CiNii',
    doi: (it['prism:doi'] || doiId?.['@value'] || '').toLowerCase(),
    title: it.title || '',
    authors: creators.map(splitName),
    year: String(date).slice(0, 4),
    venue: it['prism:publicationName'] || '',
    volume: it['prism:volume'] || '', issue: it['prism:number'] || '',
    pages: it['prism:startingPage'] ? it['prism:startingPage'] + (it['prism:endingPage'] ? '-' + it['prism:endingPage'] : '') : '',
    publisher: it['dc:publisher'] || '',
    landing: it.link?.['@id'] || it['@id'] || '',
    isOa: false, oa: [],
  };
}

// ---------- 出力の生成 ----------
function bibKey(m) {
  const f = (m.authors[0]?.family || '').normalize('NFKD').replace(/[^A-Za-z]/g, '');
  const w = (m.title || '').normalize('NFKD').split(/\s+/).map((x) => x.replace(/[^A-Za-z]/g, '')).find((x) => x.length > 3) || '';
  return ((f || 'anon') + (m.year || '') + w).toLowerCase() || 'ref';
}
function toBibTeX(m) {
  const au = m.authors.map((a) => (a.cjk ? `{${nameStr(a)}}` : (a.given ? `${a.family}, ${a.given}` : a.family))).join(' and ');
  const f = [['title', `{${m.title}}`], ['author', au], ['journal', m.venue], ['year', m.year], ['volume', m.volume], ['number', m.issue], ['pages', String(m.pages || '').replace('-', '--')], ['publisher', m.publisher], ['doi', m.doi]]
    .filter(([, v]) => v).map(([k, v]) => `  ${k} = {${v}}`).join(',\n');
  return `@article{${bibKey(m)},\n${f}\n}`;
}
function toCitation(m) {
  const vol = m.volume ? m.volume + (m.issue ? `(${m.issue})` : '') : '';
  if (hasJa(m.title) || hasJa(m.venue)) {
    const au = m.authors.map(nameStr).join('・') || '著者不明';
    return `${au} (${m.year || '刊行年不明'})「${m.title}」『${m.venue}』${vol}${m.pages ? ', pp. ' + m.pages : ''}${m.doi ? '. https://doi.org/' + m.doi : ''}`;
  }
  const au = m.authors.map((a) => (a.cjk ? nameStr(a) : `${a.family}${a.given ? ', ' + a.given.split(/[\s-]+/).map((g) => g[0] + '.').join(' ') : ''}`));
  const auS = au.length > 2 ? au.slice(0, -1).join(', ') + ', & ' + au.at(-1) : au.join(' & ');
  return `${auS || 'Anon.'} (${m.year || 'n.d.'}). ${m.title}. ${m.venue}${vol ? ', ' + vol : ''}${m.pages ? ', ' + m.pages : ''}.${m.doi ? ' https://doi.org/' + m.doi : ''}`;
}
function fileName(m) {
  const clean = (s) => String(s || '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-');
  const t = clean(m.title).slice(0, hasJa(m.title) ? 24 : 48).replace(/-$/, '');
  return [m.year || 'nd', clean(m.authors[0]?.family) || 'anon', t].filter(Boolean).join('_') + '.pdf';
}
function requestMail(m) {
  if (hasJa(m.title)) {
    return `件名: 論文別刷り（PDF）送付のお願い\n\n${m.authors[0] ? nameStr(m.authors[0]) + ' 先生' : 'ご担当者様'}\n\n突然のご連絡失礼いたします。（氏名・立場）と申します。\n下記のご論文を拝読したいのですが、所属機関がなく本文を入手できずにおります。\n差し支えなければ、PDF をお送りいただけないでしょうか。\n\n${toCitation(m)}\n\n（読みたい理由を一、二文）\n\nどうぞよろしくお願いいたします。`;
  }
  return `Subject: Request for a copy of your paper\n\nDear Dr. ${m.authors[0]?.family || ''},\n\nI am (name), an independent reader interested in (topic). I do not have institutional access and would be grateful if you could share a PDF of your paper:\n\n${toCitation(m)}\n\n(One or two sentences on why you want to read it.)\n\nThank you very much for your time.\n\nBest regards,\n(name)`;
}
function searchLinks(m) {
  const t = m.title || '';
  const q = encodeURIComponent(t);
  const d = m.doi;
  const L = [
    ['Google Scholar', `https://scholar.google.com/scholar?q=${d ? encodeURIComponent('"' + d + '"') + '+OR+' : ''}${encodeURIComponent('"' + t + '"')}`],
    ['CiNii Research', `https://cir.nii.ac.jp/all?q=${q}`],
    ['J-STAGE', `https://www.jstage.jst.go.jp/result/global/-char/ja?globalSearchKey=${q}`],
    ['IRDB（機関リポジトリ）', `https://irdb.nii.ac.jp/search?kywd=${q}`],
    ['NDLサーチ', `https://ndlsearch.ndl.go.jp/search?cs=bib&keyword=${q}`],
    ['CORE', `https://core.ac.uk/search?q=${encodeURIComponent('"' + t + '"')}`],
    ['Semantic Scholar', `https://www.semanticscholar.org/search?q=${q}`],
    ['PubMed', `https://pubmed.ncbi.nlm.nih.gov/?term=${q}`],
    ['BASE', `https://www.base-search.net/Search/Results?lookfor=${q}`],
    ['NDLデジタルコレクション', `https://dl.ndl.go.jp/search/searchResult?keyword=${q}`],
    ['ジャパンサーチ', `https://jpsearch.go.jp/csearch/jps-cross?keyword=${q}`],
  ];
  return L;
}
const verJa = { publishedVersion: '出版社版', acceptedVersion: '著者最終稿', submittedVersion: 'プレプリント' };

// OpenAlex の abstract_inverted_index（語→出現位置）を本文に戻す
function reconstructAbstract(inv) {
  if (!inv || typeof inv !== 'object') return '';
  const words = [];
  for (const [w, pos] of Object.entries(inv)) for (const p of pos) words[p] = w;
  return words.filter((w) => w !== undefined).join(' ').replace(/\s+/g, ' ').trim();
}

// 貼り付けた文章（週報の Markdown など）から DOI をすべて拾う
function extractDois(text) {
  const out = [];
  for (const m of String(text || '').matchAll(/10\.\d{4,9}\/[^\s"<>)\]]+/g)) {
    const d = m[0].replace(/[.,;:]+$/, '').toLowerCase();
    if (!out.includes(d)) out.push(d);
  }
  return out;
}

// edu-research-watch の Paper（papers.json / rising_papers.json などの要素）を取り込む
function fromWatchPaper(p) {
  return {
    source: 'edu-research-watch',
    doi: String(p.doi || '').replace(/^https?:\/\/doi\.org\//i, '').toLowerCase(),
    title: p.title || '',
    title_ja: p.title_ja || '',
    authors: (p.authors || []).map(splitName),
    year: String(p.published || '').slice(0, 4),
    venue: p.journal || '',
    volume: '', issue: '', pages: '', publisher: '',
    landing: p.url || '',
    abstract: p.abstract || '',
    cited: p.cited_by_count,
    isOa: false, oa: [],
  };
}

// NDLサーチ OpenSearch（RSS）の1件。XML の読み取りは app.js 側で行い、ここでは値だけ受け取る
function fromNdlItem(o) {
  return {
    source: 'NDL',
    doi: '',
    title: o.title || '',
    authors: (o.creators || []).map((c) => splitName(String(c).replace(/\s*[\[(（].*$/, '').replace(/[,，]\s*\d{4}-?\d*$/, '').replace(/／?著$/, ''))),
    year: (String(o.date || '').match(/\d{4}/) || [''])[0],
    venue: o.series || '',
    volume: '', issue: '', pages: '',
    publisher: o.publisher || '',
    landing: o.link || '',
    digital: /dl\.ndl\.go\.jp/.test(o.link || '') || !!o.digital,
    isOa: false, oa: [],
  };
}

// Obsidian 用のノート。edu-research-watch の vault 出力と同じ frontmatter の並びに揃える
function toObsidian(m, opts = {}) {
  const today = opts.today || new Date().toISOString().slice(0, 10);
  const q = (v) => '"' + String(v ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
  const fm = [
    '---',
    `title: ${q(m.title)}`,
    `created: ${today}`,
    `updated: ${today}`,
    'tags: ["文献", "bunken-hub"]',
    'source: bunken-hub',
    m.doi ? `doi: ${q(m.doi)}` : null,
    m.year ? `year: ${m.year}` : null,
    m.venue ? `journal: ${q(m.venue)}` : null,
    `authors: [${m.authors.map((a) => q(nameStr(a))).join(', ')}]`,
    opts.status ? `status: ${opts.status}` : null,
    '---',
  ].filter((x) => x !== null);
  const body = [
    `# ${m.title}`,
    '',
    m.title_ja ? `訳題: ${m.title_ja}\n` : null,
    `- 著者: ${m.authors.map(nameStr).join(', ') || '不明'}`,
    `- 掲載: ${[m.venue, m.volume && m.volume + (m.issue ? '(' + m.issue + ')' : ''), m.pages, m.year].filter(Boolean).join(', ')}`,
    m.doi ? `- DOI: https://doi.org/${m.doi}` : (m.landing ? `- URL: ${m.landing}` : null),
    `- PDF: ${fileName(m)}`,
    '',
    '## 引用',
    '',
    toCitation(m),
    '',
    m.abstract ? `## Abstract\n\n${m.abstract}\n` : null,
    '## メモ',
    '',
    opts.memo || '',
    '',
  ].filter((x) => x !== null);
  return fm.join('\n') + '\n' + body.join('\n');
}

if (typeof module !== 'undefined') {
  module.exports = { esc, safeUrl, hasJa, parseInput, splitName, nameStr, fromOpenAlex, fromCSL, fromCiNii, fromWatchPaper, fromNdlItem,
    reconstructAbstract, extractDois, bibKey, toBibTeX, toCitation, fileName, requestMail, searchLinks, toObsidian, verJa };
}
