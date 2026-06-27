#!/usr/bin/env python3
"""PGE Evidence Report Generator (Phase X3 + D-4 規約対応).

Reads PGE artifacts and generates a single-file HTML report with
AC-by-AC view, evidence thumbnails, and click-to-zoom lightbox.

Inputs:
  - plan/sprint.json                               (AC 一覧 = test_cases[]・Phase Z11+ 一次 source)
  - plan/spec.md                                   (sprint.json 不在時の legacy fallback)
  - plan/feedback/<name>.json                      (verdict / scores / ac_coverage / findings・
                                                    D-4: narrative と bugs は findings[] から機械導出)
  - <attachments_dir> per ac_coverage[] entry      (= <SUT root>/evidence/<test>/ 配下の attachments・
                                                    Phase X3 で evidence/ パス統一・SUT root 相対)

Output:
  - <output> (default: <attachments_root>/report.html)

D-4 規約: aggregator が MD を生成しなくなったため、本ツールは JSON 直読のみ。
旧 plan/feedback/<name>.md は読まない (生成されない)。

Phase X3 規約: 旧 test-results/ パスは evidence/ に統合。--attachments-root の default は
<workspace>/evidence/ になったが、SUT root が PGE workspace root と異なる場合は明示指定が必要
(例: --attachments-root /workspace/sample-java-app/evidence)。

Usage:
  python3 .claude/tools/pge-report.py
  python3 .claude/tools/pge-report.py --feedback sprint-1
  python3 .claude/tools/pge-report.py --workspace /path/to/repo
  python3 .claude/tools/pge-report.py --attachments-root /path/to/sut/evidence
  python3 .claude/tools/pge-report.py --output /tmp/report.html
"""

import argparse
import json
import os
import re
import sys
from html import escape
from pathlib import Path

IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"}
TEXT_EXTS = {".txt", ".log", ".diff", ".dump", ".md"}
JSON_EXTS = {".json"}

# Test runner が生成する runner-internal noise file (= 人間レビューでは価値ゼロ).
# 内容が aggregator verdict と redundant な status summary のみで、
# 真の test artifact (screenshot / curl dump / log) は denylist に入れない。
# 現在 Playwright の `--output` 配下に生成される `.last-run.json`
# (`{"status":"passed","failedTests":[]}` のみ) のみが該当。
# 将来 trace.zip / videos 等を denylist 対象に追加するときは、
# F-bash-script の `.log` / `.dump` を誤排除しないよう拡張子ではなく
# 完全 file 名 + parent dir 形状で判定すること。
EVIDENCE_DENYLIST = {".last-run.json"}

MAX_TEXT_INLINE_BYTES = 32 * 1024  # 32 KB cap for modal full text
PREVIEW_LINES = 5


def human_size(n: int) -> str:
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024 or unit == "GB":
            return f"{n:.1f} {unit}" if unit != "B" else f"{n} {unit}"
        n /= 1024
    return f"{n} GB"


def parse_spec_acs(spec_text: str):
    """Return list of {ac_id, category, when_text} from spec.md."""
    pattern = re.compile(
        r"^- (AC-\d+)\s*\[([^\]]+)\]:\s*(.+?)$",
        re.MULTILINE,
    )
    acs = []
    for m in pattern.finditer(spec_text):
        acs.append(
            {
                "ac_id": m.group(1),
                "category": m.group(2).strip(),
                "when_text": m.group(3).strip(),
            }
        )
    # Sort by AC number
    acs.sort(key=lambda x: int(x["ac_id"].split("-")[1]))
    return acs


def _ac_sort_key(ac_id: str) -> int:
    """AC-N の N を返す (非数値は 0)。"""
    parts = ac_id.split("-")
    return int(parts[1]) if len(parts) > 1 and parts[1].isdigit() else 0


def load_acs_from_sprint(sprint_json: dict):
    """Return list of {ac_id, category, when_text} from sprint.json#test_cases (Phase Z11+).

    spec.md の AC 行 parse を置き換える。Z11.1 以降 spec.md は thin pointer のため
    AC 一覧は機械可読な sprint.json#test_cases[] を一次 source にする。
      - ac_id      = test_cases[].id (AC-N)
      - category   = 親 requirement_id (test_cases を requirement 単位で filter/トレース)
      - when_text  = test_cases[].label + trigger(method path) で human-readable 説明
    domain.json は不要 (test_case が trigger を内包するため自己完結)。
    """
    acs = []
    for tc in sprint_json.get("test_cases", []) or []:
        ac_id = tc.get("id")
        if not ac_id:
            continue
        label = (tc.get("label") or "").strip()
        trig = tc.get("trigger") or {}
        method = (trig.get("method") or "").strip()
        path = (trig.get("path") or "").strip()
        trig_str = " ".join(p for p in (method, path) if p)
        when_text = f"{label}（{trig_str}）" if trig_str else label
        acs.append(
            {
                "ac_id": ac_id,
                "category": tc.get("requirement_id") or "?",
                "when_text": when_text,
            }
        )
    acs.sort(key=lambda x: _ac_sort_key(x["ac_id"]))
    return acs


def derive_narratives_from_json(feedback_json: dict) -> dict:
    """Return dict ac_id -> narrative string derived mechanically from JSON.

    D-4 規約: aggregator が MD を出さなくなったため、structured fields から
    機械的に narrative を組み立てる。
    """
    narratives = {}
    findings = feedback_json.get("findings", []) or []
    findings_by_ac = {}
    for f in findings:
        ac = f.get("ac_id")
        if ac:
            findings_by_ac.setdefault(ac, []).append(f)

    coverage = feedback_json.get("evidence", {}).get("ac_coverage", []) or []
    seen_acs = set()
    for entry in coverage:
        ac_id = entry.get("ac_id")
        if not ac_id or ac_id in seen_acs:
            continue
        seen_acs.add(ac_id)
        method = entry.get("verification_method", "")
        ac_findings = findings_by_ac.get(ac_id, [])
        parts = []
        if ac_findings:
            severities = sorted({(f.get("severity") or "").lower() for f in ac_findings})
            parts.append(f"findings: {', '.join(severities)} ({len(ac_findings)} 件)")
        else:
            parts.append("findings: なし")
        if method:
            parts.append(f"verification: {method}")
        narratives[ac_id] = " / ".join(parts)
    return narratives


def derive_bugs_from_findings(feedback_json: dict) -> list:
    """Return list of {id, severity, summary, repro} derived from findings[].

    D-4 規約: 旧 ## バグ一覧 table の代わりに findings[] (severity を持つもの) から
    機械抽出する。fix_target=review-only は除外 (cross-cutting で bug ではない)。
    """
    bugs = []
    findings = feedback_json.get("findings", []) or []
    for i, f in enumerate(findings, start=1):
        if f.get("fix_target") == "review-only":
            continue
        severity = (f.get("severity") or "").strip()
        summary = (f.get("summary") or "").strip()
        if not summary:
            continue
        ac_id = f.get("ac_id") or ""
        repro_parts = []
        if ac_id:
            repro_parts.append(ac_id)
        suggested = f.get("suggested_fix")
        if isinstance(suggested, dict):
            desc = suggested.get("description")
            if desc:
                repro_parts.append(desc)
        elif isinstance(suggested, str):
            repro_parts.append(suggested)
        bugs.append(
            {
                "id": str(f.get("id") or i),
                "severity": severity or "minor",
                "summary": summary,
                "repro": " / ".join(repro_parts) if repro_parts else "(詳細は findings JSON 参照)",
            }
        )
    return bugs


_STEP_PATTERN = re.compile(r"^(\d+)_(.+?)\.(png|jpg|jpeg|gif|webp|svg)$", re.IGNORECASE)
_TC_SCENARIO_PATTERN = re.compile(r"TC-AC-\d+-S(\d+)", re.IGNORECASE)


def extract_step_and_label(filename: str):
    """Extract step number and label from screenshot filename like '001_form-loaded.png'."""
    m = _STEP_PATTERN.match(filename)
    if not m:
        return None, None
    try:
        step = int(m.group(1))
    except ValueError:
        return None, None
    return step, m.group(2)


def extract_scenario_tag(subdir_name: str):
    """Extract scenario tag like 'S1' / 'S2' from a Playwright test-results subdir name.

    Playwright creates subdirs like:
      sprint-1-AC-1-TC-AC-1-S2-…-chromium
    Returns 'S2' for that. Returns None if the subdir does not match the TC-AC-K-Sn pattern
    (= the caller will fall back to using the subdir name itself as the prefix).
    """
    m = _TC_SCENARIO_PATTERN.search(subdir_name)
    if not m:
        return None
    return f"S{m.group(1)}"


def collect_evidence(ac_dir: Path, html_dir: Path, ac_operations=None):
    """Return list of evidence items for one AC. Paths are relative to html_dir.

    If ac_operations is provided (list of {step, locator, action, expected, value}),
    screenshot filenames matching '<step>_<label>.<ext>' get the corresponding operation
    attached as item['operation'].
    """
    if not ac_dir.exists():
        return []
    ops_by_step = {}
    if ac_operations:
        for op in ac_operations:
            step = op.get("step")
            if isinstance(step, int):
                ops_by_step[step] = op
    # Recursive walk: Playwright が test-results/<scenario>/<step>_<label>.png のように
    # 1 階層ネストするため、iterdir() ではなく rglob('*') を使う。subdir 名 (e.g.
    # 'sprint-1-AC-1-TC-AC-1-S2-...') から 'S2' を抽出して item['scenario'] と表示用
    # filename prefix に乗せ、UI 側で TC ごとに識別可能にする。top-level の file
    # (subdir == .) は scenario prefix なしで従来通り表示する。
    # DENYLIST: 人間が見ても価値がない runner-internal noise file を除外する。
    # aggregator verdict と redundant な status summary のみが対象 (バグ root cause
    # 解析に必要な実 artifact は denylist に入れない・将来必要なら logic を上書き)。
    files = sorted(
        (f for f in ac_dir.rglob("*")
         if f.is_file() and f.name not in EVIDENCE_DENYLIST),
        key=lambda f: (str(f.relative_to(ac_dir).parent), f.name),
    )
    items = []
    for f in files:
        ext = f.suffix.lower()
        rel_path = os.path.relpath(f, html_dir)
        # subdir = '.' for top-level, else the first-level subdir name
        try:
            rel_to_ac = f.relative_to(ac_dir)
        except ValueError:
            rel_to_ac = Path(f.name)
        parts = rel_to_ac.parts
        scenario_tag = None
        display_filename = f.name
        if len(parts) > 1:
            subdir_name = parts[0]
            scenario_tag = extract_scenario_tag(subdir_name) or subdir_name
            display_filename = f"{scenario_tag}/{f.name}"
        item = {
            "rel_path": rel_path.replace(os.sep, "/"),
            "filename": display_filename,
            "size": f.stat().st_size,
            "size_h": human_size(f.stat().st_size),
            "ext": ext,
        }
        if scenario_tag is not None:
            item["scenario"] = scenario_tag
        if ext in IMAGE_EXTS:
            item["kind"] = "image"
            step, label = extract_step_and_label(f.name)
            if step is not None:
                item["step"] = step
                item["label"] = label
                if step in ops_by_step:
                    item["operation"] = ops_by_step[step]
        elif ext in JSON_EXTS:
            content = f.read_text(encoding="utf-8", errors="replace")
            try:
                content = json.dumps(json.loads(content), indent=2, ensure_ascii=False)
            except json.JSONDecodeError:
                pass
            truncated = len(content) > MAX_TEXT_INLINE_BYTES
            if truncated:
                content = content[:MAX_TEXT_INLINE_BYTES] + "\n\n... (truncated)"
            lines = content.splitlines()
            item["kind"] = "json"
            item["content"] = content
            item["line_count"] = len(lines)
            item["preview"] = "\n".join(lines[:PREVIEW_LINES])
            item["truncated"] = truncated
        elif ext in TEXT_EXTS or ext == "":
            content = f.read_text(encoding="utf-8", errors="replace")
            truncated = len(content) > MAX_TEXT_INLINE_BYTES
            if truncated:
                content = content[:MAX_TEXT_INLINE_BYTES] + "\n\n... (truncated)"
            lines = content.splitlines()
            item["kind"] = "text"
            item["content"] = content
            item["line_count"] = len(lines)
            item["preview"] = "\n".join(lines[:PREVIEW_LINES])
            item["truncated"] = truncated
        else:
            item["kind"] = "other"
        items.append(item)
    return items


def derive_ac_status(ac_id: str, per_ac_verdicts: dict, ac_bugs: dict):
    """Determine per-AC display status. Returns ('pass'|'minor'|'major'|'critical'|'fail'|'unknown', label).

    per_ac_verdicts は plan/feedback/sprint-N/AC-K.json の verdict フィールド (per-AC Evaluator が
    AC 単位で出した判定) を辞書化したもの。全体 final.json の verdict (= aggregate verdict) を
    そのまま各 AC に適用すると 1 件 fail で全 AC が fail 表示になるため、per-AC verdict を優先する。

    - findings (bugs) が当該 AC に紐づく場合: 最大 severity を採用 (実害ベース)
    - findings なし & per_ac_verdicts[ac_id] == "pass" → PASS
    - findings なし & per_ac_verdicts[ac_id] == "fail" → FAIL
    - per_ac_verdicts に AC が無い (per-AC JSON 欠落) → unknown
    """
    bugs_here = ac_bugs.get(ac_id, [])
    if bugs_here:
        # Use most severe
        order = {"critical": 4, "major": 3, "minor": 2}
        worst = max(bugs_here, key=lambda b: order.get(b["severity"].lower(), 1))
        return worst["severity"].lower(), worst["severity"]
    per_ac_verdict = per_ac_verdicts.get(ac_id)
    if per_ac_verdict == "pass":
        return "pass", "PASS"
    if per_ac_verdict == "fail":
        return "fail", "FAIL"
    return "unknown", per_ac_verdict or "unknown"


def render_html(meta, acs, narratives, bugs, evidence_by_ac, scores, ac_method, ac_bugs, per_ac_verdicts):
    """Build the final HTML string.

    per_ac_verdicts: dict[ac_id, "pass"|"fail"|...] — plan/feedback/sprint-N/AC-K.json から取得した
    per-AC Evaluator の verdict 値。derive_ac_status に渡し、全体 verdict (aggregate) と
    per-AC 単位の表示を分離する。
    """
    categories = sorted({c for ac in acs for c in [ac["category"]]})

    sprint_label = escape(str(meta.get("sprint", "")))
    verdict = meta.get("verdict", "unknown")
    verdict_class = f"verdict-{escape(verdict)}"
    risk = escape(str(meta.get("risk_score", "?")))
    hard_rules = meta.get("hard_rule_hit") or []
    hard_rules_text = (
        f"[{', '.join(escape(h) for h in hard_rules)}]" if hard_rules else "なし"
    )
    evaluated_at = escape(str(meta.get("evaluated_at", "")))
    mode = escape(str(meta.get("mode", "")))
    ev_count = meta.get("evidence_count", 0)

    # Scores
    score_keys = [
        ("feature_completeness", "機能完全性", 4),
        ("operational_stability", "動作安定性", 4),
        ("ui_ux", "UI/UX 品質", 3),
        ("error_handling", "エラーハンドリング", 3),
        ("no_regression", "回帰なし", 5),
    ]
    score_html = []
    for key, label, threshold in score_keys:
        val = scores.get(key, "?")
        ok = isinstance(val, int) and val >= threshold
        score_html.append(
            f'<div class="score {"ok" if ok else "ng"}">'
            f'<div class="score-label">{escape(label)}</div>'
            f'<div class="score-value">{escape(str(val))} <span class="threshold">/ {threshold}+</span></div>'
            f"</div>"
        )

    # Category filter chips
    cat_chips = "".join(
        f'<label class="chip"><input type="checkbox" checked data-filter="category" value="{escape(c)}"> {escape(c)}</label>'
        for c in categories
    )

    # Status filter chips
    all_statuses = sorted({derive_ac_status(ac["ac_id"], per_ac_verdicts, ac_bugs)[0] for ac in acs})
    status_chips = "".join(
        f'<label class="chip"><input type="checkbox" checked data-filter="status" value="{escape(s)}"> {escape(s)}</label>'
        for s in all_statuses
    )

    # AC cards
    ac_cards = []
    for ac in acs:
        ac_id = ac["ac_id"]
        status, status_label = derive_ac_status(ac_id, per_ac_verdicts, ac_bugs)
        category = ac["category"]
        narrative = narratives.get(ac_id, "")
        method = ac_method.get(ac_id, "")
        items = evidence_by_ac.get(ac_id, [])
        bugs_here = ac_bugs.get(ac_id, [])

        ev_html = []
        for i, ev in enumerate(items):
            uid = f"{ac_id}-{i}"
            if ev["kind"] == "image":
                op = ev.get("operation") or {}
                op_step = ev.get("step", "")
                op_summary = op.get("summary", "")
                op_action = op.get("action", "")
                op_locator = op.get("locator", "")
                op_value = op.get("value", "")
                op_expected = op.get("expected", "")
                ev_html.append(
                    f'<div class="ev-item ev-image" data-img="{escape(ev["rel_path"])}" '
                    f'data-name="{escape(ev["filename"])}" '
                    f'data-step="{escape(str(op_step))}" '
                    f'data-summary="{escape(str(op_summary))}" '
                    f'data-action="{escape(str(op_action))}" '
                    f'data-locator="{escape(str(op_locator))}" '
                    f'data-value="{escape(str(op_value))}" '
                    f'data-expected="{escape(str(op_expected))}" '
                    f'tabindex="0" role="button">'
                    f'<img src="{escape(ev["rel_path"])}" loading="lazy" alt="{escape(ev["filename"])}">'
                    f'<div class="ev-name">{escape(ev["filename"])}</div>'
                    + (
                        f'<div class="ev-op-summary">'
                        f'<span class="ev-op-step">step {op_step}</span>'
                        + (f' <span class="ev-op-label">{escape(str(op_summary))}</span>' if op_summary else f' <span class="ev-op-action">{escape(str(op_action))}</span>')
                        + "</div>"
                        if op else ""
                    )
                    + "</div>"
                )
            elif ev["kind"] in ("text", "json"):
                icon = "📄" if ev["kind"] == "text" else "🔧"
                lang_class = "lang-json" if ev["kind"] == "json" else "lang-text"
                # Hidden content stored in a <template> sibling
                ev_html.append(
                    f'<div class="ev-item ev-text" data-uid="{uid}" '
                    f'data-name="{escape(ev["filename"])}" tabindex="0" role="button">'
                    f'<div class="ev-text-head"><span class="ev-icon">{icon}</span>'
                    f'<span class="ev-name">{escape(ev["filename"])}</span></div>'
                    f'<div class="ev-meta">{ev["line_count"]} 行 / {escape(ev["size_h"])}'
                    f'{" (truncated)" if ev["truncated"] else ""}</div>'
                    f'<pre class="ev-preview">{escape(ev["preview"])}</pre>'
                    f'<template id="ev-{uid}">'
                    f'<pre class="ev-full {lang_class}">{escape(ev["content"])}</pre>'
                    f'</template>'
                    f"</div>"
                )
            else:
                ev_html.append(
                    f'<div class="ev-item ev-other">'
                    f'<div class="ev-text-head"><span class="ev-icon">📎</span>'
                    f'<span class="ev-name">{escape(ev["filename"])}</span></div>'
                    f'<div class="ev-meta">{escape(ev["size_h"])}</div>'
                    f'<a class="ev-link" href="{escape(ev["rel_path"])}" target="_blank" rel="noopener">別タブで開く</a>'
                    f"</div>"
                )

        bug_html = ""
        if bugs_here:
            rows = "".join(
                f'<tr><td class="b-sev sev-{escape(b["severity"].lower())}">{escape(b["severity"])}</td>'
                f'<td>{escape(b["summary"])}</td>'
                f'<td class="b-repro">{escape(b["repro"])}</td></tr>'
                for b in bugs_here
            )
            bug_html = (
                f'<div class="ac-bugs">'
                f"<h4>関連バグ ({len(bugs_here)})</h4>"
                f'<table class="bugs-table"><thead><tr>'
                f"<th>重要度</th><th>内容</th><th>再現手順</th></tr></thead>"
                f"<tbody>{rows}</tbody></table>"
                f"</div>"
            )

        narrative_html = (
            f'<div class="ac-narrative"><h4>Evaluator 観測</h4>'
            f'<div class="ac-narrative-body">{escape(narrative)}</div></div>'
            if narrative
            else '<div class="ac-narrative empty">（Evaluator narrative なし）</div>'
        )

        ev_section = (
            f'<div class="ac-evidence"><h4>Evidence ({len(items)})</h4>'
            f'<div class="ev-grid">{"".join(ev_html)}</div></div>'
            if items
            else '<div class="ac-evidence empty"><h4>Evidence (0)</h4><p>該当ファイルなし</p></div>'
        )

        ac_cards.append(
            f'<article class="ac-card" data-ac-id="{escape(ac_id)}" '
            f'data-category="{escape(category)}" data-status="{escape(status)}">'
            f'<header class="ac-head">'
            f'<span class="ac-id">{escape(ac_id)}</span>'
            f'<span class="ac-cat">[{escape(category)}]</span>'
            f'<span class="ac-status status-{escape(status)}">{escape(status_label)}</span>'
            f'<span class="ac-method">{escape(method)}</span>'
            f"</header>"
            f'<p class="ac-when">{escape(ac["when_text"])}</p>'
            f"{narrative_html}"
            f"{bug_html}"
            f"{ev_section}"
            f"</article>"
        )

    css = r"""
:root {
  --bg: #f7f8fa;
  --bg-card: #ffffff;
  --bg-pre: #f3f4f7;
  --fg: #1a1a1a;
  --fg-muted: #6b7280;
  --border: #e5e7eb;
  --accent: #4f46e5;
  --pass: #16a34a;
  --minor: #d97706;
  --major: #ea580c;
  --critical: #dc2626;
  --fail: #dc2626;
  --shadow: 0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04);
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0f1115;
    --bg-card: #161922;
    --bg-pre: #1f2330;
    --fg: #e5e7eb;
    --fg-muted: #9ca3af;
    --border: #2a2f3a;
  }
}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  font-family: "Noto Sans JP", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  background: var(--bg);
  color: var(--fg);
  line-height: 1.6;
  font-size: 14px;
}
header.top {
  background: var(--bg-card);
  border-bottom: 1px solid var(--border);
  padding: 16px 24px;
  box-shadow: var(--shadow);
}
.title-row { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; }
.title-row h1 { margin: 0; font-size: 18px; }
.title-row .meta-item { color: var(--fg-muted); font-size: 13px; }
.verdict-badge { display: inline-block; padding: 2px 10px; border-radius: 12px; font-weight: 700; font-size: 12px; text-transform: uppercase; }
.verdict-pass { background: var(--pass); color: white; }
.verdict-fail { background: var(--fail); color: white; }
.verdict-blocked { background: var(--critical); color: white; }
.scores { display: flex; gap: 8px; margin-top: 12px; flex-wrap: wrap; }
.score {
  padding: 6px 10px; border-radius: 6px; border: 1px solid var(--border);
  background: var(--bg-pre); min-width: 120px;
}
.score-label { font-size: 11px; color: var(--fg-muted); }
.score-value { font-size: 16px; font-weight: 700; margin-top: 2px; }
.score-value .threshold { font-size: 11px; color: var(--fg-muted); font-weight: 400; }
.score.ok .score-value { color: var(--pass); }
.score.ng .score-value { color: var(--fail); }
.filters { margin-top: 12px; display: flex; gap: 16px; flex-wrap: wrap; align-items: center; }
.filter-group { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
.filter-group .label { font-size: 12px; color: var(--fg-muted); margin-right: 4px; }
.chip {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 3px 10px; border-radius: 12px;
  background: var(--bg-pre); border: 1px solid var(--border);
  cursor: pointer; font-size: 12px; user-select: none;
}
.chip input { margin: 0; cursor: pointer; }
main { padding: 16px 24px; max-width: 1200px; margin: 0 auto; }
.ac-card {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-left: 4px solid var(--border);
  border-radius: 6px;
  margin-bottom: 16px;
  padding: 14px 16px;
  box-shadow: var(--shadow);
}
.ac-card[data-status="pass"]     { border-left-color: var(--pass); }
.ac-card[data-status="minor"]    { border-left-color: var(--minor); }
.ac-card[data-status="major"]    { border-left-color: var(--major); }
.ac-card[data-status="critical"] { border-left-color: var(--critical); }
.ac-card[data-status="fail"]     { border-left-color: var(--fail); }
.ac-card.hidden { display: none; }
.ac-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.ac-id { font-weight: 700; font-size: 15px; }
.ac-cat { color: var(--fg-muted); font-size: 12px; }
.ac-status {
  font-size: 11px; padding: 2px 8px; border-radius: 10px;
  color: white; font-weight: 700; text-transform: uppercase;
}
.status-pass     { background: var(--pass); }
.status-minor    { background: var(--minor); }
.status-major    { background: var(--major); }
.status-critical { background: var(--critical); }
.status-fail     { background: var(--fail); }
.ac-method { color: var(--fg-muted); font-size: 12px; margin-left: auto; }
.ac-when { margin: 6px 0 10px; color: var(--fg); }
.ac-narrative, .ac-evidence, .ac-bugs { margin-top: 12px; }
.ac-narrative h4, .ac-evidence h4, .ac-bugs h4 { margin: 0 0 6px; font-size: 13px; color: var(--fg-muted); font-weight: 600; }
.ac-narrative-body { background: var(--bg-pre); padding: 8px 12px; border-radius: 4px; font-size: 13px; }
.ac-narrative.empty, .ac-evidence.empty { color: var(--fg-muted); font-style: italic; }
.bugs-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.bugs-table th, .bugs-table td { border: 1px solid var(--border); padding: 4px 8px; text-align: left; vertical-align: top; }
.bugs-table th { background: var(--bg-pre); }
.b-sev { font-weight: 700; }
.sev-critical { color: var(--critical); }
.sev-major    { color: var(--major); }
.sev-minor    { color: var(--minor); }
.b-repro { font-family: monospace; font-size: 11px; color: var(--fg-muted); }

.ev-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 10px; }
.ev-item {
  background: var(--bg-pre);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 8px;
  cursor: pointer;
  transition: transform 0.1s, box-shadow 0.1s;
}
.ev-item:hover, .ev-item:focus { transform: translateY(-1px); box-shadow: var(--shadow); outline: none; border-color: var(--accent); }
.ev-image img {
  width: 100%; height: 140px; object-fit: contain;
  background: white; border-radius: 3px; display: block;
}
.ev-name { font-size: 11px; color: var(--fg-muted); margin-top: 6px; word-break: break-all; }
.ev-text { display: flex; flex-direction: column; }
.ev-text-head { display: flex; align-items: center; gap: 6px; }
.ev-icon { font-size: 16px; }
.ev-meta { font-size: 11px; color: var(--fg-muted); margin-top: 2px; }
.ev-preview {
  margin: 6px 0 0; padding: 6px; background: var(--bg-card);
  border-radius: 3px; font-size: 11px; max-height: 80px; overflow: hidden;
  white-space: pre-wrap; word-break: break-all;
}
.ev-other .ev-link { font-size: 12px; color: var(--accent); display: inline-block; margin-top: 6px; }

/* Modal */
.modal-bg {
  position: fixed; inset: 0; background: rgba(0,0,0,0.85);
  display: none; align-items: center; justify-content: center;
  z-index: 100; padding: 24px;
}
.modal-bg.visible { display: flex; }
.modal-content {
  position: relative; max-width: 95vw; max-height: 95vh;
  background: var(--bg-card); border-radius: 6px;
  display: flex; flex-direction: column;
}
.modal-content img { max-width: 95vw; max-height: 90vh; object-fit: contain; display: block; }
.modal-content .modal-text {
  padding: 16px; overflow: auto; max-width: 95vw; max-height: 90vh;
}
.modal-content .modal-text pre {
  margin: 0; font-family: "JetBrains Mono", "Menlo", monospace; font-size: 12px;
  white-space: pre-wrap; word-break: break-all;
}
.ev-op-summary {
  margin-top: 4px;
  font-size: 11px;
  color: var(--fg-muted);
  display: flex; gap: 6px; align-items: center;
}
.ev-op-step {
  background: rgba(88,166,255,0.18); color: #58a6ff;
  padding: 1px 6px; border-radius: 8px; font-weight: 600;
}
.ev-op-action {
  background: rgba(255,255,255,0.06); color: var(--fg);
  padding: 1px 6px; border-radius: 8px; font-family: monospace;
}
.modal-head-text { display: flex; flex-direction: column; gap: 4px; flex: 1; min-width: 0; }
.modal-op {
  display: flex; flex-wrap: wrap; gap: 6px 10px; align-items: center;
  font-size: 12px; color: #d0d7de;
  background: rgba(255,255,255,0.05);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 6px;
  padding: 6px 10px;
  margin-top: 4px;
}
.modal-op[hidden] { display: none; }
.modal-op .op-badge {
  font-family: monospace; font-size: 11px;
  padding: 2px 8px; border-radius: 10px;
}
.modal-op .op-step {
  background: rgba(88,166,255,0.25); color: #58a6ff; font-weight: 700;
}
.modal-op .op-action {
  background: rgba(86,211,100,0.18); color: #56d364;
}
.modal-op .op-locator {
  font-family: monospace; font-size: 11.5px;
  color: #ff7eb6;
  background: rgba(255,126,182,0.08);
  padding: 2px 6px; border-radius: 4px;
  overflow: hidden; text-overflow: ellipsis;
  max-width: 50vw; white-space: nowrap;
}
.modal-op .op-value {
  font-family: monospace; font-size: 11.5px;
  color: #f0883e;
  background: rgba(240,136,62,0.08);
  padding: 2px 6px; border-radius: 4px;
}
.modal-op .op-value::before { content: "value: "; opacity: 0.6; }
.modal-op .op-expected {
  flex-basis: 100%;
  color: #e3b341;
  font-size: 12px;
  border-top: 1px dashed rgba(255,255,255,0.1);
  padding-top: 4px;
  margin-top: 2px;
}
.modal-op .op-expected:not(:empty)::before { content: "期待: "; color: #8b949e; }
.modal-head {
  position: fixed; top: 16px; right: 16px; left: 16px;
  display: flex; align-items: center; gap: 12px; justify-content: space-between;
  color: white; pointer-events: none;
  z-index: 101;
}
.modal-head .name {
  font-size: 13px;
  background: rgba(0,0,0,0.6); padding: 6px 12px; border-radius: 4px;
  pointer-events: auto;
  max-width: 50vw; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.modal-head .counter {
  font-size: 12px;
  background: rgba(0,0,0,0.6); padding: 6px 12px; border-radius: 4px;
  pointer-events: auto;
  font-variant-numeric: tabular-nums;
}
.modal-close {
  background: rgba(0,0,0,0.6); border: 1px solid rgba(255,255,255,0.5); color: white;
  width: 36px; height: 36px; border-radius: 18px; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  font-size: 20px; line-height: 1;
  pointer-events: auto;
  flex-shrink: 0;
}
.modal-close:hover { background: white; color: black; }
.modal-nav {
  position: fixed; top: 50%; transform: translateY(-50%);
  width: 48px; height: 64px; border-radius: 6px;
  background: rgba(0,0,0,0.6); border: 1px solid rgba(255,255,255,0.4); color: white;
  font-size: 24px; line-height: 1; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  z-index: 101; padding: 0;
}
.modal-nav:hover:not(:disabled) { background: white; color: black; }
.modal-nav:disabled { opacity: 0.25; cursor: not-allowed; }
.modal-nav.prev { left: 16px; }
.modal-nav.next { right: 16px; }
.empty-message { color: var(--fg-muted); text-align: center; padding: 24px; }
"""

    js = r"""
(function() {
  const modal = document.getElementById('modal');
  const modalContent = modal.querySelector('.modal-content');
  const modalName = modal.querySelector('.name');
  const modalCounter = modal.querySelector('.counter');
  const modalClose = modal.querySelector('.modal-close');
  const modalPrev = modal.querySelector('.modal-nav.prev');
  const modalNext = modal.querySelector('.modal-nav.next');

  let currentItems = [];
  let currentIndex = -1;

  function renderImage(src, name) {
    modalContent.innerHTML = '<img alt="" />';
    modalContent.querySelector('img').src = src;
    modalName.textContent = name;
  }
  function renderText(uid, name) {
    const tpl = document.getElementById('ev-' + uid);
    const wrap = document.createElement('div');
    wrap.className = 'modal-text';
    wrap.appendChild(tpl.content.cloneNode(true));
    modalContent.innerHTML = '';
    modalContent.appendChild(wrap);
    modalName.textContent = name;
  }
  const modalOp = modal.querySelector('.modal-op');
  const modalOpStep = modal.querySelector('.modal-op .op-step');
  const modalOpAction = modal.querySelector('.modal-op .op-action');
  const modalOpLocator = modal.querySelector('.modal-op .op-locator');
  const modalOpValue = modal.querySelector('.modal-op .op-value');
  const modalOpExpected = modal.querySelector('.modal-op .op-expected');

  function renderOperation(el) {
    if (!el || !el.classList.contains('ev-image')) {
      modalOp.hidden = true;
      return;
    }
    const step = el.dataset.step || '';
    const action = el.dataset.action || '';
    const locator = el.dataset.locator || '';
    const value = el.dataset.value || '';
    const expected = el.dataset.expected || '';
    if (!step && !action && !locator && !expected) {
      modalOp.hidden = true;
      return;
    }
    modalOpStep.textContent = step ? ('step ' + step) : '';
    modalOpStep.hidden = !step;
    modalOpAction.textContent = action;
    modalOpAction.hidden = !action;
    modalOpLocator.textContent = locator;
    modalOpLocator.hidden = !locator;
    modalOpValue.textContent = value;
    modalOpValue.hidden = !value;
    modalOpExpected.textContent = expected;
    modalOpExpected.hidden = !expected;
    modalOp.hidden = false;
  }

  function showAt(index) {
    if (index < 0 || index >= currentItems.length) return;
    currentIndex = index;
    const el = currentItems[index];
    if (el.classList.contains('ev-image')) {
      renderImage(el.dataset.img, el.dataset.name);
    } else if (el.classList.contains('ev-text')) {
      renderText(el.dataset.uid, el.dataset.name);
    }
    renderOperation(el);
    modalCounter.textContent = (index + 1) + ' / ' + currentItems.length;
    modalPrev.disabled = (index <= 0);
    modalNext.disabled = (index >= currentItems.length - 1);
  }
  function openModalFor(el) {
    const grid = el.closest('.ev-grid');
    if (!grid) return;
    currentItems = Array.from(grid.querySelectorAll('.ev-image, .ev-text'));
    currentIndex = currentItems.indexOf(el);
    if (currentIndex < 0) return;
    modal.classList.add('visible');
    showAt(currentIndex);
  }
  function hide() {
    modal.classList.remove('visible');
    modalContent.innerHTML = '';
    modalOp.hidden = true;
    currentItems = [];
    currentIndex = -1;
  }
  modalClose.addEventListener('click', hide);
  modalPrev.addEventListener('click', function() { showAt(currentIndex - 1); });
  modalNext.addEventListener('click', function() { showAt(currentIndex + 1); });
  modal.addEventListener('click', function(e) { if (e.target === modal) hide(); });
  document.addEventListener('keydown', function(e) {
    if (!modal.classList.contains('visible')) return;
    if (e.key === 'Escape') hide();
    else if (e.key === 'ArrowLeft') { e.preventDefault(); showAt(currentIndex - 1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); showAt(currentIndex + 1); }
  });

  document.querySelectorAll('.ev-image, .ev-text').forEach(function(el) {
    el.addEventListener('click', function() { openModalFor(el); });
    el.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openModalFor(el); }
    });
  });

  // Filtering
  function applyFilters() {
    const activeCats = new Set();
    const activeStatuses = new Set();
    document.querySelectorAll('[data-filter="category"]').forEach(function(cb) {
      if (cb.checked) activeCats.add(cb.value);
    });
    document.querySelectorAll('[data-filter="status"]').forEach(function(cb) {
      if (cb.checked) activeStatuses.add(cb.value);
    });
    let visible = 0;
    document.querySelectorAll('.ac-card').forEach(function(card) {
      const cat = card.dataset.category;
      const st = card.dataset.status;
      const ok = activeCats.has(cat) && activeStatuses.has(st);
      card.classList.toggle('hidden', !ok);
      if (ok) visible++;
    });
    const empty = document.getElementById('empty-message');
    if (empty) empty.style.display = visible === 0 ? 'block' : 'none';
  }
  document.querySelectorAll('[data-filter]').forEach(function(cb) {
    cb.addEventListener('change', applyFilters);
  });
})();
"""

    bugs_summary = ""
    if bugs:
        rows = "".join(
            f'<tr><td>#{escape(b["id"])}</td>'
            f'<td class="sev-{escape(b["severity"].lower())} b-sev">{escape(b["severity"])}</td>'
            f'<td>{escape(b["summary"])}</td></tr>'
            for b in bugs
        )
        bugs_summary = (
            f'<details class="bugs-summary"><summary>バグ一覧 ({len(bugs)} 件)</summary>'
            f'<table class="bugs-table"><thead><tr><th>#</th><th>重要度</th><th>内容</th></tr></thead>'
            f"<tbody>{rows}</tbody></table></details>"
        )

    html = f"""<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>PGE Evidence Report — {sprint_label}</title>
  <style>{css}</style>
</head>
<body>
  <header class="top">
    <div class="title-row">
      <h1>PGE Evidence Report</h1>
      <span class="verdict-badge {verdict_class}">{escape(verdict)}</span>
      <span class="meta-item">{sprint_label}</span>
      <span class="meta-item">mode: {mode}</span>
      <span class="meta-item">risk_score: {risk}</span>
      <span class="meta-item">hard_rule_hit: {hard_rules_text}</span>
      <span class="meta-item">evidence: {ev_count} files</span>
      <span class="meta-item">{evaluated_at}</span>
    </div>
    <div class="scores">{"".join(score_html)}</div>
    {bugs_summary}
    <div class="filters">
      <div class="filter-group"><span class="label">カテゴリ:</span>{cat_chips}</div>
      <div class="filter-group"><span class="label">ステータス:</span>{status_chips}</div>
    </div>
  </header>
  <main>
    {"".join(ac_cards)}
    <div id="empty-message" class="empty-message" style="display:none;">該当する AC がありません（フィルター条件を見直してください）。</div>
  </main>
  <div id="modal" class="modal-bg" aria-hidden="true">
    <div class="modal-head">
      <div class="modal-head-text">
        <span class="name"></span>
        <div class="modal-op" hidden>
          <span class="op-badge op-step"></span>
          <span class="op-badge op-action"></span>
          <span class="op-locator"></span>
          <span class="op-value" hidden></span>
          <div class="op-expected"></div>
        </div>
      </div>
      <span class="counter"></span>
      <button class="modal-close" aria-label="閉じる">×</button>
    </div>
    <button class="modal-nav prev" aria-label="前のエビデンス">‹</button>
    <button class="modal-nav next" aria-label="次のエビデンス">›</button>
    <div class="modal-content"></div>
  </div>
  <script>{js}</script>
</body>
</html>
"""
    return html


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--workspace", default=".", help="Workspace root (default: cwd)")
    parser.add_argument("--plan-dir", default=None, help="Plan dir (default: <workspace>/plan)")
    parser.add_argument("--attachments-root", default=None, help="Attachments root dir (default: <workspace>/evidence・Phase X3 規約・SUT root が異なる場合は明示指定)")
    parser.add_argument("--feedback", default="final", help="Feedback name without ext (default: final; alt: sprint-1 etc.)")
    parser.add_argument("--per-ac-dir", default=None, help="Per-AC artifact directory (default: <plan-dir>/feedback/<sprint-N> from spec.md or feedback arg). Used to load ac_operations[] and attach operation context to each screenshot in the modal.")
    parser.add_argument("--output", default=None, help="Output HTML path (default: <attachments-root>/report.html)")
    args = parser.parse_args()

    workspace = Path(args.workspace).resolve()
    plan_dir = Path(args.plan_dir).resolve() if args.plan_dir else workspace / "plan"
    # Phase X3: default を evidence/ に変更 (旧 test-results/ から移行)
    attachments_root = Path(args.attachments_root).resolve() if args.attachments_root else workspace / "evidence"
    output = Path(args.output).resolve() if args.output else attachments_root / "report.html"

    spec_path = plan_dir / "spec.md"
    sprint_path = plan_dir / "sprint.json"
    json_path = plan_dir / "feedback" / f"{args.feedback}.json"

    # feedback json は必須。AC 一覧 source は sprint.json 優先 (Phase Z11+)・無ければ spec.md fallback。
    if not json_path.exists():
        print(f"ERROR: missing input: {json_path}", file=sys.stderr)
        sys.exit(2)
    feedback_json = json.loads(json_path.read_text(encoding="utf-8"))

    if sprint_path.exists():
        sprint_json = json.loads(sprint_path.read_text(encoding="utf-8"))
        acs = load_acs_from_sprint(sprint_json)
        ac_source = "sprint.json#test_cases"
    elif spec_path.exists():
        acs = parse_spec_acs(spec_path.read_text(encoding="utf-8"))
        ac_source = "spec.md (legacy)"
    else:
        print(f"ERROR: AC source なし: {sprint_path} も {spec_path} も存在しない", file=sys.stderr)
        sys.exit(2)

    if not acs:
        print(f"ERROR: no ACs parsed from {ac_source}", file=sys.stderr)
        sys.exit(3)

    # D-4 規約: MD 廃止に伴い JSON 直読で narratives / bugs を導出
    narratives = derive_narratives_from_json(feedback_json)
    bugs = derive_bugs_from_findings(feedback_json)

    output.parent.mkdir(parents=True, exist_ok=True)
    html_dir = output.parent

    # Per-AC JSON ディレクトリの解決 (ac_operations[] を引くため)
    # 優先順: 1) --per-ac-dir 明示指定, 2) plan/feedback/<feedback>/ (feedback が sprint-N の場合),
    #         3) plan/feedback/sprint-N/ (final の場合・最後の sprint を fallback)
    per_ac_dir = None
    if args.per_ac_dir:
        per_ac_dir = Path(args.per_ac_dir).resolve()
    else:
        candidate = plan_dir / "feedback" / args.feedback
        if candidate.is_dir():
            per_ac_dir = candidate
        else:
            # final 等の場合は plan/feedback/sprint-* を探す (最後の番号を採用)
            feedback_root = plan_dir / "feedback"
            if feedback_root.is_dir():
                sprint_dirs = sorted(
                    [d for d in feedback_root.iterdir() if d.is_dir() and re.match(r"^sprint-\d+$", d.name)],
                    key=lambda d: int(d.name.split("-")[1]),
                )
                if sprint_dirs:
                    per_ac_dir = sprint_dirs[-1]

    # per-AC JSON から ac_operations[] と verdict を抽出
    # verdict は per-AC Evaluator が AC 単位で出した判定 (final.json の集約 verdict ではない)。
    # 1 件 fail で全 AC が fail 表示になるバグを回避するため、per-AC の verdict を採用する。
    ac_operations_by_ac = {}
    per_ac_verdicts = {}
    if per_ac_dir and per_ac_dir.is_dir():
        for ac in acs:
            ac_json = per_ac_dir / f"{ac['ac_id']}.json"
            if ac_json.is_file():
                try:
                    per_ac_data = json.loads(ac_json.read_text(encoding="utf-8"))
                    ops = per_ac_data.get("ac_operations") or []
                    if isinstance(ops, list):
                        ac_operations_by_ac[ac["ac_id"]] = ops
                    v = per_ac_data.get("verdict")
                    if isinstance(v, str):
                        per_ac_verdicts[ac["ac_id"]] = v
                except (json.JSONDecodeError, OSError):
                    pass

    # Phase X3 規約: ac_coverage[] の attachments_dir (= evidence/<test>/, SUT root 相対) を直接参照する。
    # 1 AC につき複数 scenario (S1 / S2) があるので、ac_coverage[] に複数エントリが並ぶ。
    # 同じ ac_id のエントリを統合して evidence_by_ac[ac_id] に蓄積する。
    evidence_by_ac = {ac["ac_id"]: [] for ac in acs}
    for entry in feedback_json.get("evidence", {}).get("ac_coverage", []):
        ac_id = entry.get("ac_id")
        if not ac_id or ac_id not in evidence_by_ac:
            continue
        attachments_dir_rel = entry.get("attachments_dir", "")
        if not attachments_dir_rel:
            continue
        # attachments_dir は SUT root 相対 (Phase X3 規約: "evidence/<test>/" 形式)
        # attachments_root が SUT root の evidence/ を指すため、parent が SUT root。
        # default では attachments_root=<workspace>/evidence → SUT root=<workspace>。
        # SUT root が異なる場合は --attachments-root /path/to/sut/evidence で渡す。
        sut_root = attachments_root.parent
        ac_dir = (sut_root / attachments_dir_rel).resolve()
        ac_ops = ac_operations_by_ac.get(ac_id)
        items = collect_evidence(ac_dir, html_dir, ac_operations=ac_ops)
        evidence_by_ac[ac_id].extend(items)

    # Phase X3 規約: evidence.count フィールドは廃止 (mv 操作がないため統計値が evidence/ 実 dir 由来になる)
    # 実 enumerate した file 数を集計値として使う
    derived_evidence_count = sum(len(v) for v in evidence_by_ac.values())
    meta = {
        "sprint": feedback_json.get("sprint", ""),
        "mode": feedback_json.get("mode", ""),
        "verdict": feedback_json.get("verdict", ""),
        "evaluated_at": feedback_json.get("evaluated_at", ""),
        "risk_score": feedback_json.get("risk_score", "?"),
        "hard_rule_hit": feedback_json.get("impact_surface", {}).get("hard_rule_hit", []) or [],
        "evidence_count": derived_evidence_count,
    }
    scores = feedback_json.get("scores", {})

    ac_method = {}
    for ac in feedback_json.get("evidence", {}).get("ac_coverage", []):
        ac_method[ac["ac_id"]] = ac.get("verification_method", "")

    ac_bugs = {}
    for bug in bugs:
        for m in re.findall(r"AC-\d+", bug.get("summary", "") + " " + bug.get("repro", "")):
            ac_bugs.setdefault(m, []).append(bug)

    html = render_html(meta, acs, narratives, bugs, evidence_by_ac, scores, ac_method, ac_bugs, per_ac_verdicts)
    output.write_text(html, encoding="utf-8")
    print(f"Generated: {output}")
    print(f"AC count: {len(acs)} / Evidence: {sum(len(v) for v in evidence_by_ac.values())} files / Bugs: {len(bugs)}")


if __name__ == "__main__":
    main()
