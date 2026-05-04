# Sprint 5 自己評価

## 実装した機能

- F-202: DOM 抽出堅牢化 - 完了
- F-203: 短い抽出結果に対する警告 UI - 完了
- F-204: 短文入力に対するプロンプト改善 - 完了

## 受け入れ条件の充足状況

| 条件 | 状態 | 備考 |
|------|------|------|
| `<main>` 配下の本文が抽出され `<nav>` 配下リンクテキストを含まない | OK | `selectContainer` が `<main>` を最優先で選択 |
| `<article>` を持つページで `<header>` 内のサイトナビが先頭に来ない | OK | `<header>` が EXCLUDED_TAGS に追加済み |
| `<script>` / `<style>` / `<noscript>` の中身を含まない（既存条件の維持） | OK | リグレッションなし |
| `aria-hidden="true"` のテキストが抽出結果に含まれない | OK | 既存条件を維持 |
| `open` Shadow Root 内のテキストが抽出に含まれる | OK | `collectText` でshadowRoot走査を追加 |
| `closed` Shadow Root は対象外 | OK | `host.shadowRoot === null` なのでアクセスできない |
| 抽出結果 40 文字未満のとき UI に警告が出て API 呼び出しが `Run anyway` 押下まで発生しない | OK | `runExplain` で `Promise` を用いたユーザー確認フロー実装 |
| 警告メッセージに抽出文字数が含まれる | OK | `Extracted N chars from this page.` |
| `Cancel` を押すと API 呼び出しが行われない | OK | テストで確認 |
| 抽出結果 40 文字以上では警告が表示されず従来どおり即実行 | OK | テストで確認 |
| 選択が空のときの挙動（F-004）は変更されない | OK | 空選択は警告ではなくエラー表示のまま |
| 入力 40 文字未満のとき短文用プロンプト文言が system に含まれる | OK | background で `SHORT_CONTENT_THRESHOLD` 参照 |
| 入力 40 文字以上のとき通常プロンプトが使われる | OK | テストで確認 |
| `outputLanguage = "ja"` のとき短文プロンプトも日本語指示入り | OK | `getShortExplainSystemPrompt(lang)` に言語引数を渡す |
| 警告ブロックに `role="alert"` 相当の通知構造がある | OK | `panel.html` の `<div role="alert">` で実装 |
| `SHORT_CONTENT_THRESHOLD = 40` が 1 か所で定義されて共有される | OK | `src/content/extract.ts` で export、`background` と `explain.ts` が import |
| 既存 Sprint 1〜4 の 166 テストがすべて pass | OK | 全 210 テスト（既存 166 + 新規 44）pass |

## 実装ログ

- タスク1: `src/content/extract.ts` 全面改修 (F-202)
  - `SHORT_CONTENT_THRESHOLD = 40` を追加 export
  - `EXCLUDED_TAGS` に NAV / ASIDE / FOOTER / HEADER / FORM / SVG / IFRAME / TEMPLATE / BUTTON を追加
  - `tagName.toUpperCase()` でSVG名前空間の小文字tagNameに対応
  - `selectContainer()` を新規実装（main → article最大長 → role=main → body フォールバック）
  - `collectText()` でopen Shadow Root走査を追加
  - 空白正規化（連続空白を1つに圧縮、`\n` 連続を1つに圧縮、trim）
  - `extractPageContent()` が `selectContainer()` を呼ぶよう変更

- タスク2: `src/lib/claude.ts` に `getShortExplainSystemPrompt(lang)` を追加 (F-204)
  - 短文用文言「The input is a short word, phrase, or code expression.」+「Explain the meaning, usage, and typical context...」

- タスク3: `src/background/index.ts` を更新 (F-204)
  - `SHORT_CONTENT_THRESHOLD` を `extract.ts` から import
  - `getShortExplainSystemPrompt` を `claude.ts` から import
  - EXPLAIN ハンドラで `message.content.length < SHORT_CONTENT_THRESHOLD` で system prompt を分岐

- タスク4: `src/sidepanel/panel.html` に短文警告ブロックを追加 (F-203)
  - `id="shortContentWarning"` の `div[role="alert"]`
  - `id="shortContentWarningText"` の `p` タグ
  - `id="btnRunAnyway"` / `id="btnCancelShort"` のボタン

- タスク5: `src/sidepanel/styles/base.css` に `.short-content-warning` スタイルを追加

- タスク6: `src/sidepanel/explain.ts` を全面改修 (F-203)
  - `ExplainElements` に新規要素を追加
  - `showShortWarning()` / `hideShortWarning()` 関数を追加
  - `doExplainRequest()` を API呼び出し内部処理として分離
  - `runExplain()` で短文チェック → 警告表示 → Promise でユーザー確認待ち のフロー実装
  - `resetExplain()` で `hideShortWarning()` を追加

- タスク7: `test/explain.test.ts` 更新
  - 既存テストのモックコンテンツを 40 文字以上に更新（短文警告を回避）
  - setupDom に新規 DOM 要素を追加

- タスク8: `test/extract-v2.test.ts` 新規追加
  - 本文コンテナ優先選択テスト（main/article/role=main/フォールバック）
  - 追加除外タグテスト（nav/aside/footer/header/form/svg/iframe/template/button）
  - Shadow DOM open/closed テスト
  - 空白正規化テスト
  - 既存バグ再現テスト（"notable" のみ取得される事象）
  - F-012 リグレッションテスト

- タスク9: `test/short-content.test.ts` 新規追加
  - F-203 警告 UI テスト（ページ全体・選択範囲）
  - F-203 Run anyway → API 呼び出し確認
  - F-203 Cancel → API 呼び出しなし確認
  - F-204 background EXPLAIN ハンドラのプロンプト切り替えテスト
  - F-204 `getShortExplainSystemPrompt` ユニットテスト

## 動作確認

- typecheck: pass
- build: pass
- test: 210 passed (既存 166 + 新規 44)
- `npm run check` (typecheck + build): pass

## 既知の課題

- 短文警告フローでは `Run anyway` → `doExplainRequest` の中で `finally { setRunning(false) }` が重複してインクリメントされる可能性があるが、実際の動作は `setRunning(true)` → `doExplainRequest` → `finally setRunning(false)` の1セットなので問題なし
- Shadow DOM走査の深度制限は実装していないが、再帰は通常の DOM ツリーと同じ深さで行われ、open mode の shadowRoot 子ノードのみを追加走査するため実用上は問題ない

## Evaluator への申し送り事項

- モック化が必要な箇所:
  - Claude API (`fetch`): 全テストでモック済み
  - `chrome.*` API: `test/helpers/chromeMock.ts` でモック済み
  - Shadow DOM テストは JSDOM の `attachShadow({ mode: 'open' })` を使用
- 閾値 `SHORT_CONTENT_THRESHOLD = 40` は `src/content/extract.ts` の単一箇所で定義し、`background/index.ts` と `sidepanel/explain.ts` の両方でインポートして参照している（単一ソースの真実）
- 空白正規化後の content 長で閾値判定するのが正しい挙動だが、content script 側（`extract.ts`）では正規化後の長さが `content.length` になっており、side panel・background 側は渡された `content` の長さで判定している（一貫性あり）

---

## Sprint 5 Codex 最終レビュー指摘修正（追記）

### 修正内容

#### [HIGH] 短文警告リスナーのクリーンアップ（AbortController 導入）

- `src/sidepanel/explain.ts`
  - モジュールスコープに `shortWarningController: AbortController | null` を追加
  - `abortShortWarning()` 関数を追加（controller.abort() + null クリア）
  - `runExplain()` 内の短文警告分岐で `abortShortWarning()` を冒頭で呼び、新規 `AbortController` を生成してから `{ signal: controller.signal }` でリスナーを登録
  - `resetExplain()` 冒頭に `abortShortWarning()` を追加し、TAB_CHANGED リセット時に pending なリスナーを確実に破棄
  - `{ once: true }` ではなく AbortController を採用した理由: 2 つのボタンを一括で剥がせるため

#### [MEDIUM] セマンティックコンテナが短い場合の body フォールバック（F-202）

- `src/content/extract.ts`
  - `normalizeText(parts: string[])` 関数を抽出して `extractPageContent` から分離
  - `extractPageContent()` でセマンティックコンテナの抽出結果が `SHORT_CONTENT_THRESHOLD` 未満のとき `<body>` で再抽出し、より長い方を採用するロジックを追加
  - `container !== bodyEl` の条件チェックで body フォールバック自体のループを防止

#### [LOW] 空白正規化を `/\s+/g` → 単一スペースに変更（F-202）

- `src/content/extract.ts`
  - 旧: `parts.join('\n').replace(/[ \t]+/g, ' ').replace(/\n{2,}/g, '\n').trim()`
  - 新: `normalizeText()` 内で `parts.join(' ').replace(/\s+/g, ' ').trim()` に統一
  - これにより改行・タブ・連続空白がすべて単一スペース1つに正規化される

### テスト追加

- `test/short-content.test.ts` に 2 件追加（HIGH 指摘対応）:
  - `resetExplain` 後に古い `btnRunAnyway` click で API 呼び出しが起きないこと
  - 連続して短文警告を出した場合に最新 Run anyway のみが API を叩くこと

- `test/extract-v2.test.ts` に 6 件追加:
  - [LOW] 改行がすべて単一スペースに正規化されること（`/\s{2,}/`、`/\n/`、`/\t/` を assert）
  - [LOW] タブ文字を含むページでの正規化
  - [MEDIUM] `<main>` が短い場合に body フォールバックが機能すること
  - [MEDIUM] `<main>` が十分長い場合はフォールバックしないこと
  - [MEDIUM] `<article>` が短い場合に body フォールバックが機能すること
  - [MEDIUM] セマンティック・body の両方が短い場合の挙動

### 動作確認（修正後）

- typecheck: pass
- build: pass（sidepanel.js 17.4kb、リグレッションなし）
- test: **218 passed**（既存 210 + 新規 8）
- `npm run check`: pass

---

## Sprint 5 Codex 再レビュー指摘修正（追記）

### 修正内容

#### [HIGH] Run anyway / Cancel 解決パスで `controller.abort()` が呼ばれていなかった問題を修正

- `src/sidepanel/explain.ts:216` / `:227`
  - 旧: `onRunAnyway` / `onCancel` ハンドラ内で `shortWarningController = null` のみ設定し、`controller.abort()` を呼んでいなかった
  - 問題: ハンドラ発火時に `controller` の AbortSignal が "not aborted" のまま残るため、もう一方のボタンのリスナーが DOM に残留する
  - 結果: 次回の短文警告でリスナーが二重登録され、古いハンドラが発火してレース状態・API 二重呼び出しが起きる
  - 修正: 両ハンドラの冒頭で `controller.abort()` を呼んでから `shortWarningController = null` に変更
  - これにより、Run anyway 発火時は onCancel が、Cancel 発火時は onRunAnyway が、それぞれ `{ signal }` 経由で自動 removeEventListener される

### テスト追加

- `test/short-content.test.ts` に 3 件追加（Codex 再レビュー指摘対応）:
  - 「短文警告 → Run anyway → 再度短文警告 → Run anyway」で API が各回 1 回ずつ、合計 2 回だけ呼ばれること
  - 「短文警告 → Cancel → 再度短文警告 → Run anyway」でステイルハンドラが発火せず API が 1 回だけ呼ばれること
  - `addEventListener` のスパイで連続発生時の click リスナー登録数が増えないこと（各回同数）

### 動作確認（Codex 再レビュー修正後）

- typecheck: pass
- build: pass（sidepanel.js 17.5kb、リグレッションなし）
- test: **221 passed**（既存 218 + 新規 3）
- `npm run check`: pass
