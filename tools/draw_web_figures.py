#!/usr/bin/env python3
"""Draw the world-model proposal's web figures as SVG, sized for the page (900 px wide, 13 px text).

Reads static/data/world_model.js (the real sample task: manifest numbers and the PhysX rollout) and writes
static/images/world_model/web_{io,training,step}.svg. The slide figures in reports/world_model/figures are too
dense to read at page width; these carry fewer words and bigger text. Standard library only.

    python3 tools/draw_web_figures.py
"""
import json
import math
from pathlib import Path
import sys

REPO = Path(__file__).resolve().parents[1]
DATA = REPO / "static" / "data" / "world_model.js"
OUT = REPO / "static" / "images" / "world_model"
SANS = "'Noto Sans', 'Helvetica Neue', Helvetica, Arial, sans-serif"
MONO = "'DejaVu Sans Mono', Menlo, Consolas, monospace"
C = {"text": "#333", "muted": "#767676", "border": "#d9dee5", "panel": "#eef1f4", "red": "#d7263d", "blue": "#1f6feb",
     "blue_fill": "#e8eef9", "amber": "#f5a623", "amber_fill": "#fff3d6", "red_fill": "#fdecee", "ball_blue": "#4a6fa5",
     "barrier": "#9aa3ad", "table": "#8B5A2B", "floor": "#c5ccd6", "grid": "#c9d1dc"}
SCALES = {"displacement": 1.0, "velocity": 2.0, "angular": 10.0}
CHANNELS = ["dx", "dy", "dz", "r1", "r2", "r3", "r4", "r5", "r6", "vx", "vy", "vz", "wx", "wy", "wz"]


def esc(s):
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


class Svg:
    def __init__(self, width, height):
        self.w, self.h, self.parts = width, height, []

    def rect(self, x, y, w, h, fill="#fff", stroke=None, sw=1.2, rx=6):
        stroke = stroke or C["border"]
        self.parts.append('<rect x="%g" y="%g" width="%g" height="%g" rx="%g" fill="%s" stroke="%s" stroke-width="%g"/>' % (x, y, w, h, rx, fill, stroke, sw))

    def cell(self, x, y, w, h, fill):
        self.parts.append('<rect x="%.2f" y="%.2f" width="%.2f" height="%.2f" fill="%s"/>' % (x, y, w, h, fill))

    def text(self, x, y, s, size=13, anchor="start", weight="normal", fill=None, mono=False, rotate=None):
        family = MONO if mono else SANS
        transform = ' transform="rotate(%g %g %g)"' % (rotate, x, y) if rotate is not None else ""
        self.parts.append('<text x="%g" y="%g" font-family="%s" font-size="%g" font-weight="%s" fill="%s" text-anchor="%s" dominant-baseline="middle"%s>%s</text>'
                          % (x, y, family, size, weight, fill or C["text"], anchor, transform, esc(s)))

    def lines(self, x, y, rows, size=13, step=None, **kw):
        step = step or size * 1.45
        for k, row in enumerate(rows):
            self.text(x, y + k * step, row, size=size, **kw)

    def line(self, x0, y0, x1, y1, stroke=None, sw=1.5, dash=None):
        d = ' stroke-dasharray="%s"' % dash if dash else ""
        self.parts.append('<line x1="%g" y1="%g" x2="%g" y2="%g" stroke="%s" stroke-width="%g"%s/>' % (x0, y0, x1, y1, stroke or C["muted"], sw, d))

    def arrow(self, x0, y0, x1, y1, stroke=None, sw=1.6):
        self.parts.append('<line x1="%g" y1="%g" x2="%g" y2="%g" stroke="%s" stroke-width="%g" marker-end="url(#ah)"/>' % (x0, y0, x1, y1, stroke or C["muted"], sw))

    def path(self, d, stroke, sw=1.6, fill="none", arrow=False):
        self.parts.append('<path d="%s" fill="%s" stroke="%s" stroke-width="%g"%s/>' % (d, fill, stroke, sw, ' marker-end="url(#ah)"' if arrow else ""))

    def circle(self, x, y, r, fill):
        self.parts.append('<circle cx="%g" cy="%g" r="%g" fill="%s"/>' % (x, y, r, fill))

    def render(self, title):
        head = ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %d %d" width="%d" height="%d" role="img" aria-label="%s">'
                '<defs><marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">'
                '<path d="M0,0 L10,5 L0,10 z" fill="%s"/></marker></defs><rect width="%d" height="%d" fill="#fff"/>'
                % (self.w, self.h, self.w, self.h, esc(title), C["muted"], self.w, self.h))
        return head + "\n".join(self.parts) + "</svg>\n"


def load_sample():
    text = DATA.read_text(encoding="utf-8")
    start = text.index("window.WM_SAMPLE = ") + len("window.WM_SAMPLE = ")
    return json.loads(text[start:].rstrip().rstrip(";"))


def rotation_columns(q):
    w, x, y, z = q
    return [1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w), 2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w)]


def channel_block(ball):
    """The 15 normalised channels of one object over frames 1..60 (what one row of the trajectory tensor holds)."""
    start = ball["position"][0]
    rows = []
    for t in range(1, len(ball["position"])):
        disp = [(p - s) / SCALES["displacement"] for p, s in zip(ball["position"][t], start)]
        vel = [v / SCALES["velocity"] for v in ball["linear_velocity"][t]]
        spin = [w / SCALES["angular"] for w in ball["angular_velocity"][t]]
        rows.append(disp + rotation_columns(ball["quaternion_wxyz"][t]) + vel + spin)
    return [[rows[t][c] for t in range(len(rows))] for c in range(15)]       # [channel][frame]


def diverging(value, limit=1.3):
    """Blue (negative) through white to red (positive), clipped at +-limit."""
    t = max(-1., min(1., value / limit))
    if t < 0:
        a, b, f = (33, 102, 172), (255, 255, 255), 1 + t
    else:
        a, b, f = (255, 255, 255), (178, 24, 43), t
    return "#%02x%02x%02x" % tuple(int(round(a[i] + (b[i] - a[i]) * f)) for i in range(3))


def heatmap(svg, x, y, w, h, block, labels=False, every=2):
    cols = list(range(0, len(block[0]), every))
    cw, ch = w / len(cols), h / len(block)
    for r, row in enumerate(block):
        for k, c in enumerate(cols):
            svg.cell(x + k * cw, y + r * ch, cw + 0.3, ch + 0.3, diverging(row[c]))
    svg.rect(x, y, w, h, fill="none", stroke=C["muted"], sw=1, rx=0)
    if labels:
        for r, name in enumerate(CHANNELS):
            svg.text(x - 4, y + (r + 0.5) * ch, name, size=8.5, anchor="end", fill=C["muted"])
    svg.text(x, y + h + 11, "frame 1", size=10, fill=C["muted"])
    svg.text(x + w, y + h + 11, "60", size=10, anchor="end", fill=C["muted"])


def fmt3(v):
    return "(%.2f, %.2f, %.2f)" % tuple(v)


def figure_io(S):
    red, blue = S["objects"]["o024"], S["objects"]["o025"]
    launch = S["launch"]["linear_velocity"]
    svg = Svg(900, 470)
    # Column 1: the manifest as rows.
    svg.rect(0, 0, 268, 34, fill=C["panel"])
    svg.text(134, 17, "Scene graph: 27 object rows", size=14, anchor="middle", weight="bold")
    rows = [("red ball", C["red"]), ("blue ball", C["ball_blue"]), ("gray barrier, static", C["barrier"]), ("brown table", C["table"]), ("gray floor, static", C["floor"])]
    for i, (label, color) in enumerate(rows):
        y = 44 + i * 30
        svg.rect(0, y, 268, 26, stroke=C["red"] if i == 0 else C["border"], sw=1.6 if i == 0 else 1.2, rx=4)
        svg.cell(8, y + 6, 14, 14, color)
        svg.text(30, y + 13, label, size=12.5)
        left = 150
        for g, count in enumerate((8, 9, 6, 21, 14, 9, 6, 3)):
            width = 112 * count / 76
            svg.cell(left, y + 8, width - 1.5, 10, "#8a94a3" if g % 2 == 0 else "#c5ccd6")
            left += width
    svg.rect(0, 194, 268, 24, fill=C["panel"], rx=4)
    svg.text(134, 206, "... 22 more rows", size=12, anchor="middle", fill=C["muted"])
    svg.text(0, 232, "each row: 76 numbers + 3 ids", size=11.5, fill=C["muted"])
    svg.rect(0, 246, 268, 206, stroke=C["red"], sw=1.6)
    svg.text(10, 264, "The red ball's row", size=12.5, weight="bold")
    svg.lines(10, 288, ["position   %5.2f %5.2f %5.2f m" % tuple(red["start_position"]),
                        "velocity   %5.2f %5.2f %5.2f m/s" % tuple(launch),
                        "radius %.2f m    mass %.1f kg" % (red["radius_m"], red["mass_kg"]),
                        "friction %.1f     restitution %g" % (red["friction"], red["restitution"]),
                        "damping %.2f / %.2f" % (red["linear_damping"], red["angular_damping"]),
                        "inertia %.4f kg m2 (x3)" % red["inertia_diag_kg_m2"][0],
                        "ids  ball | red | sphere",
                        "... 76 numbers + 3 ids in all"], size=11.5, step=20, mono=True)
    svg.arrow(272, 120, 294, 120)
    # Column 2: tokens.
    tx, tw = 298, 160
    svg.rect(tx, 0, tw, 34, fill=C["panel"])
    svg.text(tx + tw / 2, 17, "29 tokens", size=14, anchor="middle", weight="bold")
    for i, (label, color) in enumerate(rows[:5] + [("...", None)]):
        y = 44 + i * 30
        svg.rect(tx, y, tw, 26, stroke=color or C["border"], sw=1.5 if color else 1.2, rx=4)
        svg.text(tx + tw / 2, y + 13, label.replace(", static", ""), size=12.5, anchor="middle")
    svg.text(tx + tw / 2, 236, "27 object tokens", size=11.5, anchor="middle", fill=C["muted"])
    svg.rect(tx, 250, tw, 58, fill=C["amber_fill"], stroke=C["amber"], sw=1.5)
    svg.text(tx + tw / 2, 266, "action token", size=12.5, anchor="middle", weight="bold")
    svg.lines(tx + tw / 2, 284, ["launch the red ball at", "%s m/s" % fmt3(launch)], size=11, step=15, anchor="middle")
    svg.rect(tx, 318, tw, 56, fill=C["panel"])
    svg.text(tx + tw / 2, 334, "global token", size=12.5, anchor="middle", weight="bold")
    svg.lines(tx + tw / 2, 352, ["gravity 9.81 m/s2", "timestep 1/1920 s"], size=11, step=15, anchor="middle")
    svg.lines(tx + tw / 2, 402, ["each row becomes one token:", "76 numbers + 3 ids", "-> one vector of 512 numbers"], size=11, step=16, anchor="middle", fill=C["muted"])
    svg.arrow(462, 120, 486, 120)
    # Column 3: the network.
    svg.rect(488, 50, 124, 140, fill=C["blue_fill"], stroke=C["blue"], sw=1.6)
    svg.text(550, 78, "Transformer", size=13.5, anchor="middle", weight="bold", fill=C["blue"])
    svg.lines(550, 104, ["12 blocks, 512 wide", "every token", "attends to", "every other"], size=11.5, step=17, anchor="middle")
    svg.arrow(616, 120, 638, 120)
    # Column 4: the output tensor.
    svg.rect(640, 0, 260, 34, fill="#fff", stroke=C["blue"], sw=1.6)
    svg.text(770, 17, "Output: 18 x 60 x 15 numbers", size=14, anchor="middle", weight="bold")
    movable = S["movable_object_ids"]
    gx, gy, gw, gh = 686, 44, 204, 180
    cw, ch = gw / 60, gh / len(movable)
    svg.rect(gx, gy, gw, gh, fill="#fff", stroke=C["muted"], sw=1, rx=0)
    for r in range(1, len(movable)):
        svg.line(gx, gy + r * ch, gx + gw, gy + r * ch, stroke=C["grid"], sw=0.6)
    peak = 0.
    for oid in ("o024", "o025"):
        ball = S["objects"][oid]
        peak = max(peak, max(math.dist(p, ball["position"][0]) for p in ball["position"]))
    tints = {"o024": (215, 38, 61), "o025": (74, 111, 165)}
    for oid in ("o024", "o025"):
        ball = S["objects"][oid]
        r = movable.index(oid)
        for t in range(1, 61):
            d = math.dist(ball["position"][t], ball["position"][0]) / peak
            rgb = tuple(int(round(255 + (c - 255) * (0.15 + 0.85 * d))) if d > 0.005 else 255 for c in tints[oid])
            svg.cell(gx + (t - 1) * cw, gy + r * ch, cw + 0.3, ch, "#%02x%02x%02x" % rgb)
        svg.text(gx - 4, gy + (r + 0.5) * ch, ball["label"], size=9.5, anchor="end", fill=C["red"] if oid == "o024" else C["ball_blue"])
    svg.text(gx, gy + gh + 12, "frame 1", size=10, fill=C["muted"])
    svg.text(gx + gw, gy + gh + 12, "60", size=10, anchor="end", fill=C["muted"])
    svg.text(gx + gw / 2, gy + gh + 12, "60 frames (2 s)", size=10, anchor="middle", fill=C["muted"])
    svg.text(652, gy + gh / 2, "18 movable objects", size=10, anchor="middle", fill=C["muted"], rotate=-90)
    svg.lines(640, 258, ["15 numbers per cell: displacement 3,", "orientation 6, velocity 3, spin 3",
                         "shade = distance moved; 16 of 18 rows", "stay empty: nothing moved those objects"], size=11, step=15, fill=C["muted"])
    r30, b30 = red["position"][30], blue["position"][30]
    speed = math.sqrt(sum(v * v for v in red["linear_velocity"][30]))
    svg.rect(640, 318, 260, 134, stroke=C["blue"], sw=1.6)
    svg.text(650, 336, "decoded, frame 30 (t = 1.0 s)", size=12.5, weight="bold")
    svg.lines(650, 360, ["red ball  %s m" % fmt3(r30), "          speed %.2f m/s" % speed, "blue ball %s m" % fmt3(b30),
                         "", "written as frames[] JSON,", "the format the evaluator reads"], size=11.5, step=17, mono=True)
    return svg.render("Input and output of the world model on the sample task")


def figure_training(S):
    red = S["objects"]["o024"]
    block = channel_block(red)
    import random
    rng = random.Random(0)
    noise = [[rng.gauss(0, 1) for _ in range(60)] for _ in range(15)]
    tau = 0.5
    mix = [[(1 - tau) * noise[c][t] + tau * block[c][t] for t in range(60)] for c in range(15)]
    svg = Svg(900, 470)
    svg.text(130, 14, "x1: the truth, from PhysX", size=13, anchor="middle", weight="bold")
    heatmap(svg, 40, 26, 180, 128, block, labels=True)
    svg.text(130, 176, "the red ball's 15 channels over 60 frames", size=10.5, anchor="middle", fill=C["muted"])
    svg.text(130, 206, "x0: noise", size=13, anchor="middle", weight="bold")
    heatmap(svg, 40, 218, 180, 128, noise, labels=True)
    svg.text(130, 368, "drawn from N(0, 1), same shape", size=10.5, anchor="middle", fill=C["muted"])
    svg.text(420, 92, "x_tau: the mix", size=13, anchor="middle", weight="bold")
    heatmap(svg, 330, 104, 180, 128, mix)
    svg.text(420, 254, "x_tau = (1 - tau) x0 + tau x1", size=11, anchor="middle", mono=True)
    svg.text(420, 272, "tau is drawn at random every step; here 0.5", size=10.5, anchor="middle", fill=C["muted"])
    svg.path("M224,90 C280,90 290,168 326,168", C["muted"], arrow=True)
    svg.path("M224,282 C280,282 290,168 326,168", C["muted"], arrow=True)
    svg.text(228, 78, "x tau", size=11, fill=C["muted"], mono=True)
    svg.text(228, 296, "x (1 - tau)", size=11, fill=C["muted"], mono=True)
    svg.arrow(514, 168, 538, 168)
    svg.rect(540, 108, 118, 120, fill=C["blue_fill"], stroke=C["blue"], sw=1.6)
    svg.text(599, 134, "the same", size=13, anchor="middle", weight="bold", fill=C["blue"])
    svg.text(599, 152, "transformer", size=13, anchor="middle", weight="bold", fill=C["blue"])
    svg.lines(599, 178, ["reads x_tau, tau", "and the 29 tokens"], size=11, step=16, anchor="middle")
    svg.arrow(662, 168, 686, 168)
    svg.rect(688, 108, 212, 120, stroke=C["blue"], sw=1.6)
    svg.text(794, 134, "u_hat", size=13, anchor="middle", weight="bold", fill=C["blue"])
    svg.lines(794, 160, ["the predicted direction", "from the noise sample", "to the truth", "(same shape as x1)"], size=11.5, step=17, anchor="middle")
    svg.rect(540, 262, 360, 76, fill=C["red_fill"], stroke=C["red"], sw=1.6)
    svg.text(720, 284, "loss = mean of  w (u_hat - (x1 - x0))^2", size=13.5, anchor="middle", weight="bold", mono=True)
    svg.lines(720, 306, ["x1 - x0 is the true direction from the noise sample to the truth;", "w = 1 if the object moves in the truth, 0.1 if it stays still"],
              size=10.5, step=15, anchor="middle", fill=C["muted"])
    svg.lines(540, 358, ["Prediction: start from a fresh noise sample and", "take 32 small steps along u_hat.",
                         "Variant A, the control: the same network, no noise,", "one pass, squared error on x1.",
                         "Two small extra terms keep positions consistent", "with velocities and predict first contacts."],
              size=11.5, step=16, fill=C["text"])
    svg.lines(40, 398, ["channels: dx dy dz = how far it moved; r1..r6 = orientation;", "vx vy vz = velocity; wx wy wz = spin.",
                        "red = positive, blue = negative, after the design's normalisation."], size=10.5, step=15, fill=C["muted"])
    return svg.render("How the world model is trained: flow matching on the stored PhysX trajectory")


def figure_step(S):
    red = S["objects"]["o024"]
    p15, p16 = red["position"][15], red["position"][16]
    v15, v16 = red["linear_velocity"][15], red["linear_velocity"][16]
    move = [b - a for a, b in zip(p15, p16)]
    svg = Svg(900, 300)
    boxes = [(0, 212, "State at frame t", C["panel"], C["border"], ["object tokens rebuilt from", "the current poses and velocities", "(plus the last 4 frames)", "", "pairwise geometry recomputed", "from the current poses"]),
             (242, 150, "the same transformer", C["blue_fill"], C["blue"], ["about 30 tokens", "per pass"]),
             (420, 226, "Change over one frame", "#fff", C["blue"], ["(1/30 s) position change (3),", "rotation change (3, axis-angle),", "new velocity (3), new spin (3)"]),
             (668, 232, "Integrate and repeat", "#fff", C["blue"], ["pose(t+1) = pose(t) + change", "the new state is the next input", "60 passes, then write frames[]", "edit any state and continue"])]
    for x, w, title, fill, stroke, body in boxes:
        svg.rect(x, 16, w, 184, fill=fill, stroke=stroke, sw=1.6)
        svg.text(x + w / 2, 38, title, size=13, anchor="middle", weight="bold", fill=C["blue"] if stroke == C["blue"] else C["text"])
        svg.lines(x + w / 2, 64, body, size=11.5, step=17, anchor="middle")
    svg.lines(420 + 113, 128, ["frame 15 -> 16, red ball:", "moves (%+.3f, %+.3f, %+.3f) m" % tuple(move),
                              "velocity %s" % fmt3(v15), "      -> %s m/s" % fmt3(v16)], size=11, step=16, anchor="middle", mono=True)
    for x0, x1 in ((216, 238), (396, 416), (650, 664)):
        svg.arrow(x0, 108, x1, 108)
    svg.path("M784,202 L784,232 L106,232 L106,206", C["text"], sw=1.6, arrow=True)
    svg.text(446, 246, "repeat for t = 0 ... 59", size=12, anchor="middle", fill=C["text"])
    svg.text(450, 276, "Training: teacher forcing on stored PhysX transitions; noise on the input state and an 8-step unrolled loss keep errors from piling up.",
             size=11.5, anchor="middle", fill=C["muted"])
    return svg.render("Variant D: the autoregressive next-state predictor")


def figure_bidirectional():
    """One token set (scene, properties, action, motion) under four masks, one network, and how each family answers."""
    import random
    svg = Svg(900, 516)
    TOK, GAP = 22, 4
    SX, PX, AX, YX = 160, 256, 360, 410                     # left edges of the scene, property, action and motion tokens
    groups = [("scene  G∖P", SX, 3, 0), ("properties  P", PX, 3, 6), ("action  a", AX, 1, 10), ("motion  Y: 3 s in 10 chunks", YX, 10, 0)]
    # three speckle patterns for hidden tokens (noise), so neighbouring tokens do not look identical
    defs = ["<defs>"]
    for k in range(3):
        rnd = random.Random(31 + k)
        cells = "".join('<rect x="%d" y="%d" width="3" height="3" fill="%s"/>' % (3 * (i % 8), 3 * (i // 8), rnd.choice(["#8a94a3", "#b4bcc7", "#d5dbe3", "#eef1f4", "#ffffff"]))
                        for i in range(64))
        defs.append('<pattern id="noise%d" width="24" height="24" patternUnits="userSpaceOnUse">%s</pattern>' % (k, cells))
    defs.append("</defs>")
    svg.parts.append("".join(defs))

    for title, x, n, pad in groups:
        w = n * TOK + (n - 1) * GAP
        svg.rect(x - 4 - pad, 0, w + 8 + 2 * pad, 26, fill=C["panel"], rx=4)
        svg.text(x + w / 2, 13, title, size=11, anchor="middle", weight="bold")
    svg.rect(0, 0, 150, 26, fill=C["panel"], rx=4)
    svg.text(75, 13, "question", size=11, anchor="middle", weight="bold")
    svg.rect(690, 0, 210, 26, fill=C["panel"], rx=4)
    svg.text(795, 13, "the model returns", size=11, anchor="middle", weight="bold")

    def token(x, y, kind, hidden, label, seed):
        if hidden:
            svg.parts.append('<rect x="%g" y="%g" width="%d" height="%d" rx="3" fill="url(#noise%d)" stroke="%s" stroke-width="1.4" stroke-dasharray="3 2"/>'
                             % (x, y, TOK, TOK, seed % 3, C["muted"]))
            return
        fill, stroke = {"scene": (C["panel"], C["border"]), "prop": (C["amber_fill"], C["amber"]), "act": (C["red_fill"], C["red"]),
                        "motion": (C["blue_fill"], C["blue"])}[kind]
        svg.rect(x, y, TOK, TOK, fill=fill, stroke=stroke, sw=1.4, rx=3)
        if kind == "scene":
            if label == "floor":
                svg.line(x + 4, y + 15, x + 18, y + 15, stroke=C["muted"], sw=2)
            else:
                svg.cell(x + 5, y + 5, 12, 12, C["red"] if label == "red" else C["ball_blue"])
        elif kind == "motion":
            pts = []
            for s in range(7):          # a piece of a decaying bounce, one chunk per token
                u = (label + s / 6.0) / 10.0
                z = abs(math.cos(3.4 * math.pi * u)) * math.exp(-3.2 * u)
                pts.append("%.1f,%.1f" % (x + 3 + 16 * s / 6.0, y + 18 - 13 * z))
            svg.parts.append('<polyline points="%s" fill="none" stroke="%s" stroke-width="1.6"/>' % (" ".join(pts), C["blue"]))
        else:
            svg.text(x + TOK / 2, y + TOK / 2 + 1, label, size=13, anchor="middle", weight="bold", fill=C["text"])

    rows = [
        ("Forward", "predict the motion", dict(Y="all"), "Y ~ p(Y | G, P, a)", "what the simulator answers"),
        ("Backward", "infer the properties", dict(P=True), "P ~ p(P | Y, a, G∖P)", "which mass, friction, bounce?"),
        ("Backward", "infer the action", dict(a=True), "a ~ p(a | Y, P, G∖P)", "which push made this motion?"),
        ("Both at once", "infer and continue", dict(P=True, Y="late"), "P, Y₄…₁₀ ~ p(· | Y₁…₃, a, G∖P)", "unknown properties: what next?"),
    ]
    seed = 0
    for r, (name, sub, hid, eq, gloss) in enumerate(rows):
        y = 40 + r * 50
        cy = y + TOK / 2
        svg.text(0, cy - 8, name, size=13, weight="bold")
        svg.text(0, cy + 9, sub, size=11.5, fill=C["muted"])
        for j, lab in enumerate(("floor", "red", "blue")):
            token(SX + j * (TOK + GAP), y, "scene", False, lab, 0)
        for j, lab in enumerate(("e", "μ", "m")):
            seed += 1
            token(PX + j * (TOK + GAP), y, "prop", hid.get("P", False), lab, seed)
        seed += 1
        token(AX, y, "act", hid.get("a", False), "a", seed)
        for j in range(10):
            seed += 1
            hidden = hid.get("Y") == "all" or (hid.get("Y") == "late" and j >= 3)
            token(YX + j * (TOK + GAP), y, "motion", hidden, j, seed)
        if hid.get("Y") == "late":
            svg.text(YX + 1.5 * (TOK + GAP) - 2, y + TOK + 9, "first 0.9 s seen", size=9.5, anchor="middle", fill=C["muted"])
        svg.arrow(670, cy, 688, cy)
        svg.text(694, cy - 8, eq, size=11.5, weight="bold", fill=C["blue"])
        svg.text(694, cy + 9, gloss, size=11, fill=C["muted"])

    # the shared network
    svg.rect(SX, 244, 666 - SX, 46, fill=C["blue_fill"], stroke=C["blue"], sw=1.6)
    svg.text((SX + 666) / 2, 259, "the same network answers every row:  vθ(Xσ, σ, m, G∖P)", size=12.5, anchor="middle", weight="bold", fill=C["blue"])
    svg.text((SX + 666) / 2, 277, "one transformer over all tokens; the mask m marks the hidden ones", size=11.5, anchor="middle")
    svg.lines(0, 246, ["training: a random mask", "per example (motion 60%,", "properties 20%, action", "10%, a mix 10%)"], size=11, step=14, fill=C["muted"])
    svg.rect(694, 250, 13, 13, fill=C["blue_fill"], stroke=C["blue"], sw=1.2, rx=2)
    svg.text(712, 257, "given: clean, held fixed", size=11)
    svg.parts.append('<rect x="694" y="272" width="13" height="13" rx="2" fill="url(#noise0)" stroke="%s" stroke-width="1.2" stroke-dasharray="3 2"/>' % C["muted"])
    svg.text(712, 279, "hidden: starts as noise and", size=11)
    svg.text(712, 293, "is filled in by the model", size=11)

    # how each family answers
    cards = [
        ("Regression  (objective 1)", "#55606e", [
            "Forward: one pass, Ŷ = fθ(G, P, a).",
            "Backward: no sampler of its own. Search",
            "through fθ (score candidates, or gradient",
            "steps on P: WM-G1), or train a second",
            "network P̂ = gφ(Y, a, G∖P).",
            "One answer: the average of every value",
            "the motion allows, even when they differ."]),
        ("Flow matching  (objective 2)", C["blue"], [
            "Hidden tokens start as noise at σ = 1;",
            "32 to 50 Euler steps along vθ reach σ = 0.",
            "Given tokens stay clean (WM-G2).",
            "Each noise draw is one sample: a property",
            "the motion settles comes back as a tight",
            "cluster, one it does not as a spread, and",
            "the spread carries into what is predicted."]),
        ("Diffusion  (objective 3)", C["blue"], [
            "The same masking with a noise, clean-",
            "target or v prediction, and DDIM or",
            "stochastic steps. Answers come from",
            "the same distribution as flow matching,",
            "usually after more steps. Chained over",
            "0.2 s blocks, only the clean-target and v",
            "forms train (section 4)."]),
    ]
    for k, (title, color, body) in enumerate(cards):
        x = k * 304
        svg.rect(x, 318, 292, 192, stroke=color, sw=1.6)
        svg.text(x + 12, 338, title, size=13, weight="bold", fill=color)
        svg.lines(x + 12, 362, body, size=11.5, step=20)
    return svg.render("One model, both directions: the same tokens under four masks, the shared network, and how each family answers")


def main():
    S = load_sample()
    OUT.mkdir(parents=True, exist_ok=True)
    for name, text in (("web_io", figure_io(S)), ("web_training", figure_training(S)), ("web_step", figure_step(S)),
                       ("web_bidirectional", figure_bidirectional())):
        (OUT / (name + ".svg")).write_text(text, encoding="utf-8")
        print("wrote %s (%d bytes)" % (OUT / (name + ".svg"), len(text.encode("utf-8"))))
    return 0


if __name__ == "__main__":
    sys.exit(main())
