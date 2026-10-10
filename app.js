'use strict';
// ---------- 基本ユーティリティ ----------
const $ = (s) => document.querySelector(s);

const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } },
};
let settings = store.get('bunkenhub.settings.v1', {});

function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => { t.hidden = true; }, 1800);
}
async function copy(text, el) {
  try { await navigator.clipboard.writeText(text); toast('コピーしました'); }
  catch { if (el) { const r = document.createRange(); r.selectNodeContents(el); const s = getSelection(); s.removeAllRanges(); s.addRange(r); } toast('選択しました。Ctrl+C でコピーしてください'); }
}
async function getJSON(url, opts = {}, ms = 12000) {
  const ac = new AbortController(); const tm = setTimeout(() => ac.abort(), ms);
  try {
    const r = await fetch(url, { ...opts, signal: ac.signal });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } finally { clearTimeout(tm); }
}
const setStatus = (s) => { $('#status').textContent = s; };

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


// ---------- 描画 ----------
let current = null;
function renderCands(items) {
  const box = $('#candlist');
  box.innerHTML = items.map((m, i) => `<button type="button" class="cand" data-i="${i}">
    <span class="t">${esc(m.title)}</span>
    <span class="m"><span class="tag src">${esc(m.source)}</span>${esc(m.authors.slice(0, 3).map(nameStr).join(', '))}${m.authors.length > 3 ? ' ほか' : ''} · ${esc(m.year)} · ${esc(m.venue)}${m.isOa ? ' <span class="tag oa">OA</span>' : ''}${m.digital ? ' <span class="tag oa">デジコレ</span>' : ''}</span>
  </button>`).join('') || '<div class="empty">見つかりませんでした。言い回しを変えるか、下の検索リンクを使ってください。</div>';
  box.querySelectorAll('.cand').forEach((b) => b.addEventListener('click', async () => {
    const m = items[+b.dataset.i];
    if (m.doi) { await lookupDoi(m.doi, m); } else { showDetail(m); }
  }));
  $('#cands').hidden = false;
}

function showDetail(m) {
  current = m;
  const d = $('#detail');
  const doiUrl = m.doi ? `https://doi.org/${m.doi}` : '';
  const oaItems = m.oa.map((l) => `<li><a href="${esc(safeUrl(l.url))}" target="_blank" rel="noopener">${esc(l.host || (l.url.split("/")[2] || l.url))}</a> <span class="tag oa">${l.pdf ? 'PDF' : 'ページ'}</span>${verJa[l.version] ? `<span class="sub">${verJa[l.version]}</span>` : ''}${l.license ? ` <span class="sub">${esc(l.license)}</span>` : ''}</li>`).join('');
  const folder = safeUrl(settings.folder);
  d.innerHTML = `
    <div class="biblio">
      <p class="title">${esc(m.title)}</p>
      ${m.title_ja ? `<div class="m">訳題: ${esc(m.title_ja)}</div>` : ''}
      <div class="m">${esc(m.authors.map(nameStr).join(', ') || '著者不明')}</div>
      <div class="m">${esc([m.venue, m.volume && (m.volume + (m.issue ? '(' + m.issue + ')' : '')), m.pages, m.year].filter(Boolean).join(' · '))}</div>
      <div class="m mono">${m.doi ? `DOI: <a href="${esc(doiUrl)}" target="_blank" rel="noopener">${esc(m.doi)}</a>` : (safeUrl(m.landing) ? `<a href="${esc(m.landing)}" target="_blank" rel="noopener">${esc(m.landing)}</a>` : '')}
      <span class="tag src">${esc(m.source)}</span>${m.cited != null ? `<span class="sub">被引用 ${m.cited}</span>` : ''}</div>
      ${m.abstract ? `<details class="abs"><summary>Abstract</summary><p>${esc(m.abstract)}</p></details>` : ''}
    </div>
    <div class="grid2">
      <div class="route">
        <h3>① 無料で読める版</h3>
        ${oaItems ? `<ul>${oaItems}</ul>` : `<div class="empty">見つかっていません。${settings.email ? '' : '設定でメールアドレスを入れると Unpaywall も調べます。'}②の検索で別バージョン（著者最終稿・紀要・博士論文など）が見つかることがあります。</div>`}
      </div>
      <div class="route">
        <h3>② 横断して探す</h3>
        <div class="links">${searchLinks(m).map(([n, u]) => `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(n)}</a>`).join('')}</div>
        <span class="sub">Google Scholar では検索結果の「すべてのバージョン」も確認してください。</span>
      </div>
      <div class="route">
        <h3>③ 手続きして入手する</h3>
        <ul>
          ${doiUrl || safeUrl(m.landing) ? `<li><a href="${esc(doiUrl || m.landing)}" target="_blank" rel="noopener">出版社のページ</a> <span class="tag pay">購入</span><span class="sub">単品購入・レンタルの有無</span></li>` : ''}
          <li><a href="https://www.ndl.go.jp/jp/copy/remote/index.html" target="_blank" rel="noopener">国立国会図書館 遠隔複写</a> <span class="tag pay">有料</span><span class="sub">利用者登録して複写を郵送で取り寄せ</span></li>
          <li><a href="https://www.ndl.go.jp/jp/use/digital_transmission/individuals_index.html" target="_blank" rel="noopener">個人向けデジタル化資料送信</a> <span class="sub">絶版などで入手困難な資料を自宅で閲覧</span></li>
          <li>最寄りの公共図書館の相互貸借・複写取り寄せ</li>
        </ul>
      </div>
      <div class="route">
        <div class="copyrow"><h3>④ 著者に頼む</h3><button type="button" data-copy="mail">文面をコピー</button></div>
        <pre id="c_mail">${esc(requestMail(m))}</pre>
      </div>
    </div>
    <div class="grid2">
      <div class="route">
        <div class="copyrow"><h3>参考文献の表記</h3><button type="button" data-copy="cite">コピー</button></div>
        <pre id="c_cite">${esc(toCitation(m))}</pre>
        <div class="copyrow"><h3>BibTeX</h3><button type="button" data-copy="bib">コピー</button></div>
        <pre id="c_bib">${esc(toBibTeX(m))}</pre>
      </div>
      <div class="route">
        <div class="copyrow"><h3>保存するときのファイル名</h3><button type="button" data-copy="fn">コピー</button></div>
        <pre id="c_fn">${esc(fileName(m))}</pre>
        ${folder ? `<div class="links"><a href="${esc(folder)}" target="_blank" rel="noopener">保存先フォルダを開く</a></div>` : '<span class="sub">設定で保存先フォルダを登録すると、ここから開けます。</span>'}
        <div class="copyrow" style="margin-top:8px"><h3>Obsidian ノート</h3><span><button type="button" data-copy="obs">コピー</button> <button type="button" id="obsSave">.md で保存</button></span></div>
        <pre id="c_obs" hidden>${esc(toObsidian(m))}</pre>
        <h3 style="margin-top:8px">台帳</h3>
        <div class="links" style="gap:8px">
          <button type="button" class="primary" data-add="want">未入手として追加</button>
          <button type="button" data-add="have">入手済として追加</button>
        </div>
      </div>
    </div>`;
  d.hidden = false;
  d.querySelectorAll('[data-copy]').forEach((b) => b.addEventListener('click', () => { const el = $('#c_' + b.dataset.copy); copy(el.textContent, el); }));
  $('#obsSave').addEventListener('click', () => download(fileName(m).replace(/\.pdf$/, '.md'), toObsidian(m), 'text/markdown'));
  d.querySelectorAll('[data-add]').forEach((b) => b.addEventListener('click', () => addLedger(m, b.dataset.add)));
  d.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
}

async function lookupDoi(doi, fallback) {
  setStatus(`DOI ${doi} を調べています…`);
  const m = await byDoi(doi);
  if (m) { setStatus(`${m.source} から取得しました。`); showDetail(m); }
  else if (fallback) { setStatus('DOI で詳細を取得できなかったため、検索結果の情報を表示しています。'); showDetail({ ...fallback, oa: fallback.oa || [] }); }
  else { setStatus('この DOI の書誌を取得できませんでした。DOI が正しいか確認するか、タイトルで検索してください。'); }
}

async function run(raw) {
  const p = parseInput(raw);
  if (!p) return;
  $('#detail').hidden = true;
  if (p.kind === 'doi') { $('#cands').hidden = true; return lookupDoi(p.doi); }
  if (p.kind === 'url') { $('#cands').hidden = true; setStatus('この URL から DOI を見つけられませんでした。論文のタイトルで検索してください。'); return; }
  setStatus(`「${p.q}」を検索しています…`);
  const { items, ciniiOk, ndlOk } = await byTitle(p.q);
  const miss = [!ciniiOk && 'CiNii', !ndlOk && 'NDL'].filter(Boolean);
  setStatus(`${items.length} 件の候補。${miss.length ? miss.join('・') + ' は画面内に出せなかったので、詳細の「横断して探す」から開いてください。' : ''}`);
  renderCands(items);
  if (!items.length) showDetail({ source: '入力', title: p.q, authors: [], year: '', venue: '', doi: '', oa: [], isOa: false });
}

// ---------- 台帳 ----------
const LKEY = 'bunkenhub.ledger.v1';
const WATCH_IMPORT_MAX = 50;
let ledger = store.get(LKEY, []);
let ltab = 'all';
const stJa = { want: '未入手', have: '入手済', read: '読了' };
const lid = (m) => m.doi || (m.title || '').toLowerCase().replace(/\s+/g, '').slice(0, 80);
function saveLedger() { if (!store.set(LKEY, ledger)) toast('保存できませんでした。書き出しで控えを取ってください'); renderLedger(); }
function addLedger(m, st) {
  const id = lid(m);
  const ex = ledger.find((e) => e.id === id);
  if (ex) { ex.status = st; toast('台帳の状態を更新しました'); }
  else { ledger.unshift({ id, status: st, memo: '', addedAt: new Date().toISOString().slice(0, 10), meta: m }); toast('台帳に追加しました'); }
  saveLedger();
}
function renderLedger() {
  const rows = ledger.filter((e) => ltab === 'all' || e.status === ltab);
  $('#lcount').textContent = `${ledger.length} 件（未入手 ${ledger.filter((e) => e.status === 'want').length}）`;
  $('#ltbody').innerHTML = rows.length ? rows.map((e) => `<tr data-id="${esc(e.id)}">
    <td class="y">${esc(e.meta.year)}</td>
    <td><div class="t">${esc(e.meta.title)}</div><div class="sub">${esc(e.meta.authors.slice(0, 2).map(nameStr).join(', '))}${e.meta.authors.length > 2 ? ' ほか' : ''} · ${esc(e.meta.venue)}</div></td>
    <td><select aria-label="状態">${Object.entries(stJa).map(([k, v]) => `<option value="${k}"${k === e.status ? ' selected' : ''}>${v}</option>`).join('')}</select></td>
    <td><textarea rows="1" aria-label="メモ">${esc(e.memo)}</textarea></td>
    <td><button type="button" data-act="open">開く</button> <button type="button" data-act="del">削除</button></td>
  </tr>`).join('') : `<tr><td colspan="5" class="empty">${ledger.length ? 'この状態の文献はありません。' : 'まだ何もありません。上で論文を調べて「台帳に追加」を押すと、ここに並びます。'}</td></tr>`;
  $('#ltbody').querySelectorAll('tr[data-id]').forEach((tr) => {
    const e = ledger.find((x) => x.id === tr.dataset.id);
    tr.querySelector('select').addEventListener('change', (ev) => { e.status = ev.target.value; saveLedger(); });
    tr.querySelector('textarea').addEventListener('change', (ev) => { e.memo = ev.target.value; store.set(LKEY, ledger); });
    tr.querySelector('[data-act=open]').addEventListener('click', () => showDetail(e.meta));
    const del = tr.querySelector('[data-act=del]');
    del.addEventListener('click', () => {
      if (del.dataset.confirm) { ledger = ledger.filter((x) => x !== e); saveLedger(); }
      else { del.dataset.confirm = '1'; del.textContent = '本当に削除'; setTimeout(() => { del.dataset.confirm = ''; del.textContent = '削除'; }, 3000); }
    });
  });
}
function download(name, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
const today = () => new Date().toISOString().slice(0, 10);
$('#exJson').addEventListener('click', () => download(`bunken-ledger_${today()}.json`, JSON.stringify(ledger, null, 2), 'application/json'));
$('#exBib').addEventListener('click', () => download(`bunken_${today()}.bib`, ledger.map((e) => toBibTeX(e.meta)).join('\n\n'), 'text/plain'));
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
      return;
    }
    for (const e of arr) { if (e && e.id && e.meta && !ledger.some((x) => x.id === e.id)) { ledger.push(e); n++; } }
    saveLedger(); toast(`${n} 件を読み込みました`);
  } catch { toast('読み込めませんでした。このツールか edu-research-watch が書き出した JSON を選んでください'); }
  ev.target.value = '';
});
$('#ltabs').addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-st]'); if (!b) return;
  ltab = b.dataset.st;
  $('#ltabs').querySelectorAll('button').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
  renderLedger();
});

// ---------- 設定・起動 ----------
const sMap = { email: '#s_email', oakey: '#s_oakey', cinii: '#s_cinii', folder: '#s_folder' };
for (const [k, s] of Object.entries(sMap)) $(s).value = settings[k] || '';
$('#s_save').addEventListener('click', () => {
  for (const [k, s] of Object.entries(sMap)) settings[k] = $(s).value.trim();
  store.set('bunkenhub.settings.v1', settings); toast('設定を保存しました');
});
$('#f').addEventListener('submit', (ev) => { ev.preventDefault(); run($('#q').value); });
document.querySelectorAll('[data-ex]').forEach((b) => b.addEventListener('click', () => { $('#q').value = b.dataset.ex; run(b.dataset.ex); }));
$('#bulkAdd').addEventListener('click', async () => {
  const dois = extractDois($('#bulk').value);
  if (!dois.length) { toast('DOI が見つかりませんでした'); return; }
  const btn = $('#bulkAdd'); btn.disabled = true;
  let n = 0;
  for (const [i, doi] of dois.entries()) {
    setStatus(`まとめて追加 ${i + 1}/${dois.length}: ${doi}`);
    if (ledger.some((x) => x.id === doi)) continue;
    const m = await byDoi(doi);
    if (m) { ledger.push({ id: lid(m), status: 'want', memo: '', addedAt: today(), meta: m }); n++; }
  }
  saveLedger(); btn.disabled = false;
  setStatus(`${dois.length} 件の DOI のうち ${n} 件を台帳に追加しました（既にあるもの・取得できなかったものは除く）。`);
  $('#bulk').value = '';
});
renderLedger();
const qp = new URLSearchParams(location.search).get('q');
if (qp) { $('#q').value = qp; run(qp); }
else if (!settings.email) setStatus('最初に下の「設定」でメールアドレスを入れておくと、無料で読める版の検出が強くなります。');
