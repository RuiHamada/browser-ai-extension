# Sprint 2 評価レポート

## 総合判定: 合格（条件付き）

機能・テスト・型安全・MV3 適合性のすべてにおいて閾値を満たしている。
ただし Sprint 1 評価で指摘済みの **AVAILABLE_MODELS のモデル ID 問題** が
未修正のまま再提出されており、Codex 最終レビューまでに修正が必須。
合格判定はあくまで Sprint 2 範囲（DOM 抽出・Explain・エラー処理・切り詰め）に限る。

## スコア

| 評価基準 | スコア | 閾値 | 判定 |
|----------|--------|------|------|
| 機能の完全性 | 92 | 80 | OK |
| テストカバレッジ | 88 | 70 | OK |
| エラーハンドリング | 85 | 70 | OK |
| 型安全性 / データ整合性 | 92 | 90 | OK |
| コード品質 | 78 | 70 | OK |

## テスト実行結果

- `npm run typecheck`: pass（エラー 0）
- `npm run build`: pass（5 エントリポイントすべてビルド成功）
- `npm run test`: pass
  - Test Files: 11 passed
  - Tests: 87 passed / 0 failed / 0 skipped
  - 実行時間: 1.35s

### Sprint 1 リグレッション

Sprint 1 時点の 44/49 件を含む 11 ファイル 87 件すべて pass。
リグレッションなし。

## 受け入れ条件の検証（仕様書 §6 Sprint 2 合格基準）

| 受け入れ条件 | 検証方法 | 判定 |
|--------------|----------|------|
| 一般的な記事ページで本文抽出が 2 秒以内に完了 | jsdom 走査は同期で <10ms（実測）。閾値は十分余裕 | OK |
| `<script>`/`<style>`/`<noscript>` の内容を含まない | `test/extract.test.ts` 各タグ単体・複合テスト 4 件 | OK |
| ページ全体 Explain で英語解説が表示される | `EXPLAIN_SYSTEM_PROMPT` が "Always respond in English" を含み、`test/claude.test.ts:143` でリクエスト body の system に English が含まれることを検証 | OK |
| 選択範囲 Explain で選択テキストに基づく解説が表示される | `test/explain.test.ts:189` で EXPLAIN メッセージの content が選択テキストを含むことを検証 | OK |
| API エラー時にユーザー向けメッセージが表示され、API キーが UI に露出しない | `test/claude.test.ts` 401/429/4xx/5xx/network 各テスト + sk-ant-* 漏洩テスト 2 件 | OK |
| 上限超過ページでも API 呼び出しが成功し、切り詰め通知が表示される | `test/extract.test.ts:76` で truncated=true を検証、`test/explain.test.ts:92` で truncatedNotice 表示を検証 | OK |

## レビュー結果（コード）

### 重大な指摘

なし。

### 中程度の指摘

- **[M-001] `src/types/messages.ts:35-40` — AVAILABLE_MODELS のモデル ID が Anthropic 実 ID 形式と不一致（Sprint 1 評価で指摘済み・未修正）**
  - 現状: `claude-haiku-4-5`, `claude-sonnet-4-5`, `claude-sonnet-4-6`, `claude-opus-4-5`
  - Anthropic の実 ID は `claude-3-5-haiku-20241022`, `claude-3-5-sonnet-20241022`, `claude-haiku-4-5-20251001`（バージョン日付付）等の形式。
  - Generator の自己評価では「`claude-sonnet-4-6` は本 Generator 自身の ID なので有効」とあるが、これは Generator のハルシネーションであり、Anthropic API では 404/`invalid_request_error` を返す可能性が高い。
  - Sprint 2 のテストはすべて fetch をモックしているため、この不整合は型・テストでは検出できない。実 API 呼び出し時に Explain がすべて失敗するリスクがある。
  - **修正必須**: Anthropic 公式ドキュメントで現行有効な ID（少なくとも `claude-3-5-haiku-20241022` と `claude-3-5-sonnet-20241022` 等）に置き換えるか、ドキュメント由来の ID であることをコメントで根拠付けること。`DEFAULT_SETTINGS.aiModel` および `claude.ts:98` の `DEFAULT_MODEL` も同期して更新する。

### 軽微な指摘

- **[L-001] `src/sidepanel/explain.ts:122-126` — background から返される `resp.error` 文字列がそのまま `showError` に渡される（sanitize 未経由）。**
  catch 経路では `sanitizeErrorMessage` が適用されているが、background → sidepanel の正常レスポンス経路（`{ error: string }`）には適用されていない。`callClaudeAPI` の throw メッセージは現状 API キーを含まないため実害はないが、深層防御として `sanitizeErrorMessage(resp.error)` を通すのが望ましい。
- **[L-002] `src/background/index.ts:50` — 未知エラーが `sendResponse({ error: e.message })` でそのまま返される。**
  L-001 と同根。background 側でも sanitize レイヤーを通すか、メッセージ生成箇所をホワイトリスト化することを推奨。
- **[L-003] `src/lib/claude.ts:127` — `apiErrorDetail` のフィルタが `'sk-ant'` `'api-key'` のサブストリング判定のみ。**
  paranoid check としては妥当だが、コメントどおり「念のため」のレイヤーであることを明示しておくと将来の改修者が誤って外しにくい。
- **[L-004] `src/content/extract.ts:8` — `EXCLUDED_TAGS` に `IFRAME` `SVG` が含まれない。**
  クロスオリジン iframe は `textContent` が取れず実害は少ないが、同一オリジン iframe のフォーム値・アイコン SVG のテキストが混入しうる。仕様書の必須要件は満たしているので Sprint 内では指摘のみ。
- **[L-005] `src/sidepanel/explain.ts:32` — `isRunning` がモジュールスコープのトップレベル変数。**
  ホットリロードや `vi.resetModules` で初期化される前提。MV3 sidepanel では SW と異なり寿命が長いので問題はないが、テストごとに `vi.resetModules()` が呼ばれることに依存している点は留意。

### セキュリティ・PII 観点

- API キーの平文露出経路は確認できず（`x-api-key` ヘッダのみで使用）。
- エラーメッセージへの API キー混入を 2 系統（claude.ts の `apiErrorDetail` フィルタ / explain.ts の `sanitizeErrorMessage`）でブロック。テストで検証済み。
- DOM 全文をログに残す箇所なし（`console.error` には `e` オブジェクトのみ渡される）。
- `host_permissions` は `<all_urls>` だが Sprint 2 の DOM 抽出に必要。送信先は `https://api.anthropic.com/*` に限定済み。

### MV3 適合性

- `service_worker` のモジュールスコープにイベントリスナー登録のみ。可変状態を持たない。
- `chrome.runtime.onMessage` リスナーは非同期レスポンスで `return true` を返す標準パターン。
- `chrome.tabs.sendMessage` 失敗時の例外ハンドリングは catch 経由で `sanitizeErrorMessage` に渡るので、content script が注入されていないページ（`chrome://`）でもクラッシュしない。

### 型安全性 / データ整合性

- `BackgroundMessage` discriminated union に `EXPLAIN` を正しく追加（messages.ts:6）。
- `MESSAGE_HANDLERS` の `EXPLAIN` ハンドラは `Extract<Message, { type: 'EXPLAIN' }>` で narrow しており型安全。
- `content/index.ts` のレスポンス型と `sidepanel/explain.ts:103` のキャスト型（`{ url, content, truncated, originalLength }`）は一致しているが、レスポンス型を共通の interface としてエクスポートすると保守性が上がる（推奨）。

### 対象外機能の混入

- Anki 連携、閲覧履歴、クイズ生成のコードなし。
- `host_permissions` `<all_urls>` は本来 Sprint 2 の必要権限であり、過剰ではない。

## 発見されたバグ

なし（重大度 High / Medium のロジックバグはなし）。

## Generator へのフィードバック

### 必須修正事項

- **[M-001 / Sprint 1 残課題] AVAILABLE_MODELS のモデル ID 修正**
  - Sprint 1 評価レポート §中程度の指摘でも明示済み。
  - Generator 自身が動作するモデル ID を「自分は X だから X は有効」と推定するのはハルシネーション。Anthropic 公式ドキュメント（context7 の `/anthropics/anthropic-sdk-typescript` または公式 API リファレンス）で現行モデル ID を確認すること。
  - 暫定的に確実に動くもの: `claude-3-5-haiku-20241022`, `claude-3-5-sonnet-20241022`, `claude-3-5-sonnet-latest`（latest エイリアスを使う場合は将来挙動が変わる旨をコメント明記）。
  - `DEFAULT_SETTINGS.aiModel`（messages.ts:31）と `DEFAULT_MODEL`（claude.ts:98）も同期して更新すること。

### 推奨改善事項

- L-001 / L-002: background → sidepanel 経路でも `sanitizeErrorMessage` を通す（深層防御）。
- L-004: `EXCLUDED_TAGS` に `IFRAME`, `SVG` を追加（任意）。
- 型: content script のレスポンス型を `src/types/messages.ts` に切り出し、sidepanel の `as` キャストを構造的に型付けする。
