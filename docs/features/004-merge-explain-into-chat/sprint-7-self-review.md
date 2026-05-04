# Sprint 7 自己評価

## 実装した機能
- F-401: 単一 Chat 画面への UI 統合 - 完了
- F-402: クイックアクションボタン群（6 個） - 完了
- F-403: クイックアクション実行時の Chat 履歴・送信ペイロード仕様 - 完了
- F-404: 履歴クリアと URL 変化リセットの挙動継続 - 完了
- F-405: タブ UI 撤廃の確認 - 完了

## 受け入れ条件の充足状況
| 条件 | 状態 | 備考 |
|------|------|------|
| F-401: Side Panel HTML にタブ要素が存在しない | OK | `role="tablist"` / `tabBtnExplain` / `tabBtnChat` を削除 |
| F-401: 起動時に Welcome メッセージが表示される | OK | `initChat()` で `appendWelcomeMessage()` を呼ぶ |
| F-401: 履歴クリア後に Welcome メッセージが再表示される | OK | `resetChat()` で `chatMessages.innerHTML = ''` 後に再表示 |
| F-401: 言語セレクトがヘッダ領域から操作可能 | OK | `outputLanguageSelect` はヘッダ内に配置 |
| F-401: メッセージ → クイックアクション → 入力バーの縦配置 | OK | CSS フレックスコンテナで順序を維持 |
| F-402: 6 個のボタンが描画されている | OK | `qaExplainPage` / `qaExplainSelection` / `qaSummary` / `qaDetailed` / `qaBeginner` / `qaExpert` |
| F-402: 各ボタン押下時に F-402 表のプロンプト本文と完全一致する user バブルが追加される | OK | `QUICK_ACTIONS` 定数でラベル・プロンプトを固定 |
| F-402: assistant バブルに応答が表示される | OK | `doSendMessage()` で追加 |
| F-402: 応答中はボタンが disabled になる | OK | `setSending()` でクイックアクションボタンと Send ボタンを一括制御 |
| F-402: whole-page 系ボタン押下時に API リクエストに pageText が含まれる | OK | `prepareWholePageMessage()` で `userMessage` にページ本文を埋め込む（F-403） |
| F-402: selection 系押下時に `Page context` と `Explain the following selection` が含まれる | OK | `prepareSelectionMessage()` で F-302 構造を生成 |
| F-403: user バブル本文が F-402 プロンプトと完全一致（pageText 非混入） | OK | `displayText` と `apiContent` を分離。バブルには `displayText`（=プロンプト本文のみ）を表示 |
| F-403: whole-page 系の API リクエスト本文に pageText が同梱 | OK | `apiContent = ${prompt}\n\nPage content:\n${pageContent}` |
| F-403: selection 系に Page context / Explain the following selection が含まれる | OK | F-302 構造を踏襲 |
| F-403: 追加質問で最新メッセージにのみコンテキストが付与される | OK | `chatHistory` にはプロンプト本文のみ積む。API 送信時に `userMessage` = `userText + pageContent` |
| F-403: whole-page 系で pageText < 40 文字のとき F-203 警告 UI が表示される | OK | `runQuickAction()` 内で `pageContent.length < SHORT_CONTENT_THRESHOLD` を判定 |
| F-403: selection 系で selectionText < 40 文字のとき F-203 警告なし・F-204 短文プロンプト使用 | OK | `prepareSelectionMessage()` で `useShortPrompt = selectionText.length < SHORT_CONTENT_THRESHOLD` |
| F-404: Clear ボタン押下で履歴が空になり Welcome が再表示される | OK | `resetChat()` で実装 |
| F-404: URL 変化で履歴が自動クリアされ Welcome が再表示される | OK | `index.ts` の TAB_CHANGED ハンドラで `resetChat()` を呼ぶ |
| F-405: Side Panel に Explain / Chat タブが存在しない | OK | `panel.html` からタブ要素を削除 |
| F-405: タブ切替キーボード操作が無効化 | OK | タブ UI 自体を削除 |

## 実装ログ

- タスク1: panel.html を単一 Chat 画面に刷新
  - 変更: `src/sidepanel/panel.html`
  - タブバー / Explain タブ / Chat タブを削除。Welcome メッセージ領域 / クイックアクション行 / 入力バー（Clear + textarea + Send 横並び）に置き換え

- タスク2: CSS を更新（タブ関連削除・クイックアクション追加）
  - 変更: `src/sidepanel/styles/base.css`
  - `.tab-bar` / `.tab-btn` / `.tab-panel` / `.explain-actions` / `.explain-result` を削除
  - `.quick-actions` / `.btn-quick` / `.chat-input-row` / `.btn-clear` / `.btn-send` を追加

- タスク3: chat.ts を全面改訂（クイックアクション・Welcome・短文警告を統合）
  - 変更: `src/sidepanel/chat.ts`
  - `QUICK_ACTIONS` 定数で 6 個のプリセットを定義（F-402 表と完全一致）
  - `prepareWholePageMessage()` / `prepareSelectionMessage()` で表示用と API 用メッセージを分離（F-403）
  - `runQuickAction()` で whole-page 短文警告 / AbortController によるリスナー管理を実装（F-203）
  - `initChat()` で Welcome メッセージ表示・イベントリスナー登録
  - `resetChat()` でクリア後 Welcome を再表示（F-401/F-404）

- タスク4: index.ts からタブ・Explain 初期化ロジックを除去
  - 変更: `src/sidepanel/index.ts`
  - `initTabs()` / `initExplain()` / `resetExplain()` 呼び出しを削除
  - `TAB_CHANGED` ハンドラで `resetChat()` のみ呼ぶ

- タスク5: messages.ts から EXPLAIN 型を削除し CHAT に useShortPrompt 追加
  - 変更: `src/types/messages.ts`
  - `{ type: 'EXPLAIN'; ... }` ユニオンメンバーを削除（exhaustive switch の `default: never` は維持）
  - `CHAT` に `useShortPrompt?: boolean` を追加（F-204 対応）

- タスク6: background/index.ts から EXPLAIN ハンドラを削除
  - 変更: `src/background/index.ts`
  - `case 'EXPLAIN':` ブロックを削除
  - `case 'CHAT':` で `useShortPrompt` フラグを参照して system プロンプトを切り替え（F-204）

- タスク7: explain.ts を完全削除
  - 削除: `src/sidepanel/explain.ts`

- タスク8: テストを新仕様に合わせて更新
  - 変更: `test/explain.test.ts` - クイックアクション UI テストに全面置き換え
  - 変更: `test/short-content.test.ts` - DOM セットアップを新画面に更新、background EXPLAIN テストを CHAT + useShortPrompt に置換
  - 変更: `test/selection-with-context.test.ts` - DOM セットアップを新画面に更新、background EXPLAIN テストを CHAT 経由に置換
  - 変更: `test/chat.test.ts` - DOM セットアップに shortContentWarning 要素追加、pageContent → userMessage 埋め込みへの期待値修正
  - 変更: `test/output-language.test.ts` - EXPLAIN → CHAT ハンドラのテストに置換

## 動作確認
- typecheck: pass（`npm run typecheck` エラーなし）
- build: pass（`node build.mjs` 全 5 バンドル正常生成）
- test: pass（`npm test` 245 tests / 17 test files 全 pass）

## 既知の課題
- `src/lib/claude.ts` の `getExplainSystemPrompt` は background から参照を外したが、`EXPLAIN_SYSTEM_PROMPT` 定数（deprecated）からの呼び出しが残るため関数自体は残している。今後のクリーンアップ対象。
- `src/types/messages.ts` の `DEFAULT_SETTINGS` は `index.ts` から import されなくなったが不要なら削除可能（既存テストが参照しているためそのまま残した）。

## Evaluator への申し送り事項
- モック化が必要な箇所: `chrome.tabs.sendMessage` (GET_PAGE_CONTENT / GET_SELECTED_TEXT)、`chrome.runtime.sendMessage` (CHAT)、`fetch` (Anthropic API)
- short content warning の AbortController によるリスナークリーンアップが正しく動作することを `test/short-content.test.ts` の `[HIGH]` describe ブロックで検証済み
- F-403 の「最新 user メッセージにのみコンテキスト付与」は `chatHistory` にプロンプト本文のみ積み、`sendFreeInput()` / `doSendMessage()` で apiContent を生成する設計で実現。`chat.test.ts` の 2 ターン目テストで history[0].content === 'Turn 1 question'（pageContent 非混入）を検証済み

---

## Codex 最終レビュー指摘の修正（Sprint 7 追記）

### 修正した指摘

#### [HIGH-1] reset 後の stale CHAT 応答が履歴に紛れ込む
- 対策: モジュールスコープに `currentGeneration` カウンタを追加
  - `doSendMessage()` 冒頭で `const myGen = ++currentGeneration` を取得
  - `chrome.runtime.sendMessage` の resolve/reject 後に `if (myGen !== currentGeneration) return` でガード
  - `resetChat()` で `currentGeneration++` して in-flight な応答を無効化
- 変更: `src/sidepanel/chat.ts`

#### [HIGH-2] selection コンテキストが follow-up で消える
- 対策: `currentContextMode` / `currentSelectionText` をモジュールスコープに追加
  - `prepareSelectionMessage()` に `rawSelectionText?: string` フィールドを追加（再呼び出し不要）
  - `runQuickAction()` の selection 経路で `currentContextMode = 'selection'` / `currentSelectionText = prepared.rawSelectionText` をセット
  - `runQuickAction()` の whole-page 経路で `currentContextMode = 'whole'` / `currentSelectionText = null` に切替
  - `sendFreeInput()` で `currentContextMode === 'selection'` 時は `Page context + User question about the selection` 構造で送信
  - `resetChat()` で `currentContextMode = null` / `currentSelectionText = null` をクリア
  - テスト用ゲッター `getContextMode()` / `getSelectionText()` を export 追加
- 変更: `src/sidepanel/chat.ts`

#### [MEDIUM-1] 短文警告が whole-page 系全クイックアクションで発火
- 対策: `runQuickAction()` の短文チェック条件に `qa.id === 'qaExplainPage'` を追加
  - `if (isExplainPage && pageContent.trim() && pageContent.length < SHORT_CONTENT_THRESHOLD)` で判定
- 変更: `src/sidepanel/chat.ts`

#### [MEDIUM-2] Run anyway 時に useShortPrompt: false が送信される
- 対策: `onRunAnyway` ハンドラ内の `doSendMessage` 呼び出しで `useShortPrompt: true` に変更（第3引数を `false` から `true` へ）
- 変更: `src/sidepanel/chat.ts`

### 新規テスト（test/codex-review-fixes.test.ts）

- [HIGH-1] doSendMessage 中に resetChat() → stale 応答が chatHistory に積まれないこと
- [HIGH-1] stale バブルが chatMessages に追記されないこと
- [HIGH-2] Explain selection → 自由入力で Page context + selection が userMessage に含まれること
- [HIGH-2] Explain selection → Explain page → 自由入力で selection が userMessage に含まれないこと（モード切替）
- [HIGH-2] resetChat() 後は selection コンテキストがクリアされること
- [MEDIUM-1] Summary/Detailed/Beginner-friendly/Expert-level で短文ページでも警告なし（4 ケース）
- [MEDIUM-1] Explain page では短文ページで警告あり（リグレッション確認）
- [MEDIUM-2] Run anyway で useShortPrompt: true が送信されること
- [MEDIUM-2] 通常（長文）Explain page では useShortPrompt: false（リグレッション確認）

### 動作確認（修正後）
- typecheck: pass
- build: pass（全 5 バンドル正常生成）
- test: pass（257 tests / 18 test files 全 pass）

---

## Codex 再レビュー HIGH 指摘の修正（Sprint 7 二次追記）

### 修正した指摘

#### [HIGH] 世代ガードのスコープが狭く、pre-fetch 中の resetChat() に対応できていなかった
- 問題: `doSendMessage()` 冒頭で `const myGen = ++currentGeneration` していたため、`runQuickAction()` や `sendFreeInput()` で pre-fetch（`fetchPageContent` / `fetchSelectedText` / `prepareSelectionMessage`）中に `resetChat()` が走っても、その後 `doSendMessage()` が `++currentGeneration` することで世代が再び進んでしまい、stale な user バブルが描画された
- 対策:
  1. `isStale(gen: number): boolean` ヘルパー関数を追加（`gen !== currentGeneration` の判定を集約）
  2. `doSendMessage()` の `++currentGeneration` を撤去し、代わりに呼び出し元から `gen: number` を受け取るシグネチャに変更
  3. `runQuickAction()` / `sendFreeInput()` の冒頭（pre-fetch 前）で `const myGen = currentGeneration` を取得（インクリメントしない）
  4. 各 await（`fetchPageContent`, `prepareWholePageMessage`, `prepareSelectionMessage`）の直後に `if (isStale(myGen)) return` を追加
  5. `onRunAnyway` コールバック内でも `if (isStale(myGen))` チェックを追加
  6. `doSendMessage()` 内：引数 `gen` を使って API 応答前後に `if (isStale(gen)) return` チェック
  7. `resetChat()` は従来通り `currentGeneration++` のみ（変更なし）
- 変更: `src/sidepanel/chat.ts`

### 新規テスト（test/codex-review-fixes.test.ts に追加）

- [HIGH-1 拡張] `runQuickAction('qaExplainPage')` の `fetchPageContent` pending 中に `resetChat()` → resolve 後も API 呼び出しなし・user/assistant バブルなし
- [HIGH-1 拡張] `sendFreeInput` の `fetchPageContent` pending 中に `resetChat()` → resolve 後も API 呼び出しなし・user/assistant バブルなし
- [HIGH-1 拡張] selection クイックアクションの `fetchSelectedText` pending 中に `resetChat()` → resolve 後も API 呼び出しなし
- [HIGH-1 拡張] API 応答だけ stale ガード（従来テスト）のリグレッションなし確認

### 動作確認（二次修正後）
- typecheck: pass
- build: pass（全 5 バンドル正常生成）
- test: pass（261 tests / 18 test files 全 pass）
