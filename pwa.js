'use strict';
// アプリとしての振る舞い：オフライン用の控え、ホーム画面へ追加、オフライン表示、更新のお知らせ、貼り付けて調べる。
// app.js のあとに読み込む（$・toast・parseInput・run を使う）。

// ---------- Service Worker（http・https のときだけ）----------
if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('sw.js').catch(() => {});
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController) $('#update').hidden = false; });
}
$('#reload').addEventListener('click', () => location.reload());

// ---------- ホーム画面へ追加 ----------
// installEvent と standalone は app.js にある
addEventListener('beforeinstallprompt', (ev) => { ev.preventDefault(); installEvent = ev; if (!standalone) $('#installBtn').hidden = false; refreshSetup(); });
addEventListener('appinstalled', () => { installEvent = null; settings.installMarked = true; saveSettings(); $('#installBtn').hidden = true; refreshSetup(); toast('ホーム画面に追加しました'); });
$('#installBtn').addEventListener('click', async () => {
  if (!installEvent) return;
  installEvent.prompt();
  await installEvent.userChoice.catch(() => {});
  installEvent = null; $('#installBtn').hidden = true; refreshSetup();
});
document.documentElement.classList.toggle('standalone', standalone);

// ---------- オフライン表示 ----------
const showOffline = () => { $('#offline').hidden = navigator.onLine; };
addEventListener('online', showOffline); addEventListener('offline', showOffline); showOffline();

// ---------- 貼り付けて調べる ----------
async function pasteAndSearch() {
  try {
    const text = (await navigator.clipboard.readText()).trim();
    if (!text) { toast('クリップボードが空です'); return; }
    $('#q').value = text; run(text);
  } catch {
    $('#q').focus(); toast('貼り付けを許可できませんでした。検索欄に Ctrl+V（⌘V）で貼り付けてください');
  }
}
$('#pasteBtn').addEventListener('click', pasteAndSearch);
// 検索欄へ DOI を貼り付けたら、Enter を待たずに調べる
$('#q').addEventListener('paste', () => setTimeout(() => { const p = parseInput($('#q').value); if (p && p.kind === 'doi') run($('#q').value); }, 0));
