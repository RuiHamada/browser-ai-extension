# Sprint 9 自己評価

## 実装した機能

- F-504: assistant Chat バブルの Markdown レンダリング + XSS サニタイズ - 完了

## 受け入れ条件の充足状況

| 条件 | 状態 | 備考 |
|------|------|------|
| `## Title\n\n- a\n- b\n` が `<h2>` + `<ul><li>` DOM になる | OK | テスト: 見出しとリストの組み合わせ |
| `` `code` `` が `<code>code</code>` になる | OK | テスト: インラインコードレンダリング |
| ` ```js\nconst x = 1;\n``` ` が `<pre><code>` 構造になる | OK | テスト: コードブロックレンダリング |
| `[link](https://example.com)` が `<a target="_blank" rel="noopener noreferrer">` になる | OK | テスト: リンクレンダリング |
| `**bold**` が `<strong>bold</strong>` になる | OK | テスト: 太字レンダリング |
| XSS ベクタ1: `<script>alert(1)</script>` で `<script>` 生成されない | OK | テスト: ベクタ1 |
| XSS ベクタ2: `<img src=x onerror="alert(1)">` で `onerror` 属性なし | OK | テスト: ベクタ2 |
| XSS ベクタ3: `[click](javascript:alert(1))` で `javascript:` href なし | OK | テスト: ベクタ3 |
| XSS ベクタ4: `<iframe src="...">` で `<iframe>` 生成されない | OK | テスト: ベクタ4 |
| XSS ベクタ5: `<a onclick="alert(1)">` で `onclick` 属性なし | OK | テスト: ベクタ5 |
| XSS ベクタ6: レンダリング例外時にプレーンテキストフォールバック | OK | テスト: ベクタ6 |
| user バブルはプレーンテキストのまま | OK | `appendMessageBubble` の role 分岐で保証 |
| `npm run check` 成功 | OK | typecheck + build 両方 pass |
| 既存 280 件テストにリグレッションなし | OK | 全 310 件 pass |

## 実装ログ

- タスク1: `src/sidepanel/markdown.ts` 新設 - 自前 Markdown->DOM レンダラ（innerHTML 不使用）
  - `parseBlocks()`: コードブロック・見出し・ul/ol・段落をライン単位でパース
  - `parseInline()`: リンク・インラインコード・太字・イタリックをパース
  - `isSafeUrl()`: http: / https: / mailto: のみ許可、javascript: / data: / vbscript: 拒否
  - `renderMarkdown()`: 公開 API、例外時は textContent フォールバック

- タスク2: `src/sidepanel/chat.ts` 更新 - assistant バブルに `renderMarkdown` 適用
  - `import { renderMarkdown }` 追加
  - `appendMessageBubble` 内で role === 'assistant' 時のみ `renderMarkdown(body, text)` を呼ぶ
  - user / error / meta は引き続き `textContent` 代入（XSS 安全）

- タスク3: `src/sidepanel/styles/base.css` 更新 - Markdown 要素用スタイル追加
  - h1/h2/h3、p、ul/ol/li、code（インライン）、pre.markdown-codeblock > code、a、strong、em
  - assistant バブルの `white-space: normal` に変更（Markdown が整形するため）
  - user バブルは `white-space: pre-wrap` を明示維持

- タスク4: `test/markdown.test.ts` 新設 - 30 件のテスト追加
  - 基本記法（段落・見出し1〜3・ul・ol・インラインコード・コードブロック・太字・イタリック・リンク）
  - XSS 6 ベクタ（仕様書 §F-504 の 6 件をすべてカバー）
  - 不正 URL スキーム（data: / vbscript:）
  - 複合テスト・エッジケース

## 動作確認

- typecheck: pass
- build: pass（sidepanel.js 28.5kb）
- test: 310 passed（280 既存 + 30 新規）リグレッションなし

## 既知の課題

- ネストしたリスト（`- item\n  - sub`）には未対応（仕様には含まれない）
- テーブル・ブロッククォート・取り消し線は仕様上「任意」のため未実装
- ストリーミング中途の再レンダリング最適化（差分更新）は未実装だが、現実装は例外安全で部分文字列でも動作する

## Evaluator への申し送り事項

- `renderMarkdown` は `document` グローバルに依存しているが、第3引数 `doc` でカスタム Document を注入可能（テスト環境対応済み）
- XSS ベクタ5（`<a onclick="...">` の HTML タグ）は、自前実装の HTML タグ無視ポリシーにより `<a>` 自体が生成されず onclick も生成されない（テスト確認済み）
- ベクタ6のフォールバックは `appendChild` をオーバーライドして例外を強制的に発生させてテストしている
- `white-space: pre-wrap` の上書きにより assistant バブルの既存スタイルが変わるが、Markdown が改行を `<br>` / `<p>` で制御するため表示上の問題はない

---

## Sprint 8-9 Codex 指摘修正追記（スプリント 8-9 Generator による修正）

### 修正した内容

#### [HIGH] broadcast + pending 二重発火の排除（戦略 A 実装）
- `src/background/index.ts` の `FLOATING_EXPLAIN_REQUEST` ハンドラを修正
- 修正前: pending を常にセットし、broadcast も試みる（既に開いていると broadcast + pending flush の 2 回発火）
- 修正後（戦略 A）: まず broadcast を試みて、成功したら pending を立てない。失敗した場合のみ pending に保存
- これにより「broadcast 経由 + SIDE_PANEL_READY flush 経由」の二重発火を構造的に排除

#### [MEDIUM-1] Shadow ホストの aria-hidden 削除
- `src/content/floating.ts:73` の `aria-hidden="true"` を削除
- 代わりに `role="presentation"` を付与（ホスト自体は presentational）
- Shadow 内の `button[aria-label="Explain selected text"]` がスクリーンリーダーに見えるようになった

#### [MEDIUM-2] 禁止コンテキスト判定を `<input>` 全般に拡張
- `src/content/floating.ts` の `isSelectionInForbiddenContext()` を修正
- `activeElement` チェック: `HTMLInputElement` 全般（type 問わず）と `HTMLTextAreaElement` を禁止
- 祖先チェック: `INPUT` 全般、`TEXTAREA`、`contenteditable`（"false" 以外）を禁止
- `contenteditable="false"` は読み物扱いで除外しない

#### [LOW] innerHTML = '' を replaceChildren() に置換
- `src/sidepanel/chat.ts:766`: `els.chatMessages.innerHTML = ''` → `els.chatMessages.replaceChildren()`
- `src/options/options.ts:26`: `select.innerHTML = ''` → `select.replaceChildren()`
- src/ 全体で `innerHTML =` の使用ゼロを確認

### 追加テスト

- `test/sprint8-9-fixes.test.ts` 新設（12 件）
  - [HIGH] broadcast 成功時に SIDE_PANEL_READY が null を返すこと
  - [HIGH] broadcast 失敗時に SIDE_PANEL_READY が pending を flush すること
  - [HIGH] broadcast 成功時の二重発火カウント検証
  - [HIGH] flush 後の 2 回目 SIDE_PANEL_READY が null を返すこと
  - [MEDIUM-1] ホストに aria-hidden がないこと
  - [MEDIUM-1] ホストに role="presentation" があること
  - [MEDIUM-1] Shadow 内ボタンに aria-label が維持されること
  - [MEDIUM-2] `<input type="text">` でボタン非表示
  - [MEDIUM-2] `<textarea>` でボタン非表示
  - [MEDIUM-2] `contenteditable="true"` でボタン非表示
  - [MEDIUM-2] `contenteditable="false"` でボタン表示（読み物扱い）
  - [LOW] resetChat() が replaceChildren() で動作すること
- `test/background-floating.test.ts` 更新（既存 2 件を broadcast 失敗前提に修正）

### 動作確認

- typecheck: pass
- build: pass
- test: 322 passed（310 既存 + 12 新規）リグレッションなし

---

## F-504 拡張: テーブル対応追加

### 追加した機能

GFM 風パイプテーブル（`| col | col |\n|---|---|\n| a | b |`）のレンダリング対応。

### 実装ファイル

- `src/sidepanel/markdown.ts`:
  - `ColAlign` 型・`TableBlock` インターフェース追加
  - `splitTableRow()` / `parseSeparatorRow()` / `isTableRow()` ヘルパー追加
  - `parseBlocks()` にパイプテーブル検出ロジック追加（ヘッダ行 + 区切り行 + 1 行以上のデータ行）
  - `blocksToDOM()` に `table` ブロック → `<div class="md-table-wrapper"><table class="md-table">` 変換追加
  - 各セルは既存 `parseInline()` を通してインライン記法を反映
  - アライメントは `:` 位置から判定し `style.textAlign` に適用（ホワイトリスト: left/center/right）
  - innerHTML 不使用、XSS 安全

- `src/sidepanel/styles/base.css`:
  - `.md-table-wrapper`（`overflow-x: auto`）と `.md-table`（border-collapse / padding / ヘッダ背景）追加

- `test/markdown.test.ts`:
  - テーブル関連 10 件を追加（349 → 359 件）
  - 基本構造、インライン記法、アライメント、列数不揃い、前後段落共存、誤検出なし、XSS 3 件、wrapper 確認

### 動作確認

- typecheck: pass
- build: pass（sidepanel.js 31.4kb）
- test: 359 passed（349 既存 + 10 新規）リグレッションなし
