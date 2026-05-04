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
