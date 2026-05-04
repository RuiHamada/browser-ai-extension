# Sprint 7 評価レポート

## 総合判定: 合格

## スコア
| 評価基準 | スコア | 閾値 | 判定 |
|----------|--------|------|------|
| 機能の完全性 | 95 | 80 | OK |
| テストカバレッジ | 90 | 70 | OK |
| エラーハンドリング | 85 | 70 | OK |
| 型安全性 / データ整合性 | 95 | 90 | OK |
| コード品質 | 85 | 70 | OK |

## テスト実行結果
- `npm run typecheck`: pass
- `npm run build`: pass（5 バンドル: background.js / sidepanel.js / content.js / popup.js / options.js）
- `npm test`: 245 / 245 pass（17 test files）

## 受け入れ条件の充足

### F-401（単一 Chat 画面）
- `src/sidepanel/panel.html` から `role="tablist"` / `tabBtnExplain` / `tabBtnChat` / `.tab-bar` を完全撤廃
- `chatMessages` → `quickActions` → `chat-input-row` の縦順配置を確認（panel.html:46/58/69）
- `initChat()` で Welcome バブル表示（chat.ts:591）。`resetChat()` でも再表示（chat.ts:574）
- 言語セレクトはヘッダ領域に配置（panel.html:18-22）

### F-402（クイックアクション 6 個）
- `QUICK_ACTIONS` 定数のラベル・プロンプト本文がすべて仕様 §F-402 表と完全一致（chat.ts:27-64）
- 6 個の `<button class="btn-quick">` を panel.html:59-64 に配置（順序も仕様通り）
- `setSending()` で全クイックアクション + Send + textarea を一括 disabled（chat.ts:186-194）
- `test/explain.test.ts` で 6 個全ての描画と Summary/Detailed/Beginner/Expert のペイロード検証あり

### F-403（表示と送信ペイロードの分離）
- `displayText`（バブル用）と `apiContent`（API 用）を `PreparedMessage` 構造体で分離（chat.ts:278-289）
- whole-page: `${prompt}\n\nPage content:\n${pageContent}` を `apiContent` のみに付与
- selection: `Page context` + `Explain the following selection` 構造（chat.ts:340-347）
- `chatHistory` には `displayText` のみを push（chat.ts:398）し、過去メッセージにコンテキストが重複付与されないことが `test/chat.test.ts:186` で検証されている
- 自由入力でも最新メッセージにのみ `pageContent` を付与（chat.ts:528-534）

### F-404（履歴クリア・URL 変化リセット）
- `resetChat()` で `chatHistory = []` + `chatMessages.innerHTML = ''` + Welcome 再表示
- `index.ts:62` の `TAB_CHANGED` ハンドラが `resetChat()` を呼ぶ
- `abortShortWarning()` で進行中の警告リスナー（AbortController）を破棄

### F-405（タブ UI 撤廃）
- HTML / CSS / TS から旧タブ要素を全削除。`grep tab-bar|tabBtn|role="tab"|initTabs` で 0 件
- `test/explain.test.ts:288-294` で `tabBtnExplain` / `tabBtnChat` の不在を assert

### 既存スプリントのリグレッション
- F-201 言語切替: `test/output-language.test.ts:164-180` で CHAT 経由の en/ja 切替を検証
- F-203 短文警告: `test/short-content.test.ts` で `Explain page` 経路のみ発火 / Run anyway / Cancel / リスナークリーンアップを検証
- F-204 短文プロンプト: `useShortPrompt` フラグの background 振り分けを `test/short-content.test.ts:247-300` で検証
- F-301/F-302/F-303: `test/selection-with-context.test.ts` で selection 時のページ本文同時搬送 / 警告抑止 / 短文プロンプト切替を検証
- F-008 URL 変化リセット: `test/sidepanel.test.ts` 等で TAB_CHANGED 時の `resetChat()` 動作を検証

### EXPLAIN 撤廃と網羅性
- `BackgroundMessage` から `EXPLAIN` ユニオンメンバーを削除（messages.ts:38-60）
- `background/index.ts:128-133` の `default` 分岐に `_exhaustive: never` キャストが残り、新メッセージ追加時に型エラーで気付ける
- `useShortPrompt?: boolean` を `CHAT` に追加し F-204 を CHAT 経路に統合（messages.ts:55-58）

### セキュリティ
- `chrome.storage.sync` への書き込み: 0 件（grep 確認済み）
- API キーマスク: `maskApiKey()` を `GET_SETTINGS` で適用（background/index.ts:138-143）
- `sanitizeErrorMessage` / `sanitizeErrorForLog` を chat.ts のエラー経路で一貫適用
- バブル描画は `textContent` のみ（chat.ts:161）。XSS 経路なし
- Welcome メッセージは「送信ペイロードに含めない」原則を `chatHistory` 設計で担保

## 発見された指摘事項

### [LOW-001] `test/background.test.ts` に古い `EXPLAIN` メッセージ送信が残存
- 該当: `test/background.test.ts:104, 220`
- 状況: テストは `{ type: 'EXPLAIN', content: 'test' }` を `callListener` に渡しているが、`BackgroundMessage` ユニオンから `EXPLAIN` は削除済み
- 影響: 実行時には `default` 分岐に落ち、`{ error: 'Unknown message type' }` が返る。テスト自体は assert（API キーが含まれないこと）が満たされて pass しているため緑のままだが、本来意図した「EXPLAIN ハンドラの sanitize 経路」の検証にはなっていない
- 重大度: Low（既存 sanitize 経路は CHAT 系の他テストで担保されている）
- 推奨: テスト本体を `{ type: 'CHAT', userMessage: 'test', history: [], pageContent: '' }` に置換するか、当該ケース 2 件を削除

### [LOW-002] `getExplainSystemPrompt` / `EXPLAIN_SYSTEM_PROMPT` がコードに残存
- 該当: `src/lib/claude.ts:160`、関連テスト `test/claude.test.ts:146-147`
- 状況: background から参照されなくなったが deprecated 定数として残っている
- 影響: 実害はない。デッドコード気味
- 推奨: 次スプリントでクリーンアップ（自己評価でも Generator が「今後のクリーンアップ対象」と申告済み）

### [LOW-003] `DEFAULT_SETTINGS` の利用箇所減少
- 該当: `src/types/messages.ts:26-30`
- 状況: `index.ts` から import されなくなったが、`storage.ts` / 既存テストが参照しているため残置
- 重大度: Low（実害なし）

## 結論

合格基準を満たしており、Codex 最終レビューに進めて問題ない。

- F-401〜F-405 の受け入れ条件を 100% 充足
- 既存 F-001〜F-013 / F-201〜F-204 / F-301〜F-303 にリグレッションなし
- `npm run check` 成功、245 テスト全 pass
- セキュリティ規約（API キー露出禁止 / `chrome.storage.sync` 不使用 / exhaustive switch）遵守
- 対象外機能（Anki / 閲覧履歴 / 履歴永続化 / クイズ生成）の混入なし

次スプリント以降のクリーンアップ候補として Low 指摘 3 件を申し送る。
