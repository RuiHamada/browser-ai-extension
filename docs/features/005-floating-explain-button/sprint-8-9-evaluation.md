# Sprint 8-9 評価レポート（Floating Explain Button & Markdown Rendering）

## 総合判定: 合格

Sprint 8（F-501/F-502/F-503）と Sprint 9（F-504）は仕様書の受け入れ条件をすべて満たしている。
既存 Sprint 1〜7 のテストにリグレッションはない。`npm run test` / `typecheck` / `build` すべて成功。

## スコア

| 評価基準 | スコア | 閾値 | 判定 |
|----------|--------|------|------|
| 機能の完全性 | 96 | 80 | OK |
| テストカバレッジ | 92 | 70 | OK |
| エラーハンドリング | 88 | 70 | OK |
| 型安全性 / データ整合性 | 95 | 90 | OK |
| コード品質 | 88 | 70 | OK |

## テスト実行結果

- `npm run test`: 22 files / 310 tests passed（既存 280 + Sprint 8/9 追加 30）
- `npm run typecheck`: pass（エラーなし）
- `npm run build`: pass（content.js 10.6kb / sidepanel.js 28.5kb / background.js 12.3kb / popup.js 3.6kb / options.js 5.2kb）

## 受け入れ条件の検証

### Sprint 8 / F-501（Shadow DOM UI）

- Shadow DOM 隔離: `host.attachShadow({ mode: 'open' })` で生成、CSS は Shadow 内 `<style>` のみ → `src/content/floating.ts:75-80`
- ARIA: `aria-label="Explain selected text"` / `tabindex="0"` / `<button type="button">` → `src/content/floating.ts:83-88`
- z-index: `2147483000` を `:host` に適用 → `src/content/floating.ts:8`、`src/content/floating.ts:22`
- 多重インスタンス防止: `getOrCreateHost()` が `document.getElementById(FLOATING_HOST_ID)` を再利用 → `src/content/floating.ts:60-93`
- jsdom テストで host 1 個 / button 1 個 / aria-label 確認済み → `test/floating.test.ts:127-156, 197-`

### Sprint 8 / F-502（Selection 監視）

- 2 文字未満で非表示 → `src/content/floating.ts:230` / テスト `test/floating.test.ts:81`
- `<input type="password">` activeElement / 祖先チェック → `src/content/floating.ts:162-181` / テスト `test/floating.test.ts:108`
- `<textarea>` 内除外 → `src/content/floating.ts:181-184`
- `contenteditable="true"` 内除外 → `src/content/floating.ts:185-187`
- 自己再発火防止 → `src/content/floating.ts:189-191`
- スクロール: `onScroll` が `evaluateSelection` を debounce 50ms で再実行、ビューポート外なら `rect.width===0` 経由で hide → `src/content/floating.ts:259-267, 244-247`
- visibilitychange / mousedown / keyup 全イベント網羅 → `src/content/floating.ts:289-317`
- 選択解除で hide → `src/content/floating.ts:223-226` / テスト `test/floating.test.ts:159-`

### Sprint 8 / F-503（Side Panel 連携）

- メッセージフロー: `FLOATING_EXPLAIN_REQUEST`（content）→ `chrome.sidePanel.open` + pending state セット + `QUICK_ACTION_AUTORUN` ブロードキャスト → Side Panel `triggerQuickActionById` 経路 → `src/background/index.ts:137-161`、`src/sidepanel/index.ts:55-66, 110-122`
- pending state: `Map<tabId, {actionId, selectionText}>` で保持し、`SIDE_PANEL_READY` 受信時に flush → `src/background/index.ts:21, 163-182`
- TAB_CHANGED で pending クリア: `broadcastTabChanged` 内で `pendingQuickAction.delete(tabId)` → `src/background/index.ts:24-36`
- 重複時は最新 selectionText で上書き（`Map.set` のセマンティクス）→ テスト `test/background-floating.test.ts:138-`
- F-402 プリセット文言遵守: `triggerQuickActionById('qaExplainSelection', selectionText)` が `QUICK_ACTIONS` 表の文言を user バブルに表示 → `src/sidepanel/chat.ts:36-40, 736`
- F-302 構造遵守: `Page context (for reference, do not summarize this)` + `Explain the following selection within that context` → `src/sidepanel/chat.ts:723-725`
- discriminated union exhaustive switch: `default: const _exhaustive: never = message;` 維持 → `src/background/index.ts:184-189`、`src/content/index.ts:44-49`
- `chrome.storage.sync` 不使用（grep 確認済み）

### Sprint 9 / F-504（Markdown レンダリング）

- 自前実装で `innerHTML` 不使用 → `src/sidepanel/markdown.ts`（grep 確認: src 内の `innerHTML` 使用は `chat.ts:766` の clear 処理のみで、これは空文字代入のため XSS 影響なし）
- 基本記法 6 カテゴリ全カバー: 段落/見出し h1-h3 / ul / ol / インラインコード / コードブロック（pre+code+`markdown-codeblock` クラス）/ 太字 / イタリック / リンク → テスト `test/markdown.test.ts:22-206`
- リンク `target="_blank" rel="noopener noreferrer"` 自動付与 → `src/sidepanel/markdown.ts:55-59`
- URL スキームホワイトリスト http/https/mailto のみ、`javascript:` / `data:` / `vbscript:` 拒否 → `src/sidepanel/markdown.ts:14-22`、テスト `test/markdown.test.ts:312-332`
- XSS 6 ベクタすべてテスト緑: script / img onerror / javascript: link / iframe / inline onclick / 例外フォールバック → `test/markdown.test.ts:212-305`
- 過去 assistant 履歴も同経路: `appendMessageBubble` の `role === 'assistant'` 分岐は履歴復元 / ストリーミングで共通利用 → `src/sidepanel/chat.ts:185-194`
- 例外時 plaintext フォールバック: `try/catch` で `container.textContent = markdown` → `src/sidepanel/markdown.ts:343-347`
- user / error / meta バブルは引き続き `textContent` 直接代入 → `src/sidepanel/chat.ts:191-194`

## レビュー結果（指摘事項）

重大度 High の指摘なし。以下は Low / 改善余地レベル。

### LOW-1: `cloneNode` による button 差し替えがリスナー再登録のたびに発生

- 該当: `src/content/floating.ts:115-116`
- 内容: `showFloatingButton` 呼び出しごとに `button.cloneNode(true)` で要素を差し替えてリスナーを再登録している。動作上の問題はないが、頻繁に呼ばれる経路ではフォーカス状態がリセットされる可能性がある。`AbortController` でリスナー解除する設計のほうが軽量。
- 影響: なし（仕様準拠）

### LOW-2: `parseInline` のリンク regex が `]` を含むリンク文字に弱い

- 該当: `src/sidepanel/markdown.ts:50` `[([^\]]*)\]`
- 内容: ネストした括弧やエスケープを含むリンク文字（例 `[a\]b](url)`）はパースされない。ただし F-504 の必須カバレッジには含まれていない。
- 影響: なし

### LOW-3: `mouseup` リスナーが selection 操作のたびに発火しデバウンス内で再評価

- 該当: `src/content/floating.ts:284-286`
- 内容: `selectionchange` と `mouseup` 両方からデバウンスタイマーを更新するため、選択完了時に最大 80ms の追加遅延が累積しうる。仕様の 200ms 以内には収まる。
- 影響: なし

### INFO-1: `chat.ts:766` の `innerHTML = ''`（クリア用途）

- 該当: `src/sidepanel/chat.ts:766`
- 内容: `els.chatMessages.innerHTML = '';` は履歴クリアの全削除で、定数空文字を代入しているため XSS 経路はない。F-504 が禁じているのは Markdown 出力での `innerHTML` 経路であり、ここは別文脈。
- 影響: なし（許容範囲）

## 発見されたバグ

なし。

## リグレッション確認

- 既存 280 件のテスト（Sprint 1〜7）は全件 pass
- F-201（output language）/ F-301-303（selection コンテキスト）/ F-401-405（Chat 統合）/ 世代ガード / sanitizer すべて緑
- F-402 のプリセット文言は `QUICK_ACTIONS` 配列で固定維持
- F-405 のタブ UI 撤廃は復活していない

## Generator へのフィードバック

### 必須修正事項

なし。両スプリントとも合格基準を満たす。

### 推奨改善事項（次スプリントの余裕で実施可）

1. `src/content/floating.ts` の button リスナーを `AbortController` で管理することで `cloneNode` 不要にできる
2. `parseInline` のリンク regex を `]` のエスケープに対応させると堅牢性向上
3. ストリーミング途中の Markdown 再描画頻度を `requestAnimationFrame` 単位で間引くと長応答での体感パフォーマンスが向上（仕様 §5 に沿う最適化）

## Orchestrator への報告

合格。Codex 最終レビューに進んでよい。
