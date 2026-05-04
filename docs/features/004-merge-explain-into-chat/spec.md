# 製品仕様書: Merge Explain into Chat (単一 Chat 画面化)

本仕様は以下の既存仕様の **拡張・上書き** である。

- `docs/features/001-explain-and-chat/spec.md`（F-001〜F-013）
- `docs/features/002-output-language-and-robust-extract/spec.md`（F-201〜F-204）
- `docs/features/003-selection-with-context/spec.md`（F-301〜F-303）

現状 Side Panel は **Explain タブ / Chat タブ** の 2 タブ構成だが、参考実装 `~/Git/youtube-ai-extension` と同様に **タブを廃止して単一の Chat 画面に統合** する。
Explain 機能は Chat 内の **クイックアクションボタン** として提供し、ボタンを押すと所定のプリセットプロンプトがチャットに投入され、アシスタント応答が同じチャット履歴に積まれる。

---

## 0. 既存仕様との関係マトリクス

| 既存 ID | 既存挙動 | 本特性での扱い | 上書き / 補強内容 |
|---------|----------|----------------|-------------------|
| F-004 選択テキスト取得 | Explain タブの「Selection only」モードで使用 | **維持（消費経路を変更）** | クイックアクション「Explain selection」から呼び出される。取得ロジック自体は変更なし |
| F-005 Explain 全体 | Explain タブで本文抽出 → Claude へ単発送信 → 別領域に表示 | **F-401 / F-403 が上書き** | Explain は Chat 経路に統合。クイックアクション「Explain page」として履歴に積む |
| F-006 Chat | Chat タブで自由入力チャット | **維持（画面のみ統合）** | タブ廃止後は同じメッセージ領域・入力欄を共有 |
| F-007 タブ切替 | Explain / Chat タブの切替 UI | **撤廃（F-405）** | タブ UI 自体を Side Panel から削除する |
| F-008 URL 変化リセット | URL 変化で Chat 履歴クリア | **維持** | 統合後の単一履歴に対して同じ条件でクリアする |
| F-009 Side Panel 起動 | 拡張アイコン / Popup から Side Panel を開く | **維持** | 起動先がタブなしの単一 Chat 画面になるだけ |
| F-010 API キー誘導 | キー未設定時に Options へ誘導 | **維持** | Chat 画面内バナーから誘導 |
| F-011 エラーハンドリング | API/ネットワークエラーのユーザー通知 | **維持** | Chat メッセージ領域内の error バブルとして表示 |
| F-012 切り詰め通知 UX | 長文 truncate を控えめに告知 | **維持** | Chat バブル直前 / メタ表示として継続 |
| F-013 API キー露出禁止 | UI/ログにキーを出さない | **維持** | 変更なし |
| F-201 出力言語切替 | Side Panel 上の `outputLanguage` 設定 UI | **維持（位置変更のみ）** | Chat 画面ヘッダに配置 |
| F-202 DOM 抽出 | 本文抽出ロジック | **維持** | クイックアクション全種で再利用 |
| F-203 短文警告 | 抽出本文 40 文字未満で警告 | **維持（whole page クイックアクションのみ）** | 「Explain page」系で発火。selection 系は F-303 通り抑止 |
| F-204 短文プロンプト | `len < 40` で語義解説プロンプトに切替 | **維持** | クイックアクション「Explain selection」で `selectionText.length < 40` 時に発火（F-303 整合） |
| F-301 選択モードでのページ本文同時取得 | selection mode で `selectionText` + `pageText` 併送 | **維持** | クイックアクション「Explain selection」の経路で踏襲 |
| F-302 文脈付き Explain プロンプト | `Page context` + `Explain the following selection` 構造 | **維持** | 同上。Chat 履歴の user メッセージとして表示する文面は F-403 で別途規定 |
| F-303 選択モード短文警告抑止 | 選択モードでは F-203 警告を出さない | **維持** | クイックアクション「Explain selection」で踏襲 |

既存 F-001 / F-002 は変更しない。

---

## 1. プロダクト概要

- **本特性の目的**:
  - Side Panel の UI を 1 画面に統合し、Explain と Chat の認知負荷を下げる
  - Explain の結果も Chat 履歴に積むことで、続けて深掘り質問（自由入力 Chat）に繋げられるようにする
  - 参考実装 `youtube-ai-extension` と UX を揃え、コード資産を流用しやすくする
- **対象ユーザー**: 既存ターゲット（英語学習者・記事リーダー）と同一
- **対象外（明示・プロジェクト全体の対象外を再掲）**:
  - Anki 連携
  - 閲覧履歴トラッキング / Chat 履歴の永続化（タブを閉じたら破棄、または URL 変化でクリア）
  - クイズ生成

---

## 2. 機能一覧（400 番台）

### F-401: 単一 Chat 画面への UI 統合

- **概要**: Side Panel から Explain タブと Chat タブを撤廃し、単一の Chat メッセージ領域 + 入力バー + クイックアクション行に統合する。
- **ユーザーストーリー**: ユーザーとして、画面切替なしで Explain と Chat を同じ会話の流れで使いたい。
- **挙動仕様**:
  - Side Panel の DOM からタブ切替コントロール（`F-007` 由来の UI 要素）を削除する
  - Chat メッセージ領域は単一で、Explain 結果も自由入力 Chat も同じ履歴に時系列で並ぶ
  - 初期表示時、空の履歴に対して固定の **Welcome メッセージ**（assistant ロール、固定文言）を表示する。Welcome メッセージは履歴クリア後にも常に再表示される（送信ペイロードには含めない）
  - 言語切替セレクト（F-201）は画面上部ヘッダ領域に配置する
  - 入力バー（textarea + Send + Clear）は画面下部に配置する
  - クイックアクション行は入力バーのすぐ上に配置する
- **受け入れ条件**:
  - Side Panel の HTML / DOM にタブ要素（`role="tablist"` 相当 / 旧 Explain タブ・Chat タブ用ボタン）が存在しない
  - 起動時に Welcome メッセージ 1 件が表示される
  - 履歴クリア後に Welcome メッセージが再表示される
  - 言語セレクト（`en` / `ja`）がヘッダ領域から操作可能で、F-201 の保存挙動が変わらない
  - クイックアクション行・入力バー・メッセージ領域の 3 ブロックが縦に並んでいる（メッセージ領域 → クイックアクション → 入力バーの順）
- **優先度**: Must
- **既存上書き**: F-007 を撤廃。

### F-402: クイックアクションボタン群

- **概要**: Chat 画面下部にプリセットプロンプトを発火するボタンを並べる。各ボタンはあらかじめ仕様で固定された English プロンプトを user メッセージとしてチャットに投入する。
- **ユーザーストーリー**: ユーザーとして、よく使う Explain パターンを 1 クリックで実行したい。
- **プリセット（仕様で固定。実装時にブレないこと）**:

  | ID | ラベル | 種別 | 送信される user メッセージ（プリセット本文） | 必須/推奨 |
  |----|--------|------|----------------------------------------------|-----------|
  | QA-EXPLAIN-PAGE | `Explain page` | whole-page | `Explain this page in clear English. Cover the main topic, key points, and any important terminology.` | 必須 |
  | QA-EXPLAIN-SELECTION | `Explain selection` | selection | `Explain the selected text within the context of this page. Clarify meaning, usage, and any nuance.` | 必須 |
  | QA-SUMMARY | `Summary` | whole-page | `Summarize this page in 5 concise bullet points.` | 推奨 |
  | QA-DETAILED | `Detailed` | whole-page | `Provide a detailed explanation of this page, including background context and implications.` | 推奨 |
  | QA-BEGINNER | `Beginner-friendly` | whole-page | `Explain this page as if to a beginner with no prior knowledge of the topic. Use simple words and short sentences.` | 推奨 |
  | QA-EXPERT | `Expert-level` | whole-page | `Explain this page at an expert level. Use precise terminology and discuss subtle technical details.` | 推奨 |

  - 出力言語は F-201 の `outputLanguage` に従う（system プロンプト側で指示。プリセット本文自体は英語のまま固定）
  - ボタン配置順は上表のとおり（左から右、または折り返し時も同じ順）
  - 「必須」2 個は実装必須。「推奨」4 個は本スプリントで全て実装する（合計 6 個。Generator はラベル文言・プロンプト本文を改変してはならない）

- **挙動仕様**:
  - クイックアクション押下時、対応するプリセット本文を **user メッセージとして Chat 履歴に追加** し、続けて assistant の応答ストリーミングを履歴に積む
  - whole-page 種別のボタンは F-202 で抽出した `pageText` をコンテキストとしてプロンプトに同梱する（F-005 の従来構造を踏襲。プロンプト構造は F-403 で定義）
  - selection 種別（`Explain selection`）は F-301 / F-302 / F-303 をそのまま踏襲する
  - 応答中（ストリーミング中）は全クイックアクションボタンと Send ボタンを `disabled` にする
- **受け入れ条件**:
  - 6 個のボタン（必須 2 + 推奨 4）が描画されている
  - 各ボタンを押すと、上表の本文と完全一致する文字列が user バブルとして履歴に追加される
  - 各ボタン押下後に assistant バブルが履歴に追加され、最終的に非空の応答が表示される（モック API でも検証可能）
  - 応答中はボタンが押下不可（`disabled` 属性または等価な抑止）になる
  - whole-page 系ボタン押下時、Anthropic API への user content に F-202 抽出の `pageText` が含まれる
  - selection 系ボタン押下時、API リクエストに `Page context` と `Explain the following selection` の両セクションが含まれる（F-302 の構造を維持）
- **優先度**: Must
- **既存上書き**: F-005（Explain 全体の単発送信）の発火経路をクイックアクションに移管。

### F-403: クイックアクション実行時の Chat 履歴・送信ペイロード仕様

- **概要**: クイックアクションを「自由入力 Chat と同一経路」で実行するための、履歴表示と API 送信ペイロードの整合ルールを定める。
- **ユーザーストーリー**: ユーザーとして、Explain の結果に対してそのまま追加質問できてほしい。
- **挙動仕様**:
  - **履歴表示**: クイックアクションが投入する user バブルは、F-402 表のプリセット本文をそのまま表示する。`pageText` / `selectionText` を user バブル本文に含めない（UI 上のノイズを避けるため）
  - **送信ペイロード**: Anthropic API には以下を送る:
    - whole-page 系: system プロンプトに F-201 言語指示。直近 user メッセージ末尾に F-202 `pageText` を所定構造で同梱（既存 F-005 の単発プロンプト構造を踏襲）。Chat 履歴のうちプリセット本文に該当する user メッセージはこのうち 1 件として扱う
    - selection 系: F-302 の `Page context` / `Explain the following selection` 構造を直近 user メッセージに適用
  - **追加質問の流れ**: クイックアクションの応答後、ユーザーが自由入力で送信した次の user メッセージにも、`pageText`（または selection 文脈）が継続して付与される。具体的には、**送信ペイロード内の最新 user メッセージにのみ** ページ本文 / 選択文脈を同梱し、過去メッセージは履歴ロールのまま送る（トークン爆発を避ける）
  - 短文警告（F-203）は whole-page 系クイックアクション押下時のみ発火する。selection 系では F-303 により抑止
  - 短文プロンプト切替（F-204）は selection 系で `selectionText.length < 40` のときに system プロンプトを差し替える（F-303 と整合）
- **受け入れ条件**:
  - クイックアクション押下後の user バブル本文が F-402 表のプリセット本文と完全一致する（`pageText` / `selectionText` が混入していない）
  - whole-page 系の API リクエスト本文に `pageText` が同梱されている（モック API テストで検証）
  - selection 系の API リクエスト本文に `Page context` と `Explain the following selection` の両セクションが含まれる
  - クイックアクション応答の後、ユーザーが自由入力で `?` のような追加質問を送ると、送信ペイロードの **最新 user メッセージにのみ** 文脈（`pageText` / `Page context`）が同梱され、過去メッセージにはコンテキストが重複付与されない
  - whole-page 系で `pageText` が 40 文字未満のとき、F-203 の警告 UI が表示される
  - selection 系で `selectionText` が 40 文字未満のとき、F-203 警告は表示されず、F-204 の短文 system プロンプトが使われる
- **優先度**: Must
- **既存上書き**: F-005 / F-006 の送信ペイロード境界を統合。

### F-404: 履歴クリアと URL 変化リセットの挙動継続

- **概要**: 統合後の単一 Chat 履歴に対して、F-008 の URL 変化リセットと、画面下部の Clear ボタンによる手動クリアを動作させる。
- **挙動仕様**:
  - 入力バー左端に `Clear` ボタンを配置（参考実装と同等）。押下で履歴を空にし、Welcome メッセージ（F-401）を再表示する
  - 現在のタブの URL が変化した場合、F-008 の条件で履歴を自動クリアする（クリアトリガは既存仕様のまま）
  - クリア時、進行中のストリーミングがあれば中断する
- **受け入れ条件**:
  - `Clear` ボタン押下で Chat 履歴が空になり、Welcome メッセージのみが残る
  - URL 変化で履歴が自動クリアされ、Welcome メッセージのみが残る（F-008 の既存条件下で）
  - クリア後、クイックアクションも自由入力も再度押下/送信可能になる
- **優先度**: Must
- **既存上書き**: なし（F-008 の動作対象を統合履歴に移すのみ）。

### F-405: タブ UI 撤廃の確認

- **概要**: F-007 の Explain / Chat タブ切替 UI を完全に撤廃する。
- **挙動仕様**:
  - Side Panel HTML から旧タブ要素・タブ切替の TS ハンドラを除去する
  - Side Panel 起動直後の表示は単一 Chat 画面である
- **受け入れ条件**:
  - Side Panel に「Explain」「Chat」というタブラベルが描画されない
  - タブ切替に紐づくキーボード操作（あれば）が無効化されている
  - リグレッション: 既存テストでタブ存在を前提としたものは本特性の更新で削除/置換されている
- **優先度**: Must
- **既存上書き**: F-007 撤廃。

---

## 3. UI/UX 要件

### 画面構成図（テキストベース）

```
+--------------------------------------------------------------+
| Header                                                       |
|   [Output language: (en) (ja) ▼]                             |
+--------------------------------------------------------------+
| Messages (scrollable)                                        |
|                                                              |
|   [assistant] Welcome! Select text on the page or pick a     |
|               quick action below.                            |
|   [user]      Explain this page in clear English. ...        |
|   [assistant] (streaming response...)                        |
|                                                              |
+--------------------------------------------------------------+
| Quick actions (wrap to next line if needed)                  |
|   [Explain page] [Explain selection] [Summary]               |
|   [Detailed] [Beginner-friendly] [Expert-level]              |
+--------------------------------------------------------------+
| Input bar                                                    |
|   [Clear]  [ textarea: ask a follow-up...        ]  [Send]   |
+--------------------------------------------------------------+
```

- 旧 Explain タブ / Chat タブの切替 UI は **存在しない**
- メッセージ領域には Welcome メッセージ + user/assistant バブル + error バブル（F-011）+ 切り詰め通知（F-012）が時系列で混在する

### 主要フロー

1. **Explain page（whole-page クイックアクション）**:
   1. Side Panel を開く（Welcome メッセージのみ表示）
   2. `Explain page` を押下
   3. user バブル「Explain this page in clear English. ...」が履歴に追加される
   4. background が F-202 抽出 → API 呼び出し → assistant バブルにストリーミング
   5. ユーザーが自由入力で「Why is this important?」と続けて送信 → 同じ `pageText` 文脈を最新メッセージに付与して送る

2. **Explain selection（selection クイックアクション）**:
   1. ページ上で語句を選択
   2. Side Panel で `Explain selection` を押下
   3. F-301 / F-302 / F-303 の経路で `Page context` + `Explain the following selection` を含むリクエストが送られる
   4. assistant バブルに応答が表示される
   5. 自由入力での追加質問にも同じ選択 + ページ文脈が付与される

3. **履歴クリア**:
   - `Clear` ボタンまたは URL 変化 → 履歴空 → Welcome 再表示

### キーボード / アクセシビリティ
- 入力欄での `Enter` 送信 / `Shift+Enter` 改行は既存 F-006 の挙動を維持
- クイックアクションボタンは `<button>` 要素で実装し、Tab 移動でフォーカス可能であること
- 言語セレクトは `<label>` 紐づけを維持

---

## 4. スプリント計画

本特性は 1 スプリントでコンパクトに完了する。

### Sprint 7: 単一 Chat 画面への統合

- **ゴール**: Side Panel が単一 Chat 画面になり、Explain がクイックアクション経由で Chat 履歴に統合される。タブ UI は完全に撤廃される。
- **含まれる機能**: F-401, F-402, F-403, F-404, F-405
- **依存**: Sprint 1〜6（F-001〜F-013, F-201〜F-204, F-301〜F-303）が実装済みであること
- **順序制約**:
  - F-401（UI 骨格）→ F-402（クイックアクション配線）→ F-403（送信ペイロード整合）→ F-404 / F-405（既存挙動の継続確認 / 撤廃）の順を推奨
- **合格基準**:
  - F-401〜F-405 の受け入れ条件を 100% 満たす
  - 既存 Sprint 1〜6 の合格基準が引き続き通る（特に F-201 言語切替、F-301〜F-303 の selection 文脈、F-008 の URL 変化リセット）
  - `npm run check` が成功する
  - モック Claude API を用いた単体テストで、whole-page クイックアクションのリクエストに `pageText` が、selection クイックアクションのリクエストに `Page context` / `Explain the following selection` が含まれることを確認できる

---

## 5. 非機能要件（差分）

### パフォーマンス
- クイックアクション押下から最初の assistant トークン表示までの所要時間が、現行 Explain タブ実装と比較して劣化しないこと（許容: ±10%）
- 履歴に積まれる過去メッセージは送信時にそのまま含めるが、`pageText` / `Page context` を **最新 user メッセージにのみ** 付与することでトークン消費の爆発を避ける（F-403）

### セキュリティ / プライバシー
- API キーの UI / ログ露出禁止（F-013 維持）
- DOM 全文ログ禁止の方針を維持
- `chrome.storage.sync` への新規書き込み禁止（F-201 / F-013 維持）

### 互換性
- 既存ユーザーの設定（`outputLanguage` 等）に対するマイグレーション不要
- 旧 Chat 履歴 / 旧 Explain 結果の永続化は元々行っていないため、移行データは存在しない
- メッセージ型（discriminated union）にクイックアクション経路を追加する場合は、background が未知の `kind` を受け取ったときに `exhaustive switch` で安全に拒否する（既存規約維持）

---

## 6. 評価基準（5 軸、既存と整合）

| 軸 | 閾値 / 合格条件 |
|----|------------------|
| **機能適合性** | F-401〜F-405 の受け入れ条件を 100% 満たす。既存 F-001〜F-013 / F-201〜F-204 / F-301〜F-303 にリグレッションがない（特に F-007 が撤廃され、F-301〜F-303 が selection クイックアクションで動作する） |
| **コード品質** | `npm run check`（typecheck + build）が成功。Lint ゼロエラー。discriminated union メッセージ規約・exhaustive switch・`chrome.storage.sync` 禁止等の既存規約に違反しない |
| **テスト** | クイックアクション 6 種それぞれの送信ペイロード、Welcome メッセージの初期/クリア後再表示、URL 変化での履歴クリアに対する単体テスト。関連モジュールのカバレッジ 80% 以上。既存テスト緑のまま |
| **セキュリティ** | API キーが UI / ログ / エラーメッセージに露出しない。DOM 全文がログに残らない。`chrome.storage.sync` への新規書き込みが発生しない |
| **UX 一貫性** | クイックアクションのラベル・プロンプト本文が F-402 表と完全一致。応答中のボタン抑止が一貫して動作。`outputLanguage` 切替がクイックアクション・自由入力 Chat の両方に反映される。Welcome メッセージがクリア後に必ず再表示される |

### 全体の完了基準
- Sprint 7 の合格基準をすべて満たす
- 既存 Sprint 1〜6 の合格基準が引き続き満たされる
- 対象外機能（Anki 連携 / 閲覧履歴 / Chat 履歴永続化 / クイズ生成）が実装されていないこと
- `npm run check` が成功する
