# bunken-hub（文献ハブ）

論文を「探す・本文を手に入れる・控える」作業を、既存サービスをつないで1画面で済ませるための個人用ツールです。
検索エンジンもストレージも作りません。既存サービスへの橋渡しだけを担います。

## 前提
- 自分専用です。サーバーは持たず、静的ファイルだけで動きます（GitHub Pages で公開するか、ローカルで開く）
- 大学・研究機関に所属していない → **本文の入手ルート**を最重要視する
- 日本語文献もそこそこ重視する（CiNii / J-STAGE / IRDB / NDL）
- [edu-research-watch](https://github.com/napple02/edu-research-watch) が「何を読むべきか」を見つけ、文献ハブは「それをどう手に入れて控えるか」を担う

## できること
1. DOI・論文URL（arXiv を含む）・タイトルを入力する。`/` キーで検索欄に移動できる
2. 書誌情報を取得する（OpenAlex → Crossref → doi.org の順に試す）。abstract があれば表示し、Google 翻訳へ渡せる
3. タイトル検索では OpenAlex・Crossref・CiNii・NDLサーチを同時に検索し、候補に入手しやすさの色を付ける
4. **入手しやすさの帯**：無料 PDF あり / 図書館経由 / 有料のみ を一目で示す。**撤回された論文には警告**を出す
5. 「入手する」タブ：本文の入手ルートを、費用の安い順に並べる
   - 1 無料で読める版（OpenAlex / Unpaywall。出版社版・著者最終稿・プレプリントを区別する）
   - 2 横断検索リンク（Google Scholar, CiNii, J-STAGE, IRDB, NDLサーチ, NDLデジタルコレクション, ジャパンサーチ, CORE, Semantic Scholar, PubMed, BASE）
   - 3 手続きによる入手（出版社、NDL遠隔複写、個人向けデジタル化資料送信サービス、公共図書館）
   - 4 著者に頼む：**責任著者**を宛先にし、ORCID・researchmap で連絡先を探すリンクと、署名入りの依頼文を出す
6. 「引用・保存」タブ：参考文献表記 / BibTeX / RIS / Obsidian ノートを切り替えてコピー。保存用ファイル名、このページへのリンク
7. 「関連文献」タブ：被引用（多い順）・参照文献・関連論文を OpenAlex から並べ、それぞれ入手しやすさの色を付ける。Connected Papers などの図へのリンク
8. 台帳：状態（未入手 / 入手済 / 読了）・メモ・検索・並べ替え。JSON / BibTeX / RIS / CSV で書き出す。**バックアップを2週間していないと知らせる**
9. 最近調べた論文、初回のメールアドレス登録の案内、設定ダイアログ、ブックマークレット、ダークモード

10. **アプリとして使える（PWA）**：ホーム画面・デスクトップに追加でき、画面と台帳はオフラインでも開く。Android では他のアプリの「共有」から論文ページを送れる。検索欄に DOI を貼ると、Enter なしで調べる
11. **別の端末へ引き継ぎ**：GitHub のシークレット Gist を使った同期（台帳・設定・削除も伝わる）と、設定入りの JSON バックアップ
12. 表示（ライト / ダーク / 端末に合わせる）、指で押しやすい大きさ、日本語の文節折り返し

13. **無料版の探索先を増強**：OpenAlex・Unpaywall に加え、Europe PMC と Semantic Scholar も同時に引く。Semantic Scholar の一行要約（TLDR）も表示。abstract がなければ Europe PMC のものを使う
14. **台帳の整理**：★（重要）・タグ（絞り込み・入力候補つき）・全文検索。全件を Obsidian ノートの ZIP（一覧つき）で書き出し。CSL JSON・Markdown リンクの引用形式。共有ボタン（Web Share）
15. **候補の絞り込み**：「無料版ありのみ」「日本語のみ」、新しい順・被引用の多い順
16. **はじめの設定**：メールアドレス・名前・同期・ホーム画面への追加・保存先フォルダを、進み具合つきで案内（登録済みなら折りたたむ）
17. **セキュリティ**：CSP（`script-src 'self'`）で、外部・埋め込みのスクリプトを実行させない。トークンを端末に保存するため、XSS を入れさせない構えにしている

18. **Zotero と連携（任意）**：「引用・保存」タブの「Zotero に送る」で、書誌・abstract・タグ・メモと無料版へのリンクを、自分の Zotero ライブラリへ送る。台帳の未送信分はまとめて送れる。送る前に DOI で重複を確かめ、送信済みの印は台帳に残る（同期される）。PDF の保管・注釈・Word や Google ドキュメントでの引用は Zotero に任せる

## Zotero と連携するには
1. [zotero.org](https://www.zotero.org/user/register) でアカウントを作る（無料。ファイルの保存容量は 300MB まで無料）
2. [API キーの作成画面](https://www.zotero.org/settings/keys/new)で、「Allow library access」と「Allow write access」にチェックしてキーを作る
3. 文献ハブの「設定」→「Zotero と連携」にキーを入れ、「接続を確かめる」
4. 論文の「引用・保存」タブで「Zotero に送る」。パソコンには [Zotero のアプリ](https://www.zotero.org/download/)を入れると、送った論文がアプリに同期され、PDF を添付・注釈し、Word で引用できる

- キーはこの端末の中にだけ保存し、同期・バックアップには入れない。別の端末でも使うときは、その端末でキーを入れる
- PDF のファイルは送らない（無料版へのリンクだけ）。Zotero のアプリの「Find Available PDF」で、Zotero 側でも無料版を探せる

## 端末間の同期のしくみ
- 設定の「他の端末と同期」に、GitHub のトークン（**gist の権限だけ**）を入れて「接続して同期」。別の端末では同じトークンを入れるだけで、`bunken-hub-sync.json` という Gist を探して取り込む
- 文献ごとに `updatedAt` が新しいほうを残し、削除は「墓標」で他の端末へ伝える（2台で同時に編集しても合流する）。マージは `lib.js` の `mergeSync`（単体テストあり）
- 同期するのは、台帳と、メールアドレス・名前・保存先フォルダ・引用形式・CiNii appid。**トークン・OpenAlex の API キー・表示テーマは同期しない**
- シークレット Gist は検索には出ないが、URL を知っていれば読める。気になる場合は同期せず、JSON のバックアップで手動で移す

## 参考にしたサービス・リポジトリ
| 参考元 | 取り入れた考え方 |
|---|---|
| Unpaywall 拡張 / Open Access Button | 無料版の有無を一目で示す帯。合法な版だけを案内する |
| LibKey Nomad / Lean Library | 論文ページから1クリックで入手手段へ（ブックマークレット） |
| Zotero コネクタ | 論文ページの `citation_doi` メタタグから DOI を読む。RIS 書き出し |
| Connected Papers / ResearchRabbit / Litmaps | 被引用・参照文献からの芋づる式探索（関連文献タブ） |
| Retraction Watch | 撤回論文の警告（OpenAlex の `is_retracted`） |
| researchmap / ORCID | 所属のない人が著者に連絡するための導線 |
| edu-research-watch | OpenAlex の abstract の復元、Obsidian の frontmatter |
| Zotero（Web API） | 本文の保管・注釈・引用は自前で作らず Zotero に渡す。Citation.js のような引用形式のライブラリを入れる代わりに、多数の引用形式は Zotero 側で使う |

## edu-research-watch との連携
- **週報・月報から取り込む**：台帳の「DOI をまとめて追加」に、`reports/weekly/*.md` などの Markdown をそのまま貼り付けると、含まれている DOI を拾って未入手として追加する
- **JSON をそのまま読み込む**：`papers.json` / `rising_papers.json` / `data/weekly_buffer.json` などを「JSONを読み込む」で選ぶと、`score` 上位 50 件を取り込む。訳題（`title_ja`）・無料版（`oa_status`・`oa_url`）・撤回の印も引き継ぎ、`#ウォッチ` と研究デザイン（`#RCT`・`#メタ分析` など）のタグを付ける
- **リンクで開く**：`index.html?q=<DOI>` で開くと、その DOI をすぐに調べる。ウォッチの週報・月報の「入手」欄に、このリンク（「文献ハブで入手ルートを見る」）と無料版の有無が出る。無料版の区分は、こちらの「入手しやすさの帯」と同じ言葉に揃えている
- **判定規則と用語辞書を共有**：ウォッチの研究デザイン・サンプル数の判定規則と用語辞書（`data/shared_rules.json`）を `lib.js` の `WATCH_RULES` に取り込んでいる。詳細画面に「研究の型：RCT · N=1,250」を出し、abstract の下に専門用語の訳（`cognitive load＝認知負荷` など。機械翻訳の誤訳を見分ける手がかり）を並べる。Obsidian ノートの frontmatter にも `title_ja`・`design`・`sample_size` を入れる。ウォッチ側で規則を変えたら `node scripts/sync-watch-rules.mjs <edu-research-watch>/data/shared_rules.json` で取り込み直す
- 週報の Markdown を貼ったとき、入手ルートのリンクの DOI（括弧が `%28` などにエンコードされている）も正しく読む
- 参考にした実装：OpenAlex の abstract の復元、API キーの渡し方、Obsidian の frontmatter

## 構成
```
index.html            画面（CSP を meta で指定）
style.css             見た目（ライト/ダーク対応）
lib.js                DOM に依存しない処理（書誌の正規化・整形・入力解釈・同期のマージ）
app.js                API 呼び出し・描画・台帳・同期
theme.js              保存した表示テーマを、描画前に適用（CSP のためインラインにしない）
pwa.js                Service Worker の登録、ホーム画面へ追加、オフライン表示、貼り付け
sw.js                 Service Worker（オフライン用の控え）
manifest.webmanifest  アプリの定義（アイコン・共有の受け取り・ショートカット）
icons/                アイコン（scripts/make-icons.mjs で書き出し）
tests/                単体テストと構成のテスト。tests/e2e/ はブラウザでの通しの確認（npm run e2e）
docs/開発記録.md       経緯・設計の判断・未確認事項・次にやること
CLAUDE.md             今後の作業のための決まり事
```

## 使い方
1. `index.html` をブラウザで開く（または GitHub Pages の URL を開く）
2. 最初に「設定」でメールアドレスを入れる（Unpaywall の利用に必要）
3. OpenAlex の API キーを持っていれば、それも入れる

## 記録
経緯・設計の判断・実機で最初に確かめること・次にやることは [docs/開発記録.md](docs/開発記録.md) にまとめています。

## テスト
（GitHub Actions でも、push と PR のたびに自動で実行します）
```bash
npm test   # = node --test tests/*.test.js（依存パッケージなし）。同期のマージ・共有の解釈・PWA の構成を確かめる
```

ブラウザでの通しの確認は `npm run e2e`（Playwright と Chromium が必要。外部 API と GitHub の Gist は模したデータで、2端末の同期・オフライン・共有・★とタグ・ZIP・はじめの設定・CSP を確かめます）。

## 使っている外部サービス
| 用途 | サービス | 備考 |
|---|---|---|
| 書誌・OA情報 | OpenAlex | 無料。API キー（任意） |
| 書誌 | Crossref, doi.org | 無料・キー不要 |
| OA版の検出 | Unpaywall | 無料。メールアドレスが必要 |
| 日本語論文 | CiNii Research | ブラウザから直接呼べない場合はリンクのみ |
| 国会図書館 | NDLサーチ OpenSearch | 同上。デジタルコレクションの資料には「デジコレ」の印を付ける |
| 無料版・要約 | Europe PMC, Semantic Scholar | 無料・キー不要。無料版の探索先と TLDR |
| 文献の保管・引用 | Zotero Web API | 任意。API キーが必要（同期しない） |
| Google Scholar | — | 公式 API がないため、リンクのみ（スクレイピングはしない） |

## 未検証・注意
- 開発環境から外部 API に接続できなかったため、**API 呼び出しは実機で確認していない**。書誌の整形や入力の解釈など、DOM に依存しない処理は単体テスト済み
- CiNii の JSON と NDL の RSS の項目名は想定に基づいて実装しているので、実データで調整が必要
- NDL のサービス案内の URL は変わることがある
- 台帳はブラウザの localStorage にだけ保存される。定期的に書き出して、ドライブにバックアップすること

## 今後
- [ ] 実機での API 動作確認と、CiNii・NDL の調整
- [ ] Google ドライブ / Dropbox への直接保存（Dropbox Saver、Google Drive API）
- [x] edu-research-watch のレポートに `?q=<DOI>` のリンクを出す（ウォッチ側の変更。ウォッチのリポジトリの PR で対応）
