#!/usr/bin/env python3
"""PGE Spec Visual Generator (Phase Z11.1).

Reads the two machine-readable PGE planning artifacts and renders a single
human-facing HTML review file. The human reads ONLY this HTML; they never need
to open spec.md or the raw JSON.

Inputs (pure JSON — no markdown parsing, so this tool is robust and agnostic):
  - plan/sprint.json   (prose + requirements + test_cases + coverage + grounding)
  - plan/domain.json   (entities / endpoints / named_states / planned_changes)

Output:
  - plan/spec-visual.html   (default)

HTML sections (per human request):
  1. 概要            (sprint.prose.overview)
  2. 出発点          (sprint.prose.starting_point[])
  3. コア機能一覧    (sprint.prose.core_features[])
  4. 要求一覧        (requirements -> test_cases hierarchy)
  5. 前提条件        (sprint.prose.prerequisites[])
  6. 制約事項        (sprint.prose.constraints[])
  + Planner 決定 (sprint.prose.planner_decisions[]) if present
  + grounding pass/fail badge (footer · gate indicator, not review content)

This tool contains NO SUT-specific values: everything rendered comes from the
JSON inputs. It is therefore project-agnostic by construction.

Usage:
  python3 .claude/tools/pge-spec-visual.py
  python3 .claude/tools/pge-spec-visual.py --workspace /path/to/repo
  python3 .claude/tools/pge-spec-visual.py --output /tmp/spec-visual.html
"""

import argparse
import html
import json
import os
import sys


def esc(v):
    """HTML-escape any scalar (None -> empty string)."""
    if v is None:
        return ""
    return html.escape(str(v))


def load_json(path):
    if not os.path.isfile(path):
        return None
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


SCOPE_LABEL = {
    "required": "required",
    "optional-regression": "optional-regression",
    "out-of-scope": "out-of-scope",
}


def render_kv(d):
    """Render a dict of input/row literals as 'k=v' monospace text."""
    if not d:
        return '<span class="muted">(none)</span>'
    parts = []
    for k, v in d.items():
        if isinstance(v, bool):
            vs = "true" if v else "false"
        elif v is None:
            vs = "null"
        else:
            vs = str(v)
        parts.append(
            '<span class="k">%s</span>=<span class="v">%s</span>' % (esc(k), esc(vs))
        )
    return ", ".join(parts)


def render_expected(exp):
    if not exp:
        return '<span class="muted">(none)</span>'
    bits = []
    http = exp.get("http") or {}
    if http.get("status") is not None:
        s = "http %s" % esc(http.get("status"))
        if http.get("redirect_to"):
            s += " → %s" % esc(http.get("redirect_to"))
        bits.append(s)
    hc = http.get("html_contains") or []
    if hc:
        bits.append("html: " + " / ".join(esc(x) for x in hc))
    db = exp.get("db_after") or {}
    if db.get("op") and db.get("op") != "no_change":
        row = db.get("row") or {}
        bits.append("db %s(%s): %s" % (esc(db.get("op")), esc(db.get("table")), render_kv(row)))
    elif db.get("op") == "no_change":
        bits.append("db no_change")
    se = exp.get("side_effects") or []
    if se:
        bits.append("side_effects: " + " / ".join(esc(x) for x in se))
    return " ・ ".join(bits) if bits else '<span class="muted">(none)</span>'


def render_test_case(tc):
    state = tc.get("state")
    state_chip = (
        '<span class="state-chip">%s</span>' % esc(state) if state else ""
    )
    extra = tc.get("extra_steps") or []
    extra_html = ""
    if extra:
        extra_html = '<div class="extra">+ extra: %s</div>' % " / ".join(
            esc(x) for x in extra
        )
    return """
      <div class="tc">
        <div class="tc-head"><span class="tcid">%s</span><span class="tc-label">%s</span>%s</div>
        <div class="io-grid">
          <div class="io-cell input"><div class="io-lbl">input</div><div class="kv">%s</div></div>
          <div class="io-cell expected"><div class="io-lbl">expected</div><div class="kv">%s%s</div></div>
        </div>
      </div>""" % (
        esc(tc.get("id")),
        esc(tc.get("label")),
        state_chip,
        render_kv(tc.get("input") or {}),
        render_expected(tc.get("expected") or {}),
        extra_html,
    )


def render_requirement(req, test_cases):
    scope = req.get("scope", "required")
    tcs = [tc for tc in test_cases if tc.get("requirement_id") == req.get("id")]
    body = ""
    if tcs:
        body = "".join(render_test_case(tc) for tc in tcs)
    else:
        note = {
            "optional-regression": "test_case (0)・本 sprint 未テスト・将来 sprint で検証候補",
            "out-of-scope": "test_case (0)・現実装にあるが本 sprint では意図的に未テスト",
        }.get(scope, "test_case (0)")
        body = '<p class="muted" style="margin:.3rem 0 0">%s</p>' % esc(note)
    return """
  <div class="req-card %s">
    <div class="req-head"><span class="rid">%s</span><span class="req-desc">%s</span><span class="pill %s">%s</span></div>
    <div class="req-body">%s</div>
  </div>""" % (
        esc(scope),
        esc(req.get("id")),
        esc(req.get("description")),
        esc(scope),
        esc(SCOPE_LABEL.get(scope, scope)),
        body,
    )


def grounding_pass(sprint):
    g = sprint.get("grounding") or {}
    ung = 0
    for axis in g.values():
        if isinstance(axis, dict):
            ung += axis.get("ungrounded", 0) or 0
    cov = sprint.get("coverage") or {}
    gap = cov.get("gap", 0) or 0
    return (ung == 0 and gap == 0), gap, ung


def build_html(sprint, domain):
    prose = sprint.get("prose") or {}
    reqs = sprint.get("requirements") or []
    tcs = sprint.get("test_cases") or []
    cov = sprint.get("coverage") or {}
    ok, gap, ung = grounding_pass(sprint)

    title = prose.get("title") or sprint.get("feature") or sprint.get("sprint") or "PGE spec"

    # Section 1: 概要
    sec_overview = '<p>%s</p>' % esc(prose.get("overview")) if prose.get("overview") else ""

    # Section 2: 出発点
    sp = prose.get("starting_point") or []
    sec_start = ""
    if sp:
        sec_start = "<ul>%s</ul>" % "".join("<li>%s</li>" % esc(x) for x in sp)

    # Section 3: コア機能一覧
    cf = prose.get("core_features") or []
    sec_features = ""
    if cf:
        rows = "".join(
            "<tr><td><strong>%s</strong></td><td>%s</td><td>%s</td></tr>"
            % (esc(f.get("id")), esc(f.get("name")), esc(f.get("description")))
            for f in cf
        )
        sec_features = (
            '<table><thead><tr><th style="width:4rem">#</th><th>機能名</th><th>説明</th></tr></thead><tbody>%s</tbody></table>'
            % rows
        )

    # Section 4: 要求一覧 (requirements -> test_cases)
    sec_reqs = "".join(render_requirement(r, tcs) for r in reqs)

    # Section 5: 前提条件
    pre = prose.get("prerequisites") or []
    sec_pre = "<ul>%s</ul>" % "".join("<li>%s</li>" % esc(x) for x in pre) if pre else ""

    # Section 6: 制約事項
    con = prose.get("constraints") or []
    sec_con = "<ul>%s</ul>" % "".join("<li>%s</li>" % esc(x) for x in con) if con else ""

    # Planner 決定 (optional)
    pd = prose.get("planner_decisions") or []
    sec_pd = ""
    if pd:
        rows = "".join(
            "<tr><td>%s</td><td>%s</td></tr>" % (esc(d.get("topic")), esc(d.get("decision")))
            for d in pd
        )
        sec_pd = (
            '<h2>Planner 決定</h2><table><thead><tr><th style="width:40%%">論点</th><th>決定</th></tr></thead><tbody>%s</tbody></table>'
            % rows
        )

    badge = (
        '<span class="gate ok">grounding gate PASS (gap=0 / ungrounded=0)</span>'
        if ok
        else '<span class="gate fail">grounding gate FAIL (gap=%d / ungrounded=%d)</span>'
        % (gap, ung)
    )

    n_req = len([r for r in reqs if r.get("scope") == "required"])
    n_tc = len(tcs)

    return TEMPLATE % {
        "title": esc(title),
        "sprint": esc(sprint.get("sprint")),
        "badge": badge,
        "n_req": len(reqs),
        "n_req_required": n_req,
        "n_tc": n_tc,
        "sec_overview": sec_overview,
        "sec_start": sec_start,
        "sec_features": sec_features,
        "sec_reqs": sec_reqs,
        "sec_pre": sec_pre,
        "sec_con": sec_con,
        "sec_pd": sec_pd,
    }


TEMPLATE = """<!DOCTYPE html>
<html lang="ja"><head><meta charset="UTF-8"><title>%(title)s</title>
<style>
:root{--bg:#fafafa;--fg:#1f2328;--muted:#6b7280;--border:#d1d5db;--head:#f3f4f6;--accent:#2563eb;
--req:#dcfce7;--req-fg:#14532d;--opt:#fef3c7;--opt-fg:#78350f;--out:#f3f4f6;--out-fg:#4b5563;--ok:#16a34a;--bad:#dc2626}
*{box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Hiragino Sans","Yu Gothic UI","Meiryo",sans-serif;background:var(--bg);color:var(--fg);line-height:1.65;margin:0;padding:2rem 1rem 4rem}
.container{max-width:1100px;margin:0 auto}
h1{font-size:1.6rem;border-bottom:3px solid var(--accent);padding-bottom:.5rem;margin-top:0}
h2{font-size:1.2rem;margin-top:2rem;padding-left:.6rem;border-left:5px solid var(--accent)}
p,li{font-size:.93rem}
ul{padding-left:1.3rem}
code{font-family:"SFMono-Regular",Consolas,Menlo,monospace;background:#eef2ff;padding:.1rem .35rem;border-radius:3px;font-size:.85em}
.muted{color:var(--muted)}
table{border-collapse:collapse;width:100%%;margin:.6rem 0 1.4rem;background:#fff;font-size:.88rem;box-shadow:0 1px 3px rgba(0,0,0,.04);border-radius:6px;overflow:hidden}
th,td{border:1px solid var(--border);padding:.5rem .7rem;vertical-align:top;text-align:left}
th{background:var(--head);font-size:.82rem;font-weight:600}
tbody tr:nth-child(even){background:#f9fafb}
.summary{display:flex;gap:.6rem;flex-wrap:wrap;margin:1rem 0}
.chip{background:#fff;border:1px solid var(--border);border-radius:6px;padding:.4rem .8rem;font-size:.85rem}
.chip b{color:var(--accent);font-size:1.1rem}
.gate{display:inline-block;padding:.25rem .7rem;border-radius:6px;font-weight:700;font-size:.82rem}
.gate.ok{background:#dcfce7;color:#15803d}.gate.fail{background:#fee2e2;color:#b91c1c}
.req-card{background:#fff;border:1px solid var(--border);border-radius:8px;margin:.8rem 0;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.05)}
.req-card.required{border-left:5px solid var(--ok)}
.req-card.optional-regression{border-left:5px solid #d97706;background:#fffbeb}
.req-card.out-of-scope{border-left:5px solid var(--muted);background:#f9fafb}
.req-head{background:var(--head);padding:.55rem 1rem;display:flex;align-items:center;gap:.6rem;flex-wrap:wrap;border-bottom:1px solid var(--border)}
.rid{font-weight:700;font-family:monospace;background:var(--accent);color:#fff;padding:.15rem .5rem;border-radius:4px;font-size:.82em}
.req-card.optional-regression .rid{background:#d97706}.req-card.out-of-scope .rid{background:var(--muted)}
.req-desc{flex:1;font-weight:600}
.pill{display:inline-block;font-size:.7rem;padding:.1rem .5rem;border-radius:10px;font-weight:600}
.pill.required{background:var(--req);color:var(--req-fg)}.pill.optional-regression{background:var(--opt);color:var(--opt-fg)}.pill.out-of-scope{background:var(--out);color:var(--out-fg)}
.req-body{padding:.5rem 1rem}
.tc{border:1px solid #e2e8f0;border-radius:5px;margin:.45rem 0;padding:.5rem .7rem;background:#fbfcff}
.tc-head{display:flex;align-items:center;gap:.5rem;flex-wrap:wrap;margin-bottom:.3rem}
.tcid{font-family:monospace;background:#475569;color:#fff;padding:.1rem .4rem;border-radius:3px;font-size:.78em}
.tc-label{font-weight:600;font-size:.88rem}
.state-chip{display:inline-block;background:#f0f9ff;border:1px solid #bae6fd;color:#075985;padding:.1rem .45rem;border-radius:4px;font-size:.74rem;font-family:monospace}
.io-grid{display:grid;grid-template-columns:1fr 1fr;gap:.5rem}
.io-cell{background:#fff;border:1px solid var(--border);border-radius:4px;padding:.4rem .55rem;font-size:.8rem}
.io-cell.input{border-left:3px solid #047857}.io-cell.expected{border-left:3px solid #b45309}
.io-lbl{font-size:.66rem;font-weight:700;color:var(--muted);text-transform:uppercase}
.kv{font-family:"SFMono-Regular",Consolas,monospace;font-size:.78em;word-break:break-all}
.kv .k{color:#6b21a8}.kv .v{color:#0f766e}
.extra{margin-top:.25rem;font-size:.78em;color:#92400e}
.footer{margin-top:2.5rem;padding-top:1rem;border-top:1px solid var(--border);color:var(--muted);font-size:.8rem;text-align:center}
</style></head><body><div class="container">
<h1>%(title)s</h1>
<div class="summary">
  <div class="chip">sprint: <b>%(sprint)s</b></div>
  <div class="chip">requirements: <b>%(n_req)s</b> (required %(n_req_required)s)</div>
  <div class="chip">test_cases: <b>%(n_tc)s</b></div>
  <div class="chip">%(badge)s</div>
</div>

<h2>1. 概要</h2>
%(sec_overview)s

<h2>2. 出発点</h2>
%(sec_start)s

<h2>3. コア機能一覧</h2>
%(sec_features)s

<h2>4. 要求一覧</h2>
<p class="muted" style="font-size:.82rem">requirement = 要件粒度のまとまり / 各 test_case = 検証ケース (input / expected は literal)。</p>
%(sec_reqs)s

<h2>5. 前提条件</h2>
%(sec_pre)s

<h2>6. 制約事項 (スコープ外)</h2>
%(sec_con)s

%(sec_pd)s

<div class="footer">generated from <code>plan/sprint.json</code> + <code>plan/domain.json</code> by <code>.claude/tools/pge-spec-visual.py</code> (Phase Z11.1)</div>
</div></body></html>
"""


def main():
    ap = argparse.ArgumentParser(description="PGE spec-visual HTML generator (Z11.1)")
    ap.add_argument("--workspace", default=os.getcwd(), help="workspace root (default: cwd)")
    ap.add_argument("--sprint", default=None, help="path to sprint.json (default: <workspace>/plan/sprint.json)")
    ap.add_argument("--domain", default=None, help="path to domain.json (default: <workspace>/plan/domain.json)")
    ap.add_argument("--output", default=None, help="output HTML path (default: <workspace>/plan/spec-visual.html)")
    args = ap.parse_args()

    ws = args.workspace
    sprint_path = args.sprint or os.path.join(ws, "plan", "sprint.json")
    domain_path = args.domain or os.path.join(ws, "plan", "domain.json")
    output_path = args.output or os.path.join(ws, "plan", "spec-visual.html")

    sprint = load_json(sprint_path)
    if sprint is None:
        print("missing input: %s (run /pge-planning to author sprint.json)" % sprint_path, file=sys.stderr)
        return 1
    domain = load_json(domain_path)  # optional; tool tolerates absence

    if not sprint.get("prose"):
        print("warning: sprint.json has no `prose` section — 概要/出発点/コア機能/前提/制約 will be empty", file=sys.stderr)

    out = build_html(sprint, domain)
    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        f.write(out)

    ok, gap, ung = grounding_pass(sprint)
    print("spec-visual generated: %s" % output_path)
    print("  requirements=%d test_cases=%d grounding_gate=%s (gap=%d ungrounded=%d)"
          % (len(sprint.get("requirements") or []), len(sprint.get("test_cases") or []),
             "PASS" if ok else "FAIL", gap, ung))
    return 0


if __name__ == "__main__":
    sys.exit(main())
