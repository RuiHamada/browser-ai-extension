# Sprint 6 評価レポート

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

- `npm run typecheck`: pass（エラーなし）
- `npm run test`: 241 passed / 0 failed（17 ファイル）
- `npm run build`: pass（dist/{background,content,sidepanel,options,popup}.js 生成）

新規テストファイル `test/selection-with-context.test.ts` は 19 件（spec 受け入れ条件をほぼ網羅）。
既存テスト（`test/short-content.test.ts`、`test/explain.test.ts` 等）も F-303 仕様に合わせて
更新されており、全パス。

## 受け入れ条件の検証

### F-301 ページ本文搬送

- 選択モードで `chrome.tabs.sendMessage` が `GET_SELECTED_TEXT` → `GET_PAGE_CONTENT` の順に
  呼ばれ、両方の結果を background に EXPLAIN(mode='selection', selectionText, pageContent)
  として送る（`src/sidepanel/explain.ts:232`〜）
- ページ本文取得失敗時は try/catch で空文字フォールバック（`src/sidepanel/explain.ts:246`〜）
  → API は選択テキストのみで呼ばれる。テストでも検証済み（selection-with-context.test.ts:144）
- 選択空のときは API 呼ばれずエラー表示（`src/sidepanel/explain.ts:237`）
- 全体モードの挙動は破壊されていない（リグレッションテスト pass）

### F-302 プロンプト構造

- 選択モードの user prompt に `Page context (for reference, ...)` と
  `Explain the following selection within that context:` 両方が含まれる
  （`src/background/index.ts:127-129`）
- `pageContent` は content script 側で `CONTENT_MAX_CHARS=20000` 切り詰め済みの値を
  そのまま埋め込む（仕様通り）
- `selectionText` は background 側で `SELECTION_MAX_CHARS=5000` 切り詰め + `…` 付加
  （`src/background/index.ts:120-122`）
- 切り詰め通知は `doSelectionExplainRequest` でページ本文・選択テキスト両方について表示
  （`src/sidepanel/explain.ts:158-177`）
- `outputLanguage` は `getExplainSystemPrompt` / `getShortExplainSystemPrompt` 経由で
  既存仕様通り反映（テストで `Japanese` / `English` 両方を検証）
- pageContent 空（trim() で空）のときは `Page context` セクションを省略しフォールバック
  （`src/background/index.ts:125-133`）

### F-303 短文警告条件

- 選択モードでは `runExplain()` の `if (mode === 'selection')` ブロックで早期 return
  しており、F-203 の短文警告 UI（`shortContentWarning`）は表示されない
  （`src/sidepanel/explain.ts:259-266`）
- F-204 短文プロンプト切替は background 側で `selectionText.length < SHORT_CONTENT_THRESHOLD`
  により実行される（`src/background/index.ts:114`）
- 全体モードの警告挙動は変更なし（テストでリグレッション検証済み）

### Discriminated Union / Exhaustive Switch

- `BackgroundMessage` で EXPLAIN を `mode: 'whole'` と `mode: 'selection'` の 2 ユニオンに
  分割（`src/types/messages.ts:43-48`）
- background の `case 'EXPLAIN':` 内で `if (message.mode === 'selection')` 早期 return →
  以降は TypeScript が自動的に `mode: 'whole'` に narrow し `message.content` アクセスが安全
- 外側の `default: const _exhaustive: never = message;` は未知の `type` 値で型エラー化される。
  既存規約を維持

### セキュリティ不変条件

- API キー漏洩防止: `sanitizeErrorMessage` / `sanitizeErrorForLog` 既存パスを維持
- DOM 全文ログ禁止: 新規 console.error は失敗フラグのみ（`src/sidepanel/explain.ts:254`）。
  pageContent 本体はログに出していない
- `chrome.storage.sync` への新規書き込みなし
- URL 変化時のリセット (`resetExplain`) は変更なし、既存挙動を維持

## 発見された軽微な指摘（ブロッキングではない）

- **[NIT-001] 重大度: Low** — `src/sidepanel/explain.ts:169`
  - 選択モードの 2 回目以降の実行で、前回 `truncatedNotice.textContent` に書いた値が
    クリアされない。`runExplain()` 開始時 (line 217) で `classList.add('hidden')` するが
    `textContent` は空にしないため、ページ本文未切り詰め × 選択切り詰めのケースで
    `existingText` に古い文字列が残り「stacked notice」が出る可能性。
  - 影響範囲: 同一タブで連続実行した場合のみ。実害は通知文字の重複表示に限られる。
  - 提案: `runExplain` 冒頭で `els.truncatedNotice.textContent = ''` を追加。または
    `doSelectionExplainRequest` 冒頭で個別にクリア。
  - これは Sprint 6 で導入されたコードに起因するため Sprint 6 の改善対象。ただし
    F-302 の受け入れ条件は満たしているため不合格には至らない。

- **[NIT-002] 重大度: Low** — `src/background/index.ts:128`
  - `pageContent` 内に `</page>` 文字列が含まれていた場合、タグ境界が壊れて Claude 側の
    解釈が乱れる可能性（プロンプトインジェクション類似）。spec では明示要求されていない
    ためブロッキングではないが、将来の硬化候補。

## Generator へのフィードバック

### 必須修正事項
- なし（合格）

### 推奨改善事項
1. NIT-001（truncatedNotice の textContent クリア）を次スプリント or 本スプリントの cleanup 対応で修正
2. （任意）NIT-002 のプロンプトインジェクション緩和を将来検討

## 結論

Sprint 6 は spec §F-301 / F-302 / F-303 の受け入れ条件をすべて満たし、リグレッションも
発生していない。`npm run check`（typecheck + build）+ `npm run test` 全て成功。
**Codex による最終レビューに進むことを推奨**。
