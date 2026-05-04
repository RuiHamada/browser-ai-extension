# Sprint 4 自己評価

## 実装した機能

- F-201: 出力言語切替（en / ja）- 完了

## 受け入れ条件の充足状況

| 条件 | 状態 | 備考 |
|------|------|------|
| Settings 型に outputLanguage: 'en' | 'ja' を追加 | OK | discriminated union 維持 |
| DEFAULT_SETTINGS.outputLanguage = 'en' | OK | |
| validateOutputLanguage を validateAiModel と同パターンで実装 | OK | storage.ts に export 関数として追加 |
| loadSettings で outputLanguage を読み出し、不正値はデフォルトにフォールバック | OK | |
| getExplainSystemPrompt(lang) / getChatSystemPromptBase(lang) 関数化 | OK | 旧定数 EXPLAIN_SYSTEM_PROMPT / CHAT_SYSTEM_PROMPT_BASE は後方互換のため維持 |
| Hardcoded "Always respond in English" を削除し動的組み立て | OK | |
| background EXPLAIN/CHAT が outputLanguage を読んで system prompt に渡す | OK | |
| Options に outputLanguage select を追加（disabled input を削除） | OK | |
| Options で保存・反映を実装 | OK | |
| Side Panel にクイック切替 UI を追加 | OK | header-actions 内に select#outputLanguageSelect |
| Side Panel 変更で即時 storage 保存 | OK | change イベントで chrome.storage.local.set |
| chrome.storage.onChanged で Options ↔ Side Panel 双方向同期 | OK | |
| 既存テスト 132 件を壊さない | OK | |
| outputLanguage 関連テスト追加 | OK | 29 件追加 |

## 実装ログ

1. `src/types/messages.ts`: OutputLanguage 型を追加、Settings インターフェースと DEFAULT_SETTINGS に outputLanguage を追加
2. `src/lib/storage.ts`: validateOutputLanguage 関数を追加（export）、loadSettings を更新して outputLanguage を読み込む
3. `src/lib/claude.ts`: getExplainSystemPrompt(lang) / getChatSystemPromptBase(lang) を追加。旧定数 EXPLAIN_SYSTEM_PROMPT / CHAT_SYSTEM_PROMPT_BASE は後方互換維持（deprecated コメント付き）
4. `src/background/index.ts`: EXPLAIN/CHAT ハンドラで loadSettings() から outputLanguage を取得し、言語別 system prompt 関数を呼び出すよう変更
5. `src/options/options.html`: disabled な input を outputLanguage select に置換
6. `src/options/options.ts`: loadSettings / 保存ハンドラに outputLanguage を追加。DOM 要素が存在しない場合は null ガードで安全に処理
7. `src/sidepanel/panel.html`: header-actions に outputLanguageSelect を追加
8. `src/sidepanel/styles/base.css`: ヘッダ内 select のスタイルを追加
9. `src/sidepanel/index.ts`: syncOutputLanguageFromStorage / change イベント / storage.onChanged リスナーを追加
10. `test/helpers/chromeMock.ts`: chrome.storage.onChanged モックを追加（_listeners, addListener, _trigger）
11. `test/output-language.test.ts`: 新規テストファイル（29 件）を追加

## 動作確認

- typecheck: pass
- build: pass
- test: 161 passed (132 既存 + 29 新規)

## Sprint 4 Codex 指摘修正（2026-05-04）

### 修正内容

**[MEDIUM] Options が `chrome.storage.onChanged` を購読していなかった問題を修正**

- `src/options/options.ts` に `chrome.storage.onChanged.addListener` を追加
- `area === 'local'` のときのみ処理し、`sync` は無視する
- `outputLanguage` が変わった場合: `validateOutputLanguage` を経由して `<select id="outputLanguage">` の値を更新（不正値はデフォルト 'en' にフォールバック）
- `aiModel` が変わった場合: `<select id="aiModel">` の値を更新（別タブで Options を 2 枚開いた場合の整合性確保）

### 追加テスト（test/options.test.ts）

| テスト | 確認内容 |
|--------|---------|
| onChanged で outputLanguage="ja" → select が "ja" に更新 | Options→SidePanel 変更を受信 |
| area="sync" は無視される | sync 領域を処理しないことの確認 |
| 不正値 "fr" → "en" にフォールバック | validateOutputLanguage 経由を確認 |
| onChanged で aiModel 変更 → select 更新 | 別タブ整合性 |
| aiModel の area="sync" は無視 | sync 無視の確認 |

### 動作確認（修正後）

- typecheck: pass
- build: pass
- test: 166 passed（161 既存 + 5 新規）

## 既知の課題

なし

## Evaluator への申し送り事項

- chrome.storage.onChanged のモックは chromeMock.ts に `_trigger` ヘルパーで手動発火できるように実装した
- options.ts は outputLanguage select が DOM に存在しない場合（旧テストの DOM セットアップ）でも null ガードにより安全に動作する
- `getExplainSystemPrompt` / `getChatSystemPromptBase` は引数なしで呼ぶとデフォルト 'en' を返す（既存の claude.test.ts の "システムプロンプトが英語固定で渡される" テストは後方互換定数 EXPLAIN_SYSTEM_PROMPT を使用しているため影響なし）
