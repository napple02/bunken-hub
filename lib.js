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
    oaid: String(w.id || '').replace(/^https?:\/\/openalex\.org\//i, ''),
    retracted: !!w.is_retracted,
    corresponding: (w.authorships || []).findIndex((a) => a.is_corresponding),
    orcids: (w.authorships || []).map((a) => a.author?.orcid || ''),
    refIds: (w.referenced_works || []).map((u) => String(u).split('/').pop()),
    relIds: (w.related_works || []).map((u) => String(u).split('/').pop()),
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
// 著者への別刷り依頼の文面。責任著者がわかればその人宛てにする
function requestMail(m, opts = {}) {
  const to = m.authors[m.corresponding >= 0 ? m.corresponding : 0];
  const me = opts.name || '';
  if (hasJa(m.title)) {
    return `件名: 論文別刷り（PDF）送付のお願い\n\n${to ? nameStr(to) + ' 先生' : 'ご担当者様'}\n\n突然のご連絡失礼いたします。${me || '（氏名）'}と申します。\n下記のご論文を拝読したいのですが、所属機関がなく本文を入手できずにおります。\n差し支えなければ、PDF をお送りいただけないでしょうか。\n\n${toCitation(m)}\n\n（読みたい理由を一、二文）\n\nどうぞよろしくお願いいたします。\n\n${me || '（氏名）'}`;
  }
  return `Subject: Request for a copy of your paper\n\nDear Dr. ${to?.family || ''},\n\nI am ${me || '(name)'}, an independent reader interested in (topic). I do not have institutional access and would be grateful if you could share a PDF of your paper:\n\n${toCitation(m)}\n\n(One or two sentences on why you want to read it.)\n\nThank you very much for your time.\n\nBest regards,\n${me || '(name)'}`;
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
    // ウォッチの「文献ハブで入手ルートを見る」リンク（?q=10.1016/s0140-6736%2820%29…）は括弧がエンコードされている
    let d = m[0];
    try { d = decodeURIComponent(d); } catch { /* % が壊れていればそのまま */ }
    d = d.replace(/[.,;:]+$/, '').toLowerCase();
    if (!out.includes(d)) out.push(d);
  }
  return out;
}

// edu-research-watch の Paper（papers.json / rising_papers.json / weekly_buffer.json などの要素）を取り込む。
// oa_status・oa_url（OpenAlex の open_access）と is_retracted は、ウォッチが 2026-10 から書き出す
function fromWatchPaper(p) {
  const oaUrl = safeUrl(p.oa_url || '');
  const free = !!p.oa_status && p.oa_status !== 'closed';
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
    isOa: free,
    oa: free && oaUrl ? [{ url: oaUrl, pdf: /\.pdf([?#]|$)/i.test(oaUrl), version: '', host: '', license: '' }] : [],
    retracted: !!p.is_retracted,
  };
}

// ウォッチの判定（研究デザイン）を、台帳のタグにする。取り込んだ文献を絞り込めるように
const WATCH_DESIGN_TAGS = { rct: 'RCT', meta_review: 'メタ分析', quasi_natural: '準実験', longitudinal: '縦断研究' };
function watchTags(p) {
  return ['ウォッチ', ...(p.design || []).map((d) => WATCH_DESIGN_TAGS[d]).filter(Boolean)];
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
    `tags: [${['文献', 'bunken-hub', ...(opts.tags || [])].map(q).join(', ')}]`,
    'source: bunken-hub',
    m.doi ? `doi: ${q(m.doi)}` : null,
    m.year ? `year: ${m.year}` : null,
    m.venue ? `journal: ${q(m.venue)}` : null,
    `authors: [${m.authors.map((a) => q(nameStr(a))).join(', ')}]`,
    opts.status ? `status: ${opts.status}` : null,
    opts.star ? 'star: true' : null,
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

// RIS（Mendeley・EndNote・Zotero などへ取り込める形式）
function toRIS(m) {
  const L = [['TY', 'JOUR'], ['TI', m.title]];
  for (const a of m.authors) L.push(['AU', a.cjk || !a.given ? nameStr(a) : `${a.family}, ${a.given}`]);
  const [sp, ep] = String(m.pages || '').split('-');
  L.push(['PY', m.year], ['JO', m.venue], ['VL', m.volume], ['IS', m.issue], ['SP', sp], ['EP', ep], ['PB', m.publisher], ['DO', m.doi], ['UR', m.doi ? 'https://doi.org/' + m.doi : m.landing], ['AB', m.abstract]);
  return L.filter(([, v]) => v).map(([k, v]) => `${k}  - ${v}`).join('\n') + '\nER  - ';
}

// 本文がどの程度手に入りやすいかを一言で判定する（画面上部の帯に使う）
function availability(m) {
  const pdf = (m.oa || []).find((l) => l.pdf);
  if (pdf) return { level: 'free', label: '無料で PDF を読めます', detail: [verJa[pdf.version], pdf.host].filter(Boolean).join(' / ') };
  if ((m.oa || []).length || m.isOa) return { level: 'free', label: '無料で読める版があります', detail: 'リンク先で本文を確認してください' };
  if (m.digital) return { level: 'library', label: '国立国会図書館のデジタル化資料です', detail: '個人向け送信サービスやデジタルコレクションで読める可能性があります' };
  if (hasJa(m.title) || hasJa(m.venue)) return { level: 'library', label: '無料版は見つかっていません', detail: 'J-STAGE・機関リポジトリ・NDL を横断検索で確認してください' };
  return { level: 'paid', label: '無料版は見つかっていません', detail: '横断検索で別の版を探すか、著者に PDF を頼むのが早道です' };
}

// 連絡先を探すための著者リンク（researchmap は日本の研究者向け）
function authorLinks(a, orcid) {
  const n = nameStr(a);
  const L = [];
  if (orcid) L.push(['ORCID', orcid]);
  L.push(['researchmap', `https://researchmap.jp/researchers?q=${encodeURIComponent(n)}`]);
  L.push(['Google で連絡先を探す', `https://www.google.com/search?q=${encodeURIComponent('"' + n + '" email OR メール')}`]);
  return L;
}

// 引用関係を図で見られる外部サービス
function graphLinks(m) {
  if (!m.doi) return [];
  return [
    ['Connected Papers', `https://www.connectedpapers.com/api/redirect/doi/${m.doi}`],
    ['Semantic Scholar', `https://www.semanticscholar.org/search?q=${encodeURIComponent(m.doi)}`],
    ['OpenAlex', m.oaid ? `https://openalex.org/works/${m.oaid}` : `https://openalex.org/works?filter=doi:${encodeURIComponent(m.doi)}`],
  ];
}

const translateUrl = (text) => `https://translate.google.com/?sl=auto&tl=ja&op=translate&text=${encodeURIComponent(String(text || '').slice(0, 4500))}`;
const isEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || '').trim());

// 論文ページで押すと、ページ内の DOI（なければ URL）を持って文献ハブを開くブックマークレット
function bookmarklet(base) {
  const sel = 'meta[name="citation_doi"],meta[name="dc.identifier"],meta[name="DC.identifier"],meta[name="prism.doi"],meta[property="citation_doi"]';
  return `javascript:(()=>{const m=document.querySelector('${sel}');const t=document.querySelector('meta[name="citation_title"]');const q=(m&&/10\\.\\d{4,9}\\//.test(m.content)?m.content:'')||(document.body.innerText.match(/10\\.\\d{4,9}\\/[^\\s"<>]+/)||[])[0]||(t&&t.content)||location.href;window.open('${base}?q='+encodeURIComponent(q));})()`;
}

// タグの正規化（先頭の # と余分な空白を除く。長すぎるものは切る）
const normTag = (t) => String(t || '').replace(/^[#＃\s]+/, '').replace(/\s+/g, ' ').trim().slice(0, 30);
// 台帳にあるタグと件数（多い順）
function allTags(list) {
  const n = new Map();
  for (const e of list) for (const t of e.tags || []) n.set(t, (n.get(t) || 0) + 1);
  return [...n].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ja'));
}
// 台帳の絞り込みと並べ替え。tag: 指定のタグがあるもの、star: ★付きのみ
function filterLedger(list, { status = 'all', text = '', sort = 'added', tag = '', star = false } = {}) {
  const t = text.trim().toLowerCase();
  const out = list.filter((e) => (status === 'all' || e.status === status) && (!tag || (e.tags || []).includes(tag)) && (!star || e.star) &&
    (!t || [e.meta.title, e.meta.title_ja, e.meta.venue, e.memo, e.meta.doi, ...(e.tags || []), ...(e.meta.authors || []).map(nameStr)].join(' ').toLowerCase().includes(t)));
  const by = {
    added: (a, b) => String(b.addedAt).localeCompare(String(a.addedAt)),
    year: (a, b) => (Number(b.meta.year) || 0) - (Number(a.meta.year) || 0),
    title: (a, b) => String(a.meta.title).localeCompare(String(b.meta.title), 'ja'),
  }[sort];
  return by ? out.sort(by) : out;
}

// 引用の別形式
function toCSL(m) {
  const o = { type: 'article-journal', title: m.title };
  const au = m.authors.map((a) => (a.cjk || !a.given ? { literal: nameStr(a) } : { family: a.family, given: a.given }));
  if (au.length) o.author = au;
  if (m.year) o.issued = { 'date-parts': [[Number(m.year)]] };
  Object.assign(o, Object.fromEntries([['container-title', m.venue], ['volume', m.volume], ['issue', m.issue], ['page', m.pages], ['publisher', m.publisher], ['DOI', m.doi], ['URL', m.doi ? 'https://doi.org/' + m.doi : m.landing]].filter(([, v]) => v)));
  return JSON.stringify([o], null, 2);
}
function toMarkdownLink(m) {
  const au = m.authors.slice(0, 2).map((a) => a.family || nameStr(a)).join('・') + (m.authors.length > 2 ? ' ほか' : '');
  const url = m.doi ? 'https://doi.org/' + m.doi : m.landing;
  return `${au ? au + ' ' : ''}${m.year ? '(' + m.year + ') ' : ''}${url ? `[${m.title}](${url})` : m.title}`;
}

// ---------- ZIP（無圧縮）の書き出し。Obsidian ノートをまとめて渡すために使う ----------
const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(bytes) { let c = 0xFFFFFFFF; for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
// files: [{ name, data: string | Uint8Array }]。名前は UTF-8（フラグ付き）で入れる
function makeZip(files, date = new Date()) {
  const enc = new TextEncoder();
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  const dosDate = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  const parts = []; const central = []; let offset = 0;
  const u16 = (v) => [v & 255, (v >>> 8) & 255]; const u32 = (v) => [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255];
  for (const f of files) {
    const name = enc.encode(f.name); const data = typeof f.data === 'string' ? enc.encode(f.data) : f.data; const crc = crc32(data);
    const head = Uint8Array.from([0x50, 0x4b, 3, 4, ...u16(20), ...u16(0x0800), ...u16(0), ...u16(dosTime), ...u16(dosDate), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(name.length), ...u16(0)]);
    parts.push(head, name, data);
    central.push(Uint8Array.from([0x50, 0x4b, 1, 2, ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(dosTime), ...u16(dosDate), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset)]), name);
    offset += head.length + name.length + data.length;
  }
  const cdSize = central.reduce((n, p) => n + p.length, 0);
  const end = Uint8Array.from([0x50, 0x4b, 5, 6, ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length), ...u32(cdSize), ...u32(offset), ...u16(0)]);
  const all = [...parts, ...central, end]; const out = new Uint8Array(all.reduce((n, p) => n + p.length, 0));
  let pos = 0; for (const p of all) { out.set(p, pos); pos += p.length; }
  return out;
}
// 台帳の全件を Obsidian ノートにして、一覧（00_文献一覧.md）と一緒に ZIP にする
function ledgerNotesZip(entries, { folder = '文献ハブ', today } = {}) {
  const used = new Set(); const files = []; const rows = [];
  const stJa = { want: '未入手', have: '入手済', read: '読了' };
  for (const e of entries) {
    const base = fileName(e.meta).replace(/\.pdf$/, '').replace(/[#^[\]|]/g, '');
    let name = base; for (let i = 2; used.has(name); i++) name = `${base}_${i}`;
    used.add(name);
    files.push({ name: `${folder}/${name}.md`, data: toObsidian(e.meta, { today, status: e.status, memo: e.memo, tags: e.tags, star: e.star }) });
    rows.push({ name, e });
  }
  const sec = (st) => rows.filter((r) => r.e.status === st).map((r) => `- [[${r.name}]]${r.e.star ? ' ★' : ''} — ${r.e.meta.title}${r.e.meta.venue ? `（${r.e.meta.venue}, ${r.e.meta.year}）` : ''}`).join('\n') || '- なし';
  const index = ['# 文献一覧', '', ...['want', 'have', 'read'].flatMap((st) => [`## ${stJa[st]}`, '', sec(st), ''])].join('\n');
  files.unshift({ name: `${folder}/00_文献一覧.md`, data: index });
  return makeZip(files);
}

// ---------- 端末間の引き継ぎ（GitHub Gist 同期・バックアップ）----------
const SYNC_KEYS = ['email', 'name', 'folder', 'fmt', 'cinii'];   // 端末をまたいで共有する設定。トークン・API キー・表示テーマは含めない
const TOMB_KEEP_DAYS = 365;
const SYNC_FILE = 'bunken-hub-sync.json';

// 台帳や同期データに保存する書誌は軽くする（関連文献の ID 群は開くたびに取り直せる）
function compactMeta(m) {
  const { refIds, relIds, orcids, ...rest } = m || {};
  return rest;
}
const stamp = (e) => String(e.updatedAt || (e.addedAt ? e.addedAt + 'T00:00:00.000Z' : '') || '');

// 端末ごとの台帳 {entries, tombs} と、もう一方の端末のデータをマージする。
// 同じ ID は updatedAt が新しいほうを採用し、削除は tombs（墓標）で伝える。同時刻なら残す側（entry）を優先する。
function mergeLedgers(local, remote, now = new Date()) {
  const latest = new Map();   // id → { t, entry|null }
  const put = (id, t, entry) => {
    const cur = latest.get(id);
    if (!cur || t > cur.t || (t === cur.t && entry && !cur.entry)) latest.set(id, { t, entry });
  };
  for (const side of [local, remote]) {
    for (const e of side?.entries || []) if (e && e.id) put(e.id, stamp(e), e);
    for (const t of side?.tombs || []) if (t && t.id) put(t.id, String(t.updatedAt || ''), null);
  }
  const keep = new Date(now.getTime() - TOMB_KEEP_DAYS * 864e5).toISOString();
  const entries = []; const tombs = [];
  for (const [id, { t, entry }] of latest) {
    if (entry) entries.push(entry);
    else if (t >= keep) tombs.push({ id, updatedAt: t });
  }
  entries.sort((a, b) => stamp(b).localeCompare(stamp(a)));
  return { entries, tombs };
}

const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);
// 並び順や書誌の軽量化の違いで「変更あり」と誤判定しないよう、id と更新時刻だけで比べる
const sig = (list) => (list || []).map((e) => `${e.id}|${stamp(e)}`).sort().join('\n');
const pickSync = (settings) => Object.fromEntries(SYNC_KEYS.filter((k) => settings?.[k]).map((k) => [k, settings[k]]));

// 同期データ（remote）を手元（local）に取り込む。
// 戻り値: 新しい手元の状態 next と、リモートを更新する必要があるか（push）、手元が変わったか（pull）
function mergeSync(local, remote, now = new Date()) {
  const rs = remote && remote.settings ? remote : null;
  const merged = mergeLedgers(local, { entries: remote?.ledger || [], tombs: remote?.tombs || [] }, now);
  const lSet = pickSync(local.settings);
  const lAt = String(local.settings?.settingsUpdatedAt || '');
  const rAt = String(rs?.settings?.settingsUpdatedAt || '');
  const useRemote = !!rs && rAt > lAt;
  const outSet = useRemote ? { ...pickSync(rs.settings) } : lSet;
  const settingsAt = useRemote ? rAt : lAt;
  const next = { entries: merged.entries, tombs: merged.tombs, settings: outSet, settingsUpdatedAt: settingsAt };
  const pull = sig(merged.entries) !== sig(local.entries) || sig(merged.tombs) !== sig(local.tombs) || (useRemote && !sameJson(lSet, outSet));
  const push = !remote || sig(merged.entries) !== sig(remote.ledger) || sig(merged.tombs) !== sig(remote.tombs) ||
    (!useRemote && lAt > rAt && !sameJson(lSet, pickSync(rs?.settings)));
  return { next, pull, push };
}

// リモートへ書き込むデータ
function buildSyncPayload(state, now = new Date()) {
  return {
    app: 'bunken-hub', version: 2, updatedAt: now.toISOString(),
    settings: { ...state.settings, settingsUpdatedAt: state.settingsUpdatedAt || '' },
    ledger: state.entries.map((e) => ({ ...e, meta: compactMeta(e.meta) })),
    tombs: state.tombs,
  };
}

// 手動のバックアップ（JSON）。設定（秘密の値を除く）も入れる
function buildBackup(settings, entries, now = new Date()) {
  return { app: 'bunken-hub', version: 2, exportedAt: now.toISOString(), settings: pickSync(settings), ledger: entries.map((e) => ({ ...e, meta: compactMeta(e.meta) })) };
}
// 読み込んだ JSON を {kind, entries, settings} に整える。kind: 'backup' | 'watch'
function parseImport(data) {
  // ウォッチの週次バッファ（data/weekly_buffer.json）は {schema_version, items: [...]}
  if (data && !Array.isArray(data) && Array.isArray(data.items) && 'schema_version' in data) data = data.items;
  if (Array.isArray(data)) {
    if (data[0] && !data[0].meta && 'journal' in data[0] && 'title' in data[0]) return { kind: 'watch', papers: data };
    return { kind: 'backup', entries: data.filter((e) => e && e.id && e.meta), settings: {} };
  }
  if (data && data.app === 'bunken-hub' && Array.isArray(data.ledger)) {
    return { kind: 'backup', entries: data.ledger.filter((e) => e && e.id && e.meta), settings: pickSync(data.settings) };
  }
  return null;
}

// 共有メニュー（Web Share Target）や URL のパラメータから、検索する文字列を決める。DOI があれば最優先
function sharedQuery(params) {
  const get = (k) => String(params.get ? params.get(k) || '' : params[k] || '').trim();
  const [url, text, title] = [get('url'), get('text'), get('title')];
  for (const v of [url, text, title]) { const d = extractDois(v)[0]; if (d) return d; }
  for (const v of [url, text]) { const m = v.match(/https?:\/\/[^\s]+/); if (m && /arxiv\.org/i.test(m[0])) return m[0]; }
  const plain = [title, text].find((v) => v && !/^https?:\/\/\S+$/.test(v));
  return plain || url || '';
}

// 「はじめの設定」の進み具合。env.standalone は、すでにアプリとして開いていること
function setupSteps(settings, env = {}) {
  const s = settings || {};
  return [
    { key: 'email', done: !!s.email },
    { key: 'name', done: !!s.name },
    { key: 'sync', done: !!s.gistToken },
    { key: 'install', done: !!env.standalone || !!s.installMarked },
    { key: 'folder', done: !!s.folder },
  ];
}
// 設定カードを出すか。全部済んだか、本人が「あとで」を選んだら出さない（旧版の setupLater も同じ扱い）
function showSetupCard(settings, env = {}) {
  const steps = setupSteps(settings, env);
  return steps.some((x) => !x.done) && !settings?.setupHidden && !settings?.setupLater;
}

// ---------- 無料版の探索先を増やす（Europe PMC・Semantic Scholar）----------
// Europe PMC の search 結果（resultType=core）の1件から、無料で読める場所と abstract を取り出す
function fromEuropePmc(r) {
  const urls = r?.fullTextUrlList?.fullTextUrl || [];
  const oa = urls.filter((u) => /open access/i.test(u.availability || '') && u.url)
    .map((u) => ({ url: u.url, pdf: /pdf/i.test(u.documentStyle || ''), version: 'publishedVersion', host: 'Europe PMC', license: '' }));
  if (!oa.length && r?.pmcid && r.isOpenAccess === 'Y') oa.push({ url: `https://europepmc.org/article/PMC/${String(r.pmcid).replace(/^PMC/i, '')}`, pdf: false, version: 'publishedVersion', host: 'Europe PMC', license: '' });
  return { oa, abstract: String(r?.abstractText || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() };
}
// Semantic Scholar の paper（fields=openAccessPdf,tldr,abstract）から取り出す
function fromSemanticScholar(j) {
  const pdf = j?.openAccessPdf?.url;
  return { oa: pdf ? [{ url: pdf, pdf: true, version: '', host: 'Semantic Scholar', license: j.openAccessPdf.license || '' }] : [], tldr: j?.tldr?.text || '', abstract: j?.abstract || '' };
}
// 無料版の一覧を、URL の重複を除き、PDF → 出版社版 → 著者最終稿 → プレプリントの順に並べる
function mergeOa(...lists) {
  const seen = new Set(); const out = [];
  for (const l of lists.flat()) { if (l && l.url && !seen.has(l.url)) { seen.add(l.url); out.push(l); } }
  const rank = { publishedVersion: 0, acceptedVersion: 1, submittedVersion: 2 };
  return out.sort((a, b) => (b.pdf ? 1 : 0) - (a.pdf ? 1 : 0) || (rank[a.version] ?? 3) - (rank[b.version] ?? 3));
}

// タイトル検索の候補の絞り込み・並べ替え。sort: rel（検索の順）| year | cited
function filterCands(items, { oaOnly = false, jaOnly = false, sort = 'rel' } = {}) {
  const out = items.filter((m) => (!oaOnly || m.isOa || (m.oa || []).length || m.digital) && (!jaOnly || hasJa(m.title) || hasJa(m.venue)));
  const by = { year: (a, b) => (Number(b.year) || 0) - (Number(a.year) || 0), cited: (a, b) => (b.cited || 0) - (a.cited || 0) }[sort];
  return by ? [...out].sort(by) : out;
}

if (typeof module !== 'undefined') {
  module.exports = { esc, safeUrl, hasJa, parseInput, splitName, nameStr, fromOpenAlex, fromCSL, fromCiNii, fromWatchPaper, watchTags, fromNdlItem,
    reconstructAbstract, extractDois, bibKey, toBibTeX, toCitation, fileName, requestMail, searchLinks, toObsidian, verJa,
    toRIS, availability, authorLinks, graphLinks, translateUrl, isEmail, bookmarklet, filterLedger,
    SYNC_KEYS, SYNC_FILE, compactMeta, mergeLedgers, mergeSync, buildSyncPayload, buildBackup, parseImport, sharedQuery, setupSteps, showSetupCard, fromEuropePmc, fromSemanticScholar, mergeOa, filterCands, normTag, allTags, toCSL, toMarkdownLink, crc32, makeZip, ledgerNotesZip };
}
