'use strict';
// 文献ハブ：API 呼び出し・描画・台帳。DOM に依存しない処理は lib.js にある。

// ---------- 基本ユーティリティ ----------
const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];

const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } },
};
// アプリとして開いているか／ホーム画面への追加を受け付けられるか（後者は pwa.js が beforeinstallprompt で入れる）
const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
let installEvent = null;
const SKEY = 'bunkenhub.settings.v1';
let settings = store.get(SKEY, {});
const saveSettings = () => store.set(SKEY, settings);
const nowIso = () => new Date().toISOString();
// 端末をまたいで共有する設定を変えたときに呼ぶ。変えた項目の更新時刻を進めて、同期の対象にする（項目ごとに新しいほうが勝つ）
function stampSettings(keys) {
  const t = nowIso();
  settings.settingsAt = { ...(settings.settingsAt || {}) };
  for (const k of keys) settings.settingsAt[k] = t;
  settings.settingsUpdatedAt = t;
}
function markSettingsChanged(...keys) { stampSettings(keys); saveSettings(); scheduleSync(); }
// 表示テーマ（端末ごと）。空なら端末の設定に合わせる
function applyTheme() {
  const t = settings.theme === 'light' || settings.theme === 'dark' ? settings.theme : '';
  if (t) document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme;
  const colors = { light: '#f3f5f4', dark: '#0f1618' };
  $$('meta[name="theme-color"]').forEach((m) => { m.content = colors[t || m.dataset.scheme]; });
}

function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => { t.hidden = true; }, 2000);
}
async function copy(text, el) {
  try { await navigator.clipboard.writeText(text); toast('コピーしました'); }
  catch {
    if (el) { const r = document.createRange(); r.selectNodeContents(el); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }
    toast('選択しました。Ctrl+C（⌘C）でコピーしてください');
  }
}
async function getJSON(url, opts = {}, ms = 12000) {
  const ac = new AbortController(); const tm = setTimeout(() => ac.abort(), ms);
  try {
    const r = await fetch(url, { ...opts, signal: ac.signal });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } finally { clearTimeout(tm); }
}
const setStatus = (s, busy = false) => { const el = $('#status'); el.textContent = s; el.classList.toggle('busy', busy); };
const today = () => new Date().toISOString().slice(0, 10);
const link = (u, label, cls = '') => (safeUrl(u) ? `<a href="${esc(u)}" target="_blank" rel="noopener"${cls ? ` class="${cls}"` : ''}>${esc(label)}</a>` : '');
function download(name, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------- API 呼び出し ----------
function oaParams() {
  const p = new URLSearchParams();
  if (settings.email) p.set('mailto', settings.email);
  if (settings.oakey) p.set('api_key', settings.oakey);
  return p.toString();
}
async function byDoi(doi) {
  const enc = encodeURIComponent(doi);
  let meta = null;
  try { meta = fromOpenAlex(await getJSON(`https://api.openalex.org/works/doi:${enc}?${oaParams()}`)); } catch {}
  if (!meta) {
    try { const j = await getJSON(`https://api.crossref.org/works/${enc}${settings.email ? '?mailto=' + encodeURIComponent(settings.email) : ''}`); meta = fromCSL(j.message, 'Crossref'); } catch {}
  }
  if (!meta) {
    // JaLC など Crossref 以外の DOI も doi.org のコンテントネゴシエーションで取れることが多い
    try { meta = fromCSL(await getJSON(`https://doi.org/${doi}`, { headers: { Accept: 'application/vnd.citationstyles.csl+json' } }), 'doi.org'); } catch {}
  }
  if (!meta) return null;
  meta.doi = meta.doi || doi;
  // 無料版の探索先を同時に引く。どれかが落ちても、ほかの結果は使う
  const [up, epmc, s2] = await Promise.allSettled([
    settings.email ? getJSON(`https://api.unpaywall.org/v2/${enc}?email=${encodeURIComponent(settings.email)}`, {}, 9000) : Promise.reject(),
    getJSON(`https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${encodeURIComponent(`DOI:"${doi}"`)}&format=json&resultType=core&pageSize=1`, {}, 9000),
    getJSON(`https://api.semanticscholar.org/graph/v1/paper/DOI:${enc}?fields=openAccessPdf,tldr,abstract`, {}, 9000),
  ]);
  const unp = up.status === 'fulfilled' ? (up.value.oa_locations || []).map((l) => ({
    url: l.url_for_pdf || l.url || l.url_for_landing_page, pdf: !!l.url_for_pdf, version: l.version, host: l.repository_institution || l.host_type || '', license: l.license || '' })) : [];
  const pmc = epmc.status === 'fulfilled' ? fromEuropePmc(epmc.value.resultList?.result?.[0]) : { oa: [], abstract: '' };
  const sem = s2.status === 'fulfilled' ? fromSemanticScholar(s2.value) : { oa: [], tldr: '', abstract: '' };
  meta.oa = mergeOa(meta.oa, unp, pmc.oa, sem.oa);
  meta.abstract = meta.abstract || pmc.abstract || sem.abstract;
  meta.tldr = sem.tldr;
  if (meta.oa.length || (up.status === 'fulfilled' && up.value.is_oa)) meta.isOa = true;
  return meta;
}
async function ndlSearch(q) {
  const ac = new AbortController(); const tm = setTimeout(() => ac.abort(), 12000);
  try {
    const r = await fetch(`https://ndlsearch.ndl.go.jp/api/opensearch?any=${encodeURIComponent(q)}&cnt=8`, { signal: ac.signal });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const doc = new DOMParser().parseFromString(await r.text(), 'application/xml');
    const txt = (el, tag) => [...el.getElementsByTagName(tag)].map((x) => x.textContent.trim()).filter(Boolean);
    return [...doc.getElementsByTagName('item')].map((it) => fromNdlItem({
      title: txt(it, 'title')[0],
      link: txt(it, 'link')[0],
      creators: txt(it, 'dc:creator'),
      date: txt(it, 'dcterms:issued')[0] || txt(it, 'dc:date')[0] || txt(it, 'pubDate')[0],
      publisher: txt(it, 'dc:publisher')[0],
      series: txt(it, 'dcndl:seriesTitle')[0],
      digital: txt(it, 'rdfs:seeAlso').concat(txt(it, 'link')).some((u) => /dl\.ndl\.go\.jp/.test(u)),
    }));
  } finally { clearTimeout(tm); }
}
async function byTitle(q) {
  const jobs = [
    getJSON(`https://api.openalex.org/works?search=${encodeURIComponent(q)}&per-page=8&${oaParams()}`).then((j) => j.results.map(fromOpenAlex)),
    getJSON(`https://api.crossref.org/works?query.bibliographic=${encodeURIComponent(q)}&rows=6${settings.email ? '&mailto=' + encodeURIComponent(settings.email) : ''}`).then((j) => j.message.items.map((m) => fromCSL(m, 'Crossref'))),
  ];
  // CiNii はブラウザから直接呼べない場合がある。失敗しても下の検索リンクで補う
  const cp = new URLSearchParams({ q, count: '8', format: 'json' });
  if (settings.cinii) cp.set('appid', settings.cinii);
  jobs.push(getJSON(`https://cir.nii.ac.jp/opensearch/all?${cp}`).then((j) => (j.items || []).map(fromCiNii)));
  // NDLサーチ（国立国会図書館。デジタルコレクションの資料も含む）。こちらも直接呼べない場合はリンクで補う
  jobs.push(ndlSearch(q));
  const res = await Promise.allSettled(jobs);
  const out = []; const seen = new Set();
  const ok = res.map((r) => r.status === 'fulfilled');
  // 日本語の問い合わせなら CiNii の結果を先頭に
  const order = hasJa(q) ? [2, 3, 0, 1] : [0, 1, 2, 3];
  for (const i of order) {
    if (!ok[i]) continue;
    for (const m of res[i].value) {
      const key = m.doi || (m.title || '').toLowerCase().replace(/\W+/g, '').slice(0, 60);
      if (!m.title || seen.has(key)) continue;
      seen.add(key); out.push(m);
    }
  }
  return { items: out, ciniiOk: ok[2], ndlOk: ok[3] };
}


// OpenAlex の ID 群（参照文献・関連論文）や被引用論文をまとめて取る
async function fetchWorks(filter, extra = '') {
  const j = await getJSON(`https://api.openalex.org/works?filter=${filter}&per-page=25${extra}&${oaParams()}`);
  return (j.results || []).map(fromOpenAlex);
}

// ---------- 状態 ----------
let current = null;
let lastCands = [];
const LKEY = 'bunkenhub.ledger.v1';
const RKEY = 'bunkenhub.recent.v1';
const WATCH_IMPORT_MAX = 50;
const TKEY = 'bunkenhub.tombs.v1';   // 削除した文献の墓標（他の端末へ削除を伝えるため）
let ledger = store.get(LKEY, []);
let tombs = store.get(TKEY, []);
const persistLedger = () => store.set(LKEY, ledger) && store.set(TKEY, tombs);
const newEntry = (m, status) => ({ id: lid(m), status, memo: '', addedAt: today(), updatedAt: nowIso(), meta: compactMeta(m) });
const rememberEntry = (e) => { tombs = tombs.filter((t) => t.id !== e.id); ledger.unshift(e); };
let recent = store.get(RKEY, []);
const lview = { status: 'all', text: '', sort: 'added', tag: '', star: false };
const stJa = { want: '未入手', have: '入手済', read: '読了' };
const lid = (m) => m.doi || (m.title || '').toLowerCase().replace(/\s+/g, '').slice(0, 80);
const inLedger = (m) => ledger.find((e) => e.id === lid(m));

// ---------- 候補 ----------
function candHTML(m, i, attr = 'data-i') {
  const av = availability(m);
  const au = m.authors.slice(0, 3).map(nameStr).join(', ') + (m.authors.length > 3 ? ' ほか' : '');
  return `<button type="button" class="cand" ${attr}="${i}">
    <span class="dot ${av.level}" aria-hidden="true"></span>
    <span class="cand-b">
      <span class="t">${esc(m.title)}</span>
      <span class="m">${esc([au, m.year, m.venue].filter(Boolean).join(' · '))}</span>
      <span class="badges"><span class="tag src">${esc(m.source)}</span>${m.oa?.length || m.isOa ? '<span class="tag oa">無料版あり</span>' : ''}${m.digital ? '<span class="tag oa">デジコレ</span>' : ''}${m.retracted ? '<span class="tag bad">撤回</span>' : ''}${inLedger(m) ? `<span class="tag src">台帳: ${stJa[inLedger(m).status]}</span>` : ''}${m.cited ? `<span class="sub">被引用 ${m.cited}</span>` : ''}</span>
    </span>
  </button>`;
}
const candView = { oaOnly: false, jaOnly: false, sort: 'rel' };
let candNote = '';
function renderCands(items, note = candNote) {
  candNote = note; lastCands = items;
  const shown = filterCands(items, candView);
  shownCands = shown;
  $('#candsNote').textContent = shown.length === items.length ? note : `${shown.length} / ${items.length} 件を表示`;
  $('#candlist').innerHTML = shown.map((m, i) => candHTML(m, i)).join('') ||
    `<div class="empty">${items.length ? '条件に合う候補がありません。絞り込みを外してください。' : '見つかりませんでした。言い回しを変えるか、DOI で調べてください。'}</div>`;
  $('#cands').hidden = false;
}
let shownCands = [];
$('#fOa').addEventListener('click', (ev) => { candView.oaOnly = !candView.oaOnly; ev.currentTarget.setAttribute('aria-pressed', String(candView.oaOnly)); renderCands(lastCands); });
$('#fJa').addEventListener('click', (ev) => { candView.jaOnly = !candView.jaOnly; ev.currentTarget.setAttribute('aria-pressed', String(candView.jaOnly)); renderCands(lastCands); });
$('#cSort').addEventListener('change', (ev) => { candView.sort = ev.target.value; renderCands(lastCands); });
$('#candlist').addEventListener('click', (ev) => {
  const b = ev.target.closest('.cand'); if (!b) return;
  openWork(shownCands[+b.dataset.i]);
});
async function openWork(m) {
  if (m.doi) await lookupDoi(m.doi, m); else showDetail(m);
}

// ---------- 詳細 ----------
const TABS = [['get', '入手する'], ['cite', '引用・保存'], ['rel', '関連文献']];
let tab = 'get';

function ledgerControl(m) {
  const e = inLedger(m);
  if (!e) return `<button type="button" class="primary" data-add="want">台帳に追加</button>`;
  return `<button type="button" class="star" data-star aria-pressed="${!!e.star}" title="重要（★）">${e.star ? '★' : '☆'}</button><label class="inline">台帳: <select data-setst aria-label="台帳の状態">${Object.entries(stJa).map(([k, v]) => `<option value="${k}"${k === e.status ? ' selected' : ''}>${v}</option>`).join('')}</select></label>`;
}

// 研究デザインとサンプル数（edu-research-watch と同じ規則での一次判定）
function factsLine(m) {
  const f = studyFacts(m);
  const parts = [...f.labels, f.n != null ? `N=${f.n.toLocaleString('ja-JP')}` : ''].filter(Boolean);
  return parts.length ? `<p class="facts"><span class="tag src">研究の型</span> ${esc(parts.join(' · '))} <span class="sub">（題名と abstract からの自動判定。本文で確認してください）</span></p>` : '';
}
// abstract に出てくる専門用語の訳（ウォッチの用語辞書）。機械翻訳の誤訳を見分ける手がかり
function glossLine(text) {
  const hits = glossaryHits(text);
  return hits.length ? `<p class="gloss"><span class="sub">用語:</span> ${hits.map(([en, ja]) => `<span class="gl">${esc(en)}＝${esc(ja)}</span>`).join(' ')}</p>` : '';
}

function showDetail(m) {
  current = m;
  rememberRecent(m);
  const d = $('#detail');
  const av = availability(m);
  const doiUrl = m.doi ? `https://doi.org/${m.doi}` : '';
  const meta = [m.venue, m.volume && (m.volume + (m.issue ? '(' + m.issue + ')' : '')), m.pages, m.year].filter(Boolean).join(' · ');
  d.innerHTML = `
    <header class="biblio">
      <div class="biblio-main">
        <h2 class="title">${esc(m.title)}</h2>
        ${m.title_ja ? `<div class="m">訳題: ${esc(m.title_ja)}</div>` : ''}
        <div class="m">${esc(m.authors.map(nameStr).join(', ') || '著者不明')}</div>
        <div class="m">${esc(meta)}</div>
        <div class="m mono">${m.doi ? `DOI ${link(doiUrl, m.doi)}` : link(m.landing, m.landing)}
          <span class="tag src">${esc(m.source)}</span>${m.cited != null ? ` <span class="sub">被引用 ${m.cited}</span>` : ''}</div>
      </div>
      <div class="biblio-act" id="lctl">${ledgerControl(m)}</div>
    </header>
    ${m.retracted ? '<div class="banner bad"><b>この論文は撤回されています。</b><span>引用・参照する前に、撤回の理由を出版社のページで確認してください。</span></div>' : ''}
    <div class="banner ${av.level}"><b>${esc(av.label)}</b><span>${esc(av.detail)}</span></div>
    ${factsLine(m)}
    ${m.tldr ? `<p class="tldr"><span class="tag src">TLDR</span> ${esc(m.tldr)} <span class="sub">（Semantic Scholar による一行要約）</span> ${link(translateUrl(m.tldr), '翻訳')}</p>` : ''}
    ${m.abstract ? `<details class="abs"><summary>Abstract</summary><p>${esc(m.abstract)}</p>${glossLine(`${m.title} ${m.abstract}`)}<p>${link(translateUrl(m.abstract), '日本語に翻訳する（Google 翻訳）')}</p></details>` : ''}
    <div class="dtabs" role="tablist" aria-label="詳細の切り替え">
      ${TABS.map(([k, v]) => `<button type="button" role="tab" id="t_${k}" aria-controls="p_${k}" aria-selected="${k === tab}" data-tab="${k}">${v}</button>`).join('')}
    </div>
    <div id="p_get" role="tabpanel" aria-labelledby="t_get" ${tab === 'get' ? '' : 'hidden'}>${getPanel(m, doiUrl)}</div>
    <div id="p_cite" role="tabpanel" aria-labelledby="t_cite" ${tab === 'cite' ? '' : 'hidden'}>${citePanel(m)}</div>
    <div id="p_rel" role="tabpanel" aria-labelledby="t_rel" ${tab === 'rel' ? '' : 'hidden'}><div class="empty">読み込み中…</div></div>`;
  d.hidden = false;
  d.dataset.relFor = '';
  if (tab === 'rel') loadRelated(m);
  if (m.doi) history.replaceState(null, '', `?q=${encodeURIComponent(m.doi)}`);
  d.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
}

function getPanel(m, doiUrl) {
  const oaItems = (m.oa || []).map((l) => `<li>${link(l.url, l.host || (l.url.split('/')[2] || l.url))}
    <span class="tag oa">${l.pdf ? 'PDF' : 'ページ'}</span>${verJa[l.version] ? `<span class="sub">${verJa[l.version]}</span>` : ''}${l.license ? ` <span class="sub">${esc(l.license)}</span>` : ''}</li>`).join('');
  // 上部の初回案内を閉じた人にだけ、ここで登録を促す
  const emailAsk = settings.email || !(settings.setupHidden || settings.setupLater) ? '' : `<form class="inline-form" data-email-form>
      <label>メールアドレスを登録すると、Unpaywall でも無料版を探します
        <span class="row"><input type="email" placeholder="you@example.com" autocomplete="email" required><button type="submit" class="primary">登録して調べ直す</button></span></label></form>`;
  const to = m.authors[m.corresponding >= 0 ? m.corresponding : 0];
  const toIdx = m.corresponding >= 0 ? m.corresponding : 0;
  return `<div class="routes">
    <section class="route">
      <h3><span class="num">1</span>無料で読める版</h3>
      ${oaItems ? `<ul class="list">${oaItems}</ul>` : '<p class="empty">見つかっていません。2 の横断検索で、著者最終稿・紀要・博士論文などの別の版が見つかることがあります。</p>'}
      ${emailAsk}
    </section>
    <section class="route">
      <h3><span class="num">2</span>横断して探す</h3>
      <div class="links">${searchLinks(m).map(([n, u]) => link(u, n)).join('')}</div>
      <p class="sub">Google Scholar では、検索結果の下の「すべてのバージョン」も開いてください。</p>
    </section>
    <section class="route">
      <h3><span class="num">3</span>手続きして入手する</h3>
      <ul class="list">
        ${doiUrl || safeUrl(m.landing) ? `<li>${link(doiUrl || m.landing, '出版社のページ')} <span class="tag pay">購入</span><span class="sub">単品購入・レンタルがあるか</span></li>` : ''}
        <li>${link('https://www.ndl.go.jp/jp/copy/remote/index.html', '国立国会図書館の遠隔複写')} <span class="tag pay">有料</span><span class="sub">利用者登録をして、複写を郵送で取り寄せる</span></li>
        <li>${link('https://www.ndl.go.jp/jp/use/digital_transmission/individuals_index.html', '個人向けデジタル化資料送信サービス')} <span class="sub">絶版などで手に入りにくい資料を自宅で読む</span></li>
        <li>最寄りの公共図書館の相互貸借・複写の取り寄せ</li>
      </ul>
    </section>
    <section class="route">
      <h3><span class="num">4</span>著者に頼む</h3>
      ${to ? `<p class="sub">宛先: ${esc(nameStr(to))}${m.corresponding >= 0 ? '（責任著者）' : '（筆頭著者）'}</p>
      <div class="links">${authorLinks(to, m.orcids?.[toIdx]).map(([n, u]) => link(u, n)).join('')}</div>` : ''}
      <details class="mail"><summary>依頼文を見る</summary>
        <pre id="c_mail">${esc(requestMail(m, { name: settings.name }))}</pre>
        <div class="row"><button type="button" data-copy="mail">依頼文をコピー</button>${settings.name ? '' : '<span class="sub">設定で名前を入れると署名に入ります</span>'}</div>
      </details>
    </section>
  </div>`;
}

const FORMATS = [['cite', '参考文献'], ['bib', 'BibTeX'], ['ris', 'RIS'], ['csl', 'CSL JSON'], ['md', 'Markdown'], ['obs', 'Obsidian']];
function formatText(m, f) {
  const e = inLedger(m);
  return { cite: toCitation(m), bib: toBibTeX(m), ris: toRIS(m), csl: toCSL(m), md: toMarkdownLink(m), obs: toObsidian(m, { status: e?.status, memo: e?.memo, tags: e?.tags, star: e?.star }) }[f];
}
const shareUrl = (m) => `${location.origin}${location.pathname}?q=${encodeURIComponent(m.doi || m.title)}`;
function citePanel(m) {
  const fmt = settings.fmt || 'cite';
  const folder = safeUrl(settings.folder);
  const share = shareUrl(m);
  return `<div class="routes">
    <section class="route wide">
      <div class="seg" role="radiogroup" aria-label="形式">${FORMATS.map(([k, v]) => `<button type="button" role="radio" aria-checked="${k === fmt}" data-fmt="${k}">${v}</button>`).join('')}</div>
      <pre id="c_fmt">${esc(formatText(m, fmt))}</pre>
      <div class="row"><button type="button" class="primary" data-copy="fmt">コピー</button>${fmt === 'obs' ? '<button type="button" id="obsSave">.md で保存</button>' : ''}</div>
    </section>
    <section class="route">
      <h3>保存するときのファイル名</h3>
      <pre id="c_fn">${esc(fileName(m))}</pre>
      <div class="row"><button type="button" data-copy="fn">コピー</button>${folder ? link(folder, '保存先フォルダを開く', 'btnlink') : '<button type="button" data-open-settings>保存先フォルダを登録</button>'}</div>
    </section>
    <section class="route">
      <h3>Zotero</h3>
      ${zoteroRoute(m)}
    </section>
    <section class="route">
      <h3>このページへのリンク</h3>
      <pre id="c_share">${esc(share)}</pre>
      <div class="row"><button type="button" data-copy="share">コピー</button>${navigator.share ? '<button type="button" data-share>共有…</button>' : ''}</div>
    </section>
  </div>`;
}

async function loadRelated(m) {
  const p = $('#p_rel');
  const key = m.oaid || m.doi || m.title;
  if ($('#detail').dataset.relFor === key) return;
  $('#detail').dataset.relFor = key;
  const ext = graphLinks(m).map(([n, u]) => link(u, n)).join('');
  if (!m.oaid) {
    p.innerHTML = `<p class="empty">この論文は OpenAlex の情報がないため、関連文献を画面内に出せません。</p>${ext ? `<div class="links">${ext}</div>` : ''}`;
    return;
  }
  p.innerHTML = '<p class="empty">読み込み中…</p>';
  const ids = (a) => a.slice(0, 25).join('|');
  const byAuthor = authorWorksFilter(m);
  const [refs, cites, rel, auth] = await Promise.allSettled([
    m.refIds?.length ? fetchWorks(`openalex:${ids(m.refIds)}`) : Promise.resolve([]),
    fetchWorks(`cites:${m.oaid}`, '&sort=cited_by_count:desc'),
    m.relIds?.length ? fetchWorks(`openalex:${ids(m.relIds)}`) : Promise.resolve([]),
    byAuthor ? fetchWorks(byAuthor, '&sort=cited_by_count:desc') : Promise.resolve([]),
  ]);
  if (current !== m) return;
  if (auth.status === 'fulfilled') auth.value = auth.value.filter((x) => x.oaid !== m.oaid);
  const groups = [
    ['この論文を引用している（被引用の多い順）', cites],
    ['この論文が参照している', refs],
    ['関連する論文（OpenAlex の推定）', rel],
    ['同じ著者の他の論文（筆頭・責任著者、被引用の多い順）', auth],
  ];
  const count = (r) => (r.status === 'fulfilled' ? r.value.length : undefined);
  const lag = citationLagNote(m, { cites: count(cites), refs: m.refIds?.length ?? count(refs) });
  related = [];
  p.innerHTML = `<div class="links">${ext}<span class="sub">引用関係を図で見る</span></div>`
    + (lag ? `<p class="note">${esc(lag)}</p>` : '') + groups.map(([h, r]) => {
    const items = r.status === 'fulfilled' ? r.value : null;
    if (items) items.sort((a, b) => (b.cited || 0) - (a.cited || 0));
    const html = items ? items.slice(0, 10).map((x) => { related.push(x); return candHTML(x, related.length - 1, 'data-r'); }).join('') : '';
    return `<section class="relgroup"><h3>${h}${items ? ` <span class="sub">${items.length}${items.length >= 25 ? '+' : ''} 件</span>` : ''}</h3>
      <div class="cands">${items ? (html || '<p class="empty">ありません。</p>') : '<p class="empty">取得できませんでした。</p>'}</div></section>`;
  }).join('');
}
let related = [];

// 詳細パネル内の操作は1か所でまとめて受ける
$('#detail').addEventListener('click', (ev) => {
  const t = ev.target;
  const tb = t.closest('[data-tab]');
  if (tb) {
    tab = tb.dataset.tab;
    $$('[data-tab]', $('#detail')).forEach((b) => b.setAttribute('aria-selected', String(b === tb)));
    TABS.forEach(([k]) => { $('#p_' + k).hidden = k !== tab; });
    if (tab === 'rel') loadRelated(current);
    return;
  }
  const fb = t.closest('[data-fmt]');
  if (fb) { settings.fmt = fb.dataset.fmt; markSettingsChanged('fmt'); $('#p_cite').innerHTML = citePanel(current); return; }
  const cb = t.closest('[data-copy]');
  if (cb) { const el = $('#c_' + cb.dataset.copy); copy(el.textContent, el); return; }
  if (t.closest('[data-share]')) { navigator.share({ title: current.title, text: toCitation(current), url: shareUrl(current) }).catch(() => {}); return; }
  if (t.closest('#obsSave')) { download(fileName(current).replace(/\.pdf$/, '.md'), formatText(current, 'obs'), 'text/markdown'); return; }
  if (t.closest('[data-star]')) { const e = inLedger(current); if (e) { e.star = !e.star; e.updatedAt = nowIso(); saveLedger(); $('#lctl').innerHTML = ledgerControl(current); } return; }
  const ab = t.closest('[data-add]');
  if (ab) { addLedger(current, ab.dataset.add); $('#lctl').innerHTML = ledgerControl(current); return; }
  if (t.closest('[data-zotero]')) { sendCurrentToZotero(); return; }
  if (t.closest('[data-open-settings]')) { openSettings(t.closest('[data-open-settings]').dataset.openSettings); return; }
  const rb = t.closest('[data-r]');
  if (rb) openWork(related[+rb.dataset.r]);
});
$('#detail').addEventListener('change', (ev) => {
  if (ev.target.matches('[data-setst]')) { addLedger(current, ev.target.value); }
});
$('#detail').addEventListener('submit', async (ev) => {
  const f = ev.target.closest('[data-email-form]'); if (!f) return;
  ev.preventDefault();
  const v = $('input', f).value.trim();
  if (!isEmail(v)) { toast('メールアドレスの形をご確認ください'); return; }
  settings.email = v; markSettingsChanged('email'); refreshSetup();
  toast('登録しました。調べ直します');
  if (current?.doi) lookupDoi(current.doi, current);
});

// ---------- 検索の流れ ----------
async function lookupDoi(doi, fallback) {
  setStatus(`DOI ${doi} を調べています…`, true);
  const m = await byDoi(doi);
  if (m) { setStatus(''); showDetail(m); }
  else if (fallback) { setStatus('DOI から詳細を取得できなかったので、検索結果の情報を表示しています。'); showDetail({ ...fallback, oa: fallback.oa || [] }); }
  else { setStatus('この DOI の書誌を取得できませんでした。DOI が正しいか確かめるか、タイトルで検索してください。'); }
}

let running = false;
async function run(raw) {
  const p = parseInput(raw);
  if (!p || running) return;
  running = true;
  const go = $('#go'); go.disabled = true; go.textContent = '調べています…';
  try {
    $('#detail').hidden = true;
    tab = 'get';
    if (p.kind === 'doi') { $('#cands').hidden = true; await lookupDoi(p.doi); return; }
    if (p.kind === 'url') { $('#cands').hidden = true; setStatus('この URL から DOI を見つけられませんでした。論文のタイトルで検索するか、ブックマークレット（使い方を参照）を使ってください。'); return; }
    setStatus(`「${p.q}」を検索しています…`, true);
    const { items, ciniiOk, ndlOk } = await byTitle(p.q);
    const miss = [!ciniiOk && 'CiNii', !ndlOk && 'NDL'].filter(Boolean);
    setStatus('');
    renderCands(items, `${items.length} 件${miss.length ? `（${miss.join('・')} は取得できませんでした）` : ''}`);
    if (!items.length) showDetail({ source: '入力', title: p.q, authors: [], year: '', venue: '', doi: '', oa: [], isOa: false });
  } finally {
    running = false; go.disabled = false; go.textContent = '調べる';
  }
}

// ---------- 最近調べた論文 ----------
function rememberRecent(m) {
  const q = m.doi || m.title; if (!q) return;
  recent = [{ q, t: m.title }, ...recent.filter((r) => r.q !== q)].slice(0, 6);
  store.set(RKEY, recent); renderRecent();
}
function renderRecent() {
  $('#recentBox').hidden = !recent.length;
  $('#recent').innerHTML = recent.map((r, i) => `<button type="button" data-rec="${i}" title="${esc(r.t)}">${esc(r.t.length > 28 ? r.t.slice(0, 28) + '…' : r.t)}</button>`).join('');
}
$('#recent').addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-rec]'); if (!b) return;
  const r = recent[+b.dataset.rec]; $('#q').value = r.q; run(r.q);
});

// ---------- 台帳 ----------
function saveLedger() {
  if (!persistLedger()) toast('保存できませんでした。書き出しで控えを取ってください');
  renderLedger(); scheduleSync();
}
function addLedger(m, st) {
  const ex = inLedger(m);
  if (ex) { ex.status = st; ex.updatedAt = nowIso(); toast(`台帳の状態を「${stJa[st]}」にしました`); }
  else { rememberEntry(newEntry(m, st)); toast('台帳に追加しました'); requestPersist(); }
  saveLedger();
}
// 容量が足りなくなってもブラウザに台帳を消されないよう、保存の継続を頼む（断られても支障はない）
function requestPersist() { try { navigator.storage?.persist?.(); } catch {} }
function renderLedger() {
  const counts = { all: ledger.length, want: 0, have: 0, read: 0 };
  for (const e of ledger) counts[e.status] = (counts[e.status] || 0) + 1;
  $$('#ltabs [data-st]').forEach((b) => { $('.n', b).textContent = counts[b.dataset.st] || 0; });
  $('#navcount').textContent = counts.want ? counts.want : '';
  $('#navcount').title = '未入手の件数';
  $('#lcount').textContent = ledger.length ? `${ledger.length} 件` : '';
  renderTagFilter();
  const rows = filterLedger(ledger, lview);
  $('#ltbody').innerHTML = rows.length ? rows.map((e) => `<tr data-id="${esc(e.id)}" class="st-${e.status}">
    <td class="y">${esc(e.meta.year)}</td>
    <td class="tt"><div class="titlerow"><button type="button" class="star" data-act="star" aria-pressed="${!!e.star}" title="重要（★）">${e.star ? '★' : '☆'}</button><button type="button" class="linkish t" data-act="open">${esc(e.meta.title)}</button></div>
      <div class="sub">${esc(e.meta.authors.slice(0, 2).map(nameStr).join(', '))}${e.meta.authors.length > 2 ? ' ほか' : ''}${e.meta.venue ? ' · ' + esc(e.meta.venue) : ''}</div>
      <div class="tagrow">${(e.tags || []).map((t) => `<span class="tchip"><button type="button" data-act="tagfilter" data-tag="${esc(t)}" title="このタグで絞り込む">#${esc(t)}</button><button type="button" data-act="tagrm" data-tag="${esc(t)}" aria-label="タグ ${esc(t)} を外す">×</button></span>`).join('')}<input class="taginput" list="taglist" data-act="tagadd" placeholder="＋タグ" aria-label="タグを追加" maxlength="30"></div></td>
    <td class="stc"><select aria-label="状態" data-act="st">${Object.entries(stJa).map(([k, v]) => `<option value="${k}"${k === e.status ? ' selected' : ''}>${v}</option>`).join('')}</select></td>
    <td class="memo"><textarea rows="1" aria-label="メモ" data-act="memo" placeholder="メモ">${esc(e.memo)}</textarea></td>
    <td class="act"><button type="button" class="ghost" data-act="del">削除</button></td>
  </tr>`).join('') : `<tr><td colspan="5" class="empty">${ledger.length ? '条件に合う文献はありません。' : 'まだ何もありません。論文を調べて「台帳に追加」を押すと、ここに並びます。'}</td></tr>`;
  renderBackupNote();
}
// タグの絞り込み欄と入力候補。選んでいたタグが無くなったら絞り込みを外す
function renderTagFilter() {
  const tags = allTags(ledger);
  if (lview.tag && !tags.some(([t]) => t === lview.tag)) lview.tag = '';
  $('#ltag').innerHTML = '<option value="">すべてのタグ</option>' + tags.map(([t, n]) => `<option value="${esc(t)}"${t === lview.tag ? ' selected' : ''}>#${esc(t)}（${n}）</option>`).join('');
  $('#ltag').hidden = !tags.length;
  $('#taglist').innerHTML = tags.map(([t]) => `<option value="${esc(t)}">`).join('');
  $('#lstar').setAttribute('aria-pressed', String(lview.star));
}
const rowEntry = (el) => ledger.find((x) => x.id === el.closest('tr').dataset.id);
$('#ltbody').addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-act]'); if (!b) return;
  const e = rowEntry(b);
  if (b.dataset.act === 'open') { tab = 'get'; openWork(e.meta); }
  if (b.dataset.act === 'star') { e.star = !e.star; e.updatedAt = nowIso(); saveLedger(); if (current && lid(current) === e.id && $('#lctl')) $('#lctl').innerHTML = ledgerControl(current); }
  if (b.dataset.act === 'tagrm') { e.tags = (e.tags || []).filter((t) => t !== b.dataset.tag); e.updatedAt = nowIso(); saveLedger(); }
  if (b.dataset.act === 'tagfilter') { lview.tag = b.dataset.tag; renderLedger(); }
  if (b.dataset.act === 'del') {
    if (b.dataset.confirm) { ledger = ledger.filter((x) => x !== e); tombs.push({ id: e.id, updatedAt: nowIso() }); saveLedger(); toast('削除しました'); }
    else { b.dataset.confirm = '1'; b.textContent = 'もう一度押すと削除'; b.classList.add('danger'); setTimeout(() => { if (b.isConnected) { b.dataset.confirm = ''; b.textContent = '削除'; b.classList.remove('danger'); } }, 3000); }
  }
});
$('#ltbody').addEventListener('change', (ev) => {
  const t = ev.target; const e = rowEntry(t);
  if (t.dataset.act === 'st') { e.status = t.value; e.updatedAt = nowIso(); saveLedger(); if (current && lid(current) === e.id) $('#lctl').innerHTML = ledgerControl(current); }
  if (t.dataset.act === 'tagadd') {
    const tag = normTag(t.value); t.value = '';
    if (tag && !(e.tags || []).includes(tag)) { e.tags = [...(e.tags || []), tag]; e.updatedAt = nowIso(); saveLedger(); }
    return;
  }
  if (t.dataset.act === 'memo') { e.memo = t.value; e.updatedAt = nowIso(); persistLedger(); scheduleSync(); }
});
$('#ltabs').addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-st]'); if (!b) return;
  lview.status = b.dataset.st;
  $$('#ltabs [data-st]').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
  renderLedger();
});
$('#ltag').addEventListener('change', (ev) => { lview.tag = ev.target.value; renderLedger(); });
$('#lstar').addEventListener('click', () => { lview.star = !lview.star; renderLedger(); });
$('#lfind').addEventListener('input', (ev) => { lview.text = ev.target.value; renderLedger(); });
$('#lsort').addEventListener('change', (ev) => { lview.sort = ev.target.value; renderLedger(); });

function renderBackupNote() {
  const el = $('#backupNote');
  const days = settings.lastExport ? Math.floor((Date.now() - Date.parse(settings.lastExport)) / 864e5) : null;
  const need = ledger.length >= 3 && (days === null || days >= 14);
  el.hidden = !need;
  if (need) el.innerHTML = `${days === null ? 'まだ一度もバックアップしていません。' : `最後のバックアップから ${days} 日たっています。`}台帳はこのブラウザにしか保存されていません。 <button type="button" id="quickBackup">今すぐ JSON で書き出す</button>`;
}
function exportJson() {
  download(`bunken-ledger_${today()}.json`, JSON.stringify(buildBackup(settings, ledger), null, 2), 'application/json');
  settings.lastExport = new Date().toISOString(); saveSettings(); renderBackupNote();
}
$('#backupNote').addEventListener('click', (ev) => { if (ev.target.id === 'quickBackup') exportJson(); });
$('#exJson').addEventListener('click', exportJson);
$('#exBib').addEventListener('click', () => download(`bunken_${today()}.bib`, ledger.map((e) => toBibTeX(e.meta)).join('\n\n'), 'text/plain'));
$('#exObs').addEventListener('click', () => {
  if (!ledger.length) { toast('台帳が空です'); return; }
  download(`bunken-obsidian_${today()}.zip`, ledgerNotesZip(ledger, { today: today() }), 'application/zip');
  toast('ZIP を書き出しました。Vault の中に展開してください');
});
$('#exRis').addEventListener('click', () => download(`bunken_${today()}.ris`, ledger.map((e) => toRIS(e.meta)).join('\n\n'), 'application/x-research-info-systems'));
$('#exCsv').addEventListener('click', () => {
  const q = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;
  const rows = [['状態', '★', 'タグ', '年', 'タイトル', '著者', '誌名', 'DOI', 'メモ', '追加日']]
    .concat(ledger.map((e) => [stJa[e.status], e.star ? '★' : '', (e.tags || []).join(' '), e.meta.year, e.meta.title, e.meta.authors.map(nameStr).join('; '), e.meta.venue, e.meta.doi, e.memo, e.addedAt]));
  download(`bunken-ledger_${today()}.csv`, '﻿' + rows.map((r) => r.map(q).join(',')).join('\r\n'), 'text/csv');
});
$('#imJson').addEventListener('change', async (ev) => {
  const f = ev.target.files[0]; if (!f) return;
  try {
    const imp = parseImport(JSON.parse(await f.text()));
    if (!imp) throw new Error();
    if (imp.kind === 'watch') {
      // edu-research-watch の出力。papers.json は数千件あるのでスコア上位だけを未入手として入れる
      const top = [...imp.papers].sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, WATCH_IMPORT_MAX);
      let n = 0;
      for (const p of top) { const m = fromWatchPaper(p); if (m.title && !ledger.some((x) => x.id === lid(m))) { rememberEntry({ ...newEntry(m, 'want'), tags: watchTags(p) }); n++; } }
      saveLedger(); toast(`ウォッチから ${n} 件を追加しました${imp.papers.length > WATCH_IMPORT_MAX ? `（スコア上位 ${WATCH_IMPORT_MAX} 件まで）` : ''}`);
    } else {
      // バックアップ。同じ文献は更新が新しいほうを残し、設定は手元で未入力のものだけ補う
      const before = ledger.length;
      ({ entries: ledger, tombs } = mergeLedgers({ entries: ledger, tombs }, { entries: imp.entries, tombs: [] }));
      const filled = SYNC_KEYS.filter((k) => !settings[k] && imp.settings[k]);
      for (const k of filled) settings[k] = imp.settings[k];
      if (filled.length) { markSettingsChanged(...filled); refreshSetup(); }
      saveLedger(); toast(`${Math.max(0, ledger.length - before)} 件を読み込みました${filled.length ? `（設定 ${filled.length} 項目も引き継ぎました）` : ''}`);
    }
  } catch { toast('読み込めませんでした。このツールか edu-research-watch が書き出した JSON を選んでください'); }
  ev.target.value = '';
});
$('#bulk').addEventListener('input', () => { const n = extractDois($('#bulk').value).length; $('#bulkCount').textContent = n ? `${n} 件の DOI` : ''; });
$('#bulkAdd').addEventListener('click', async () => {
  const dois = extractDois($('#bulk').value);
  if (!dois.length) { toast('DOI が見つかりませんでした'); return; }
  const btn = $('#bulkAdd'); btn.disabled = true;
  let n = 0;
  for (const [i, doi] of dois.entries()) {
    setStatus(`まとめて追加 ${i + 1}/${dois.length}: ${doi}`, true);
    if (ledger.some((x) => x.id === doi)) continue;
    const m = await byDoi(doi);
    if (m) { rememberEntry(newEntry(m, 'want')); n++; renderLedger(); }
  }
  saveLedger(); btn.disabled = false;
  setStatus(`${dois.length} 件の DOI のうち ${n} 件を台帳に追加しました（すでにあるもの・取得できなかったものを除く）。`);
  $('#bulk').value = ''; $('#bulkCount').textContent = '';
});

// ---------- Zotero との連携（Web API v3）----------
// 書誌を本人の Zotero ライブラリへ送る。キーはこの端末だけに置き、同期・書き出しに入れない（SYNC_KEYS に含めない）。
// 送った item のキーは台帳の文献（entry.zotero）に残す。台帳は同期されるので、別の端末でも送信済みと分かる。
const zUser = () => settings.zoteroUser || null;
async function zoteroFetch(path, opts = {}) {
  const r = await fetch(ZOTERO_API + path, { ...opts, headers: { 'Zotero-API-Key': settings.zoteroKey, 'Zotero-API-Version': '3', ...(opts.body ? { 'Content-Type': 'application/json' } : {}), ...(opts.headers || {}) } });
  if (!r.ok) { const err = new Error('HTTP ' + r.status); err.status = r.status; throw err; }
  return r.status === 204 ? null : r.json();
}
const zoteroErrorText = (e) => (e.status === 403 ? 'キーが無効か、書き込みの権限がありません。設定でキーを確かめてください。'
  : e.status === 429 ? 'Zotero の利用制限にかかりました。しばらく待ってからやり直してください。'
    : `Zotero に接続できませんでした（${e.message}）。`);
function renderZoteroInfo(msg) {
  const u = zUser();
  $('#zInfo').textContent = msg || (settings.zoteroKey && u ? `接続済み：${u.name || u.id} のライブラリ` : '');
  $('#zOff').hidden = !settings.zoteroKey;
}
function zoteroRoute(m) {
  if (!settings.zoteroKey || !zUser()) return `<p class="sub">書誌を Zotero に送ると、PDF の保管・注釈や、Word での引用に使えます。${settings.gistToken ? 'Zotero の API キーは、安全のため同期せず、端末ごとに入れます。' : ''}</p><div class="row"><button type="button" data-open-settings="zotero">Zotero と連携する</button></div>`;
  const e = inLedger(m);
  if (e?.zotero) { const url = zoteroItemUrl(zUser().name, e.zotero); return `<p class="sub">送信済みです。</p><div class="row">${url ? link(url, 'Zotero で開く', 'btnlink') : ''}</div>`; }
  return '<p class="sub">書誌・abstract・タグ・メモと、無料版へのリンクを送ります（PDF のファイルは送りません）。台帳にない論文は、台帳にも追加します。</p><div class="row"><button type="button" class="primary" data-zotero>Zotero に送る</button></div>';
}
// DOI で、すでに Zotero にある item を探す（同じ論文を二重に作らない）
async function zoteroFindByDoi(doi) {
  if (!doi) return '';
  const list = await zoteroFetch(`/users/${zUser().id}/items?q=${encodeURIComponent(doi)}&qmode=everything&itemType=-attachment&limit=5`);
  const hit = (list || []).find((x) => String(x.data?.DOI || '').toLowerCase() === doi || String(x.data?.url || '').toLowerCase().endsWith(doi));
  return hit?.key || '';
}
// 台帳の文献をまとめて送る。親 item を 50 件ずつ書き、続けて子（無料版のリンク・メモ）を書く
async function sendToZotero(entries, progress = () => {}) {
  const todo = [];
  let found = 0;
  for (const [i, e] of entries.entries()) {
    progress(`Zotero の重複を確認 ${i + 1}/${entries.length}`);
    const key = await zoteroFindByDoi(e.meta.doi);
    if (key) { e.zotero = key; e.updatedAt = nowIso(); found++; } else todo.push(e);
  }
  let sent = 0; const failed = [];
  const rand = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
  for (let i = 0; i < todo.length; i += ZOTERO_BATCH) {
    const batch = todo.slice(i, i + ZOTERO_BATCH);
    progress(`Zotero へ送信 ${Math.min(i + ZOTERO_BATCH, todo.length)}/${todo.length}`);
    // Write-Token：通信が切れて送り直しても、二重に作られない
    const res = await zoteroFetch(`/users/${zUser().id}/items`, { method: 'POST', headers: { 'Zotero-Write-Token': rand() }, body: JSON.stringify(batch.map((e) => toZoteroItem(e.meta, { tags: e.tags || [] }))) });
    const out = parseZoteroWrite(res, batch.length);
    const children = [];
    batch.forEach((e, j) => {
      if (out[j].key) { e.zotero = out[j].key; e.updatedAt = nowIso(); sent++; children.push(...zoteroChildren(e.meta, out[j].key, e.memo)); } else failed.push(`${e.meta.title}: ${out[j].error}`);
    });
    for (let k = 0; k < children.length; k += ZOTERO_BATCH) {
      // 子の失敗は書誌の送信を取り消さない（リンクとメモは Zotero 側で足せる）
      try { await zoteroFetch(`/users/${zUser().id}/items`, { method: 'POST', body: JSON.stringify(children.slice(k, k + ZOTERO_BATCH)) }); } catch (err) { failed.push(`無料版のリンク・メモ: ${zoteroErrorText(err)}`); }
    }
  }
  saveLedger();
  return { sent, found, failed };
}
async function sendCurrentToZotero() {
  const m = current;
  if (!inLedger(m)) addLedger(m, 'want');
  const e = inLedger(m);
  try {
    const r = await sendToZotero([e]);
    toast(r.sent ? 'Zotero に送りました' : r.found ? 'すでに Zotero にありました（送信済みとして記録しました）' : `送れませんでした：${r.failed.join(' / ')}`);
  } catch (err) { toast(zoteroErrorText(err)); }
  if (current === m) $('#p_cite').innerHTML = citePanel(m);
}
$('#exZotero').addEventListener('click', async () => {
  if (!settings.zoteroKey || !zUser()) { openSettings('zotero'); return; }
  const todo = ledger.filter((e) => !e.zotero);
  if (!todo.length) { toast('台帳の文献は、すべて Zotero に送信済みです'); return; }
  const btn = $('#exZotero'); btn.disabled = true;
  try {
    const r = await sendToZotero(todo, (s) => setStatus(s, true));
    setStatus(`Zotero へ ${r.sent} 件を送りました${r.found ? `（${r.found} 件はすでにありました）` : ''}${r.failed.length ? `。送れなかったもの: ${r.failed.join(' / ')}` : ''}`);
  } catch (err) { setStatus(zoteroErrorText(err)); }
  btn.disabled = false;
});
$('#zConnect').addEventListener('click', async () => {
  const key = $('#s_zkey').value.trim();
  if (!key) { renderZoteroInfo('API キーを入れてください。'); return; }
  settings.zoteroKey = key;
  renderZoteroInfo('確かめています…');
  try {
    const info = zoteroKeyInfo(await zoteroFetch('/keys/current'));
    if (!info.ok) { delete settings.zoteroUser; saveSettings(); renderZoteroInfo(info.reason); return; }
    settings.zoteroUser = { id: info.userID, name: info.username };
    saveSettings(); renderZoteroInfo(); toast('Zotero に接続しました');
    if (current) $('#p_cite').innerHTML = citePanel(current);
  } catch (err) { delete settings.zoteroUser; saveSettings(); renderZoteroInfo(zoteroErrorText(err)); }
});
$('#zOff').addEventListener('click', () => {
  delete settings.zoteroKey; delete settings.zoteroUser; saveSettings();
  $('#s_zkey').value = ''; renderZoteroInfo('接続を解除しました。Zotero 側のキーは、Zotero の設定画面から削除できます。');
  if (current) $('#p_cite').innerHTML = citePanel(current);
});

// ---------- 端末間の同期（GitHub のシークレット Gist）----------
// 台帳と設定を、本人の GitHub アカウントのシークレット Gist（bunken-hub-sync.json）に預ける。
// 別の端末では同じトークンを入れるだけで、見つけて取り込む。マージは lib.js の mergeSync が行う（新しいほうを採用・削除は墓標で伝える）。
const GH = 'https://api.github.com';
let syncing = false; let syncTimer = 0; let resync = false;
let syncState = 'off';
async function gh(path, opts = {}) {
  // GitHub API は GET を max-age=60 で返す。HTTP キャッシュを通すと、他の端末の push 直後でも最大60秒古い同期データを読み、
  // それを元に push して相手の変更を一時的に消してしまう。同期は毎回、最新を取りに行く
  const r = await fetch(GH + path, { cache: 'no-store', ...opts, headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${settings.gistToken}`, ...(opts.body ? { 'Content-Type': 'application/json' } : {}) } });
  if (!r.ok) {
    // 原因を見分けるため、残り回数・スコープ・本文の message を添える（読めなければ無いものとして扱う）
    const e = new Error('HTTP ' + r.status); e.status = r.status;
    e.step = `${opts.method || 'GET'} ${path.split('?')[0].replace(/^\/gists\/[^/]+/, '/gists/…')}`;
    e.remaining = r.headers.get('x-ratelimit-remaining'); e.scopes = r.headers.get('x-oauth-scopes');
    try { e.ghMessage = String((await r.json()).message || ''); } catch { e.ghMessage = ''; }
    throw e;
  }
  return r.json();
}
async function readGist(id) {
  const g = await gh(`/gists/${id}`);
  const f = g.files?.[SYNC_FILE];
  if (!f) return null;
  const text = f.truncated ? await (await fetch(f.raw_url)).text() : f.content;
  const data = JSON.parse(text);
  return data && data.app === 'bunken-hub' ? data : null;
}
async function findGist() {
  for (let page = 1; page <= 5; page++) {
    const list = await gh(`/gists?per_page=100&page=${page}`);
    const hit = list.find((g) => g.files?.[SYNC_FILE]);
    if (hit) return hit.id;
    if (list.length < 100) break;
  }
  return '';
}
function syncErrorText(e) {
  const t = ghErrorText({ status: e.status, token: settings.gistToken || '', remaining: e.remaining ?? null, scopes: e.scopes ?? null, message: e.ghMessage || '', step: e.step || '' });
  if (t) return t;
  if (e instanceof SyntaxError) return '同期データを読み取れませんでした。';
  return 'GitHub に接続できませんでした。通信を確かめてください。';
}
function setSyncState(state, err) {
  syncState = state;
  const b = $('#syncBtn'); b.dataset.state = state;
  const t = settings.lastSync ? new Date(settings.lastSync).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
  $('#syncLabel').textContent = { off: '同期', busy: '同期中…', ok: '同期済', error: '同期エラー', offline: '同期（オフライン）' }[state];
  b.title = { off: '他の端末と台帳・設定を同期する（設定が必要です）', busy: '同期しています', ok: `最後の同期: ${t}`, error: err ? syncErrorText(err) : '同期できませんでした', offline: 'オフラインのため、あとで同期します' }[state];
  renderSyncInfo(err);
}
function renderSyncInfo(err) {
  const el = $('#syncInfo'); if (!el) return;
  const t = settings.lastSync ? new Date(settings.lastSync).toLocaleString('ja-JP') : '';
  el.textContent = err ? syncErrorText(err) : settings.gistToken ? (t ? `最後の同期: ${t}` : '接続済みです。まだ同期していません。') : '';
  el.classList.toggle('err', !!err);
  $('#syncOff').hidden = !settings.gistToken;
}
function scheduleSync() {
  if (!settings.gistToken || settings.autoSync === false) return;
  if (syncing) { resync = true; return; }
  clearTimeout(syncTimer); syncTimer = setTimeout(() => syncNow({ quiet: true }), 2500);
}
async function syncNow({ quiet = false } = {}) {
  if (!settings.gistToken) { if (!quiet) openSettings(); return; }
  if (syncing) { if (!quiet) toast('同期しています。しばらくお待ちください'); return; }
  if (!navigator.onLine) { setSyncState('offline'); if (!quiet) toast('オフラインです。つながったら同期します'); return; }
  syncing = true; setSyncState('busy');
  try {
    let id = settings.gistId || ''; let remote = null;
    if (id) { try { remote = await readGist(id); } catch (e) { if (e.status !== 404) throw e; id = ''; } }
    if (!id) { id = await findGist(); if (id) remote = await readGist(id); }
    const r = mergeSync({ entries: ledger, tombs, settings }, remote);
    if (r.pull) applyMerged(r.next);
    if (r.push || !id) {
      const files = { [SYNC_FILE]: { content: JSON.stringify(buildSyncPayload(r.next)) } };
      if (id) await gh(`/gists/${id}`, { method: 'PATCH', body: JSON.stringify({ files }) });
      else id = (await gh('/gists', { method: 'POST', body: JSON.stringify({ description: '文献ハブの同期データ（bunken-hub）', public: false, files }) })).id;
    }
    settings.gistId = id; settings.lastSync = nowIso(); saveSettings();
    setSyncState('ok');
    if (!quiet) toast(r.pull ? '他の端末の変更を取り込みました' : r.push ? '同期しました' : '最新の状態です');
  } catch (e) {
    setSyncState('error', e);
    if (!quiet) toast(syncErrorText(e));
  } finally {
    syncing = false;
    if (resync) { resync = false; scheduleSync(); }
  }
}
// マージ結果を手元に反映する
function applyMerged(next) {
  ledger = next.entries; tombs = next.tombs;
  for (const k of SYNC_KEYS) { if (next.settings[k]) settings[k] = next.settings[k]; else delete settings[k]; }
  settings.settingsAt = next.settingsAt; settings.settingsUpdatedAt = next.settingsUpdatedAt;
  persistLedger(); saveSettings();
  renderLedger(); refreshSetup();
  if (current && $('#lctl')) $('#lctl').innerHTML = ledgerControl(current);
}
$('#syncBtn').addEventListener('click', () => { if (settings.gistToken) syncNow(); else openSettings('sync'); });
$('#syncConnect').addEventListener('click', () => {
  if (!$('#s_token').value.trim()) { toast('トークンを入れてください'); return; }
  // 同じ画面に入力したメールアドレスなども、ここで一緒に保存する（同期の対象にするため）
  const err = saveSettingsForm();
  if (err) { $('#settingsErr').textContent = err; $('#settingsErr').hidden = false; return; }
  $('#settingsErr').hidden = true;
  setSyncState('off'); syncNow();
});
$('#syncOff').addEventListener('click', () => {
  delete settings.gistToken; delete settings.gistId; delete settings.lastSync; saveSettings();
  $('#s_token').value = ''; setSyncState('off'); toast('接続を解除しました。同期データ（Gist）は GitHub に残ります');
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && settings.gistToken && settings.autoSync !== false && Date.now() - Date.parse(settings.lastSync || 0) > 60000) syncNow({ quiet: true });
});
addEventListener('online', () => { if (settings.gistToken) scheduleSync(); });

// ---------- 設定・初回案内 ----------
const sMap = { email: '#s_email', name: '#s_name', folder: '#s_folder', oakey: '#s_oakey', cinii: '#s_cinii' };
function openSettings(focus) {
  for (const [k, s] of Object.entries(sMap)) $(s).value = settings[k] || '';
  $('#s_theme').value = settings.theme || '';
  $('#s_token').value = settings.gistToken || '';
  $('#s_auto').checked = settings.autoSync !== false;
  $('#s_zkey').value = settings.zoteroKey || '';
  renderZoteroInfo();
  $('#settingsErr').hidden = true;
  renderSyncInfo();
  $('#settings').showModal();
  if (focus === 'sync') $('#s_token').focus();
  if (focus === 'zotero') $('#s_zkey').focus();
}
$('#openSettings').addEventListener('click', () => openSettings());
// 設定画面の入力を検査して保存する。問題があれば文言を返す（保存しない）
function saveSettingsForm() {
  const email = $('#s_email').value.trim();
  const folder = $('#s_folder').value.trim();
  if (email && !isEmail(email)) return 'メールアドレスの形をご確認ください。';
  if (folder && !safeUrl(folder)) return 'フォルダの URL は https:// から始まる形で入れてください。';
  const before = Object.fromEntries(SYNC_KEYS.map((k) => [k, settings[k] || '']));
  for (const [k, s] of Object.entries(sMap)) settings[k] = $(s).value.trim();
  settings.theme = $('#s_theme').value;
  const token = $('#s_token').value.trim();
  if (token !== (settings.gistToken || '')) { if (token) settings.gistToken = token; else { delete settings.gistToken; delete settings.gistId; } }
  settings.autoSync = $('#s_auto').checked;
  // Zotero のキーを書き換えて「保存」した場合は、接続を確かめ直すまで未接続として扱う
  const zkey = $('#s_zkey').value.trim();
  if (zkey !== (settings.zoteroKey || '')) { delete settings.zoteroUser; if (zkey) settings.zoteroKey = zkey; else delete settings.zoteroKey; }
  const changed = SYNC_KEYS.filter((k) => (settings[k] || '') !== before[k]);
  if (changed.length) stampSettings(changed);
  saveSettings(); applyTheme(); refreshSetup();
  return '';
}
$('#settingsForm').addEventListener('submit', (ev) => {
  if (ev.submitter?.value !== 'save') return;
  const err = saveSettingsForm();
  if (err) { ev.preventDefault(); $('#settingsErr').textContent = err; $('#settingsErr').hidden = false; return; }
  setSyncState(settings.gistToken ? (syncState === 'off' ? 'ok' : syncState) : 'off');
  toast('設定を保存しました');
  if (settings.gistToken) { if (settings.gistId) scheduleSync(); else syncNow({ quiet: true }); }
  if (current) showDetail(current);
});
// ---------- はじめの設定（おすすめの設定を順に案内する）----------
// 済んだものは一行で示し、未了のものだけ入力欄や操作を出す。値はこれまでの設定と同じ場所に保存する（メール・名前・保存先は同期の対象）。
const SETUP_TEXT = {
  email: { title: 'メールアドレスを登録', tag: '推奨', why: '無料で読める版を探す Unpaywall に必要です。アドレスは、Unpaywall・OpenAlex・Crossref への問い合わせにだけ添えます。', field: { type: 'email', ph: 'you@example.com', auto: 'email', btn: '登録' } },
  name: { title: '名前を登録', tag: '任意', why: '著者に PDF を頼む依頼文の署名に入ります。', field: { type: 'text', ph: '山田太郎', auto: 'name', btn: '登録' } },
  sync: { title: '別の端末と同期', tag: 'おすすめ', why: '台帳と設定を GitHub のシークレット Gist に預けて、スマホとパソコンで引き継ぎます。バックアップも兼ねます。' },
  install: { title: 'ホーム画面に追加', tag: 'おすすめ', why: 'アドレスバーのない全画面で開け、オフラインでも台帳を見られます。' },
  folder: { title: 'PDF の保存先フォルダを登録', tag: '任意', why: 'Google ドライブや Dropbox のフォルダの URL。論文の詳細から1クリックで開けます。', field: { type: 'url', ph: 'https://drive.google.com/drive/folders/...', auto: 'off', btn: '登録' } },
};
const setupEnv = () => ({ standalone });
function refreshSetup() {
  const steps = setupSteps(settings, setupEnv());
  const card = $('#setup');
  card.hidden = !showSetupCard(settings, setupEnv());
  if (card.hidden) return;
  // 最初に出すときだけ、メールアドレス未登録なら開き、登録済みなら折りたたむ（あとは本人の開閉を尊重する）
  if (!card.dataset.init) { card.dataset.init = '1'; $('#setupDetails').open = !settings.email; }
  // 入力途中の文字を、再描画（同期の取り込みなど）で消さない
  const typed = Object.fromEntries($$('#setupList input').map((i) => [i.name, i.value]));
  const focused = document.activeElement?.closest?.('#setupList') ? document.activeElement.name : '';
  $('#setupProg').textContent = `${steps.filter((x) => x.done).length} / ${steps.length}`;
  $('#setupList').innerHTML = steps.map(({ key, done }) => {
    const t = SETUP_TEXT[key];
    const value = key === 'email' ? settings.email : key === 'name' ? settings.name : key === 'folder' ? settings.folder : '';
    if (done) return `<li class="step done"><span class="mark" aria-hidden="true">✓</span><span class="step-b"><b>${esc(t.title)}</b><span class="sub">${esc(value ? value.replace(/^https?:\/\//, '').slice(0, 40) : '完了')}</span></span></li>`;
    let body;
    if (t.field) body = `<form data-step="${key}" class="step-form" novalidate><label class="sr" for="st_${key}">${esc(t.title)}</label><input id="st_${key}" name="${key}" type="${t.field.type}" placeholder="${esc(t.field.ph)}" autocomplete="${t.field.auto}"><button type="submit" class="primary">${t.field.btn}</button></form><p class="err" hidden></p>`;
    else if (key === 'sync') body = '<div class="row"><button type="button" class="primary" data-act="sync">設定を開く</button><span class="sub">GitHub のトークンを入れます</span></div>';
    else body = installEvent
      ? '<div class="row"><button type="button" class="primary" data-act="install">ホーム画面に追加</button></div>'
      : '<div class="row"><span class="sub">ブラウザのメニュー（iPhone は共有ボタン）から「ホーム画面に追加」を選んでください。</span><button type="button" data-act="mark">追加した</button></div>';
    return `<li class="step"><span class="mark" aria-hidden="true">${steps.findIndex((x) => x.key === key) + 1}</span><span class="step-b"><b>${esc(t.title)} <span class="req">${t.tag}</span></b><span class="sub">${esc(t.why)}</span>${body}</span></li>`;
  }).join('');
  for (const [name, v] of Object.entries(typed)) { const el = $(`#setupList input[name="${name}"]`); if (el) el.value = v; }
  if (focused) $(`#setupList input[name="${focused}"]`)?.focus();
}
$('#setupList').addEventListener('submit', (ev) => {
  const f = ev.target.closest('[data-step]'); if (!f) return;
  ev.preventDefault();
  const key = f.dataset.step; const v = $('input', f).value.trim();
  const err = !v ? '入力してください。' : key === 'email' && !isEmail(v) ? 'メールアドレスの形をご確認ください。'
    : key === 'folder' && !safeUrl(v) ? 'https:// から始まる URL を入れてください。' : '';
  const p = f.nextElementSibling;
  if (err) { p.textContent = err; p.hidden = false; return; }
  settings[key] = v; markSettingsChanged(key); refreshSetup(); toast('登録しました');
  if (key === 'email' && current?.doi) lookupDoi(current.doi, current);
});
$('#setupList').addEventListener('click', async (ev) => {
  const b = ev.target.closest('[data-act]'); if (!b) return;
  if (b.dataset.act === 'sync') openSettings('sync');
  if (b.dataset.act === 'mark') { settings.installMarked = true; saveSettings(); refreshSetup(); }
  if (b.dataset.act === 'install' && installEvent) {
    installEvent.prompt(); await installEvent.userChoice.catch(() => {});
    installEvent = null; $('#installBtn').hidden = true; refreshSetup();
  }
});
$('#setupLater').addEventListener('click', () => { settings.setupHidden = true; saveSettings(); refreshSetup(); toast('「設定」の中から、いつでも表示できます'); });
$('#setupShow').addEventListener('click', () => { delete settings.setupHidden; delete settings.setupLater; saveSettings(); $('#settings').close(); refreshSetup(); $('#setup').scrollIntoView({ block: 'start' }); });

// ---------- 使い方・ブックマークレット ----------
$('#bm').href = bookmarklet(location.origin + location.pathname);
$('#bm').addEventListener('click', (ev) => { ev.preventDefault(); toast('ブックマークバーへドラッグして登録してください'); });
$('#openAbout').addEventListener('click', () => { $('#aboutDetails').open = true; });

// ---------- 起動 ----------
$('#f').addEventListener('submit', (ev) => { ev.preventDefault(); run($('#q').value); });
$$('[data-ex]').forEach((b) => b.addEventListener('click', () => { $('#q').value = b.dataset.ex; run(b.dataset.ex); }));
document.addEventListener('keydown', (ev) => {
  if (ev.key === '/' && !ev.target.closest('input, textarea, select, [contenteditable]')) { ev.preventDefault(); $('#q').focus(); }
});
applyTheme();
renderLedger();
renderRecent();
refreshSetup();
setSyncState(settings.gistToken ? (settings.lastSync ? 'ok' : 'off') : 'off');
if (settings.gistToken && settings.autoSync !== false) setTimeout(() => syncNow({ quiet: true }), 600);
// 検索語は ?q= のほか、共有メニュー（Web Share Target）から渡される title・text・url からも受け取る
const params = new URLSearchParams(location.search);
const qp = params.get('q') || sharedQuery(params);
if (qp) { $('#q').value = qp; run(qp); }
