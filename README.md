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

## edu-research-watch との連携
- **週報・月報から取り込む**：台帳の「DOI をまとめて追加」に、`reports/weekly/*.md` などの Markdown をそのまま貼り付けると、含まれている DOI を拾って未入手として追加する
- **JSON をそのまま読み込む**：`papers.json` / `rising_papers.json` などを「JSONを読み込む」で選ぶと、`score` 上位 50 件を取り込む。訳題（`title_ja`）も引き継ぐ
- **リンクで開く**：`index.html?q=<DOI>` で開くと、その DOI をすぐに調べる。ウォッチ側のレポートに「入手ルート」リンクを出す用途を想定している
- 参考にした実装：OpenAlex の abstract の復元、API キーの渡し方、Obsidian の frontmatter

## 構成
```
index.html   画面
style.css    見た目（ライト/ダーク対応）
lib.js       DOM に依存しない処理（書誌の正規化・整形・入力解釈）
app.js       API 呼び出し・描画・台帳
tests/       lib.js の単体テスト
```

## 使い方
1. `index.html` をブラウザで開く（または GitHub Pages の URL を開く）
2. 最初に「設定」でメールアドレスを入れる（Unpaywall の利用に必要）
3. OpenAlex の API キーを持っていれば、それも入れる

## テスト
```bash
npm test   # = node --test tests/*.test.js（依存パッケージなし）
```

## 使っている外部サービス
| 用途 | サービス | 備考 |
|---|---|---|
| 書誌・OA情報 | OpenAlex | 無料。API キー（任意） |
| 書誌 | Crossref, doi.org | 無料・キー不要 |
| OA版の検出 | Unpaywall | 無料。メールアドレスが必要 |
| 日本語論文 | CiNii Research | ブラウザから直接呼べない場合はリンクのみ |
| 国会図書館 | NDLサーチ OpenSearch | 同上。デジタルコレクションの資料には「デジコレ」の印を付ける |
| Google Scholar | — | 公式 API がないため、リンクのみ（スクレイピングはしない） |

## 未検証・注意
- 開発環境から外部 API に接続できなかったため、**API 呼び出しは実機で確認していない**。書誌の整形や入力の解釈など、DOM に依存しない処理は単体テスト済み
- CiNii の JSON と NDL の RSS の項目名は想定に基づいて実装しているので、実データで調整が必要
- NDL のサービス案内の URL は変わることがある
- 台帳はブラウザの localStorage にだけ保存される。定期的に書き出して、ドライブにバックアップすること

## 今後
- [ ] 実機での API 動作確認と、CiNii・NDL の調整
- [ ] Google ドライブ / Dropbox への直接保存（Dropbox Saver、Google Drive API）
- [ ] 台帳をドライブ上のファイルと同期（複数のブラウザで使えるように）
- [ ] ブックマークレット（論文ページを開いたまま、1クリックで文献ハブへ送る）
- [ ] edu-research-watch のレポートに `?q=<DOI>` のリンクを出す（ウォッチ側の変更）
