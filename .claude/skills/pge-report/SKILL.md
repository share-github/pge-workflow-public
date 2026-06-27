---
description: PGE 成果物（sprint.json の test_cases・feedback/final.json・<SUT root>/evidence/<test>/）から AC × Evidence の単一 HTML レポートを生成し、ブラウザでサムネ一覧＋クリック拡大表示で人間レビューしやすい形式に変換する。PGE flow から責務分離された手動実行ツール。
disable-model-invocation: true
argument-hint: "[--feedback <name>] [--output <path>] [--workspace <path>] [--attachments-root <SUT root>/evidence] (省略時は workspace=cwd, feedback=final, attachments-root=<workspace>/evidence, output=<attachments-root>/report.html)"
---

# PGE Evidence Report 生成スキル

PGE が出力した成果物（`plan/sprint.json` の test_cases・`plan/feedback/<name>.json`・`<SUT root>/evidence/<test>/`・Phase X3 + D-4 + Z11 以降）を **単一 HTML レポート** に変換するスキル。読み込み後にやることは 1 つだけ：`.claude/tools/pge-report.py` を実行してレポートを生成する。

D-4 規約: aggregator は MD を出さない (`plan/feedback/<name>.md` は存在しない)。本ツールは JSON 直読で narrative と bug を機械導出する。

## 想定ユーザー

- PGE 完了後（または途中のスプリント完了時）に成果物を人間レビューする者
- AC 一覧と evidence をセットで眺めたい者
- スクリーンショットをサムネ一覧＋ポップアップ拡大で確認したい者

## レポートの構成（出力 HTML 概観）

- ヘッダー: verdict バッジ / sprint / mode / risk_score / hard_rule_hit / evidence 件数 / 評価日時
- スコアバッジ: 5 基準 × スコア / 閾値
- バグサマリ: 全 bugs[] の折りたたみテーブル
- フィルター: カテゴリ（UI / API / CLI / DB / Batch）× ステータス（pass / minor / major / critical / fail）
- AC カード（per AC）:
  - AC ID / [カテゴリ] / ステータスバッジ / 検証手段
  - "When ... the ..." 受け入れ基準本文
  - Evaluator 観測 narrative
  - 関連バグ（あれば）
  - Evidence セクション:
    - 画像 (`.png` 等) → サムネ表示 / クリックで lightbox 拡大
    - テキスト (`.txt` / `.log` / `.diff` / `.dump` / `.md`) → カード表示 / 先頭 5 行プレビュー / クリックで modal 全文表示
    - JSON (`.json`) → カード表示 / pretty-print / クリックで modal 表示
    - その他 → ファイル名のみ表示 / 別タブで開くリンク

## 実行手順

1. **入力ファイルの存在確認** — `plan/sprint.json` (AC 一覧 = test_cases[]・Phase Z11+ 一次 source) / `plan/feedback/<feedback>.json` がワークスペースに揃っているか確認する (D-4: `.md` ファイルは不要・aggregator が生成しない)。`plan/sprint.json` が無い場合のみ `plan/spec.md` の AC 行を legacy fallback として読む。`<SUT root>/evidence/` の attachments は `feedback.json` の `ac_coverage[].attachments_dir` から SUT root 相対パスで参照される (Phase X3 規約)。揃っていなければユーザーに通知し中断（PGE が未完了の可能性）。
2. **スクリプト実行** — Bash で以下を実行 (SUT root が PGE workspace と異なる場合は `--attachments-root` 必須):
   ```bash
   python3 .claude/tools/pge-report.py [arguments]
   ```
3. **出力先の報告** — 生成された HTML のパス（既定: `<attachments-root>/report.html` = `<workspace>/evidence/report.html`）と AC 数 / evidence 件数 / bugs 件数をユーザーに報告する。
4. **閲覧方法の案内** — ユーザーが直接ファイル URL を開けない環境（VS Code Codespaces 等で `file://` ブロックされる場合）に備え、以下のいずれかを提示:
   - HTTP 経由閲覧: `python3 -m http.server ${REPORT_PORT:-8765} --directory <SUT root>`（root から相対パスで画像参照するため SUT root を root にする）→ `http://localhost:<REPORT_PORT>/evidence/report.html`
   - VS Code 等のローカル環境: `file://<SUT root>/evidence/report.html` を直接ブラウザで開く

## $ARGUMENTS の扱い

スキル引数は `.claude/tools/pge-report.py` の CLI オプションとしてそのまま透過する。

| 引数 | 既定値 | 説明 |
|------|--------|------|
| `--workspace <path>` | カレントディレクトリ | PGE ワークスペースルート（`plan/` の親） |
| `--plan-dir <path>` | `<workspace>/plan` | sprint.json / feedback/ の親ディレクトリ |
| `--attachments-root <path>` | `<workspace>/evidence` | attachments_dir のルート = SUT root の `evidence/` (Phase X3 規約)。SUT root が PGE workspace と異なる場合は明示指定必須。レポート HTML の既定出力先もここ |
| `--feedback <name>` | `final` | `<name>.json` と `<name>.md` を読む（`final` / `sprint-1` 等） |
| `--output <path>` | `<attachments-root>/report.html` | 生成 HTML の保存先 |

呼び出し例:

```bash
# 既定（PGE 完了後の final レポート）
python3 .claude/tools/pge-report.py

# 中間スプリント向け
python3 .claude/tools/pge-report.py --feedback sprint-2

# 別ロケーション
python3 .claude/tools/pge-report.py --output build/report.html
```

## 責務境界（PGE flow との分離）

- **本スキルは PGE flow の一部ではない** — `/pge-planning` + `/pge-sprint-cycle` の Step 1〜8 には含まれず、PGE 完了後の人間レビューを補助するための独立ツール
- **PGE 成果物の書き込み権限を持たない** — `plan/`・`<SUT root>/evidence/<test>/` を**読むだけ** (Phase X3)、書くのは `<output>` の HTML のみ
- **再生成は冪等** — 既存 HTML を上書きする。PGE 成果物に影響を与えない
- **依存ゼロ** — Python 3 標準ライブラリのみ。pip install 不要。embed されたインライン CSS / JS で完結（外部ネットワーク・CDN にも非依存）

## エラーハンドリング

スクリプトが exit code != 0 で終了した場合、stderr に出る理由を確認し、以下を試す:

| stderr メッセージ | 想定原因 | 対処 |
|---|---|---|
| `missing input: ...plan/feedback/<name>.json` | Evaluator final 未実行 or 別の feedback name | `--feedback sprint-N` を試すか PGE を進める |
| `AC source なし: ...sprint.json も ...spec.md も存在しない` | planning 未実行 or workspace パスが違う | `--workspace` を見直す、または planning を完了させてから再実行 |
| `no ACs parsed from sprint.json#test_cases` | sprint.json の `test_cases[]` が空 | planning (`/pge-planning`) の test_cases author を確認 |

## halt 条件

以下の場合は halt して人間判断を仰ぐ（成果物を勝手に作らない）:

- 必須入力ファイルが揃っていない（PGE が未完了の可能性 → PGE を先に完了させるか）
- `--output` の親ディレクトリが書き込み不可
- sprint.json の `test_cases[]` 形式が不明（Planner 出力フォーマットの変更 → `.claude/references/pge-spec-schema.md` の sprint.json section を見直すか）

halt 時はユーザーに状況を報告し、本スキルを中断する。レポートが壊れたまま生成されることを避ける。
