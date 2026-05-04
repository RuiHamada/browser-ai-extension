# 製品仕様書: Floating Explain Button & Chat Markdown Rendering

本仕様は以下の既存仕様の **拡張・上書き** である。

- `docs/features/001-explain-and-chat/spec.md`（F-001〜F-013）
- `docs/features/002-output-language-and-robust-extract/spec.md`（F-201〜F-204）
- `docs/features/003-selection-with-context/spec.md`（F-301〜F-303）
- `docs/features/004-merge-explain-into-chat/spec.md`（F-401〜F-405）

本特性は 2 系統の改善を扱う:

1. **Floating Explain Button**: Web ページ上でテキストを選択した際、選択範囲付近にフローティングの `Explain` ボタンを表示し、クリックすると Side Panel を開いて選択範囲に対する Explain（既存「Explain selection」クイックアクション）を即時実行する。
2. **Chat Bubble Markdown Rendering**: Side Panel の Chat における assistant メッセージを Markdown として描画する。XSS を確実に防ぎつつ、見出し / 箇条書き / コードブロック / リンク / 強調等を見やすく表示する。

---

## 0. 既存仕様との関係マトリクス

| 既存 ID | 既存挙動 | 本特性での扱い | 上書き / 補強内容 |
|---------|----------|----------------|-------------------|
| F-004 選択テキスト取得 | 選択テキストを content script 経由で取得 | **維持** | フローティングボタン経路でも同じ抽出ロジックを再利用 |
| F-006 Chat 自由入力 | 自由入力でチャット | **維持** | Markdown レンダリングは assistant バブルにのみ適用、user バブルはプレーンテキストのまま |
| F-007 タブ切替 | （F-405 で撤廃済） | **撤廃継続** | 復活させない |
| F-008 URL 変化リセット | URL 変化で履歴クリア | **維持** | フローティング起動経路でも同条件で発火 |
| F-011 エラーハンドリング | error バブル表示 | **維持** | Markdown レンダリング失敗時は安全フォールバックに `error` 表示は使わない（F-504 で規定） |
| F-013 API キー露出禁止 | UI/ログにキーを出さない | **維持** | 変更なし |
| F-201 出力言語切替 | `outputLanguage` 設定 | **維持** | フローティング経由 Explain でも適用 |
| F-301 選択モード時の併送 | `selectionText` + `pageText` 併送 | **維持** | フローティング経由でも踏襲 |
| F-302 文脈付き Explain プロンプト | `Page context` + `Explain the following selection` | **維持** | フローティング経由でも同構造 |
| F-303 選択モード短文警告抑止 | 選択モードでは F-203 警告を出さない | **維持** | フローティング経由でも踏襲 |
| F-401 単一 Chat 画面 | タブ廃止・単一 Chat | **維持** | Markdown レンダリングは本画面の assistant バブルに適用 |
| F-402 クイックアクション | 6 個のプリセット | **維持** | フローティングボタンは `QA-EXPLAIN-SELECTION` の発火経路を増やすのみ。プリセット文言・本数は不変 |
| F-403 送信ペイロード整合 | selection 系の API ペイロード構造 | **維持** | フローティング経由でも同一ペイロードが組み立てられる |
| F-404 履歴クリア | Clear / URL 変化リセット | **維持** | TAB_CHANGED 由来のリセットも従来通り |
| F-405 タブ UI 撤廃 | タブ完全撤廃 | **維持** | 復活させない |

新規 ID:

- **F-501**: フローティング Explain ボタン UI（Shadow DOM）
- **F-502**: content script の Selection 監視と起動条件
- **F-503**: フローティングボタン → background → Side Panel の Explain 自動起動連携
- **F-504**: assistant Chat バブルの Markdown レンダリング + XSS サニタイズ

---

## 1. プロダクト概要

- **本特性の目的**:
  - Web ページ上で気になった語句・段落を選択 → 即座に Explain を起動できる導線を追加し、Side Panel を開いてからクイックアクションを押す手間を削減する
  - assistant 応答が Markdown で返るケース（コード片・リスト・見出し）が多いため、可読性を向上する
- **対象ユーザー**: 既存ターゲット（英語学習者・記事リーダー）と同一
- **対象外（プロジェクト全体の対象外を再掲）**:
  - Anki 連携
  - 閲覧履歴トラッキング / Chat 履歴の永続化
  - クイズ生成
  - 言語自動判定（出力言語は引き続き F-201 のユーザー設定に従う）

---

## 2. 機能一覧（500 番台）

### F-501: フローティング Explain ボタン UI

- **概要**: 現在のページ DOM に対し、選択テキストの近くにフローティングの `Explain` ボタンを描画する。ホストページの CSS / DOM と衝突しないよう **Shadow DOM** で隔離する。
- **ユーザーストーリー**: ユーザーとして、テキストを選択した直後にその場で Explain を起動したい。
- **挙動仕様**:
  - content script が Shadow DOM 付きホスト要素（`document.body` 直下に追加）を 1 つだけ生成し、その中にボタンを描画する
  - ボタン文言は `Explain`（固定。出力言語設定に依存しない）
  - ボタンの位置は選択範囲の `getBoundingClientRect()` の右下付近にビューポート座標で配置する。画面端で見切れないようクランプする
  - ボタンは `role="button"` 相当（`<button>` 要素）であり、`aria-label="Explain selected text"` を持つ
  - ボタンはホストページの `z-index` の上に出る（実装上は最大値クラスの `z-index` を使う）
  - スタイル隔離のため、ボタンの CSS は Shadow DOM 内にのみ存在する
- **受け入れ条件**:
  - jsdom 上でテキストを選択し `selectionchange` を発火させると、`document.body` 配下に Shadow DOM ホスト要素が 1 個だけ存在する
  - 同ホストの `shadowRoot` 配下に `<button>` 要素が 1 個存在し、テキストが `Explain`、`aria-label` が `Explain selected text` である
  - フローティングボタン用のスタイルがホストページの `<head>` 直下や `document.body` 直下に挿入されていない（Shadow DOM 外への CSS リークがない）
  - 同じ選択を維持したまま再評価されてもホスト要素は 2 個以上に増えない
- **優先度**: Must

### F-502: content script の Selection 監視と起動条件

- **概要**: content script が `selectionchange` / `mouseup` / `keyup` を監視し、起動条件を満たした場合のみ F-501 のボタンを表示する。条件を外れた場合は速やかに非表示化する。
- **ユーザーストーリー**: ユーザーとして、誤発火（パスワード入力欄や 1 文字選択）を避けたい。
- **挙動仕様（起動条件、すべて満たすときのみ表示）**:
  - 選択文字列が `trim` 後 **2 文字以上**
  - 選択範囲のアンカー / フォーカスノードのどちらかが `<input type="password">` または `<textarea>` の内部・あるいは祖先に `contenteditable="true"` を持つ要素を含む場合は **起動しない**
  - `document.activeElement` が `<input type="password">` の場合も起動しない
  - 選択範囲が当該 Shadow DOM ホスト要素自身の中にある場合は起動しない（自己再発火防止）
- **挙動仕様（非表示条件）**:
  - 選択が空になった、選択文字列が条件未満になった
  - フローティングボタン以外の場所がクリックされた（`mousedown` で他要素にフォーカスが移った）
  - ページがスクロールされた場合は **追従または消去** のどちらかで挙動が一貫していること（実装は追従を推奨。消去でも可。受け入れ条件で「画面外に取り残されない」ことを担保）
  - タブが非表示（`document.hidden`）になった
- **受け入れ条件**:
  - 1 文字だけの選択ではボタンが表示されない
  - `<input type="password">` 内の選択ではボタンが表示されない
  - `contenteditable="true"` 要素内の選択ではボタンが表示されない
  - 選択をクリアするとボタンが DOM 上から消える、または `display: none` 相当で不可視になる
  - スクロール後にボタンの可視矩形がビューポート内に収まる、もしくは非表示になる（取り残されない）
  - ボタン自身をクリックした際、選択がクリアされる前に F-503 のメッセージが送信される
- **優先度**: Must

### F-503: フローティングボタン → Side Panel の Explain 自動起動連携

- **概要**: ボタンクリック時、content script が `chrome.runtime.sendMessage` で background に「Explain selection を Side Panel で実行」を依頼する。background は Side Panel を開き（必要なら）、Side Panel に「クイックアクション `QA-EXPLAIN-SELECTION` を即時実行する」旨のメッセージを送る。
- **ユーザーストーリー**: ユーザーとして、フローティングボタン 1 クリックで Side Panel が開き Explain 結果が出てきてほしい。
- **挙動仕様**:
  - メッセージ型は discriminated union として追加する（例: `kind: "FLOATING_EXPLAIN_REQUEST"` 等。具体名は Generator が決定）。ペイロードには `selectionText`（必須・空でない）を含む。`pageText` は Side Panel 側の既存経路で改めて取得して構わない（重複送信を避けるため）
  - background は `chrome.sidePanel.open({ tabId })` 等で Side Panel を開く。既に開いていれば再オープンしない
  - background は Side Panel のレンダラに「自動 Explain 実行依頼」メッセージをブロードキャストする。Side Panel 起動直後でリスナが未登録の場合に備え、background は短時間バッファ（タブ単位の pending state）を保持する
  - Side Panel は受信メッセージを既存 F-402 の `QA-EXPLAIN-SELECTION` 実行経路と同一の関数（`runQuickAction('qaExplainSelection')` 相当）で処理する。プリセット本文・F-302 の `Page context` + `Explain the following selection` 構造は **F-402 / F-403 の規定を変更してはならない**
  - 別タブに切り替わったり URL が変化した場合は、F-008 / F-404 の TAB_CHANGED リセット条件をそのまま満たす（pending state も破棄する）
  - 出力言語は F-201 の現在値に従う
- **受け入れ条件**:
  - フローティングボタン押下時、background に対して `selectionText` 入りのメッセージが 1 通だけ送信される（モック検証可能）
  - background は `chrome.sidePanel.open` を 1 回呼び、Side Panel 側にクイックアクション実行依頼メッセージを送る
  - Side Panel が当該メッセージを受信したとき、F-402 表のプリセット本文と完全一致する user バブルが履歴に追加される（フローティング経由でも文言は同じ）
  - API リクエストに F-302 の `Page context` と `Explain the following selection` の両セクションが含まれる
  - Side Panel 起動直後（リスナ未登録）にメッセージが先行した場合でも、リスナ登録後 pending state が解決され、Explain が 1 回だけ実行される（重複実行されない）
  - URL 変化時には pending state が破棄され、新しいページ文脈で誤って Explain が走らない
  - API キーが未設定の場合、F-010 の誘導 UI が Chat バブル内に表示され、ペイロードは送信されない
- **優先度**: Must
- **既存上書き**: なし。F-402 / F-403 への発火経路追加のみ。

### F-504: assistant Chat バブルの Markdown レンダリング + XSS サニタイズ

- **概要**: Side Panel の Chat 履歴に積まれる **assistant ロール** のメッセージを Markdown として描画する。user / error / 切り詰め通知バブルは従来通りプレーンテキストのまま。
- **ユーザーストーリー**: ユーザーとして、Claude が返す箇条書き・コードブロック・見出し・リンクが整形されて読みたい。
- **対応する Markdown 記法（最低限の必須カバレッジ）**:
  - 段落 / 改行（空行による段落区切り、行末改行）
  - 見出し（`#`, `##`, `###`）
  - 順序付きリスト（`1.`, `2.`, ...）
  - 順序なしリスト（`-`, `*`）
  - インラインコード（`` `code` ``）
  - フェンス付きコードブロック（` ```lang ... ``` `、`lang` は無くても可）
  - 太字（`**bold**`）
  - イタリック（`*italic*` または `_italic_`）
  - リンク（`[text](https://example.com)`）
- **任意（実装してもよいが必須ではない）**: テーブル、画像、ブロッククォート、取り消し線
- **挙動仕様**:
  - 実装方針は次のいずれか:
    1. 自前の最小レンダラで Markdown をパースしつつ、`document.createElement` ベースで DOM ノードを直接組み立てる（`innerHTML` 不使用）
    2. 軽量ライブラリ（例: marked 等）でパースし、**必ず DOMPurify 相当のサニタイザを通してから** `innerHTML` に渡す
  - いずれの方針でも MV3 の CSP（`script-src 'self'`、no `eval`、no inline script）と互換であること
  - リンクは `target="_blank"` かつ `rel="noopener noreferrer"` を必ず付与する
  - リンクの URL スキームは `http:` / `https:` / `mailto:` のみ許可。`javascript:`, `data:`, `vbscript:`, その他不明スキームは無効化（`href` を削除またはプレーンテキスト化）
  - コードブロックは `<pre><code>` 構造で描画。等幅フォント・薄い背景の既存 CSS と整合する class 名（例: `markdown-codeblock`）を付与する
  - `<script>`, `<iframe>`, `<object>`, `<embed>`, `<style>` などの危険要素は出力 DOM に出現してはならない
  - `on*=` 属性（`onerror`, `onclick` 等）は出力 DOM に出現してはならない
  - **過去の assistant 履歴**を再描画する経路（履歴復元時・再レンダリング時）も同じレンダラを通す
  - レンダラが例外を投げた場合は **元の文字列をプレーンテキストとして表示** する安全フォールバックを行う（assistant バブル自体は表示される）
  - ストリーミング中の途中文字列にも逐次レンダリングを適用してよい。途中で不完全な Markdown（閉じていないコードブロック等）に対しても例外で落ちず、安全フォールバックまたは部分整形で表示する
  - user バブルには Markdown レンダリングを適用しない（既存通りテキストノードで表示）
- **受け入れ条件（機能）**:
  - assistant メッセージ `## Title\n\n- a\n- b\n\n` が `<h2>Title</h2>` と `<ul><li>a</li><li>b</li></ul>` を含む DOM として描画される
  - assistant メッセージ `` `code` `` が `<code>code</code>` として描画される
  - assistant メッセージ ` ```js\nconst x = 1;\n``` ` が `<pre><code>` 構造で描画される
  - assistant メッセージ `[link](https://example.com)` が `<a href="https://example.com" target="_blank" rel="noopener noreferrer">link</a>` として描画される
  - assistant メッセージ `**bold**` が `<strong>bold</strong>` として描画される
  - 履歴を再レンダリングしても上記が同じ DOM 構造になる
- **受け入れ条件（XSS 防止、必ず自動テストで検証）**:
  - 入力 `<script>alert(1)</script>` から生成された DOM に `<script>` 要素が一切含まれない
  - 入力 `<img src=x onerror="alert(1)">` から生成された DOM に `onerror` 属性が含まれない（`<img>` 自体が落ちていてもよい）
  - 入力 `[click](javascript:alert(1))` から生成された DOM の `<a>` に `href="javascript:..."` が **付与されていない**（`href` 削除 or プレーンテキスト化）
  - 入力 `<iframe src="https://evil"></iframe>` から生成された DOM に `<iframe>` が含まれない
  - 入力 `<a href="https://x" onclick="alert(1)">x</a>` から生成された DOM の `<a>` に `onclick` が含まれない
  - レンダラ例外時に元の文字列がプレーンテキストとしてバブルに表示される（HTML として解釈されない）
- **優先度**: Must
- **既存上書き**: なし。F-006 / F-401 の表示挙動を assistant バブルに限り強化。

---

## 3. UI/UX 要件

### 画面構成図（テキストベース）

#### フローティング Explain ボタン（ホストページ上）

```
+--- Host page ---------------------------------------------+
|                                                           |
|   ... lorem ipsum [SELECTED TEXT] dolor sit amet ...      |
|                                  +-----------+            |
|                                  |  Explain  |  <- F-501  |
|                                  +-----------+            |
|                                                           |
+-----------------------------------------------------------+
       (Shadow DOM ホスト要素は body 直下、CSS は Shadow 内のみ)
```

#### Side Panel との連携シーケンス

```
[content script] ----(FLOATING_EXPLAIN_REQUEST { selectionText })----> [background]
                                                                            |
                                                                            v
                                                          chrome.sidePanel.open({tabId})
                                                                            |
                                                                            v
[Side Panel] <----(QUICK_ACTION_AUTORUN { actionId: "qaExplainSelection",
                                          selectionText })---- [background]
       |
       v
runQuickAction("qaExplainSelection")
       |
       v
F-402 / F-403 の selection 経路に合流 → Anthropic API 呼び出し
       |
       v
assistant バブルを Markdown レンダリング (F-504)
```

- Side Panel 起動直後にリスナが未登録の場合、background はタブ単位の pending state を保持し、リスナ登録通知（既存の `SIDE_PANEL_READY` 等、Generator が決定）受信時に flush する。

#### Markdown レンダリング適用範囲

- assistant バブル: Markdown レンダリング適用
- user バブル: プレーンテキスト（既存通り）
- error バブル: プレーンテキスト（既存通り）
- 切り詰め通知 / 短文警告: プレーンテキスト（既存通り）

### 主要フロー

1. **フローティング Explain（新規）**:
   1. ユーザーがページ上のテキストを選択
   2. 選択範囲付近に `Explain` ボタンが表示される（F-501 / F-502）
   3. ボタンクリックで Side Panel が開き、`QA-EXPLAIN-SELECTION` のプリセット本文が user バブルとして履歴に追加される（F-402 文言を遵守）
   4. assistant バブルにストリーミング応答が Markdown として描画される（F-504）
2. **誤発火回避**:
   - パスワード入力欄上の選択 / 1 文字選択 / `contenteditable` 内の選択 ではボタンが出ない
3. **Markdown 表示確認**:
   - 既存自由入力 Chat / 各クイックアクションの応答も Markdown レンダリングを通る

### キーボード / アクセシビリティ
- フローティングボタンは `<button>` 要素・Tab 移動でフォーカス可能・`Enter` / `Space` で起動可能であること
- `aria-label` は `Explain selected text`
- Markdown 描画後の `<a>` は標準のフォーカス順序を維持
- ホストページの色覚スタイルを破壊しない（Shadow DOM 内に閉じる）

---

## 4. スプリント計画

本特性は 2 スプリントに分割する。Sprint 8 が独立して導入可能であり、Sprint 9 は表示品質向上のため後続で進める。

### Sprint 8: フローティング Explain ボタンと Side Panel 連携

- **ゴール**: ホストページ上のテキスト選択でフローティング `Explain` ボタンが表示され、クリックすると Side Panel が開いて既存の `Explain selection` クイックアクションが自動実行される。
- **含まれる機能**: F-501, F-502, F-503
- **依存**: Sprint 1〜7 が実装済みであること（特に F-301〜F-303 / F-402 selection 経路）
- **順序制約**:
  - F-501（Shadow DOM UI）→ F-502（Selection 監視・起動条件）→ F-503（メッセージ連携）の順を推奨
- **合格基準**:
  - F-501〜F-503 の受け入れ条件を 100% 満たす
  - jsdom + `chrome.*` モック環境で、選択 → ボタン押下 → Side Panel 側で `QA-EXPLAIN-SELECTION` が起動するシナリオが緑になる
  - 既存 F-007 撤廃 / F-401〜F-405 / F-301〜F-303 にリグレッションがない
  - `npm run check` 成功

### Sprint 9: Chat assistant バブルの Markdown レンダリング

- **ゴール**: Side Panel の assistant メッセージが Markdown として整形表示され、XSS が確実に防がれる。
- **含まれる機能**: F-504
- **依存**: Sprint 7（F-401〜F-405）が実装済みであること
- **順序制約**: なし（Sprint 8 と独立に着手可能。並行可）
- **合格基準**:
  - F-504 の機能受け入れ条件 6 件すべて緑
  - F-504 の XSS 防止受け入れ条件 6 件すべて緑（自動テストで網羅）
  - 既存 F-006 / F-011 / F-012 のテキスト系バブル表示にリグレッションがない
  - `npm run check` 成功

両スプリント完了後、フローティング経由 → Side Panel → Markdown 表示という end-to-end 経路（jsdom 上の擬似 E2E）が成立すること。

---

## 5. 非機能要件（差分）

### パフォーマンス
- `selectionchange` ハンドラはデバウンス（推奨 50〜150ms）し、選択操作中の再描画コストを抑える
- Markdown レンダリングはストリーミング 1 トークン到達ごとに走らせてもよいが、1 メッセージあたり同期処理時間が 16ms を超えるパースを毎回実行しない（差分更新または `requestAnimationFrame` 単位の更新を推奨）
- フローティングボタン表示までの追加レイテンシは選択完了から 200ms 以内

### セキュリティ / プライバシー
- API キー UI / ログ露出禁止（F-013 維持）
- 選択テキストおよびページ DOM 全文をログ出力しない（既存方針維持）
- フローティングボタンは Shadow DOM で隔離し、ホストページの DOM / CSS / イベントを書き換えない（クリック以外でホストページ上のイベントを `stopPropagation` しない）
- Markdown レンダリングは F-504 受け入れ条件にあるとおり XSS を確実に防ぐ
- MV3 CSP（`script-src 'self'`）と互換、`eval` / インラインスクリプト不使用
- 出力言語は F-201 のユーザー設定のみに依存（自動判定なし）

### アクセシビリティ
- フローティングボタンは ARIA 属性を持ち、キーボード操作可能
- Markdown 描画した DOM はネイティブ HTML セマンティクス（`h2`, `ul`, `code`, `a` 等）を使用しスクリーンリーダーに読まれる

### 互換性
- 既存メッセージ型に新規 `kind` を追加。background は未知の `kind` を `exhaustive switch` で安全に拒否（既存規約維持）
- 既存設定値のマイグレーション不要

---

## 6. 評価基準（5 軸、既存と整合）

| 軸 | 閾値 / 合格条件 |
|----|------------------|
| **機能適合性** | F-501〜F-504 の受け入れ条件を 100% 満たす。既存 F-001〜F-013 / F-201〜F-204 / F-301〜F-303 / F-401〜F-405 にリグレッションがない（特に F-402 のプリセット文言・本数、F-302 の selection ペイロード構造、F-405 タブ撤廃） |
| **コード品質** | `npm run check`（typecheck + build）成功。Lint ゼロエラー。discriminated union メッセージ規約・`exhaustive switch`・`chrome.storage.sync` 禁止・MV3 CSP（no eval / no inline）・Shadow DOM 隔離の規約を遵守 |
| **テスト** | フローティングボタン起動条件（最短文字数 / password / contenteditable）、Side Panel 連携の pending state、Markdown レンダリングの基本記法 6 種、XSS 6 ベクタを単体テストで網羅。関連モジュールのカバレッジ 80% 以上。既存テスト緑のまま |
| **セキュリティ** | API キーが UI / ログ / エラーメッセージに露出しない。選択テキスト / DOM 全文がログに残らない。Markdown レンダリングが `<script>` / `on*=` / `javascript:` URL を実行可能な形で DOM に残さない。フローティング UI が Shadow DOM 外に CSS / DOM をリークしない |
| **UX 一貫性** | フローティング経由の Explain でも F-402 表のプリセット本文と完全一致する user バブルが追加される。出力言語が F-201 設定に従う。assistant バブルの Markdown 描画が履歴復元・再レンダリング・ストリーミング途中・例外フォールバックすべてで一貫している |

### 全体の完了基準
- Sprint 8 と Sprint 9 双方の合格基準を満たす
- 既存 Sprint 1〜7 の合格基準が引き続き満たされる
- 対象外機能（Anki 連携 / 閲覧履歴 / Chat 履歴永続化 / クイズ生成 / 言語自動判定）が実装されていないこと
- `npm run check` が成功する
