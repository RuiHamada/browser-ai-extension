# Feature 006: Speak ボタン（フローティングツールチップ拡張）

## 0. 既存仕様との関係マトリクス

| 既存 ID | タイトル | 本機能での扱い |
|---------|----------|----------------|
| F-501 | フローティングツールチップ表示制御 | **維持・拡張**（Explain と Speak の 2 ボタンを内包） |
| F-502 | 起動条件・除外ルール（2 文字以上 / `<input>` `<textarea>` `[contenteditable]` / password 除外 / Shadow ホスト無視） | **維持**（Speak も同条件で表示） |
| F-503 | Explain ボタン → Side Panel 連携 | **維持**（クリック挙動・Side Panel への送信に変更なし） |
| F-601（新規） | Speak ボタン UI（2 ボタン横並び） | 本機能で追加 |
| F-602（新規） | Web Speech API 連携（en-US 固定） | 本機能で追加 |
| F-603（新規） | 再生状態管理・停止条件 | 本機能で追加 |

---

## 1. プロダクト概要

- **プロダクト名**: browser-ai-extension（Sprint 10: Speak ボタン）
- **一文での説明**: テキスト選択時のフローティングツールチップに、選択文字列を英語音声で再生する Speak ボタンを追加する。
- **ターゲットユーザー**: 英文 Web ページを読みながら発音を確認したい英語学習者・非ネイティブ読者。
- **解決する課題**: 単語・フレーズの発音を別タブやアプリに切り替えずに、その場で確認したい。
- **参考実装との差分**: Explain と並ぶ第 2 アクションを追加する。Side Panel への遷移は伴わず、ページ上で完結する。Web Speech API を直接使用するため API キーや追加権限は不要。

---

## 2. 機能一覧

### F-601: Speak ボタン UI（2 ボタン横並び）

- **概要**: 既存のフローティングツールチップ内に「Explain」ボタンと並べて「🔊 Speak」ボタンを表示する。Shadow DOM 内の CSS で完結し、ホストページのスタイル影響を受けない。
- **ユーザーストーリー**: 読者として、選択時に出るツールチップから 1 クリックで音声再生を始めたい。
- **受け入れ条件**:
  - F-502 の起動条件を満たす選択時、ツールチップ内に Explain と Speak の 2 ボタンが横並びで表示される。
  - 2 ボタンはホバー時とアクティブ時に視覚フィードバック（背景色変化等）を持つ。
  - Speak ボタンは `role="button"`、`aria-label="Speak selected text"` を持つ。
  - `'speechSynthesis' in window` が偽の環境では Speak ボタンが `disabled` 属性または `aria-disabled="true"` で操作不可になる。
  - ツールチップは Shadow DOM 内にレンダリングされ、ホストページの `button` セレクタが適用されない。
- **優先度**: Must

### F-602: Web Speech API 連携（en-US 固定）

- **概要**: Speak クリックで `speechSynthesis.speak()` を呼び、選択テキストを英語音声で再生する。声・速度・ピッチは OS デフォルトに従う。
- **ユーザーストーリー**: 読者として、選択した英文を OS の英語音声で読み上げてほしい。
- **受け入れ条件**:
  - Speak クリック時、`new SpeechSynthesisUtterance(text)` の `text` は現在の選択文字列と一致する。
  - 生成される utterance の `lang` プロパティが `"en-US"` である。
  - `window.speechSynthesis.speak(utterance)` が 1 回呼ばれる。
  - 言語自動判定・音声選択・速度設定は行わない（テスト時に `rate` `pitch` `voice` をセットしないことを確認可能）。
  - API キー送信や Side Panel への message 送出は発生しない。
- **優先度**: Must

### F-603: 再生状態管理・停止条件

- **概要**: 再生中の Speak 再押下、選択解除によるツールチップ非表示、別所クリックによる非表示で `speechSynthesis.cancel()` を確実に呼ぶ。再生中はボタン状態を `aria-pressed="true"` で表現する。
- **ユーザーストーリー**: 読者として、誤って長文を再生しても即座に止められたい。新しい選択を始めたら前の再生が残らないでほしい。
- **受け入れ条件**:
  - 再生中（`speechSynthesis.speaking === true` 相当）に Speak を再押下すると `speechSynthesis.cancel()` が呼ばれる。
  - 再生中の Speak ボタンは `aria-pressed="true"` を持つ。`onend` / `onerror` 発火後は `aria-pressed="false"` に戻る。
  - 選択解除（`selectionchange` で空選択）でツールチップが非表示になる際、同時に `speechSynthesis.cancel()` が呼ばれる。
  - ツールチップ外クリックによる非表示時にも `speechSynthesis.cancel()` が呼ばれる。
  - 既存 Explain ボタンのクリック動作（Side Panel への送信）が破壊されていない（回帰テストで確認）。
- **優先度**: Must

---

## 3. UI/UX 要件

### 画面一覧

| 画面 | 目的 |
|------|------|
| Content Script のフローティングツールチップ | テキスト選択時に Explain / Speak の 2 アクションを提供 |

### UI 構成図（2 ボタン横並び・Shadow DOM 隔離）

```
┌─────────────────────────────────────┐  ← Shadow DOM root（ホストの<div>に attach）
│ ┌──────────┐  ┌──────────────────┐  │
│ │ Explain  │  │ 🔊 Speak         │  │ ← flex 横並び、gap あり
│ └──────────┘  └──────────────────┘  │
└─────────────────────────────────────┘
         ▲ 選択範囲の近傍に絶対配置
```

- 横並び（`display: flex`）、ボタン間に小さな gap。
- ホバー / アクティブで背景色が変化。
- 再生中の Speak は `aria-pressed="true"` を持ち、視覚的にも押下中であることがわかる（背景色変化等）。

### 主要フロー

1. ユーザーがページ上の英文を選択する（2 文字以上、除外要素外）。
2. ツールチップが選択近傍に表示される（Explain と Speak の 2 ボタン）。
3a. Explain クリック → 既存 F-503 のフロー（Side Panel に送出）。
3b. Speak クリック → `speechSynthesis.speak()` 実行、ボタンが `aria-pressed="true"` に。
4. 再生中に再度 Speak クリック → `speechSynthesis.cancel()` で停止、`aria-pressed="false"`。
5. 選択解除 / 別所クリック → ツールチップ非表示 + `speechSynthesis.cancel()`。

### キーボード

- Speak ボタンはネイティブの `<button>` を使用し、Tab フォーカス・Enter / Space での起動が可能。

---

## 4. スプリント計画

### Sprint 10: Speak ボタン追加（F-601, F-602, F-603）

- **スプリントゴール**: フローティングツールチップに Speak ボタンを追加し、Web Speech API で選択テキストを en-US で再生・停止できる状態にする。
- **依存**: Sprint 8（F-501-503）が完了済みであること。
- **対象機能**: F-601, F-602, F-603（同時に達成、不可分）。

スプリント数は 1 個でコンパクトに完了する。

---

## 5. 非機能要件

- **パフォーマンス**: Speak クリックから `speechSynthesis.speak()` 呼び出しまで 50ms 以内。ツールチップの追加描画コストは既存比 +5ms 以内。
- **セキュリティ / プライバシー**: 選択文字列を外部 API に送信しない（Web Speech API はブラウザ内部処理）。ログに選択全文を残さない。
- **アクセシビリティ**: ボタンは `<button>` ネイティブ要素、`aria-label` / `aria-pressed` を適切に設定。フォーカスリングを抑制しない。
- **ブラウザ互換性**: Chrome 116+。`'speechSynthesis' in window` で機能検出し、未対応時は Speak ボタンを無効化（disabled）。Explain ボタンの動作は影響を受けない。
- **隔離性**: ツールチップは Shadow DOM 内にレンダリングされ、ホストページの CSS / JS 影響を受けない。

---

## 6. 評価基準（5 軸）

### 軸 1: 仕様適合性
- F-601, F-602, F-603 の全受け入れ条件を満たす。

### 軸 2: 自動テスト（jsdom + speechSynthesis モック）
以下のテストが全て pass する:
1. 通常選択でツールチップ DOM に Explain と Speak の 2 ボタンが存在する。
2. Speak クリックで `window.speechSynthesis.speak` がモックで 1 回呼ばれ、引数 utterance の `text` が選択文字列、`lang === "en-US"`。
3. 再生中（`speaking` モック true）の Speak 再押下で `speechSynthesis.cancel` が呼ばれる。
4. `selectionchange` で空選択にした際、ツールチップが除去され、同時に `speechSynthesis.cancel` が呼ばれる。
5. ツールチップ外クリックによる非表示でも `speechSynthesis.cancel` が呼ばれる。
6. `'speechSynthesis' in window` を false にしたケースで Speak ボタンが disabled になる。
7. Explain ボタンクリックの既存挙動（Side Panel への message 送出）が変わらない（回帰）。
8. 除外要素（`<input>`, `<textarea>`, `[contenteditable]`, password, Shadow ホスト上の選択）でツールチップが出ない（回帰）。

### 軸 3: 型安全性
- `npm run typecheck` がエラー 0 で通る。
- `SpeechSynthesisUtterance` / `speechSynthesis` の型は標準 lib.dom を利用し、any を使わない。

### 軸 4: コード品質
- Shadow DOM 内 CSS で 2 ボタンのレイアウトとホバー / アクティブ状態が完結。
- 再生状態 / cancel の責務が単一モジュールに集約されている。
- 選択全文を `console.log` に出力しない（先頭 N 文字までの省略表示は可）。

### 軸 5: 全体整合性
- 既存 F-501 / F-502 / F-503 が機能ごと回帰なし。
- Side Panel・Background・Options に変更が波及しない（content script 側で完結）。

### 全体完了基準
- 上記 5 軸すべて合格。
- Codex 最終レビューで重大指摘なし。

---

## 7. 対象外（明示）

- Anki 連携
- 閲覧履歴の永続化
- クイズ生成
- 言語自動判定（常に `en-US`）
- TTS の音声 / 速度 / ピッチカスタマイズ（OS デフォルト固定）
- Side Panel 内（Explain / Chat タブ）の発音ボタン
- Speak ショートカット（キーボードグローバルショートカット）
