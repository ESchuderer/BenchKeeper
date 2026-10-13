"""Generate the SDLC loop SVG. Run from web/: python3 scripts/sdlc.py > src/assets/sdlc.svg"""
import math
C, R = 320, 220
steps = [
    ("Understand", "request, AGENTS.md, code"), ("Track", "GitHub issue"), ("Branch", "type/issue-slug"),
    ("Specify", "OpenSpec / Spec Kit"), ("Plan", "tasks.md"), ("Build", "small slices, tests first"),
    ("Verify", "build, lint, tests, browser"), ("Review", "code review before push"),
    ("Ship", "draft PR, checks, ready"), ("Maintain", "findings: new requests"),
]
you = {1: "approve issue", 7: "findings stop push", 8: "you merge"}
phases = [("Define", "define", 0, 3), ("Build", "build", 4, 6), ("Ship", "ship", 7, 8), ("Maintain", "maintain", 9, 9)]

def pt(deg, r=R):
    a = math.radians(deg)
    return C + r * math.sin(a), C - r * math.cos(a)

def arc(a0, a1, r=R):
    x0, y0 = pt(a0, r); x1, y1 = pt(a1, r)
    large = 1 if (a1 - a0) % 360 > 180 else 0
    return f"M{x0:.1f} {y0:.1f}A{r} {r} 0 {large} 1 {x1:.1f} {y1:.1f}"

o = ['<svg class="ring" viewBox="-140 -40 920 700" role="img" aria-labelledby="ring-t ring-d">',
     '<title id="ring-t">BenchKeeper SDLC loop</title>',
     '<desc id="ring-d">Ten steps in a clockwise loop, grouped into four phases. Define: Understand, Track, Branch, Specify. '
     'Build: Plan, Build, Verify. Ship: Review, Ship. Maintain. A request enters at Understand; Maintain findings become new requests. You decide at Track (approve the issue), Review (findings stop the push) and Ship (you merge).</desc>',
     f'<circle class="track" cx="{C}" cy="{C}" r="{R}"/>']
for name, cls, i0, i1 in phases:
    a0, a1 = i0 * 36 - 13, i1 * 36 + 13
    o.append(f'<path class="phase {cls}" d="{arc(a0, a1)}"/>')
    mid = (a0 + a1) / 2
    x, y = pt(mid, 160)
    o.append(f'<text class="ph-l {cls}" x="{x:.1f}" y="{y + 4:.1f}" text-anchor="middle">{name.upper()}</text>')
o.append('<path class="flow" d="M320 -36V2"/><path class="flow-head" d="M313 0L320 13 327 0z"/>')
o.append('<text class="flow-t" x="330" y="-14">request</text>')
o.append('<path class="flow back" d="M168 112C140 40 210 -24 306 -28"/><path class="flow-head back" d="M300 -34L314 -28 301 -21z"/>')
o.append('<text class="flow-t" x="148" y="40" text-anchor="end">findings</text>')
for k in range(10):
    x, y = pt(k * 36 + 18)
    o.append(f'<path class="arrow" d="M-5-4.5L5 0-5 4.5z" transform="translate({x:.1f} {y:.1f}) rotate({k * 36 + 18})"/>')
o.append(f'<circle class="core" cx="{C}" cy="{C}" r="118"/>')
o.append(f'<text class="core-t" x="{C}" y="{C - 30}" text-anchor="middle">issue to merged PR</text>')
o.append(f'<text class="core-s" x="{C}" y="{C - 6}" text-anchor="middle">agent-skills drives each phase</text>')
o.append(f'<circle class="you-dot" cx="{C - 62}" cy="{C + 28}" r="9"/>')
o.append(f'<text class="core-s" x="{C - 46}" y="{C + 32}">your decision</text>')
o.append(f'<text class="core-s" x="{C}" y="{C + 62}" text-anchor="middle">everything else: the agent</text>')
for k, (lbl, sub) in enumerate(steps):
    deg = k * 36
    x, y = pt(deg)
    if k in you:
        o.append(f'<circle class="you-ring" cx="{x:.1f}" cy="{y:.1f}" r="35"/>')
    o.append(f'<g class="node"><circle cx="{x:.1f}" cy="{y:.1f}" r="27"/><text class="n" x="{x:.1f}" y="{y + 6:.1f}" text-anchor="middle">{k + 1}</text></g>')
    lx, ly = pt(deg, 282)
    s = math.sin(math.radians(deg))
    anchor = "middle" if abs(s) < 0.2 else ("start" if s > 0 else "end")
    if abs(s) >= 0.2:
        lx += 8 if s > 0 else -8
    ly += -8 if math.cos(math.radians(deg)) > 0.5 else (14 if math.cos(math.radians(deg)) < -0.5 else 0)
    o.append(f'<text class="lbl" x="{lx:.1f}" y="{ly:.1f}" text-anchor="{anchor}">{lbl}</text>')
    o.append(f'<text class="sub" x="{lx:.1f}" y="{ly + 18:.1f}" text-anchor="{anchor}">{sub}</text>')
    if k in you:
        o.append(f'<text class="you-t" x="{lx:.1f}" y="{ly + 35:.1f}" text-anchor="{anchor}">{you[k]}</text>')
o.append('</svg>')
print("\n".join(o))
