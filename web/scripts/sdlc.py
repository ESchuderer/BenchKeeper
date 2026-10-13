"""Generate the SDLC loop SVG. Run from web/: python3 scripts/sdlc.py > src/assets/sdlc.svg"""
import math
from textwrap import wrap

C, R = 320, 220
steps = [
    ("Understand", "request, AGENTS.md, code", "Reads the request, AGENTS.md and the code it touches. No edits yet."),
    ("Track", "GitHub issue", "Turns the request into a GitHub issue with goal, acceptance criteria and tasks. You approve it."),
    ("Branch", "type/issue-slug", "Creates <type>/<issue>-<slug> from the default branch."),
    ("Specify", "OpenSpec / Spec Kit", "Writes the spec as an OpenSpec change or a Spec Kit feature spec, or uses plan mode."),
    ("Plan", "tasks.md", "Breaks the spec into small tasks with acceptance criteria."),
    ("Build", "small slices, tests first", "Implements task by task, tests first, the smallest complete change."),
    ("Verify", "build, lint, tests, browser", "Runs build, types, lint and tests in the devcontainer; checks UI changes in a browser."),
    ("Review", "code review before push", "Reviews the commits for correctness before push. Findings wait for you."),
    ("Ship", "draft PR, checks, ready", "Opens a draft pull request, waits for checks, marks it ready. You merge."),
    ("Maintain", "findings: new requests", "About every 10 merges: audit, debt, dependencies, docs drift. Findings become new requests."),
]
req_tip = "From you, GitHub issues, Jira, Linear or other trackers, bug reports, reviews or Maintain findings. Linked or pasted; only GitHub issues are automated."
you = {1: "approve issue", 7: "findings stop push", 8: "you merge"}
phases = [("Define", "define", 0, 3), ("Build", "build", 4, 6), ("Ship", "ship", 7, 8), ("Maintain", "maintain", 9, 9)]
esc = lambda t: t.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

def pt(deg, r=R):
    a = math.radians(deg)
    return C + r * math.sin(a), C - r * math.cos(a)

def arc(a0, a1, r=R):
    x0, y0 = pt(a0, r); x1, y1 = pt(a1, r)
    large = 1 if (a1 - a0) % 360 > 180 else 0
    return f"M{x0:.1f} {y0:.1f}A{r} {r} 0 {large} 1 {x1:.1f} {y1:.1f}"

def tip(i, cx, cy, text):
    lines = wrap(text, 30)
    w, h = 236, 18 * len(lines) + 18
    x, y = cx - w / 2, cy - h / 2
    t = [f'<g class="tip tip-{i}" aria-hidden="true"><rect x="{x:.1f}" y="{y:.1f}" width="{w}" height="{h}" rx="8"/>']
    t += [f'<text x="{x + 12:.1f}" y="{y + 22 + 18 * n:.1f}">{esc(l)}</text>' for n, l in enumerate(lines)]
    return t + ["</g>"]

o = ['<svg class="ring" viewBox="-140 -90 920 750" role="img" aria-labelledby="ring-t ring-d">',
     '<title id="ring-t">BenchKeeper SDLC loop</title>',
     '<desc id="ring-d">Requirements enter at step 1. Ten steps in a clockwise loop, grouped into four phases. Define: Understand, Track, Branch, Specify. '
     'Build: Plan, Build, Verify. Ship: Review, Ship. Maintain, whose findings become new requirements. People add requirements directly; Maintain findings add more. Human actions: Track (approve the issue), Review (findings stop the push) and Ship (you merge).</desc>',
     '<defs><marker id="ah" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="ah" d="M0 0L10 5 0 10z"/></marker></defs>',
     '<style>' + "".join(f".ring:has(.hit-{i}:hover) .tip-{i}{{opacity:1}}" for i in range(11)) + '</style>',
     f'<circle class="track" cx="{C}" cy="{C}" r="{R}"/>']
for name, cls, i0, i1 in phases:
    a0, a1 = i0 * 36 - 13, i1 * 36 + 13
    o.append(f'<path class="phase {cls}" d="{arc(a0, a1)}"/>')
    x, y = pt((a0 + a1) / 2, 160)
    o.append(f'<text class="ph-l {cls}" x="{x:.1f}" y="{y + 4:.1f}" text-anchor="middle">{name.upper()}</text>')
for k in range(10):
    x, y = pt(k * 36 + 18)
    o.append(f'<path class="chev" d="M-3-5L3 0-3 5" transform="translate({x:.1f} {y:.1f}) rotate({k * 36 + 18})"/>')

# requirements box, arrow into step 1, feedback from Maintain
o.append('<g class="hit-10 req"><rect x="225" y="-80" width="190" height="48" rx="24"/>'
         '<text class="req-t" x="320" y="-50" text-anchor="middle">Requirements</text></g>')
o.append('<path class="flow" d="M320 -32V64" marker-end="url(#ah)"/>')
o.append('<path class="flow back" d="M174 114C120 30 160 -56 222 -56" marker-end="url(#ah)"/>')
o.append('<text class="flow-t" x="118" y="20" text-anchor="end">findings</text>')
o.append('<path class="flow" d="M512 -56H426" marker-end="url(#ah)"/>')
o.append('<g class="hit-10"><circle class="hit" cx="541" cy="-56" r="28"/><circle class="you-ring" cx="541" cy="-56" r="24"/>'
         '<g class="person"><circle cx="541" cy="-63" r="6"/><path d="M529 -43a12 11 0 0 1 24 0"/></g></g>')

o.append('<circle class="you-dot" cx="-112" cy="628" r="10"/>')
o.append('<text class="core-s" x="-94" y="633">human action</text>')

tips = []
for k, (lbl, sub, detail) in enumerate(steps):
    deg = k * 36
    x, y = pt(deg)
    g = [f'<g class="hit-{k}"><circle class="hit" cx="{x:.1f}" cy="{y:.1f}" r="40"/>']
    if k in you:
        g.append(f'<circle class="you-ring" cx="{x:.1f}" cy="{y:.1f}" r="35"/>')
    g.append(f'<g class="node"><circle cx="{x:.1f}" cy="{y:.1f}" r="27"/><text class="n" x="{x:.1f}" y="{y + 6:.1f}" text-anchor="middle">{k + 1}</text></g>')
    if k == 0:
        lx, ly, anchor = 334, 26, "start"
    else:
        lx, ly = pt(deg, 282)
        s = math.sin(math.radians(deg)); c = math.cos(math.radians(deg))
        anchor = "middle" if abs(s) < 0.2 else ("start" if s > 0 else "end")
        if abs(s) >= 0.2:
            lx += 8 if s > 0 else -8
        ly += -8 if c > 0.5 else (14 if c < -0.5 else 0)
    g.append(f'<text class="lbl" x="{lx:.1f}" y="{ly:.1f}" text-anchor="{anchor}">{lbl}</text>')
    g.append(f'<text class="sub" x="{lx:.1f}" y="{ly + 18:.1f}" text-anchor="{anchor}">{sub}</text>')
    if k in you:
        g.append(f'<text class="you-t" x="{lx:.1f}" y="{ly + 35:.1f}" text-anchor="{anchor}">{you[k]}</text>')
    o += g + ["</g>"]
    tips += tip(k, C, C, f"{k + 1}. {lbl}: {detail}")
tips += tip(10, C, C, f"Requirements: {req_tip}")
o += tips + ["</svg>"]
print("\n".join(o))
