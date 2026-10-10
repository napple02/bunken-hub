// 無料版の探索先・候補の絞り込み・引用形式・★とタグ・Obsidian の ZIP・CSP（外部 API は模したデータ）
// 実行: node tests/e2e/features.mjs（harness.mjs の説明を参照）
import { start } from './harness.mjs';
const { base: BASE, browser: b, tmp, ok, stop } = await start();
import { execFileSync } from 'node:child_process';
const ctx = await b.newContext({ viewport:{width:1100,height:1000}, acceptDownloads: true }); const p = await ctx.newPage();
const errs=[]; p.on('pageerror',e=>errs.push(e.message)); p.on('console', m=>{ if(m.type()==='error' && !/Failed to load resource|net::ERR/.test(m.text())) errs.push('console: '+m.text()); });
const calls = new Set();
const work = (id, title, extra={}) => ({ id:'https://openalex.org/'+id, doi:'https://doi.org/10.1000/'+id.toLowerCase(), title, publication_year:2015, cited_by_count:5,
  authorships:[{author:{display_name:'Yann LeCun'}}], primary_location:{source:{display_name:'Nature'}}, biblio:{}, open_access:{is_oa:false}, locations:[], referenced_works:[], related_works:[], ...extra });
await ctx.route('**/*', async (r) => { const u = r.request().url();
  if (u.includes('fonts.g')) return r.abort();
  if (u.startsWith('http://localhost')) return r.continue();
  calls.add(new URL(u).hostname);
  if (u.includes('api.openalex.org/works/doi')) return r.fulfill({json: work('W1','Deep learning')});
  if (u.includes('api.openalex.org/works?search')) return r.fulfill({json:{results:[
    work('W1','Deep learning',{publication_year:2015,cited_by_count:50000,open_access:{is_oa:true}}),
    work('W5','分子模型を用いた授業実践',{publication_year:2022,cited_by_count:2,primary_location:{source:{display_name:'化学と教育'}}}),
    work('W6','Molecular models in class',{publication_year:2019,cited_by_count:30})]}});
  if (u.includes('api.openalex.org')) return r.fulfill({json:{results:[]}});
  if (u.includes('ebi.ac.uk')) return r.fulfill({json:{resultList:{result:[{pmcid:'PMC1',isOpenAccess:'Y',abstractText:'<p>Europe abstract.</p>',fullTextUrlList:{fullTextUrl:[{availability:'Open access',documentStyle:'pdf',url:'https://europepmc.org/x.pdf'}]}}]}}});
  if (u.includes('semanticscholar')) return r.fulfill({json:{openAccessPdf:{url:'https://s2.example/a.pdf'},tldr:{text:'A one line summary.'},abstract:'S2 abstract'}});
  if (/unpaywall|crossref|cir\.nii|ndlsearch/.test(u)) return r.fulfill({status:500, body:''});
  return r.fulfill({status:500, body:''}); });
await p.goto(BASE + '/index.html');

// --- タイトル検索の絞り込み ---
await p.fill('#q','molecular'); await p.press('#q','Enter'); await p.waitForSelector('#cands:not([hidden]) .cand');
ok(await p.locator('#candlist .cand').count()===3, '候補が3件');
await p.click('#fOa'); ok(await p.locator('#candlist .cand').count()===1, '「無料版ありのみ」で1件');
await p.click('#fOa'); await p.click('#fJa'); ok(await p.locator('#candlist .cand').count()===1 && (await p.textContent('#candlist .cand')).includes('分子模型'), '「日本語のみ」で日本語の1件');
await p.click('#fJa'); await p.selectOption('#cSort','year');
ok((await p.locator('#candlist .t').first().textContent())==='分子模型を用いた授業実践', '新しい順に並ぶ');
await p.selectOption('#cSort','cited'); ok((await p.locator('#candlist .t').first().textContent())==='Deep learning', '被引用の多い順に並ぶ');

// --- 無料版の探索先（Europe PMC・Semantic Scholar）---
await p.locator('#candlist .cand').first().click(); await p.waitForSelector('#detail:not([hidden]) .banner');
const banner = await p.textContent('#detail .banner.free, #detail .banner');
ok(banner.includes('無料で PDF'), '無料版の帯が出る（Europe PMC / Semantic Scholar 由来）');
const links = await p.locator('#p_get .list a').evaluateAll(a => a.map(x => x.href));
ok(links.some(l => l.includes('europepmc.org')) && links.some(l => l.includes('s2.example')), '無料版の一覧に Europe PMC と Semantic Scholar が並ぶ');
ok((await p.textContent('#detail .tldr')).includes('A one line summary.'), 'TLDR（一行要約）が出る');
await p.click('#detail .abs summary'); ok((await p.textContent('#detail .abs')).includes('Europe abstract.'), 'abstract が無いときは Europe PMC のものを使う');

// --- 引用形式 ---
await p.click('#t_cite');
for (const [k, re] of [['csl', /"type": "article-journal"/], ['md', /\[Deep learning\]\(https:\/\/doi\.org\/10\.1000\/w1\)/]]) { await p.click('[data-fmt='+k+']'); ok(re.test(await p.textContent('#c_fmt')), '形式: '+k); }

// --- 台帳: ★・タグ・絞り込み・ZIP ---
await p.click('#t_get'); await p.click('[data-add=want]');
await p.click('#detail [data-star]'); ok(await p.locator('#ltbody .star[aria-pressed=true]').count()===1, '詳細の★が台帳に反映される');
await p.fill('#ltbody .taginput','#分数'); await p.press('#ltbody .taginput','Enter');
await p.fill('#ltbody .taginput','授業'); await p.press('#ltbody .taginput','Enter');
ok((await p.locator('#ltbody .tchip').allTextContents()).join('|').includes('#分数') && (await p.locator('#ltbody .tchip').count())===2, 'タグを2つ付けられる（# は除かれる）');
ok(await p.locator('#ltag option').count()===3, 'タグの絞り込み欄ができる');
await p.selectOption('#ltag','授業'); ok(await p.locator('#ltbody tr[data-id]').count()===1, 'タグで絞り込める');
await p.selectOption('#ltag',''); await p.click('#lstar'); ok(await p.locator('#ltbody tr[data-id]').count()===1, '★のみで絞り込める');
await p.click('#ltbody [data-act=tagrm][data-tag=分数]'); ok((await p.locator('#ltbody .tchip').count())===1, 'タグを外せる');
await p.click('#ledger summary:has-text("書き出し")');
const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#exObs')]);
const zipPath = tmp + '/dl.zip'; await dl.saveAs(zipPath);
const py = execFileSync('python3', ['-c', 'import zipfile,sys;z=zipfile.ZipFile(sys.argv[1]);print(z.testzip());print("\\n".join(z.namelist()));print(z.read([n for n in z.namelist() if "Deep" in n][0]).decode())', zipPath]).toString();
ok(py.startsWith('None') && py.includes('00_文献一覧.md') && py.includes('tags: ["文献", "bunken-hub", "授業"]') && py.includes('star: true'), 'Obsidian ノートの ZIP を書き出せる（タグと★つき）');
// 同期データにタグが入る（再読み込みしても残る）
await p.reload(); ok((await p.locator('#ltbody .tchip').count())===1, 'タグは再読み込み後も残る');
// --- edu-research-watch の週次バッファ（{schema_version, items}）を読み込む ---
await p.locator('#imJson').setInputFiles({ name: 'weekly_buffer.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ schema_version: 1, items: [
  { title: 'Fraction tutoring trial', journal: 'Learning and Instruction', published: '2026-09-29', doi: '10.1000/watch1', design: ['rct'], oa_status: 'gold', oa_url: 'https://pub.example/w1', score: 9 }] })) });
await p.waitForSelector('#ltbody tr[data-id="10.1000/watch1"]');
const wrow = await p.textContent('#ltbody tr[data-id="10.1000/watch1"]');
ok(wrow.includes('#ウォッチ') && wrow.includes('#RCT'), 'ウォッチの週次バッファを読み込み、研究デザインがタグになる');
console.log('通信先:', [...calls].sort().join(', '));
console.log('errors', errs);
await stop();
