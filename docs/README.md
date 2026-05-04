# docs

依頼（feature）単位でディレクトリを切り、仕様書・スプリント成果物をまとめる。

## 採番ルール

- ディレクトリ名: `{NNN}-{kebab-case-slug}`（例: `001-explain-and-chat`）
- `NNN` は 3 桁ゼロ埋めの連番
- スラッグは英語の短い識別子

## ディレクトリ内のファイル

| ファイル | 生成者 |
|----------|--------|
| `spec.md` | Planner |
| `sprint-{N}-self-review.md` | Generator |
| `sprint-{N}-evaluation.md` | Evaluator |

## features 一覧

| ID | ディレクトリ | 概要 | ステータス |
|----|--------------|------|-----------|
| 001 | [001-explain-and-chat](features/001-explain-and-chat/) | 任意 Web ページの DOM を読み、英文 Explain と Chat を提供する Chrome 拡張の初期実装 | 完了（Sprint 1-3 / Codex 全 NO ISSUES） |
| 002 | [002-output-language-and-robust-extract](features/002-output-language-and-robust-extract/) | 出力言語切替（English/Japanese）と DOM 抽出堅牢化（main/article 優先・Shadow DOM・短文警告） | 完了（Sprint 4-5 / Codex 全 NO ISSUES） |
| 003 | [003-selection-with-context](features/003-selection-with-context/) | Selection Explain にページ本文を文脈として併送、選択モード時の警告抑止 | 完了（Sprint 6 / Codex NO ISSUES） |
| 004 | [004-merge-explain-into-chat](features/004-merge-explain-into-chat/) | Explain タブを撤廃し Chat に統合。クイックアクション 6 個（youtube-ai-extension 風） | 完了（Sprint 7 / Codex NO ISSUES） |
| 005 | [005-floating-explain-button](features/005-floating-explain-button/) | ページ上のフローティング Explain ボタン（Shadow DOM）と Chat バブル Markdown レンダリング | 完了（Sprint 8-9 / Codex NO ISSUES） |
