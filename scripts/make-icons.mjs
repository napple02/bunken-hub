// アイコンの PNG を書き出す。実行: node scripts/make-icons.mjs（Playwright と Chromium が必要）
// 図柄は「真ん中の論文と、そこへつながる3つの入手先」。maskable は端まで塗り、図柄を中央の安全域に収める。
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const BG = '#1f5f6b';
const mark = `
  <g stroke="#ffffff" stroke-width="12" stroke-linecap="round" opacity=".72">
    <line x1="186" y1="214" x2="150" y2="190"/><line x1="186" y1="298" x2="150" y2="322"/><line x1="336" y1="256" x2="376" y2="256"/>
  </g>
  <g fill="#ffffff"><circle cx="124" cy="176" r="26"/><circle cx="124" cy="336" r="26"/><circle cx="402" cy="256" r="26"/></g>
  <rect x="186" y="146" width="150" height="220" rx="18" fill="#ffffff"/>
  <g fill="${BG}" opacity=".62"><rect x="210" y="188" width="102" height="14" rx="7"/><rect x="210" y="224" width="102" height="14" rx="7"/><rect x="210" y="260" width="102" height="14" rx="7"/><rect x="210" y="296" width="62" height="14" rx="7"/></g>`;
const svg = (rounded) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <rect width="512" height="512"${rounded ? ' rx="112"' : ''} fill="${BG}"/>${mark}
</svg>`;

writeFileSync('icons/icon.svg', svg(true).replace(' width="512" height="512"', ''));

const jobs = [
  ['icons/icon-192.png', 192, true], ['icons/icon-512.png', 512, true],
  ['icons/icon-maskable-512.png', 512, false], ['icons/apple-touch-icon.png', 180, false], ['icons/favicon-32.png', 32, true],
];
const b = await chromium.launch();
for (const [path, size, rounded] of jobs) {
  const p = await b.newPage({ viewport: { width: size, height: size } });
  await p.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg(rounded)}`);
  await p.screenshot({ path, omitBackground: true });
  await p.close();
}
await b.close();
