# Sprint 3 評価レポート

## 総合判定: 合格

Sprint 3 で実装された Chat（F-006）、タブ切替（F-007）、ページ変更検知（F-008）はいずれも仕様書 §6 の合格基準を満たしている。126 件全テストが pass、typecheck・build とも成功。重大な指摘なし。

## スコア

| 評価基準 | スコア | 閾値 | 判定 |
|----------|--------|------|------|
| 機能の完全性 | 95 | 80 | OK |
| テストカバレッジ | 90 | 70 | OK |
| エラーハンドリング | 90 | 70 | OK |
| 型安全性 / データ整合性 | 95 | 90 | OK |
| コード品質 | 90 | 70 | OK |

## テスト実行結果

- `npm run test`: 13 ファイル / 126 テスト すべて pass（Sprint 1+2 の 105 件 + Sprint 3 の 21 件）
- `npm run typecheck`: pass（エラーなし）
- `npm run build`: pass（background.js / sidepanel.js / options.js / content.js すべて生成）

## 受け入れ条件の検証

| 条件 | 判定 | 検証内容 |
|------|------|----------|
| Chat タブで 2 ターン以上の対話ができ、過去発話が表示される | OK | `chat.test.ts` "2 ターン分の発話が画面に残る" + 履歴蓄積テストで実証 |
| Chat の API リクエストにページ本文がコンテキストとして含まれる | OK | background.ts:105-107 で `system` プロンプトに `pageContent` を埋め込み、テスト "fetchBody.system に含まれる" で実証 |
| タブを閉じる/明示クリアで Chat 履歴が破棄される（次回起動時に残らない） | OK | `chatHistory` はモジュールスコープのみ。`chrome.storage.local/sync/session` への書き込みは grep で 0 件。Clear ボタンで `chatHistory = []` |
| Explain と Chat のタブ切り替えで各状態が同一セッション中保持される | OK | 各モジュール（explain.ts / chat.ts）が独立したスコープで状態管理。`switchTab()` は class toggle のみ |
| アクティブタブの URL 変化時に状態リセットまたは現ページと紐づかない旨の表示が行われる | OK | `index.ts:97-107` で TAB_CHANGED 受信時に `resetExplain()` + `resetChat()` を呼び出し、URL 表示も更新。テスト "TAB_CHANGED 時に sidepanel/index から resetChat が呼ばれる" で実証 |

## レビュー結果

### 検証観点ごとの確認

- **Chat 履歴の永続化なし**: OK。`rg "chrome\.storage" src/sidepanel/chat.ts` は 0 件。`chatHistory` はモジュール変数のみ
- **2 ターン以上で履歴蓄積**: OK。`chat.ts:159-160` で成功時のみ push。`background/index.ts:112` で `message.history` を `callClaudeAPI` に渡し、`claude.ts:45-50` で messages 配列に展開
- **ページ本文が system prompt に含まれる**: OK。`background/index.ts:105-107`
- **明示クリアで履歴クリア**: OK。`chat.ts:174-186` `resetChat()`、Clear ボタンが `chat.ts:225-227`
- **タブ切替で状態保持**: OK。タブは表示制御のみ、各タブのモジュール状態は独立保持
- **URL 変化時のリセット**: OK。`background/index.ts:13-41` で `onActivated` / `onUpdated` 両方で TAB_CHANGED ブロードキャスト。`index.ts:97-107` で受信して reset
- **API キー漏洩防止（Chat 経路）**: OK。`chat.ts:5,148,164,167` で `sanitizeErrorMessage` / `sanitizeErrorForLog` を使用。テスト "console.error に API キーが出力されない" で実証
- **discriminated union exhaustive switch**: OK。`background/index.ts:117-122` で `_exhaustive: never` チェックあり、`CHAT` ケース追加済み
- **リグレッション**: OK。Sprint 1+2 の 105 件含む全 126 件 pass

### コード品質観点

- **MV3 適合**: OK。background はステートレス（タブ通知のみ）。chat 状態は sidepanel 側に閉じている
- **PII**: OK。`fetchPageContent` のエラーログは `[chat] ページ本文取得エラー:` のみで DOM 全文を出力しない
- **XSS**: OK。`appendMessageBubble` は `textContent` を使用。`innerHTML = ''` は空文字代入のみ（クリア用途）で安全
- **型安全性**: OK。`ChatMessage` 型の role が `'user' | 'assistant'` ユニオン、`BackgroundMessage` 拡張も exhaustive
- **対象外機能の混入**: なし（anki / quiz / browser history いずれも src 配下に存在せず）

## 発見されたバグ

なし。

## 軽微な観察事項（修正不要）

- `chat.ts:174` `resetChat()` は履歴とキャッシュ両方をクリアするが、`clearPageContentCache()` という別関数も export されている。現状未使用だが、将来 URL 変化時に「履歴は維持・本文だけ更新」のような分岐を行う際の拡張点として残しているとみられる。冗長と感じる場合は将来削除候補
- `chat.ts:31` `getElements` 内のキャストパターンは options.ts と同等。一貫性あり
- `background/index.ts:36` `tab.id ?? 0` のフォールバック値 `0` は使用されないがログで誤解を招く可能性あり。実害なし

## Generator へのフィードバック

### 必須修正事項

なし（合格）。

### 推奨改善事項

1. `clearPageContentCache()` が未使用なら、将来コミットで削除するか、URL 変化時の選択的リセットに使う設計を仕様化しておくと混乱を防げる
2. `chat.ts:179` の `innerHTML = ''` は安全だが、将来の保守者向けに `replaceChildren()` への置き換えも検討候補（純粋なスタイルの問題）

## 次のステップ

Sprint 3 評価合格。Orchestrator は `codex exec --full-auto` による最終レビューに進むことが可能。
