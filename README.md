# bunken-hub（文献ハブ）

論文を「探す・本文を手に入れる・控える」作業を、既存サービスをつないで1画面で済ませるための個人用ツールです。
検索エンジンもストレージも作りません。既存サービスへの橋渡しだけを担います。

## 前提
- 自分専用です。サーバーは持たず、静的ファイルだけで動きます（GitHub Pages で公開するか、ローカルで開く）
- 大学・研究機関に所属していない → **本文の入手ルート**を最重要視する
- 日本語文献もそこそこ重視する（CiNii / J-STAGE / IRDB / NDL）
- [edu-research-watch](https://github.com/napple02/edu-research-watch) が「何を読むべきか」を見つけ、文献ハブは「それをどう手に入れて控えるか」を担う

## できること
1. DOI・論文URL（arXiv を含む）・タイトルを入力する
2. 書誌情報を取得する（OpenAlex → Crossref → doi.org の順に試す）。OpenAlex に abstract があれば表示する
3. タイトル検索では OpenAlex・Crossref・CiNii・**NDLサーチ**を並べて検索し、候補を出す（日本語の検索語なら CiNii と NDL を先頭に出す）
4. 本文の入手ルートを、費用の安い順に示す
   - ① 無料で読める版（OpenAlex / Unpaywall の OA 情報）
   - ② 横断検索リンク（Google Scholar, CiNii, J-STAGE, IRDB, NDLサーチ, **NDLデジタルコレクション**, **ジャパンサーチ**, CORE, Semantic Scholar, PubMed, BASE）
   - ③ 手続きによる入手（出版社での購入、NDL遠隔複写、個人向けデジタル化資料送信サービス、公共図書館）
   - ④ 著者への別刷り依頼メールの文面（日本語と英語を自動で切り替え）
5. 参考文献表記・BibTeX・保存用ファイル名（`年_筆頭著者_タイトル.pdf`）をコピーする
6. **Obsidian ノート**（edu-research-watch の Vault 出力と同じ frontmatter の並び）をコピーするか、`.md` で保存する
7. 台帳（未入手 / 入手済 / 読了 + メモ）を管理する。JSON / BibTeX / CSV で書き出し、JSON で読み込む

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
