// edu-research-watch の判定規則と用語辞書（data/shared_rules.json）を、lib.js の WATCH_RULES に取り込む。
// ウォッチは非公開リポジトリで、静的ページから実行時に読めないため、写しを lib.js に持つ。
// 使い方: node scripts/sync-watch-rules.mjs ../edu-research-watch/data/shared_rules.json
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const src = process.argv[2];
if (!src) { console.error('使い方: node scripts/sync-watch-rules.mjs <edu-research-watch/data/shared_rules.json>'); process.exit(1); }
const rules = JSON.parse(fs.readFileSync(src, 'utf8'));
if (rules.source !== 'edu-research-watch' || rules.schema_version !== 1) { console.error('edu-research-watch の shared_rules.json（schema_version 1）ではありません'); process.exit(1); }
const { note, ...body } = rules;
const lib = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'lib.js');
const text = fs.readFileSync(lib, 'utf8');
const re = /(\/\/ <watch-rules>[^\n]*\n)[\s\S]*?(\n\/\/ <\/watch-rules>)/;
if (!re.test(text)) { console.error('lib.js に // <watch-rules> の区間がありません'); process.exit(1); }
fs.writeFileSync(lib, text.replace(re, (_, a, b) => `${a}const WATCH_RULES = ${JSON.stringify(body)};${b}`));
console.log(`lib.js の WATCH_RULES を更新しました（用語 ${Object.keys(body.glossary).length} 件）`);
