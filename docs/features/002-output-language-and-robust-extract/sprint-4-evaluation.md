# Sprint 4 評価レポート（feature 002 / F-201）

## 総合判定: 合格

Sprint 4 の合格基準（仕様 §4 Sprint 4・§6 評価軸）をすべて満たしている。
161/161 テスト緑、typecheck/build 成功、リグレッションなし。

## スコア

| 評価基準 | スコア | 閾値 | 判定 |
|----------|--------|------|------|
| 機能の完全性 | 95 | 80 | OK |
| テストカバレッジ | 90 | 70 | OK |
| エラーハンドリング | 85 | 70 | OK |
| 型安全性 / データ整合性 | 95 | 90 | OK |
| コード品質 | 88 | 70 | OK |

## テスト実行結果

- `npm run typecheck`: pass（エラーなし）
- `npm run build`: pass（4 バンドル: popup / content / background / sidepanel）
- `npm run test`: **161 passed / 0 failed**（既存 132 + 新規 29）

## 受け入れ条件の検証結果

| 受け入れ条件（F-201） | 結果 | 検証根拠 |
|-----------------------|------|----------|
| Options で en/ja 選択 → `chrome.storage.local.outputLanguage` に保存 | OK | `src/options/options.html:113`, `src/options/options.ts:73`、test "保存ボタンで選択した outputLanguage が storage に保存される" |
| 未保存時はデフォルト `'en'` | OK | `src/types/messages.ts:29`, `src/lib/storage.ts:32`、test "未設定時はデフォルト "en" を返す" |
| Side Panel クイック切替が即時 storage に反映 | OK | `src/sidepanel/index.ts:130-133`、test "セレクト変更で storage.local.set が呼ばれ outputLanguage が保存される" |
| `outputLanguage='ja'` で Explain 応答が日本語（system prompt 検証） | OK | `src/lib/claude.ts:117-126`, `src/background/index.ts:107-112`、test "EXPLAIN system に "Japanese" が含まれる" |
| `outputLanguage='en'` で Explain 応答が英語 | OK | 同上、test "EXPLAIN system に "English" が含まれる" |
| `outputLanguage='ja'` で Chat 応答が日本語 | OK | `src/lib/claude.ts:132-139`, `src/background/index.ts:120-121`、test "CHAT system に "Japanese" が含まれる" |
| Options ↔ Side Panel 双方向同期、最後の値が再起動後も保持 | OK | `chrome.storage.local` 永続 + `src/sidepanel/index.ts:137-143` の onChanged リスナー、test "storage.onChanged で outputLanguage が変わるとセレクトが更新される" |
| `chrome.storage.sync` に `outputLanguage` を書き込まない | OK | `rg "storage\.sync" src/` で 0 件、test 内で `mock.storage.sync.set` が呼ばれていないことを assert |

## レビュー結果（コード品質）

### 良好な点

- `validateOutputLanguage` が `validateAiModel` と一致した防御パターンで実装され、`null` / 数値 / 不正文字列すべてを `'en'` にフォールバックする（`src/lib/storage.ts:28`）。
- 言語ラベル化を `languageLabel('en'|'ja')` に集約し、プロンプト 2 か所で再利用（`src/lib/claude.ts:109`）。文字列重複が最小化されている。
- `EXPLAIN_SYSTEM_PROMPT` / `CHAT_SYSTEM_PROMPT_BASE` を deprecated コメント付きで後方互換維持（`src/lib/claude.ts:145`）。既存テストを壊さない丁寧な移行。
- Side Panel の onChanged リスナーが `area === 'local'` を必ず検証（`src/sidepanel/index.ts:138`）。`'sync'` イベントを誤って反映しないことが test でも確認されている。
- discriminated union の exhaustive switch（`src/background/index.ts:78-141`）は維持。新メッセージ型を追加せず Settings 拡張のみで実装した点は仕様適合。

### 軽微な指摘（非ブロッキング）

1. **重複した言語ラベル変換ロジック**（Low）
   - `src/background/index.ts:108`: `const explainPromptLang = explainLang === 'ja' ? 'Japanese' : 'English';`
   - 同じ変換が `src/lib/claude.ts:109` の `languageLabel()` に既に存在する。`languageLabel` を export して再利用すれば DRY になる。
   - Sprint 5 でも同様の言語名が必要になりうるため、リファクタを推奨。
2. **Side Panel の `change` リスナー登録タイミング**（Low）
   - `src/sidepanel/index.ts:128-134` はモジュールロード時に直接 `getElementById` してリスナーを登録している。テストでは DOM が事前にセットされるので問題ないが、将来 panel.html の id 名が変わったとき silent fail（`outputLangSel === null` で何も起きない）になる。`console.warn` を出すか、`init()` 関数化して他の初期化と並べるとより一貫的（既存の `initTabs` パターンに合わせるとよい）。
3. **`options.ts` の `outputLanguage` 値検証**（Low）
   - `src/options/options.ts:65`: 保存時に `outputLangEl.value` をそのまま使用しており、`validateOutputLanguage` を通していない。HTML の `<select>` 制約で `'en' | 'ja'` 以外は通常入らないが、ロード時には validate しているので保存時にも一貫させると堅牢（既存パターンとの整合）。

### セキュリティ / プライバシー

- API キー漏洩経路の追加なし。`maskApiKey` / `sanitizeErrorForLog` は変更されておらず、Sprint 1〜3 の不変条件は保たれている。
- `outputLanguage` は機微情報ではないが、仕様通り `chrome.storage.local` 限定で `sync` には書かない（`rg storage.sync src/` 結果 0 件で確認）。
- DOM 全文ログ禁止方針も維持（本スプリントでは抽出処理を変更していない）。
- URL 変化時の `resetExplain` / `resetChat` も `src/sidepanel/index.ts:104-105` で維持されている（Sprint 3 不変条件）。

## 発見されたバグ

なし。重大度 High / Medium に該当する問題は見つからなかった。

## Generator へのフィードバック

### 必須修正事項

なし（合格）。

### 推奨改善事項（Sprint 5 と一緒に取り込んでよい）

- [REC-1] `src/lib/claude.ts` の `languageLabel()` を export し、`src/background/index.ts:108` の三項演算子を置き換える。Sprint 5 で F-204 の短文プロンプト分岐や Explain prompt 文言にも言語名が必要になりやすいため、共通化しておくと整合する。
- [REC-2] `src/options/options.ts:65` で保存前にも `validateOutputLanguage` を通す。
- [REC-3] Side Panel の出力言語切替を `initOutputLanguageSelector()` のように関数化し、`initTabs` / `initExplain` / `initChat` と並べる。

## Sprint 5 への申し送り

- Sprint 5 は F-202（DOM 抽出堅牢化）/ F-203（短文警告 UI）/ F-204（短文プロンプト改善）が対象。
- F-204 が言語切替に依存するので、本スプリントで整備された `getExplainSystemPrompt(lang)` のシグネチャを拡張（例: `getExplainSystemPrompt(lang, opts?: { shortInput?: boolean })`）するか、新関数を追加する形が想定される。
- F-203 の「extracted N chars」表示は現状の `outputLanguage` に関わらず英文 UI でよい（仕様 §3 の文言）が、UX 一貫性のため言語切替後の文言レビューは Sprint 5 評価時に確認する。
