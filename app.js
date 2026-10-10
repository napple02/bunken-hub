'use strict';
// 文献ハブ：API 呼び出し・描画・台帳。DOM に依存しない処理は lib.js にある。

// ---------- 基本ユーティリティ ----------
const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];

const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } },
};
const SKEY = 'bunkenhub.settings.v1';
let settings = store.get(SKEY, {});
const saveSettings = () => store.set(SKEY, settings);

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
  if (settings.email) {
    try {
      const u = await getJSON(`https://api.unpaywall.org/v2/${enc}?email=${encodeURIComponent(settings.email)}`);
      if (u.is_oa) meta.isOa = true;
      for (const l of u.oa_locations || []) {
        meta.oa.push({ url: l.url_for_pdf || l.url || l.url_for_landing_page, pdf: !!l.url_for_pdf, version: l.version, host: l.repository_institution || l.host_type || '', license: l.license || '' });
      }
    } catch {}
  }
  const seen = new Set();
  meta.oa = meta.oa.filter((l) => l.url && !seen.has(l.url) && seen.add(l.url));
  if (meta.oa.length) meta.isOa = true;
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
let ledger = store.get(LKEY, []);
let recent = store.get(RKEY, []);
const lview = { status: 'all', text: '', sort: 'added' };
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
function renderCands(items, note = '') {
  lastCands = items;
  $('#candsNote').textContent = note;
  $('#candlist').innerHTML = items.map((m, i) => candHTML(m, i)).join('') ||
    '<div class="empty">見つかりませんでした。言い回しを変えるか、DOI で調べてください。</div>';
  $('#cands').hidden = false;
}
$('#candlist').addEventListener('click', (ev) => {
  const b = ev.target.closest('.cand'); if (!b) return;
  openWork(lastCands[+b.dataset.i]);
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
  return `<label class="inline">台帳: <select data-setst aria-label="台帳の状態">${Object.entries(stJa).map(([k, v]) => `<option value="${k}"${k === e.status ? ' selected' : ''}>${v}</option>`).join('')}</select></label>`;
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
    ${m.abstract ? `<details class="abs"><summary>Abstract</summary><p>${esc(m.abstract)}</p><p>${link(translateUrl(m.abstract), '日本語に翻訳する（Google 翻訳）')}</p></details>` : ''}
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
  const emailAsk = settings.email || !settings.setupLater ? '' : `<form class="inline-form" data-email-form>
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

const FORMATS = [['cite', '参考文献'], ['bib', 'BibTeX'], ['ris', 'RIS'], ['obs', 'Obsidian']];
function formatText(m, f) {
  return { cite: toCitation(m), bib: toBibTeX(m), ris: toRIS(m), obs: toObsidian(m, { status: inLedger(m)?.status, memo: inLedger(m)?.memo }) }[f];
}
function citePanel(m) {
  const fmt = settings.fmt || 'cite';
  const folder = safeUrl(settings.folder);
  const share = `${location.origin}${location.pathname}?q=${encodeURIComponent(m.doi || m.title)}`;
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
      <h3>このページへのリンク</h3>
      <pre id="c_share">${esc(share)}</pre>
      <div class="row"><button type="button" data-copy="share">コピー</button></div>
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
  const [refs, cites, rel] = await Promise.allSettled([
    m.refIds?.length ? fetchWorks(`openalex:${ids(m.refIds)}`) : Promise.resolve([]),
    fetchWorks(`cites:${m.oaid}`, '&sort=cited_by_count:desc'),
    m.relIds?.length ? fetchWorks(`openalex:${ids(m.relIds)}`) : Promise.resolve([]),
  ]);
  if (current !== m) return;
  const groups = [
    ['この論文を引用している（被引用の多い順）', cites],
    ['この論文が参照している', refs],
    ['関連する論文（OpenAlex の推定）', rel],
  ];
  related = [];
  p.innerHTML = `<div class="links">${ext}<span class="sub">引用関係を図で見る</span></div>` + groups.map(([h, r]) => {
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
  if (fb) { settings.fmt = fb.dataset.fmt; saveSettings(); $('#p_cite').innerHTML = citePanel(current); return; }
  const cb = t.closest('[data-copy]');
  if (cb) { const el = $('#c_' + cb.dataset.copy); copy(el.textContent, el); return; }
  if (t.closest('#obsSave')) { download(fileName(current).replace(/\.pdf$/, '.md'), formatText(current, 'obs'), 'text/markdown'); return; }
  const ab = t.closest('[data-add]');
  if (ab) { addLedger(current, ab.dataset.add); $('#lctl').innerHTML = ledgerControl(current); return; }
  if (t.closest('[data-open-settings]')) { openSettings(); return; }
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
  settings.email = v; saveSettings(); refreshSetup();
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
  if (!store.set(LKEY, ledger)) toast('保存できませんでした。書き出しで控えを取ってください');
  renderLedger();
}
function addLedger(m, st) {
  const ex = inLedger(m);
  if (ex) { ex.status = st; toast(`台帳の状態を「${stJa[st]}」にしました`); }
  else { ledger.unshift({ id: lid(m), status: st, memo: '', addedAt: today(), meta: m }); toast('台帳に追加しました'); }
  saveLedger();
}
function renderLedger() {
  const counts = { all: ledger.length, want: 0, have: 0, read: 0 };
  for (const e of ledger) counts[e.status] = (counts[e.status] || 0) + 1;
  $$('#ltabs [data-st]').forEach((b) => { $('.n', b).textContent = counts[b.dataset.st] || 0; });
  $('#navcount').textContent = counts.want ? counts.want : '';
  $('#navcount').title = '未入手の件数';
  $('#lcount').textContent = ledger.length ? `${ledger.length} 件` : '';
  const rows = filterLedger(ledger, lview);
  $('#ltbody').innerHTML = rows.length ? rows.map((e) => `<tr data-id="${esc(e.id)}" class="st-${e.status}">
    <td class="y">${esc(e.meta.year)}</td>
    <td><button type="button" class="linkish t" data-act="open">${esc(e.meta.title)}</button>
      <div class="sub">${esc(e.meta.authors.slice(0, 2).map(nameStr).join(', '))}${e.meta.authors.length > 2 ? ' ほか' : ''}${e.meta.venue ? ' · ' + esc(e.meta.venue) : ''}</div></td>
    <td><select aria-label="状態" data-act="st">${Object.entries(stJa).map(([k, v]) => `<option value="${k}"${k === e.status ? ' selected' : ''}>${v}</option>`).join('')}</select></td>
    <td><textarea rows="1" aria-label="メモ" data-act="memo" placeholder="メモ">${esc(e.memo)}</textarea></td>
    <td><button type="button" class="ghost" data-act="del">削除</button></td>
  </tr>`).join('') : `<tr><td colspan="5" class="empty">${ledger.length ? '条件に合う文献はありません。' : 'まだ何もありません。論文を調べて「台帳に追加」を押すと、ここに並びます。'}</td></tr>`;
  renderBackupNote();
}
const rowEntry = (el) => ledger.find((x) => x.id === el.closest('tr').dataset.id);
$('#ltbody').addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-act]'); if (!b) return;
  const e = rowEntry(b);
  if (b.dataset.act === 'open') { tab = 'get'; openWork(e.meta); }
  if (b.dataset.act === 'del') {
    if (b.dataset.confirm) { ledger = ledger.filter((x) => x !== e); saveLedger(); toast('削除しました'); }
    else { b.dataset.confirm = '1'; b.textContent = 'もう一度押すと削除'; b.classList.add('danger'); setTimeout(() => { if (b.isConnected) { b.dataset.confirm = ''; b.textContent = '削除'; b.classList.remove('danger'); } }, 3000); }
  }
});
$('#ltbody').addEventListener('change', (ev) => {
  const t = ev.target; const e = rowEntry(t);
  if (t.dataset.act === 'st') { e.status = t.value; saveLedger(); if (current && lid(current) === e.id) $('#lctl').innerHTML = ledgerControl(current); }
  if (t.dataset.act === 'memo') { e.memo = t.value; store.set(LKEY, ledger); }
});
$('#ltabs').addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-st]'); if (!b) return;
  lview.status = b.dataset.st;
  $$('#ltabs [data-st]').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
  renderLedger();
});
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
  download(`bunken-ledger_${today()}.json`, JSON.stringify(ledger, null, 2), 'application/json');
  settings.lastExport = new Date().toISOString(); saveSettings(); renderBackupNote();
}
$('#backupNote').addEventListener('click', (ev) => { if (ev.target.id === 'quickBackup') exportJson(); });
$('#exJson').addEventListener('click', exportJson);
$('#exBib').addEventListener('click', () => download(`bunken_${today()}.bib`, ledger.map((e) => toBibTeX(e.meta)).join('\n\n'), 'text/plain'));
$('#exRis').addEventListener('click', () => download(`bunken_${today()}.ris`, ledger.map((e) => toRIS(e.meta)).join('\n\n'), 'application/x-research-info-systems'));
$('#exCsv').addEventListener('click', () => {
  const q = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;
  const rows = [['状態', '年', 'タイトル', '著者', '誌名', 'DOI', 'メモ', '追加日']]
    .concat(ledger.map((e) => [stJa[e.status], e.meta.year, e.meta.title, e.meta.authors.map(nameStr).join('; '), e.meta.venue, e.meta.doi, e.memo, e.addedAt]));
  download(`bunken-ledger_${today()}.csv`, '﻿' + rows.map((r) => r.map(q).join(',')).join('\r\n'), 'text/csv');
});
$('#imJson').addEventListener('change', async (ev) => {
  const f = ev.target.files[0]; if (!f) return;
  try {
    const arr = JSON.parse(await f.text());
    if (!Array.isArray(arr)) throw new Error();
    let n = 0;
    const isWatch = arr.length && arr[0] && !arr[0].meta && 'journal' in arr[0] && 'title' in arr[0];
    if (isWatch) {
      // edu-research-watch の出力。papers.json は数千件あるのでスコア上位だけを未入手として入れる
      const top = [...arr].sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, WATCH_IMPORT_MAX);
      for (const p of top) { const m = fromWatchPaper(p); const id = lid(m); if (m.title && !ledger.some((x) => x.id === id)) { ledger.push({ id, status: 'want', memo: '', addedAt: today(), meta: m }); n++; } }
      saveLedger(); toast(`ウォッチから ${n} 件を追加しました${arr.length > WATCH_IMPORT_MAX ? `（スコア上位 ${WATCH_IMPORT_MAX} 件まで）` : ''}`);
    } else {
      for (const e of arr) { if (e && e.id && e.meta && !ledger.some((x) => x.id === e.id)) { ledger.push(e); n++; } }
      saveLedger(); toast(`${n} 件を読み込みました`);
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
    if (m) { ledger.unshift({ id: lid(m), status: 'want', memo: '', addedAt: today(), meta: m }); n++; renderLedger(); }
  }
  saveLedger(); btn.disabled = false;
  setStatus(`${dois.length} 件の DOI のうち ${n} 件を台帳に追加しました（すでにあるもの・取得できなかったものを除く）。`);
  $('#bulk').value = ''; $('#bulkCount').textContent = '';
});

// ---------- 設定・初回案内 ----------
const sMap = { email: '#s_email', name: '#s_name', folder: '#s_folder', oakey: '#s_oakey', cinii: '#s_cinii' };
function openSettings() {
  for (const [k, s] of Object.entries(sMap)) $(s).value = settings[k] || '';
  $('#settingsErr').hidden = true;
  $('#settings').showModal();
}
$('#openSettings').addEventListener('click', openSettings);
$('#settingsForm').addEventListener('submit', (ev) => {
  if (ev.submitter?.value !== 'save') return;
  const email = $('#s_email').value.trim();
  const folder = $('#s_folder').value.trim();
  const err = !email || isEmail(email) ? (!folder || safeUrl(folder) ? '' : 'フォルダの URL は https:// から始まる形で入れてください。') : 'メールアドレスの形をご確認ください。';
  if (err) { ev.preventDefault(); $('#settingsErr').textContent = err; $('#settingsErr').hidden = false; return; }
  for (const [k, s] of Object.entries(sMap)) settings[k] = $(s).value.trim();
  saveSettings(); refreshSetup(); toast('設定を保存しました');
  if (current) showDetail(current);
});
function refreshSetup() { $('#setup').hidden = !!settings.email || !!settings.setupLater; }
$('#setupForm').addEventListener('submit', (ev) => {
  ev.preventDefault();
  const v = $('#setupEmail').value.trim();
  if (!isEmail(v)) { $('#setupErr').textContent = 'メールアドレスの形をご確認ください。'; $('#setupErr').hidden = false; return; }
  settings.email = v; saveSettings(); refreshSetup(); toast('登録しました');
  if (current?.doi) lookupDoi(current.doi, current);
});
$('#setupLater').addEventListener('click', () => { settings.setupLater = true; saveSettings(); refreshSetup(); toast('あとで「設定」から登録できます'); });

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
renderLedger();
renderRecent();
refreshSetup();
const qp = new URLSearchParams(location.search).get('q');
if (qp) { $('#q').value = qp; run(qp); }
