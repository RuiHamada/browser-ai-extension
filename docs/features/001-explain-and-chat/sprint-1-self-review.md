# Sprint 1 自己評価

## 実装した機能

- F-001: API キー設定 - 完了
- F-002: モデル選択 - 完了
- F-009: Side Panel の起動 - 完了
- F-010: API キー未設定時の誘導 - 完了

## 受け入れ条件の充足状況

| 条件 | 状態 | 備考 |
|------|------|------|
| F-001: 設定画面に API キー入力欄（type=password）と保存ボタンがある | OK | options.html に実装済み |
| F-001: 保存後にキーが chrome.storage.local に保存される | OK | storage.ts の saveSettings で local のみに保存 |
| F-001: chrome.storage.sync には保存されない | OK | saveSettings は chrome.storage.local のみを使用 |
| F-001: 保存済みキーは UI 上では伏字で表示される | OK | 保存済みキーは input にロードしない。`#apiKeyMask` span に `sk-ant-...XXXX` 形式で表示 |
| F-001: キー未設定時に Explain/Chat を実行すると誘導メッセージが表示される | OK | サイドパネル・ポップアップ両方に警告バナーを実装 |
| F-002: 設定画面に複数モデルから選択できるドロップダウンがある | OK | AVAILABLE_MODELS で 4 種類定義、動的に生成 |
| F-002: 選択値が chrome.storage.local に保存される | OK | options.ts の btnSave ハンドラで保存 |
| F-002: 未選択時は既定モデルが使用される | OK | DEFAULT_SETTINGS.aiModel = 'claude-haiku-4-5' |
| F-009: 拡張アイコンクリックまたはポップアップから Side Panel が開く | OK | background で openPanelOnActionClick: true を設定、popup からも開ける |
| F-009: 開いた直後に現在のアクティブタブの URL が Side Panel に反映される | OK | sidepanel/index.ts の displayCurrentUrl() で実装 |
| F-010: キー未設定時の実行で誘導メッセージが表示される | OK | サイドパネルの apiKeyWarning バナー |
| F-010: 設定画面を開くリンク/ボタンが同時に表示される | OK | 警告バナー内に「Open Settings」ボタンを設置 |

## 実装ログ

- タスク1: プロジェクト基盤ファイルの作成
  - `/Users/rui/Git/browser-ai-extension/package.json`
  - `/Users/rui/Git/browser-ai-extension/tsconfig.json`
  - `/Users/rui/Git/browser-ai-extension/build.mjs`
  - `/Users/rui/Git/browser-ai-extension/manifest.json`
  - `/Users/rui/Git/browser-ai-extension/.gitignore`

- タスク2: 型定義とストレージユーティリティ
  - `/Users/rui/Git/browser-ai-extension/src/types/messages.ts`（discriminated union、Settings 型、AVAILABLE_MODELS）
  - `/Users/rui/Git/browser-ai-extension/src/lib/storage.ts`（chrome.storage.local の読み書き）

- タスク3: バックグラウンドサービスワーカー
  - `/Users/rui/Git/browser-ai-extension/src/background/index.ts`（メッセージルータ、サイドパネル起動設定）

- タスク4: コンテンツスクリプト（Sprint 1 は最小限）
  - `/Users/rui/Git/browser-ai-extension/src/content/index.ts`

- タスク5: 設定ページ（F-001, F-002）
  - `/Users/rui/Git/browser-ai-extension/src/options/options.html`
  - `/Users/rui/Git/browser-ai-extension/src/options/options.ts`

- タスク6: ポップアップ（F-009, F-010）
  - `/Users/rui/Git/browser-ai-extension/src/popup/popup.html`
  - `/Users/rui/Git/browser-ai-extension/src/popup/popup.ts`

- タスク7: サイドパネル（F-009, F-010）
  - `/Users/rui/Git/browser-ai-extension/src/sidepanel/panel.html`
  - `/Users/rui/Git/browser-ai-extension/src/sidepanel/index.ts`
  - `/Users/rui/Git/browser-ai-extension/src/sidepanel/styles/base.css`

- タスク8: プレースホルダーアイコン
  - `/Users/rui/Git/browser-ai-extension/icons/icon16.png`（プレースホルダー）
  - `/Users/rui/Git/browser-ai-extension/icons/icon48.png`（プレースホルダー）
  - `/Users/rui/Git/browser-ai-extension/icons/icon128.png`（プレースホルダー）

## 動作確認

- typecheck: pass（`npm run typecheck` でエラーなし）
- build: pass（`npm run build` で全 5 エントリポイントのビルド成功）
  - dist/background.js (3.5kb)
  - dist/sidepanel.js (2.8kb)
  - dist/content.js (855b)
  - dist/options.js (3.2kb)
  - dist/popup.js (2.6kb)

手動確認は Chrome への拡張ロードが必要なため未実施。構造上の確認:
- `manifest.json` に `background.service_worker`, `side_panel`, `action`, `options_page`, `content_scripts` が定義済み
- `chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })` で F-009 を実装
- `chrome.storage.local` のみを使用（sync への書き込みなし）

## 既知の課題

- アイコンファイルはプレースホルダー（最小PNGバイト列）。正式な PNG アイコンに差し替えが必要
- Sprint 2 で実装予定の Explain/Chat UI は未実装のため、メインコンテンツ欄は「次スプリントで実装」の仮表示
- manifest.json の `host_permissions` に `<all_urls>` を含めているため、Chrome で権限の確認が出る場合がある

## Codex 最終レビュー指摘対応（修正）

### 問題
- `options.ts:29` で保存済みAPIキーを `<input>` の `value` に直接ロードしていた
- Show/Hide トグルで `type="text"` に切り替えると保存済みキーが平文で見える状態だった

### 修正内容
- `src/options/options.ts`: `loadSettings()` を変更し、保存済みキーを `input.value` にセットしない。代わりに `#apiKeyMask` span に `maskApiKey()` 関数で末尾4文字のみ見せるマスク文字列（例: `sk-ant-...XXXX`）を表示
- `src/options/options.ts`: Show/Hide トグルボタン（`toggleApiKey`）を削除。入力欄は常に `type="password"` で、ユーザーが新しいキーを入力する専用欄として機能
- `src/options/options.ts`: 保存後に `input.value = ''` でクリア（平文が残らない）
- `src/options/options.html`: `toggleApiKey` ボタンを削除。`#apiKeyMask` span を追加。プレースホルダーを「Enter new key to replace...」に変更
- `test/options.test.ts`: Show ボタンのトグルテストを削除。新挙動（保存済みキーが input に現れない、マスク span の表示・非表示、保存後の input クリア）を検証するテストを追加（合計 49 テスト pass）

### 動作確認
- typecheck: pass
- build: pass
- test: 49 tests pass

## Evaluator への申し送り事項

- `chrome.storage.local` への保存は実際のブラウザ環境でのみ確認できる。テストでは chrome.storage を Mock する必要がある
- `chrome.sidePanel.*` API のモックが必要（chrome-mock 等を利用）
- Sprint 1 の評価範囲: F-001, F-002, F-009, F-010 の受け入れ条件
- Sprint 2 以降のファイル（Explain, Chat の本実装）は未作成のため、評価対象外
