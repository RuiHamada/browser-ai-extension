# Sprint 5 評価レポート（feature/002）

対象機能: F-202 DOM 抽出堅牢化 / F-203 短文警告 UI / F-204 短文プロンプト

## 総合判定: 合格

仕様書 §Sprint 5 合格基準（F-202 受け入れ条件、既存バグ再現 fixture、警告 UI、短文プロンプト指示、Sprint 1〜4 リグレッションなし）をすべて満たす。`npm run test` / `npm run typecheck` / `npm run build` のいずれもエラーなし。

## スコア

| 評価基準 | スコア | 閾値 | 判定 |
|----------|--------|------|------|
| 機能の完全性 | 95 | 80 | OK |
| テストカバレッジ | 92 | 70 | OK |
| エラーハンドリング | 85 | 70 | OK |
| 型安全性 / データ整合性 | 95 | 90 | OK |
| コード品質 | 88 | 70 | OK |

## テスト実行結果

- `npm run test`: 16 files / **210 passed** (既存 166 + 新規 44)、failures 0、skipped 0
- `npm run typecheck`: pass
- `npm run build`: pass（background.js 11.8kb / sidepanel.js 17.2kb / options.js 5.2kb / popup.js 3.6kb）

## 受け入れ条件の検証

### F-202: DOM 抽出の堅牢化

| 条件 | 結果 | 根拠 |
|------|------|------|
| `<main>` 優先で `<nav>` 配下を含まない | OK | `src/content/extract.ts:72`、`test/extract-v2.test.ts:25` |
| `<article>` を持つページで `<header>` ナビが先頭に来ない | OK | `src/content/extract.ts:18`（HEADER 除外）、`test/extract-v2.test.ts:39` |
| `<script>`/`<style>`/`<noscript>` の維持 | OK | `test/extract-v2.test.ts:314`〜 |
| `aria-hidden="true"` 除外 | OK | `src/content/extract.ts:38`、`test/extract-v2.test.ts:370` |
| open Shadow Root を取り込み | OK | `src/content/extract.ts:49`、`test/extract-v2.test.ts:213` |
| closed Shadow Root は対象外 | OK | `host.shadowRoot === null` で自然に到達不可、`test/extract-v2.test.ts:236` |
| 空白正規化 | OK | `src/content/extract.ts:116`、`test/extract-v2.test.ts:284` |
| `"notable"` 既存バグ再現 fixture が解消 | OK | `test/extract-v2.test.ts:401` |
| 上限切り詰め（F-012）リグレッションなし | OK | `test/extract-v2.test.ts:384` |

優先順序の優位性（main > article > role=main > body）も `test/extract-v2.test.ts:86` で `<main>` が `<article>` に勝つことを直接検証。SVG 名前空間の小文字 tagName 対策も `tagName.toUpperCase()` で吸収（`src/content/extract.ts:35`）。

### F-203: 短文警告 UI

| 条件 | 結果 | 根拠 |
|------|------|------|
| 40 文字未満で警告 + Run anyway / Cancel ボタン表示 | OK | `src/sidepanel/explain.ts:182`、`src/sidepanel/panel.html:73` |
| 警告中は API 呼び出しが発生しない | OK | `test/short-content.test.ts:84`（`expect(sendMessage).not.toHaveBeenCalled()`） |
| 警告メッセージに `extracted N chars` 相当の文字数を含む | OK | `src/sidepanel/explain.ts:74`、`test/short-content.test.ts:80` |
| Cancel で API 呼び出しが行われない | OK | `test/short-content.test.ts:171` |
| 40 文字以上では即実行 | OK | 境界値 40 で警告非表示・即実行を確認（`test/short-content.test.ts:87`） |
| 選択空時の挙動（F-004）が変わらない | OK | `src/sidepanel/explain.ts:160`〜（empty 時は従来どおり error 表示） |
| `role="alert"` 相当 | OK | `src/sidepanel/panel.html:73`、`test/short-content.test.ts:178` |

### F-204: 短文プロンプト

| 条件 | 結果 | 根拠 |
|------|------|------|
| 入力 < 40 で短文 system prompt が選択 | OK | `src/background/index.ts:111`、`test/short-content.test.ts:249` |
| ≥ 40 で通常 prompt | OK | `test/short-content.test.ts:258` |
| 出力言語が `outputLanguage` に従う（en/ja 双方） | OK | `src/lib/claude.ts:132`、`test/short-content.test.ts:269,277` |
| 共通閾値定数の単一ソース化 | OK | `SHORT_CONTENT_THRESHOLD` を `src/content/extract.ts:11` で定義し、background / explain.ts が import |

## レビュー結果

指摘件数: 0（重大）/ 軽微 2件

### 軽微 (Nit)

- **N-001 `BUTTON` の除外**（`src/content/extract.ts:20`）
  - 仕様には明記されていないが、フォーム内 UI 要素として除外されている。実用的には妥当だが、`<button>` 内に意味のある本文（例: ニュースの「次の記事」見出しが button 化されている等）が含まれるサイトでは取りこぼす可能性がある。リスク低、現状の実装で問題なし。
- **N-002 短文警告の Promise 未 cleanup ケース**（`src/sidepanel/explain.ts:187`）
  - `runExplain` が新規実行されたとき、前回の警告が未確定だった場合のリスナー残留を `clearError` / `hideShortWarning` でクリアしているが、未解決 Promise 自体は残る。実害はなく、UI は一意化されるためテストでも失敗しない。

## セキュリティ / プライバシー検証

- API キーの露出経路なし（`callClaudeAPI` ヘッダのみ、`buildHttpErrorMessage` で paranoid フィルタ）
- `console.error` での DOM 全文出力なし。`sanitizeErrorForLog` が一貫して適用
- `chrome.storage.sync` への新規書き込みなし（grep 確認: 該当 0）
- 警告 UI のテキストは `textContent` 経由で innerHTML を使用していない（XSS なし）
- Shadow DOM 走査は open mode のみで、closed には触らない（プライバシー上の安全側）

## 型安全性 / データ整合性

- `BackgroundMessage` の exhaustive switch 維持（`src/background/index.ts:142`、`_exhaustive: never`）
- `extractPageContent` の戻り値型 `ExtractResult` は既存 Sprint と同じシグネチャ（`content` / `truncated` / `originalLength`）でリグレッションなし
- `SHORT_CONTENT_THRESHOLD` は単一 export、background と explain.ts の双方で同一値を参照

## リグレッション検証

- 既存テスト 166 件 + 新規 44 件 = 210 件すべて pass
- 切り詰め動作（F-012）/ aria-hidden / hidden / script-style-noscript の旧条件はすべて新テストでも維持確認
- output-language（Sprint 4）のテストも引き続き pass

## Generator へのフィードバック

### 必須修正事項
- なし

### 推奨改善事項
- N-002 のリスナー残留について、`runExplain` 冒頭で前回の `btnRunAnyway` / `btnCancelShort` のリスナーを明示的に剥がす実装にすると堅牢性が増す（現状は cleanup が onClick 内で行われるため二重起動はないが、防御的に追加可）
- `selectContainer` のフォールバック判定が「container 選択 → 抽出後の文字数評価」ではなく「container 選択のみ」になっているため、仕様書 §F-202 抽出仕様 4 の「抽出文字数が下限未満の場合は `<body>` をフォールバック」は実装されていない。ただし受け入れ条件と Sprint 5 合格基準には含まれない（受け入れ条件は「下限未満で警告 UI」と「fixture でバグ再現しない」のみ）ため判定は合格。将来の改善として、`<main>`/`<article>` を選んだ結果が極端に短い場合の二段階フォールバックを検討するとよい

## Orchestrator への報告

Sprint 5 は合格。Codex 最終レビューに進んでよい。