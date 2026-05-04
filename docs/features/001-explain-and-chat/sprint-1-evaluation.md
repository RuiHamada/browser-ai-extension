# Sprint 1 評価レポート

## 総合判定: 合格（再評価後も合格を維持）

> 2026-05-04 追記: Codex 最終レビュー HIGH 指摘（保存済み API キーが options 画面の `<input>` に平文ロードされる）への修正対応を再評価。下部「## 再評価（Codex HIGH 指摘修正後）」を参照。

## 初回評価（参考）

## スコア

| 評価基準 | スコア | 閾値 | 判定 |
|----------|--------|------|------|
| 機能の完全性 | 95 | 80 | OK |
| テストカバレッジ | 85 | 70 | OK |
| エラーハンドリング | 80 | 70 | OK |
| 型安全性 / データ整合性 | 92 | 90 | OK |
| コード品質 | 82 | 70 | OK |

## テスト実行結果

- `npm run typecheck`: pass（エラー 0）
- `npm run build`: pass（5 エントリポイントすべてビルド成功）
- `npm run test`: pass
  - Test Files: 8 passed
  - Tests: 44 passed / 0 failed / 0 skipped
  - 実行時間: 877ms

### 追加した依存と設定

- `devDependencies`: `vitest`, `jsdom`, `@types/chrome` を追加
- `scripts.test`: `vitest run` を追加
- `vitest.config.ts`: jsdom 環境、`globals: true`、`include: ['test/**/*.test.ts']`

### テストファイル

- `test/storage.test.ts` — 7 件（loadSettings / saveSettings / hasApiKey / sync 非書込）
- `test/messages.test.ts` — 4 件（AVAILABLE_MODELS / DEFAULT_SETTINGS の整合性）
- `test/background.test.ts` — 7 件（OPEN_SIDE_PANEL / SAVE_SETTINGS / GET_SETTINGS の伏字化 / sidePanel.setPanelBehavior）
- `test/content.test.ts` — 2 件（GET_SELECTED_TEXT / GET_PAGE_CONTENT）
- `test/options.test.ts` — 8 件（DOM 操作、保存、Show/Hide、Clear、空入力時の上書き防止）
- `test/popup.test.ts` — 5 件（警告表示、サイドパネル起動、設定誘導）
- `test/sidepanel.test.ts` — 6 件（URL 表示、警告切替、TAB_CHANGED 受信）
- `test/manifest.test.ts` — 6 件（MV3 / side_panel / 権限）

## 受け入れ条件の検証（仕様書 §6 Sprint 1 合格基準）

| 受け入れ条件 | 検証方法 | 判定 |
|--------------|----------|------|
| Options で API キーを保存し、再起動後も保持される | `test/options.test.ts` 保存テスト + `test/storage.test.ts` 保存・読込テスト | OK |
| `chrome.storage.sync` に API キーが書き込まれていない | `test/storage.test.ts` / `test/options.test.ts` / `test/background.test.ts` で `mock.storage.sync.set` 未呼出を確認 | OK |
| 保存済み API キーが UI 上で平文表示されない | `test/options.test.ts` で `<input type="password">` 維持確認 + `test/background.test.ts` で `GET_SETTINGS` が伏字を返すことを確認 | OK |
| モデル選択が保存・反映される | `test/options.test.ts`「保存済みモデルが select に反映される」 | OK |
| API キー未設定で起動時に誘導メッセージが出る | `test/popup.test.ts` / `test/sidepanel.test.ts` の警告表示テスト | OK |

## レビュー結果（コード）

### 重大な指摘
なし。

### 中程度の指摘
- `src/types/messages.ts:34` — `AVAILABLE_MODELS` のモデル ID（例: `claude-haiku-4-5`, `claude-sonnet-4-6`）は Anthropic API の実 ID 形式（例: `claude-3-5-haiku-20241022`）と異なる可能性が高い。Sprint 1 の保存・反映テストは通るが、Sprint 2 で API 呼び出し時に 404 になる恐れあり。Sprint 2 着手時に最新の有効モデル ID へ差し替えること。

### 軽微な指摘
- `src/options/options.ts:24,48` — 設定の読み書きを `chrome.storage.local` 直叩きで行っており、`src/lib/storage.ts` の `loadSettings` / `saveSettings` ヘルパーを使っていない。重複ロジックは将来的なバグ温床（伏字仕様の二重定義など）になりうる。Sprint 2 のリファクタで統一を推奨。
- `src/background/index.ts:42-53` — `MESSAGE_HANDLERS[message.type]` のルックアップで未知の `type` の場合に `sendResponse` が呼ばれず `undefined` を返す（リスナーは `true` を返さない）ので問題はないが、未対応 type をログに残すと運用時のデバッグが容易になる。
- `src/background/index.ts:11-39` — `TAB_CHANGED` ブロードキャストは仕様上 Sprint 3（F-008）の機能だが、Sprint 1 で先行実装されている。`.catch(() => {})` でサイレント失敗にするのは MV3 では一般的だが、本番では `console.debug` 程度のログを残すと監視しやすい。
- `src/popup/popup.ts:9` — `tab` が undefined の場合（ウィンドウにアクティブタブがない極端なケース）に `tab.windowId` でランタイムエラーになる。`tab?.windowId` への変更を推奨。
- `src/background/index.ts:84-89` — `maskApiKey` は短いキー（≤8 文字）に対して `'****'` を返す。テスト用ダミーで誤って空文字や短文字列を渡した場合の挙動として妥当。

### セキュリティ・PII 観点
- API キーを `console` / UI に平文露出する箇所なし（確認済み）。
- DOM 全文をログに残す箇所なし（Sprint 1 範囲ではそもそも DOM 抽出を行っていない）。
- `chrome.storage.sync` への書込なし（テストで検証済み）。
- `host_permissions` は `<all_urls>` を含むが、Sprint 2 以降の content_script による DOM 抽出に必要。Anthropic API オリジンが限定列挙されているのは妥当。

### MV3 適合性
- `service_worker` の永続前提コードなし（モジュールスコープに状態を持たない）。
- `chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })` を起動時に登録（F-009 の「アイコンクリックで開く」を実現）。
- `onMessage` リスナーは非同期レスポンスで `return true` を返している（標準パターン）。

### 対象外機能の混入チェック
- Anki 連携、閲覧履歴、クイズ生成のいずれも実装されていない（grep 結果ゼロ）。

## 発見されたバグ
なし（重大バグは検出されず）。

## Generator へのフィードバック

### 必須修正事項
なし（合格）。

### 推奨改善事項（次スプリント着手前または並行で対応）
1. `src/types/messages.ts` の `AVAILABLE_MODELS` を最新の有効な Anthropic モデル ID に差し替え（Sprint 2 で API 呼び出しを行う前に必須）。
2. `src/options/options.ts` の `chrome.storage.local` 直接呼び出しを `loadSettings`/`saveSettings` ヘルパーに統一。
3. `src/popup/popup.ts:9` を `tab?.windowId` に変更し、tab undefined 時の防御を追加。
4. アイコンファイル（icons/icon{16,48,128}.png）を正式なものに差し替え（自己評価で既知の課題として申告済み）。

## Evaluator 申し送り

- Sprint 2 では `lib/claude.ts`（Claude API クライアント）が新規追加される予定。`fetch` のモックを使ったエラーハンドリング（4xx / 5xx / ネットワーク失敗の区別）テストを必ず書くこと。
- DOM 抽出（F-003）のテストは jsdom 上に `<script>`/`<style>`/`<noscript>` を含む HTML を組み立てて行えば十分（chrome.scripting.executeScript のモックも併用）。

---

## 再評価（Codex HIGH 指摘修正後）

### 判定: 合格

### Codex HIGH 指摘内容
- 保存済み API キーが options 画面ロード時に `<input id="apiKey">` の value にセットされ、DOM 上で平文閲覧可能（DevTools / 拡張機能ストアレビュー / アクセシビリティツール経由で露出）。仕様書 §F-001 / §セキュリティ「API キーを UI のテキストノードやログに平文で出さない」と §Sprint 1 合格基準「保存済み API キーが UI 上で平文表示されない」に違反。

### 修正内容（実装確認）
`src/options/options.ts:35-51` `src/options/options.html:93-100`

- `loadSettings()` で `data['apiKey']` を `<input>` の `value` に代入する処理を撤去。代わりに別 span (`#apiKeyMask`) に `Saved: <prefix>...<suffix4>` の形でマスク表示（`maskApiKey`、`src/options/options.ts:12-20`）。
- options.html から Show/Hide トグルボタンを撤去（input は常時 `type=password`）。
- `<input id="apiKey">` の placeholder を `Enter new key to replace...` に変更し、空欄時は既存キーを維持する旨の注記を追加（`src/options/options.html:93,98-100`）。
- 保存後 `input.value = ''` でクリアし、マスク span を更新（`src/options/options.ts:66-70`）。
- Clear ボタンでマスク span も非表示化＆ textContent クリア（`src/options/options.ts:79-89`）。

### 追加されたテスト（test/options.test.ts）
- `test/options.test.ts:45-51`「保存済みAPIキーが input の value にロードされない（平文が DOM に現れない）」 — `mock.storage.local._data['apiKey']` に値を入れた状態で options を import し、`inp.value === ''` を assert。HIGH 指摘の核心を直接カバー。
- `test/options.test.ts:53-61`「マスク span に末尾4文字付きで表示」 — `AAAA` を含み `secretvalue` を含まないことを assert。プレフィックス + 末尾 4 文字仕様を検証。
- `test/options.test.ts:63-67`「保存済みキーがない場合はマスク span が非表示」 — `style.display === 'none'`。
- `test/options.test.ts:84-93`「保存後に input.value がクリアされる」 — 保存ボタンクリック後 `inp.value === ''`。
- `test/options.test.ts:95-107`「保存後にマスク span が更新される」 — 末尾 4 文字を含み平文を含まないことを assert。
- `test/options.test.ts:131-140`「Clear ボタンでマスク span が非表示になる」 — `display: none` かつ `textContent === ''`。

カバレッジは仕様書の核心要件「保存済みキーが input.value に入らない」「マスクが末尾のみ」「Clear 後マスクも消える」を満たす。

### テスト・ビルド結果
- `npm run test`: 8 files / **49 passed** / 0 failed（前回 44 → +5 件）。Generator 自己申告と一致。
- `npm run typecheck`: pass（エラー 0）。
- `npm run build`: pass（5 エントリポイント全成功）。
- 既存テスト破壊なし（44 件中の旧 Show/Hide 系テストは新仕様に合わせて適切に置き換わっている）。

### 5 評価軸スコア（再評価）

| 評価基準 | 旧スコア | 新スコア | 閾値 | 判定 |
|----------|---------|---------|------|------|
| 機能の完全性 | 95 | 96 | 80 | OK |
| テストカバレッジ | 85 | 90 | 70 | OK |
| エラーハンドリング | 80 | 80 | 70 | OK |
| 型安全性 / データ整合性 | 92 | 92 | 90 | OK |
| コード品質 | 82 | 86 | 70 | OK |

- 機能完全性: 仕様書 §F-001 / §セキュリティ / §Sprint 1 合格基準のすべてを充足。Show/Hide トグル撤去により仕様の「常時マスク表示」がより素直に表現された。
- テストカバレッジ: HIGH 指摘の核心ケース（input.value にロードされない）が直接 assert されており、+5 件の追加で options 画面のセキュリティ動作が網羅された。
- 型安全性: 変更は局所的で、`Record<string, string>` の安全な使い方を維持。
- コード品質: Show/Hide トグルの撤去で options.ts のロジックが単純化（条件分岐 1 つ削減）。マスク表示と input を別要素に分けたことで責務が明快になった。

### セキュリティ・PII 観点（再確認）
- DOM 内に平文 API キーが現れる経路を全て塞いだことを確認: input.value への代入なし、textContent への直接出力なし、`console.log` なし。
- マスク文字列は最大でもプレフィックス（`sk-ant-`）＋末尾 4 文字のみ。元キーの再構築は不可能。
- `chrome.storage.sync` への書込なし（テストで再検証済み）。

### リグレッション確認
- popup / sidepanel / background / content / storage / messages / manifest の各テストは全てそのまま pass。
- background 側の `GET_SETTINGS` レスポンス伏字化（`src/background/index.ts:71`）は変更なし、テストも継続 pass。

### 残課題（旧評価から引き継ぎ、本スプリントの合否には影響しない）
1. `AVAILABLE_MODELS` の Anthropic モデル ID 妥当性（Sprint 2 で API 呼び出し前に要差し替え）。
2. `src/options/options.ts` が `chrome.storage.local` を直接呼び出しており、`src/lib/storage.ts` ヘルパーを使っていない（Sprint 2 リファクタ推奨）。
3. `src/popup/popup.ts:9` の `tab?.windowId` 防御。
4. アイコン PNG の正式版差し替え。

### 結論
Codex HIGH 指摘は完全に解消された。仕様書 §Sprint 1 合格基準をすべて満たし、5 評価軸も全閾値クリア。**再評価 合格**。Orchestrator は次スプリント（Sprint 2: F-003 / F-004）の Generator 起動に進んでよい。
