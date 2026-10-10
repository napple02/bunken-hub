// 保存してある表示テーマを、画面を描く前に適用する（ちらつき防止）。CSP のため、インラインではなく別ファイルにしている。
try { const t = JSON.parse(localStorage.getItem('bunkenhub.settings.v1') || '{}').theme; if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t; } catch (e) {}
