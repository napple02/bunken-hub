// 2つの端末の同期・オフライン・共有からの検索・DOI の貼り付け・PWA の構成（GitHub の Gist は模したデータ）
// 実行: node tests/e2e/sync-pwa.mjs（harness.mjs の説明を参照）
import { start } from './harness.mjs';
const { base: BASE, browser: b, tmp, ok, stop } = await start();
let gist = null;           // 模擬の GitHub Gist（同期データ）
let gistCalls = [];
const work = (id, title) => ({ id:'https://openalex.org/'+id, doi:'https://doi.org/10.1000/'+id.toLowerCase(), title, publication_year:2015, cited_by_count:5,
  authorships:[{author:{display_name:'Yann LeCun'}}], primary_location:{source:{display_name:'Nature'}}, biblio:{}, open_access:{is_oa:false}, locations:[],
  abstract_inverted_index:{Deep:[0],learning:[1]}, referenced_works:['https://openalex.org/W2'], related_works:[] });
async function device(w, h) {
  const ctx = await b.newContext({ viewport:{width:w,height:h}, serviceWorkers:'allow', permissions: [] });
  const p = await ctx.newPage(); const errs=[]; p.on('pageerror',e=>errs.push(e.message)); p.on('console', m=>{ if(m.type()==='error' && !/Failed to load resource|net::ERR/.test(m.text())) errs.push('console: '+m.text()); });
  await ctx.route('**/*', async (r) => { const u = r.request().url(); const m = r.request().method();
    if (u.includes('fonts.g')) return r.abort();
    if (u.startsWith('https://api.github.com')) {
      const path = u.replace('https://api.github.com',''); gistCalls.push(m+' '+path.split('?')[0]);
      if (!r.request().headers()['authorization']) return r.fulfill({status:401, json:{}});
      if (m==='GET' && path.startsWith('/gists?')) return r.fulfill({json: gist ? [{id:'g1', files:{'bunken-hub-sync.json':{}}}] : []});
      if (m==='GET' && path==='/gists/g1') return r.fulfill({json:{id:'g1', files:{'bunken-hub-sync.json':{content:gist, truncated:false}}}});
      if (m==='POST' && path==='/gists') { gist = JSON.parse(r.request().postData()).files['bunken-hub-sync.json'].content; return r.fulfill({json:{id:'g1'}}); }
      if (m==='PATCH' && path==='/gists/g1') { gist = JSON.parse(r.request().postData()).files['bunken-hub-sync.json'].content; return r.fulfill({json:{id:'g1'}}); }
      return r.fulfill({status:404, json:{}});
    }
    if (u.includes('api.openalex.org/works/doi')) return r.fulfill({json: work('W1','Deep learning')});
    if (u.includes('api.openalex.org')) return r.fulfill({json:{results:[]}});
    if (/unpaywall|crossref|cir\.nii|ndlsearch/.test(u)) return r.fulfill({status:500, body:''});
    return r.continue(); });
  await p.goto(BASE + '/index.html');
  return {p, errs, ctx};
}

// --- 端末 A ---
let A = await device(1100, 900);
await A.p.waitForFunction(() => navigator.serviceWorker.getRegistration().then(r=>!!r?.active), null, { polling: 100 });
await A.p.reload(); await A.p.waitForFunction(() => !!navigator.serviceWorker.controller, null, { polling: 100 });
ok(true, 'A: Service Worker が有効');
const man = await A.p.evaluate(async () => { const l=document.querySelector('link[rel=manifest]').href; const j = await (await fetch(l)).json(); const ic = await Promise.all(j.icons.map(async i => (await fetch(new URL(i.src, l))).status)); return { name:j.name, ic, share: !!j.share_target }; });
ok(man.name==='文献ハブ' && man.ic.every(s=>s===200) && man.share, 'A: manifest とアイコンを取得できる ' + JSON.stringify(man.ic));
await A.p.click('#openSettings'); await A.p.fill('#s_email','me@example.com'); await A.p.fill('#s_name','山田太郎'); await A.p.fill('#s_token','tkn-abc');
await A.p.click('#syncConnect'); await A.p.waitForFunction(() => document.querySelector('#syncBtn').dataset.state==='ok', null, { polling: 100 });
ok(!!gist && JSON.parse(gist).settings.email==='me@example.com', 'A: 接続すると Gist が作られ、設定が入る');
ok(!gist.includes('tkn-abc'), 'A: トークンは同期データに入らない');
await A.p.keyboard.press('Escape');
await A.p.fill('#q','10.1000/w1'); await A.p.press('#q','Enter'); await A.p.waitForSelector('#detail:not([hidden]) .banner');
await A.p.click('[data-add=want]');
await A.p.waitForFunction(() => true, null, { polling: 100 }); await new Promise(r=>setTimeout(r,3500));
ok(JSON.parse(gist).ledger.length===1, 'A: 台帳への追加が自動で Gist に反映される');
ok(JSON.parse(gist).ledger[0].meta.refIds===undefined, 'A: 同期データの書誌は軽量化されている');

// --- 端末 B（まっさらな端末）---
let B = await device(400, 860);
ok(await B.p.isVisible('#setup'), 'B: 初回は「はじめの設定」が出る');
await B.p.click('#syncBtn'); await B.p.waitForSelector('#settings[open]'); await B.p.fill('#s_token','tkn-abc'); await B.p.click('#syncConnect');
await B.p.waitForFunction(() => document.querySelector('#syncBtn').dataset.state==='ok', null, { polling: 100 });
const bState = await B.p.evaluate(() => ({ n: document.querySelectorAll('#ltbody tr[data-id]').length, prog: document.querySelector('#setupProg').textContent.trim(), email: JSON.parse(localStorage.getItem('bunkenhub.settings.v1')).email }));
ok(bState.n===1 && bState.prog==='3 / 5' && bState.email==='me@example.com', 'B: トークンを入れるだけで台帳と設定が届く ' + JSON.stringify(bState));
await B.p.keyboard.press('Escape');
// B で削除 → A に伝わる
const del = B.p.locator('#ltbody [data-act=del]'); await del.click(); await del.click();
await new Promise(r=>setTimeout(r,3500));
ok(JSON.parse(gist).ledger.length===0 && JSON.parse(gist).tombs.length===1, 'B: 削除が墓標として Gist に反映される');
await A.p.click('#syncBtn'); await A.p.waitForFunction(() => document.querySelectorAll('#ltbody tr[data-id]').length===0, null, { polling: 100 });
ok(true, 'A: 同期すると B での削除が反映される');
// B でメモ編集、A と同時編集でも合流
await A.p.fill('#q','10.1000/w1'); await A.p.press('#q','Enter'); await A.p.waitForSelector('#detail:not([hidden]) .banner'); await A.p.click('[data-add=want]'); await A.p.selectOption('[data-setst]','have');
await new Promise(r=>setTimeout(r,3500));
await B.p.click('#syncBtn'); await B.p.waitForFunction(() => document.querySelectorAll('#ltbody tr[data-id]').length===1, null, { polling: 100 });
ok(await B.p.locator('#ltbody select').inputValue()==='have', 'B: A で入れ直した文献（再追加）が届く');

// --- オフライン ---
await A.ctx.setOffline(true); await A.p.reload();
ok((await A.p.title())==='文献ハブ', 'A: オフラインでも画面が開く');
ok(await A.p.isVisible('#offline'), 'A: オフラインの表示が出る');
ok(await A.p.locator('#ltbody tr[data-id]').count()===1, 'A: オフラインでも台帳が見られる');
await A.ctx.setOffline(false);

// --- 共有メニュー ---
await A.p.goto(BASE + '/index.html?title=Deep%20learning&text=' + encodeURIComponent('https://doi.org/10.1000/w1'));
await A.p.waitForSelector('#detail:not([hidden]) .title');
ok((await A.p.textContent('#detail .title')).includes('Deep learning') && (await A.p.textContent('#detail .biblio')).includes('OpenAlex'), '共有された URL の DOI から論文が開く（OpenAlex の書誌）');
// 貼り付け
await A.p.goto(BASE + '/index.html'); await A.p.evaluate(() => { const q=document.querySelector('#q'); q.focus(); q.value='https://doi.org/10.1000/w1'; q.dispatchEvent(new Event('paste')); });
await A.p.waitForSelector('#detail:not([hidden]) .title'); ok(true, '検索欄に DOI を貼ると自動で調べる');

// 解除
await A.p.click('#openSettings'); await A.p.click('#syncOff'); ok(await A.p.evaluate(()=>!JSON.parse(localStorage.getItem('bunkenhub.settings.v1')).gistToken), 'A: 接続を解除するとトークンが消える');
console.log('A errors', A.errs, 'B errors', B.errs);
console.log('gist calls', [...new Set(gistCalls)]);
await stop();
