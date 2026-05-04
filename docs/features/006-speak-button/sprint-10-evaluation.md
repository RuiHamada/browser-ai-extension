# Sprint 10 評価レポート（Speak ボタン F-601 / F-602 / F-603）

## 総合判定: 合格

## スコア
| 評価基準 | スコア | 閾値 | 判定 |
|----------|--------|------|------|
| 機能の完全性 | 95 | 80 | OK |
| テストカバレッジ | 90 | 70 | OK |
| エラーハンドリング | 85 | 70 | OK |
| 型安全性 / データ整合性 | 98 | 90 | OK |
| コード品質 | 88 | 70 | OK |

## テスト実行結果
- `npm run typecheck`: pass（エラー 0）
- `npm run build`: pass（content.js 13.8kb）
- `npm run test`: pass 340 / 340（24 ファイル）
  - うち Sprint 10 関連: 18 件（speak.test.ts）。Evaluator が SPEAK_MAX_CHARS 切り詰めの追加検証を 1 件追加（合計 18 → 18 を確認）。
  - 既存 322 件の回帰なし。

## 仕様適合性

### F-601 UI（2 ボタン横並び・Shadow DOM 隔離）
- `src/content/floating.ts:117` に `.btn-container { display:flex; gap:6px }` を持つ flex コンテナを追加し、Explain → Speak の順で配置。
- `src/content/floating.ts:131` Speak ボタンに `role="button"` / `aria-label="Speak selected text"` / `aria-pressed="false"` / `tabindex="0"` を付与。ネイティブ `<button>` のため Tab/Enter/Space で操作可能。
- `src/content/floating.ts:142` Web Speech API 未対応環境では描画時点で `disabled` + `aria-disabled="true"` を設定。`showFloatingButton` 内 `src/content/floating.ts:189` でも cloneNode 後に再設定しており二重防御。
- Shadow DOM `mode: 'open'` で attach、`:host { all: initial }` でホストの CSS 影響を遮断。

### F-602 Web Speech API
- `src/content/floating.ts:270` で `new SpeechSynthesisUtterance(text)` 直後に `utterance.lang = 'en-US'`。`rate` / `pitch` / `voice` は明示的に上書きしておらず、テストでデフォルト値（rate=1, pitch=1, voice=null）を確認。
- `SPEAK_MAX_CHARS = 1000` で先頭 1000 文字に切り詰め（`src/content/floating.ts:267`）。Evaluator 追加テストで検証済み。
- `chrome.runtime.sendMessage` は呼ばれないことをテストで確認（Side Panel・background へのメッセージ送出なし）。Web Speech API はブラウザ内部処理のため API キーや外部送信なし。
- 既存 Explain 経路（`FLOATING_EXPLAIN_REQUEST`）の回帰テストも pass。

### F-603 状態管理
- `currentUtterance` モジュールスコープで再生中の utterance を保持（`src/content/floating.ts:25`）。
- `handleSpeak` で `currentUtterance !== null || speechSynthesis.speaking` を検出して `stopSpeech()` 呼び出し → toggle 動作。
- `utterance.onend` / `utterance.onerror` でアイデンティティ比較（`currentUtterance === utterance`）後に状態クリア → 古い utterance のコールバックが新しい再生をリセットしない設計。良。
- `hideFloatingButton` 内で `stopSpeech()` を必ず呼ぶ（`src/content/floating.ts:165`）→ 選択解除・別所クリック・スクロール脱出・visibilitychange のいずれでも cancel が走る。

## レビュー結果（指摘）

重大な指摘はなし。以下は推奨改善（任意）。

- [LOW-001] `handleSpeak` の停止条件 `currentUtterance !== null || speechSynthesis.speaking` が真でも、`stopSpeech()` の中身は `currentUtterance !== null` のときしか `cancel()` を呼ばない。`currentUtterance === null && speaking === true` の場合（他要因で再生開始した想定上ありえないケース）に no-op となる。実害は無いが、防御として `stopSpeech` 側でも `speechSynthesis.speaking` を判定するか、警告を出すと堅牢性が上がる。
- [LOW-002] `console.error('[floating] SpeechSynthesis エラー:', ev.error)` は読み上げ対象テキストを含まないので PII 漏洩はない。OK。今後ログを増やす場合も選択全文を直接 console に出さない方針を継続すること。
- [LOW-003] cloneNode で stale なリスナーを切る方式は機能的には正しいが、`getOrCreateHost` が返した `explainBtn` / `speakBtn` 参照が `showFloatingButton` 内で即時破棄されるため、`FloatingHost` の型でわざわざ持つ必要はない（リファクタ余地）。型安全性に問題はない。
- [LOW-004] `SPEAK_MAX_CHARS` の切り詰めは spec.md に明示されていない（仕様書本文では言及なし、テスト軸 F-602 でも触れていない）。実装上は妥当な防御だが、仕様にメモを残しておくと整合性が高まる。

## 軸別評価

| 軸 | 結果 |
|----|------|
| 軸 1 仕様適合性 | F-601/F-602/F-603 の全受け入れ条件を満たす |
| 軸 2 自動テスト | spec.md §6 軸 2 の 8 ケースを全てカバー、追加で aria-pressed の遷移・onerror・SPEAK_MAX_CHARS・rate/pitch も検証 |
| 軸 3 型安全性 | typecheck pass、`any` 使用なし、`SpeechSynthesisUtterance` は標準 lib.dom 型を利用 |
| 軸 4 コード品質 | 再生状態管理が `floating.ts` 単一モジュールに集約、Shadow DOM 内 CSS で完結、ログに選択全文を残さない |
| 軸 5 全体整合性 | F-501/F-502/F-503 の回帰テスト pass、Sprint 9 F-504 Markdown 影響なし、background/sidepanel/options への変更波及なし |

## セキュリティ不変条件
- API キー漏洩: Speak 経路で API キーを参照しない（Web Speech はローカル処理）。OK
- sanitizer: Markdown レンダリング経路に変更なし。OK
- exhaustive switch: メッセージ型に追加・変更なし、`content/index.ts` の `_exhaustive: never` は不変。OK
- `chrome.storage.sync` 不使用: 変更なし。OK
- DOM 全文ログ: Speak 経路では選択テキストを console に出していない。OK

## Generator へのフィードバック

### 必須修正事項
- なし（合格）

### 推奨改善事項
- [LOW-001] `stopSpeech()` 内で `speechSynthesis.speaking` も合わせて判定し、状態が乖離した場合のフェイルセーフを追加する（任意）。
- [LOW-004] spec.md 側に `SPEAK_MAX_CHARS = 1000` 切り詰めポリシーを明文化する（任意）。

## 結論

合格。Sprint 10 の実装は仕様の F-601 / F-602 / F-603 を完全に満たし、既存 322 件の回帰がなく、型・ビルド・テスト全てクリーン。Codex 最終レビューに進めてよい。
