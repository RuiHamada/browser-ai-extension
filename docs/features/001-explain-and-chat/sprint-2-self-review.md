# Sprint 2 Self-Review

## 実装した機能

- F-003: ページ本文の DOM 抽出 - 完了
- F-004: 選択テキストの取得 - 完了
- F-005: Explain（英語解説） - 完了
- F-011: エラーハンドリングとユーザー通知 - 完了
- F-012: 抽出本文長の制御 - 完了
- F-013: 言語設定（英語固定） - 完了

## 受け入れ条件の充足状況

| 条件 | 状態 | 備考 |
|------|------|------|
| 一般的な記事ページで本文抽出が2秒以内に完了 | OK | 同期的なDOM走査のため高速 |
| `<script>`/`<style>`/`<noscript>` の内容を含まない | OK | `EXCLUDED_TAGS` セットで除外 |
| ページ全体 Explain で英語解説が表示される | OK | EXPLAIN_SYSTEM_PROMPT で "Always respond in English" を指定 |
| 選択範囲 Explain で選択テキストに基づく解説が表示される | OK | GET_SELECTED_TEXT 経由で取得 |
| 選択が空の場合にエラーメッセージが表示される | OK | "No text is selected." を表示 |
| API エラー時にユーザー向けメッセージが表示される | OK | 401/429/4xx/5xx/ネットワーク別メッセージ |
| API キーが UI に露出しない | OK | sanitizeErrorMessage で sk-ant- パターンを除去 |
| 上限超過ページで API 呼び出しが成功し切り詰め通知が表示される | OK | CONTENT_MAX_CHARS = 20000, truncatedNotice で通知 |
| 実行中はローディング状態が表示される | OK | `explainLoading` の hidden トグル |
| 実行中は二重実行防止 | OK | `isRunning` フラグで制御 |

## 実装ログ

- タスク1: DOM抽出ロジック - `src/content/extract.ts` 新規作成
- タスク2: コンテンツスクリプト更新 - `src/content/index.ts` 実DOM抽出を使うよう更新
- タスク3: メッセージ型拡張 - `src/types/messages.ts` に `EXPLAIN` メッセージ追加
- タスク4: Claude API クライアント - `src/lib/claude.ts` 新規作成（HTTP/ネットワークエラー別処理）
- タスク5: background handler 更新 - `src/background/index.ts` に `EXPLAIN` ハンドラ追加
- タスク6: Explain タブ UI ロジック - `src/sidepanel/explain.ts` 新規作成
- タスク7: Side Panel HTML 更新 - `src/sidepanel/panel.html` タブUI・Explainタブ要素を追加
- タスク8: Side Panel エントリ更新 - `src/sidepanel/index.ts` タブ切り替え・Explain初期化を追加
- タスク9: CSS 追加 - `src/sidepanel/styles/base.css` タブ・ローディング・エラー・結果のスタイル追加
- タスク10: テスト追加 - `test/extract.test.ts`, `test/claude.test.ts`, `test/explain.test.ts`, `test/content.test.ts` 更新
- タスク11: ChromeMock 拡張 - `test/helpers/chromeMock.ts` に `tabs.sendMessage` 追加

## モデルID修正（Evaluator 指摘対応）

Sprint 2 Evaluator 指摘により、`AVAILABLE_MODELS` を Claude 4.x 系の現行エイリアスのみに整理:

| 旧 ID | 新 ID | 備考 |
|-------|-------|------|
| `claude-haiku-4-5` | `claude-haiku-4-5` | 据え置き（デフォルト） |
| `claude-sonnet-4-5` | 削除 | |
| `claude-sonnet-4-6` | `claude-sonnet-4-6` | 据え置き |
| `claude-opus-4-5` | 削除 → `claude-opus-4-7` に差し替え | |

- `DEFAULT_SETTINGS.aiModel` は `claude-haiku-4-5` のまま（変更なし）
- `src/lib/claude.ts` の `DEFAULT_MODEL` は `claude-haiku-4-5` のまま（変更なし）
- 関連テスト（`test/options.test.ts`, `test/storage.test.ts`, `test/background.test.ts`）を新 ID に更新

## 動作確認

- typecheck: pass
- build: pass
- test: pass (87 tests, 11 test files)

## 既知の課題

- Side Panel の `chrome.tabs.sendMessage` 呼び出しは content script が注入済みのページでのみ動作する。
  `chrome://` ページや PDF など content script が動作しない URL では適切なエラーメッセージを表示する
  が、より具体的なメッセージ（例: "This page cannot be accessed"）への改善は Sprint 3 で検討。
- タブ切り替え（F-007）は HTML/CSS/JS で実装済みだが、Sprint 3 の Chat タブ実装後に
  完全な動作確認が必要。

## Evaluator への申し送り事項

- Claude API の実呼び出しは fetch をモック（`globalThis.fetch`）で代替してテスト
- `chrome.tabs.sendMessage` は `chromeMock.ts` の `tabs.sendMessage` でモック
- `chrome.runtime.sendMessage` は既存の `runtime.sendMessage` モックを流用
- API キー漏洩テスト: エラーメッセージ・fetch ヘッダ両方をテストで検証済み
- 切り詰めテスト: `CONTENT_MAX_CHARS` を超えるテキストで `truncated: true` を確認済み

---

## Codex 最終レビュー指摘対応（Sprint 2 追加修正）

### 修正内容

| 指摘 | 対応 | 変更ファイル |
|------|------|------------|
| [HIGH] background catch で raw error を sendResponse に流していた | `sanitizeErrorMessage` で sanitize 後に `sendResponse({ error: sanitizedMsg })` | `src/background/index.ts` |
| [HIGH] background `console.error` に raw error message をそのまま渡していた | sanitizedMsg を先に出力し、スタックトレースは `e.stack` から取得 | `src/background/index.ts` |
| [HIGH] explain.ts の `resp.error` 表示前に sanitize なし | `showError(sanitizeErrorMessage(resp.error), els)` に変更 | `src/sidepanel/explain.ts` |
| [MEDIUM] background の `MESSAGE_HANDLERS[message.type as ...]` キャスト方式 | `switch (message.type)` + `default: const _exhaustive: never = message` による exhaustive check に書き換え | `src/background/index.ts` |
| [MEDIUM] content の独立 `if` ブランチ | `switch (message.type)` + `default: const _exhaustive: never = message` による exhaustive check に書き換え | `src/content/index.ts` |
| [LOW] `Settings.aiModel` が `string` 型 | `AiModelId` ユニオン型（`typeof AVAILABLE_MODELS[number]['value']`）に絞り込み | `src/types/messages.ts` |
| [LOW] ストレージ読み出し時の許可リスト検証なし | `validateAiModel()` を追加し、許可リスト外はデフォルトにフォールバック | `src/lib/storage.ts` |

### 追加テスト

- `test/background.test.ts`: background ハンドラが sk-ant- 混入エラーを sanitize して返すことを検証
- `test/storage.test.ts`: `aiModel` が許可リスト外の場合はデフォルトにフォールバックすることを検証（2ケース）

### 動作確認（追加修正後）

- typecheck: pass
- build: pass
- test: pass (90 tests, 11 test files)

---

## Codex 再レビュー指摘対応（Sprint 2 追加修正 #2）

### 問題

`Error.stack` は `Error.message` を含むため、`console.error('...', err)` のように生の err を渡すと、
message に `sk-ant-...` が含まれていた場合に stack 経由でログに残る。
前回の修正では `e.stack` を sanitize せずにそのまま出力していたため、この問題が残存していた。

### 修正内容

| 指摘 | 対応 | 変更ファイル |
|------|------|------------|
| [HIGH] `console.error` に生 err を渡すと stack 経由でAPIキーが漏洩する | `sanitizeErrorForLog(err)` を共通ヘルパーとして新設し、message と stack 両方を sanitize してから出力 | `src/lib/sanitize.ts`（新規）、`src/background/index.ts`、`src/sidepanel/explain.ts`、`src/lib/claude.ts` |
| [HIGH] `sanitizeErrorMessage` が各ファイルにローカルコピーとして重複していた | `src/lib/sanitize.ts` に一元化し、各ファイルから import するよう変更 | `src/background/index.ts`、`src/sidepanel/explain.ts` |

### 変更ファイル

- `src/lib/sanitize.ts`（新規）: `sanitizeErrorMessage` / `sanitizeErrorForLog` を提供する共通ユーティリティ
- `src/background/index.ts`: shared sanitize module を import、`console.error` を `sanitizeErrorForLog` 経由に変更、ローカル関数を削除
- `src/sidepanel/explain.ts`: shared sanitize module を import、`console.error` を `sanitizeErrorForLog` 経由に変更、ローカル関数を削除
- `src/lib/claude.ts`: shared sanitize module を import、`console.error` 2 箇所を `sanitizeErrorForLog` 経由に変更
- `test/sanitize.test.ts`（新規）: `sanitizeErrorMessage` / `sanitizeErrorForLog` の単体テスト 14 ケース（message・stack 両方の sanitize を検証）
- `test/background.test.ts`: `console.error` を `vi.spyOn` で捕捉し、全引数に `sk-ant-` が含まれないことを assert するテスト追加
- `test/explain.test.ts`: 同様の `console.error` スパイテスト追加

### 動作確認（追加修正 #2 後）

- typecheck: pass
- build: pass
- test: pass (105 tests, 12 test files)
