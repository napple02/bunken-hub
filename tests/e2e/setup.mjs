// 「はじめの設定」の一連の操作（検査・入力途中の保持・折りたたみ・あとで・再表示・完了）
// 実行: node tests/e2e/setup.mjs（harness.mjs の説明を参照）
import { start } from './harness.mjs';
const { base: BASE, browser: b, tmp, ok, stop } = await start();
const ctx = await b.newContext({ viewport:{width:420,height:900} }); const p = await ctx.newPage(); const errs=[]; p.on('pageerror',e=>errs.push(e.message));
await ctx.route('**/*', (r) => { const u = r.request().url(); if (u.startsWith('http://localhost')) return r.continue(); if (u.startsWith('https://api.openalex.org/works/doi')) return r.fulfill({json:{id:'https://openalex.org/W1',doi:'https://doi.org/10.1000/w1',title:'Deep learning',publication_year:2015,authorships:[],locations:[],primary_location:{},biblio:{}}}); return r.fulfill({status:500, body:''}); });
await p.goto(BASE + '/index.html');
const prog = () => p.textContent('#setupProg');
ok(await p.isVisible('#setup') && (await prog()).trim()==='0 / 5', '初回は 0 / 5 で表示される');
ok(await p.evaluate(()=>document.querySelector('#setupDetails').open), '初回（メール未登録）は開いている');
// 入力チェック
await p.fill('#st_email','bad'); await p.click('[data-step=email] button'); 
ok((await p.textContent('[data-step=email] + .err')).includes('形'), 'メールアドレスの形が違うと、その場で知らせる');
// 入力途中の文字は、別の項目を登録しても消えない
await p.fill('#st_folder','https://drive.google.com/drive/folders/abc');
await p.fill('#st_email','me@example.com'); await p.click('[data-step=email] button');
ok((await prog()).trim()==='1 / 5' && await p.inputValue('#st_folder')==='https://drive.google.com/drive/folders/abc', 'メール登録で 1 / 5。入力途中のフォルダ URL は残る');
await p.click('[data-step=folder] button'); ok((await prog()).trim()==='2 / 5', 'フォルダ登録で 2 / 5');
await p.fill('#st_name','山田太郎'); await p.press('#st_name','Enter'); ok((await prog()).trim()==='3 / 5', '名前は Enter でも登録できる');
const saved = await p.evaluate(() => JSON.parse(localStorage.getItem('bunkenhub.settings.v1')));
ok(saved.email==='me@example.com' && saved.name==='山田太郎' && saved.folder.startsWith('https://drive') && !!saved.settingsUpdatedAt, '設定は保存され、同期の対象（更新時刻）になる');
ok(await p.isVisible('text=ブラウザのメニュー'), 'インストールの案内（iPhone など自動で出せない場合）が出る');
// 同期ボタン → 設定が開く
await p.click('[data-act=sync]'); ok(await p.isVisible('#settings') && await p.evaluate(() => document.activeElement.id)==='s_token', '「設定を開く」で同期のトークン欄に移る');
await p.keyboard.press('Escape');
// あとで → 非表示、設定から再表示
await p.click('#setupLater'); ok(await p.isHidden('#setup'), '「あとで」で閉じる');
await p.reload(); ok(await p.isHidden('#setup'), '再読み込みしても閉じたまま');
await p.click('#openSettings'); await p.click('#setupShow');
ok(await p.evaluate(()=>!document.querySelector('#setupDetails').open), 'メール登録済みなら、再表示しても折りたたまれている');
await p.click('#setup summary'); ok(await p.evaluate(()=>document.querySelector('#setupDetails').open), 'タイトルを押すと開く');
ok(await p.isVisible('#setup'), '設定から再表示できる');
await p.click('[data-act=mark]'); ok((await prog()).trim()==='4 / 5', '「追加した」で 4 / 5');
// 最後の項目（同期）はトークンで完了 → 全部済むと消える
await p.click('#openSettings'); await p.fill('#s_token','tkn'); await p.click('#s_save');
await p.waitForTimeout(300); ok(await p.isHidden('#setup'), '全部済むとカードが消える');
console.log('errors', errs); await stop();
