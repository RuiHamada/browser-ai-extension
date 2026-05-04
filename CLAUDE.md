# browser-ai-extension

任意のWebページのDOMを読み取り、英文での解説（Explain）と AI チャットを提供する Chrome 拡張機能（MV3）。
`~/Git/youtube-ai-extension` を参考実装としつつ、対象は YouTube ではなく一般 Web ページ全体。Anki 連携・閲覧履歴の機能は持たない。

## プロダクトのスコープ

- **対象**: 任意の Web ページ（`<all_urls>` または許可されたホスト）
- **入力**: ページ DOM（本文抽出）またはユーザーが選択したテキスト
- **出力**:
  - **Explain**: 選択範囲またはページ全体について英語で解説（Side Panel に表示）
  - **Chat**: ページ内容をコンテキストとした AI チャット
- **対象外**: Anki 連携、視聴/閲覧履歴トラッキング、クイズ生成

## 技術スタック（参考: youtube-ai-extension）

- TypeScript（strict mode）
- esbuild によるバンドル
- Chrome Extension Manifest V3
  - `service_worker`（background）
  - `content_scripts`（DOM 抽出 / 選択テキスト送信）
  - `side_panel`（Explain・Chat UI）
  - `options_page` / `popup`
- Anthropic Claude API（直接呼び出し）
- 設定保存: `chrome.storage.local`
- チャット履歴: 保存しない、もしくはセッションのみ（タブを閉じたら破棄）

## プロジェクト構成（予定）

```
browser-ai-extension/
├── manifest.json
├── build.mjs
├── tsconfig.json
├── package.json
├── icons/
├── dist/                       # ビルド成果物（gitignore）
├── docs/
│   ├── README.md                       # features 一覧と現行版へのリンク
│   └── features/
│       └── {NNN-slug}/                 # 依頼単位（例: 001-explain-and-chat）
│           ├── spec.md                 # 製品仕様書（Planner 生成）
│           ├── sprint-{N}-self-review.md
│           └── sprint-{N}-evaluation.md
└── src/
    ├── types/
    │   └── messages.ts         # メッセージ型（discriminated union）
    ├── lib/
    │   └── claude.ts           # Claude API クライアント
    ├── background/
    │   └── index.ts            # メッセージルータ
    ├── content/
    │   ├── index.ts            # DOM 抽出 + 選択テキスト取得
    │   └── extract.ts          # 本文抽出ロジック
    ├── sidepanel/
    │   ├── panel.html
    │   ├── index.ts
    │   ├── explain.ts          # Explain タブ
    │   ├── chat.ts             # Chat タブ
    │   └── styles/
    ├── options/
    │   ├── options.html
    │   └── options.ts
    └── popup/
        ├── popup.html
        └── popup.ts
```

最終的な構成は Generator が仕様書に従って決定する。上記はあくまで初期想定。

## 開発コマンド（予定）

```bash
npm install
npm run build         # 開発ビルド
npm run watch         # 監視ビルド
npm run typecheck     # 型チェックのみ
npm run check         # typecheck + build
```

## コーディング規約

- **言語**: TypeScript（strict）。コメント・ドキュメントは日本語
- **メッセージ通信**: `chrome.runtime.sendMessage` を集約ルータで処理。型は discriminated union で表現
- **API キー**: `chrome.storage.local` のみ。`chrome.storage.sync` には保存しない（漏洩リスク）
- **DOM 抽出**: `<script>` / `<style>` / `<noscript>` を除外し、本文相当のテキストを抽出する
- **エラーハンドリング**:
  - API 呼び出しは try/catch し、ユーザー向けに英文/日本語で原因がわかるメッセージを表示
  - `console.error` はスタックトレース込みで出力（`console.error("...", err)`）
- **PII / セキュリティ**:
  - ページ DOM にはユーザーの機微情報が含まれうる。ログに DOM 全文を残さない
  - API キーを UI / ログに表示しない

## コミット規約

- コメント・コミットメッセージは日本語
- `Co-Authored-By` 署名は不要

---

## エージェントパイプライン（自動制御ルール）

ユーザーから機能実装を依頼された場合、Claude Code は以下のパイプラインを **自動的に** 制御する。ユーザーが手動で `claude --agent` を実行する必要はない。

### アーキテクチャ

Claude Code（Orchestrator）が Sub-Agent に役割を委任する。Codex は **最終レビュー時のみ** 使用する。

```
Claude Code (Orchestrator)
  │
  ├─[1] 仕様書生成 ──→ Planner (Opus)
  │                       └─ docs/spec.md を生成
  │
  ├─[2] ユーザー承認待ち
  │
  ├─[3] 実装 ──→ Generator (Sonnet)
  │                       └─ 自分でコードを書く（Codex 委任なし）
  │                       └─ git diff / npm run check で自己検証
  │                       └─ docs/sprint-{N}-self-review.md
  │
  ├─[4] 全体整合性チェック（Orchestrator自身）
  │      NG → Generator に差し戻し
  │
  ├─[5] テスト・レビュー ──→ Evaluator (Opus)
  │                       └─ 自分でテストを書く（Codex 委任なし）
  │                       └─ 自分でコードレビューする
  │                       └─ docs/sprint-{N}-evaluation.md
  │      不合格 → Generator に差し戻し → 再評価
  │
  ├─[6] 合格 → 最終レビュー ──→ Codex (codex exec --full-auto)
  │      指摘あり → Generator に差し戻し → Evaluator → ...
  │
  └─[7] 完了 → ユーザーに報告
```

### 各レイヤーの責務

| レイヤー | モデル | Codex 利用 | 責務 |
|----------|--------|------------|------|
| **Orchestrator (Claude Code)** | - | スプリント完了時のみ | 全体計画、Sub-Agent への指示、整合性チェック、最終 Codex レビュー、ユーザーとの対話 |
| **Planner** | Opus | 不使用 | `docs/spec.md` を生成。技術詳細には踏み込まない |
| **Generator** | Sonnet | 不使用 | スプリントを自分で実装。`docs/sprint-{N}-self-review.md` を残す |
| **Evaluator** | Opus | 不使用 | テスト作成・コードレビュー。`docs/sprint-{N}-evaluation.md` を残す |
| **Codex** | gpt 系 | 最終レビュー専用 | スプリント合格後の最終レビューのみ |

### 必須フロー

```
1. Planner (Opus) → docs/spec.md を生成
2. ユーザーに仕様書レビュー依頼（承認待ち）
3. Generator (Sonnet) → 実装
4. Orchestrator → 全体整合性チェック
5. Evaluator (Opus) → テスト作成・レビュー
6. 不合格 → Generator に差し戻し → 再評価
7. 合格 → Codex 最終レビュー → 指摘あれば Generator に差し戻し
8. 完了 → 次スプリントがあれば 3 に戻る
```

### 制御ルール

- **スキップ禁止**: Planner → Generator → Evaluator の順序を飛ばさない
- **仕様書が先**: 実装前に必ず `docs/spec.md` を生成し承認を得る
- **評価は必須**: Generator の実装後は必ず Evaluator を走らせる
- **FB ループ**: 同一スプリントで 3 回不合格になった場合、ユーザーに仕様見直しを提案
- **Codex は最終レビューのみ**: Generator / Evaluator から Codex を呼ぶことは禁止

### エージェント間の契約（ファイルパス）

依頼（feature）ごとに専用ディレクトリ `docs/features/{NNN-slug}/` を作成し、その配下にすべての成果物を配置する。

- 採番: 3 桁ゼロ埋め連番（`001`, `002`, ...）
- スラッグ: kebab-case の英語短い識別子（例: `explain-and-chat`）
- ディレクトリ作成は **Orchestrator の責務**。Sub-Agent には feature ディレクトリの絶対/相対パスを引数で渡す

| ファイル | 生成者 | 消費者 | 説明 |
|----------|--------|--------|------|
| `docs/features/{NNN-slug}/spec.md` | Planner | Generator, Evaluator | 製品仕様書 |
| `docs/features/{NNN-slug}/sprint-{N}-self-review.md` | Generator | Evaluator | スプリント自己評価 |
| `docs/features/{NNN-slug}/sprint-{N}-evaluation.md` | Evaluator | Generator（不合格時） | 評価レポート |
| `docs/README.md` | Orchestrator | 全員 | feature 一覧 / 現行版リンク |

これらのパス規約はエージェント間の契約であり、変更してはならない。Sub-Agent は **必ず引数で受け取った feature ディレクトリ** に対して読み書きし、パスをハードコードしない。

### エージェントの起動方法

Orchestrator は feature ディレクトリのパスを必ずプロンプトに含めて起動する:

```
Agent(subagent_type="planner",   prompt="feature_dir=docs/features/001-explain-and-chat\n依頼概要: ...")
Agent(subagent_type="generator", prompt="feature_dir=docs/features/001-explain-and-chat\nsprint=1")
Agent(subagent_type="evaluator", prompt="feature_dir=docs/features/001-explain-and-chat\nsprint=1")
```

### 最終レビュー（Codex）

- Evaluator 合格後、Orchestrator が `codex exec --full-auto` を直接実行
- レビュー範囲はスプリントの全 `git diff`
- 指摘があれば Generator に差し戻し → Evaluator → Codex を再度回す
