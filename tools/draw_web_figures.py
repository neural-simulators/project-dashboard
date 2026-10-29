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
    """One token set (scene, properties, action, motion) under five masks, one network, and how each family answers."""
    import random
    svg = Svg(900, 586)
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
        ("Backwards in time", "from the end state", dict(P=True, Y="early"), "P, Y₁…₉ ~ p(· | Y₁₀, a, G∖P)", "which histories end here?"),
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
            hidden = hid.get("Y") == "all" or (hid.get("Y") == "late" and j >= 3) or (hid.get("Y") == "early" and j < 9)
            token(YX + j * (TOK + GAP), y, "motion", hidden, j, seed)
        if hid.get("Y") == "late":
            svg.text(YX + 1.5 * (TOK + GAP) - 2, y + TOK + 9, "first 0.9 s seen", size=9.5, anchor="middle", fill=C["muted"])
        if hid.get("Y") == "early":
            svg.text(YX + 10 * (TOK + GAP) - GAP, y + TOK + 9, "last 0.3 s seen: the end state", size=9.5, anchor="end", fill=C["muted"])
        svg.arrow(670, cy, 688, cy)
        svg.text(694, cy - 8, eq, size=11.5, weight="bold", fill=C["blue"])
        svg.text(694, cy + 9, gloss, size=11, fill=C["muted"])

    # the shared network
    svg.rect(SX, 294, 666 - SX, 46, fill=C["blue_fill"], stroke=C["blue"], sw=1.6)
    svg.text((SX + 666) / 2, 309, "the same network answers every row:  vθ(Xσ, σ, m, G∖P)", size=12.5, anchor="middle", weight="bold", fill=C["blue"])
    svg.text((SX + 666) / 2, 327, "one transformer over all tokens; the mask m marks the hidden ones", size=11.5, anchor="middle")
    svg.text(450, 358, "Diffusion Forcing's per-chunk noise levels (objective 4) let the hidden chunks be cleaned in any order:", size=11, anchor="middle", fill=C["muted"])
    svg.text(450, 372, "forward from a known beginning (row 4), or backward from a known end (row 5).", size=11, anchor="middle", fill=C["muted"])
    svg.lines(0, 296, ["training: a random mask", "per example (motion 60%,", "properties 20%, action", "10%, a mix 10%)"], size=11, step=14, fill=C["muted"])
    svg.rect(694, 300, 13, 13, fill=C["blue_fill"], stroke=C["blue"], sw=1.2, rx=2)
    svg.text(712, 307, "given: clean, held fixed", size=11)
    svg.parts.append('<rect x="694" y="322" width="13" height="13" rx="2" fill="url(#noise0)" stroke="%s" stroke-width="1.2" stroke-dasharray="3 2"/>' % C["muted"])
    svg.text(712, 329, "hidden: starts as noise and", size=11)
    svg.text(712, 343, "is filled in by the model", size=11)

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
        svg.rect(x, 388, 292, 192, stroke=color, sw=1.6)
        svg.text(x + 12, 408, title, size=13, weight="bold", fill=color)
        svg.lines(x + 12, 432, body, size=11.5, step=20)
    return svg.render("One model, both directions: the same tokens under five masks, the shared network, and how each family answers")


# ---------- capability figures (section 18 of the World model tab): data, the model as it is, the questions, what to build ----------
def _dashed_rect(svg, x, y, w, h, stroke, rx=6, sw=1.4, fill="none"):
    svg.parts.append('<rect x="%g" y="%g" width="%g" height="%g" rx="%g" fill="%s" stroke="%s" stroke-width="%g" stroke-dasharray="5 3"/>'
                     % (x, y, w, h, rx, fill, stroke, sw))


def _box(svg, x, y, w, h, title, body, fill="#fff", stroke=None, tsize=12.5, bsize=11, step=15, tcolor=None, dashed=False):
    if dashed:
        _dashed_rect(svg, x, y, w, h, stroke or C["border"], fill=fill)
    else:
        svg.rect(x, y, w, h, fill=fill, stroke=stroke or C["border"], sw=1.4)
    if title:
        svg.text(x + 10, y + 16, title, size=tsize, weight="bold", fill=tcolor or C["text"])
    if body:
        svg.lines(x + 10, y + (36 if title else 16), body, size=bsize, step=step)


def _chip(svg, x, y, text, color, fill):
    w = int(6.3 * len(text)) + 14
    svg.rect(x, y, w, 18, fill=fill, stroke=color, sw=1.2, rx=9)
    svg.text(x + w / 2, y + 9, text, size=10.5, anchor="middle", weight="bold", fill=color)
    return w


AMBER_TEXT = "#8a5a00"


def figure_cap_data():
    """What one stored simulation contains, at what time resolution, and what the next data round adds."""
    svg = Svg(900, 455)
    grey, blue, amber = C["muted"], C["blue"], C["amber"]
    _box(svg, 0, 0, 250, 112, "One scene (stored)", [
        "objects: shape and parts, size, mass,", "friction, restitution, inertia, pose",
        "joints: pendulum hinges, spring plungers", "floor friction and restitution", "12 tasks with success rules"])
    _box(svg, 0, 124, 250, 104, "Actions (stored): all at t = 0", [
        "place, drop, throw, push, spin, strike,", "swing, compress, poke, pull (force, duration)",
        "up to two at once, on different objects"], stroke=C["red"])
    svg.text(10, 212, "no action anywhere starts after t = 0", size=11, weight="bold", fill=C["red"])
    X0, X1, Y = 290, 630, 34
    svg.text(X0, 12, "One simulation (stored): 3 s, 91 frames", size=12.5, weight="bold")
    svg.line(X0, Y, X1, Y, sw=1.5)
    for k in range(4):
        x = X0 + (X1 - X0) * k / 3
        svg.line(x, Y - 4, x, Y + 4)
        svg.text(x, Y + 15, "%d s" % k, size=10.5, anchor="middle", fill=grey)
    for f in range(91):
        x = X0 + (X1 - X0) * f / 90
        svg.line(x, Y - 2, x, Y + 2, stroke=C["grid"], sw=0.8)

    def t2x(t):
        return X0 + (X1 - X0) * t / 3.

    def row(y, label, desc, color=None):
        svg.text(X0, y, label, size=11, weight="bold", fill=color or C["text"])
        svg.text(X0, y + 29, desc, size=10, fill=grey)

    y = 66
    row(y, "states: position, rotation, velocity, spin", "every object, every frame")
    svg.rect(X0, y + 8, X1 - X0, 10, fill=C["blue_fill"], stroke=blue, sw=1, rx=2)
    y = 112
    row(y, "touching pairs, per frame", "object with object; contact with the floor is not recorded")
    for f in list(range(13, 31)) + list(range(41, 49)) + list(range(60, 91)):
        x = X0 + (X1 - X0) * f / 90
        svg.cell(x - 1.2, y + 8, 2.4, 10, blue)
    y = 158
    row(y, "contact episodes", "start and end at 1/1920 s, the pair's ids")
    for t0, t1 in ((0.41, 0.98), (1.37, 1.61), (2.0, 3.0)):
        svg.rect(t2x(t0), y + 8, t2x(t1) - t2x(t0), 10, fill=C["blue_fill"], stroke=blue, sw=1.2, rx=2)
    svg.text(t2x(0.41) - 3, y + 13, "0.41 s", size=9.5, anchor="end", fill=blue)
    y = 204
    row(y, "task verdicts", "success or fail for each of the scene's tasks")
    for k, (lab, col) in enumerate((("drop: yes", "#2f9e44"), ("topple: no", C["red"]), ("hit: yes", "#2f9e44"))):
        svg.rect(X0 + k * 100, y + 7, 92, 14, fill="#fff", stroke=col, sw=1.2, rx=3)
        svg.text(X0 + k * 100 + 46, y + 14, lab, size=9.5, anchor="middle", fill=col)
    y = 250
    row(y, "events: landing, topple, slide start or stop, at rest", "computed from the states afterwards, with thresholds; not stored", color=grey)
    for t in (0.43, 1.37, 1.9, 2.6):
        _dashed_rect(svg, t2x(t) - 5, y + 7, 10, 12, grey, rx=2)
    svg.text(X0, y + 52, "contact timing between objects is exact in the data; every other event is derived", size=10.5, fill=C["text"])
    RX = 660
    svg.text(RX, 12, "Simulations per scene: about 580", size=12.5, weight="bold")
    svg.text(RX, 28, "(40 training scenes sampled)", size=10.5, fill=grey)
    rows = [("random actions", 41), ("refined by search", 31), ("action sweeps", 11), ("attribute sweeps", 7),
            ("free actions", 6), ("aimed collisions", 3), ("object removed", 0.4)]
    for k, (lab, pct) in enumerate(rows):
        yy = 46 + k * 22
        svg.text(RX, yy + 7, lab, size=10.5)
        svg.rect(RX + 112, yy, max(2, pct * 2.4), 14, fill=C["blue_fill"], stroke=blue, sw=1, rx=2)
        svg.text(RX + 116 + max(2, pct * 2.4), yy + 7, ("%g%%" % pct), size=10, fill=grey)
    svg.lines(RX, 212, ["attribute sweeps: one object's mass,", "friction or restitution at 7 values",
                        "(the counterfactual training signal)"], size=10.5, step=14, fill=C["text"])
    svg.lines(RX, 262, ["restarts from a mid-motion state exist only", "in the rubble brace / let-go set and V7's",
                        "engine continuations, with no new action"], size=10.5, step=14, fill=grey)
    _box(svg, 0, 335, 900, 110, "What the next data round adds (not in any stored record today)", None,
         fill=C["amber_fill"], stroke=C["amber"], tcolor=AMBER_TEXT)
    cols = [["actions that start at t > 0", "a start time on the action token;", "the engine applies it mid-rollout"],
            ["event records", "type, time, objects, evidence,", "written by the engine, not derived"],
            ["written descriptions", "what happened, in words, per", "simulation (templates, then free text)"]]
    for k, body in enumerate(cols):
        x = 10 + k * 300
        svg.text(x, 371, body[0], size=12, weight="bold", fill=AMBER_TEXT)
        svg.lines(x, 391, body[1:], size=11, step=15)
    return svg.render("What one stored simulation contains, how its timing is recorded, and what the next data round adds")


def figure_cap_model():
    """The model as it is: tokens, encoder, block head, built-in motion, rules, the loop over blocks."""
    svg = Svg(900, 470)
    grey, blue, amber = C["muted"], C["blue"], C["amber"]
    svg.rect(0, 20, 215, 150, fill="#fff", stroke=C["border"], sw=1.4)
    svg.text(10, 36, "object tokens, one per object", size=12.5, weight="bold")
    svg.text(10, 56, "pose, velocity, spin", size=11)
    svg.text(10, 72, "size, up to 16 convex parts, surface points", size=11)
    svg.rect(8, 84, 199, 18, fill=C["amber_fill"], stroke=amber, sw=1.2, rx=3)
    svg.text(12, 93, "mass, friction, restitution, inertia", size=11, weight="bold", fill=AMBER_TEXT)
    svg.text(10, 116, "the properties, as plain input numbers", size=10, fill=AMBER_TEXT)
    svg.text(10, 136, "flags: dynamic, jointed, pendulum, spring", size=11)
    svg.text(10, 152, "static ones and the floor too", size=10, fill=grey)
    _box(svg, 0, 182, 215, 48, "action token", ["type, pose, velocity, impulse, force"], bsize=10.5)
    _box(svg, 0, 242, 215, 48, "global token", ["gravity, physics rate, floor material"], bsize=10.5)
    _box(svg, 0, 302, 215, 48, "joint tokens", ["hinge or slider: anchor, axis, stiffness"], bsize=10.5)
    _box(svg, 0, 362, 215, 62, "neighbour geometry, per object", ["gap, contact direction, approach speed,", "time to impact for the 8 nearest objects"], bsize=10.5)
    svg.arrow(219, 149, 244, 149)
    _box(svg, 248, 20, 170, 46, "MLP per token kind", None)
    svg.text(258, 50, "no learned ids: identity is structural", size=10, fill=grey)
    svg.arrow(333, 70, 333, 90)
    _box(svg, 248, 94, 170, 110, "transformer", ["every token attends", "to every other", "(8 to 24 layers,", "23M to 50M parameters)"],
         fill=C["blue_fill"], stroke=blue, tcolor=blue)
    _box(svg, 248, 232, 170, 92, "slot tokens", ["one per movable object", "per 0.2 s block, carrying", "the block's start state", "and time (t, t²)"], bsize=10.5, step=14)
    svg.arrow(333, 228, 333, 208)
    svg.arrow(422, 150, 446, 150)
    _box(svg, 450, 20, 200, 52, "block head", ["8 corners, velocity, spin", "for the 0.2 s block"], bsize=10.5, step=14)
    svg.arrow(550, 76, 550, 96)
    _box(svg, 450, 100, 200, 66, "+ built-in motion", ["free flight at the centre of mass,", "pendulum and spring equations;", "the head predicts the correction"], bsize=10.5, step=14)
    svg.arrow(550, 170, 550, 190)
    _box(svg, 450, 194, 200, 66, "rules (no training)", ["exact floor, no new overlap,", "objects at rest stay until", "something reaches them"], bsize=10.5, step=14)
    svg.arrow(550, 264, 550, 284)
    _box(svg, 450, 288, 200, 48, "state at the end of the block", ["position, rotation, velocity, spin"], fill=C["blue_fill"], stroke=blue, tcolor=blue, bsize=10.5)
    svg.path("M550,340 L550,442 L110,442 L110,174", C["text"], sw=1.6, arrow=True)
    svg.text(330, 456, "the end state is the next start: 15 blocks make 3 s", size=11.5, weight="bold", anchor="middle")
    _box(svg, 680, 20, 220, 48, "hold-still head", ["which objects move at all; the rest are", "held exactly in place"], bsize=10.5, step=13)
    _box(svg, 680, 80, 220, 48, "contact head", ["which pairs touch, frame by frame", "(the only event output today)"], bsize=10.5, step=13)
    _box(svg, 680, 140, 220, 118, "training", ["regression: squared error on each", "block against the engine, moving", "objects weighted 10x; 5 blocks", "chained through its own output;",
                                              "one pass per block, no noise, no", "sampling"], bsize=10.5, step=14)
    _box(svg, 680, 270, 220, 72, "what this cannot do", ["return a set of answers (one pass,", "one answer), or take the end of", "the motion as an input"],
         bsize=10.5, step=14, stroke=amber, tcolor=AMBER_TEXT, fill=C["amber_fill"])
    svg.lines(680, 362, ["time enters only as the fraction of", "the 3 s; events enter only through the",
                         "neighbour gaps and times to impact", "read at the start of each block"], size=10.5, step=14, fill=grey)
    return svg.render("The model as it is: one transformer over object, action, global and joint tokens, predicting 0.2 s blocks in a loop")


def figure_cap_questions():
    """The six questions as given / wanted tokens, how each is answered, and its status."""
    svg = Svg(900, 600)
    grey, blue, amber = C["muted"], C["blue"], C["amber"]
    SX, HX = 178, 482
    for x, t in ((0, "question"), (SX, "given (blue), wanted (amber)"), (HX, "how the model answers it")):
        svg.text(x, 12, t, size=11.5, weight="bold", fill=grey)
    svg.line(0, 24, 900, 24, stroke=C["border"])

    def tok(x, y, label, state, w=22, h=22):
        fill, stroke = {"g": (C["blue_fill"], blue), "w": (C["amber_fill"], amber), "h": ("#f4f5f7", grey)}[state]
        if state == "h":
            _dashed_rect(svg, x, y, w, h, stroke, rx=4, fill=fill)
        else:
            svg.rect(x, y, w, h, fill=fill, stroke=stroke, sw=1.4, rx=4)
        svg.text(x + w / 2, y + h / 2 + 1, label, size=11, anchor="middle", weight="bold", fill=AMBER_TEXT if state == "w" else C["text"])

    def strip(x, y, states, mark=None, plabel="P"):
        labels = ("S", plabel, "a", "s₀")
        for k in range(4):
            tok(x + k * 28, y, labels[k], states[k])
        yx = x + 4 * 28 + 4
        for c in range(10):
            tok(yx + c * 12, y, "", states[4][c], w=11)
        svg.text(yx + 60, y + 32, "motion, 0 to 3 s", size=9.5, anchor="middle", fill=grey)
        tok(yx + 124, y, "sᴛ", states[5])
        if mark is not None:
            mx = yx + mark * 12
            svg.line(mx, y - 6, mx, y + 28, stroke=C["text"], sw=1.2, dash="3 2")
            svg.text(mx, y - 12, "tₖ", size=10, anchor="middle", fill=C["text"])

    rows = [
        (["Forward"], "exists", "gggg" + "w" * 10 + "w", None, "P",
         ["one pass per 0.2 s block, fifteen blocks: the model as it is (head 1)"], None),
        (["Properties from", "a recording"], "to train", "gwgg" + "g" * 10 + "g", None, "P",
         ["the property slots read the recording and the action through attention", "and are filled in: samples with flow matching (a spread where the recording",
          "does not decide), or one value with a squared error; same slot, other loss"], "P is an output slot of the network, not a search"),
        (["Cause from", "start and end"], "to train, priority", "ggwg" + "w" * 10 + "g", None, "P",
         ["properties known; the action token and the fifteen chunks are generated", "together, so each sample is one story that starts at s₀ and ends at sᴛ;",
          "forty samples are the set of causes the end allows; with the action given", "as well, only the motion between the ends comes out"],
         "the collapsed bridge: what happened, and what did it"),
        (["Forward with", "unknown properties"], "to train", "gwgg" + "w" * 10 + "w", None, "P?",
         ["some or all property tokens hidden at random during training, so the", "motion is predicted from the properties seen for such objects, and the hidden",
          "ones are narrowed as the motion unfolds; attribute dropout does this in head 1"], "today no property is ever hidden in training"),
        (["Intervene", "mid-way"], "exists by restart", "gggg" + "g" * 4 + "w" * 6 + "w", 4, "P",
         ["run to tₖ, apply the new action to the predicted state, restart with the", "clock at zero (predict_jobs takes a start state); an action starting at tₖ",
          "inside one rollout needs the motion pilot's timed-intervention data"], "a₂ enters as a new action token at tₖ"),
        (["Counterfactual"], "exists", "gggg" + "w" * 10 + "w", None, "P′",
         ["edit the property numbers or drop an object, run again; attribute sweeps", "and removals are training inputs; with head 2 the answer gets a spread"],
         "P edited, or an object dropped from S"),
    ]
    chip = {"exists": (blue, C["blue_fill"]), "exists by restart": (blue, C["blue_fill"]), "to train": (AMBER_TEXT, C["amber_fill"]), "to train, priority": (AMBER_TEXT, C["amber_fill"])}
    for r, (name, status, states, mark, plabel, how, note) in enumerate(rows):
        y = 40 + r * 94
        if r:
            svg.line(0, y - 10, 900, y - 10, stroke=C["border"], sw=0.8)
        for i, ln in enumerate(name):
            svg.text(0, y + 11 + i * 16, ln, size=12, weight="bold")
        _chip(svg, 0, y + 14 + 16 * len(name), status, *chip[status])
        strip(SX, y + 4, [states[0], states[1], states[2], states[3], states[4:14], states[14]], mark, plabel)
        if note:
            svg.text(SX, y + 56, note, size=9.5, fill=grey)
        svg.lines(HX, y + 8, how, size=10.5, step=14)
    y = 40 + 6 * 94 - 4
    svg.line(0, y, 900, y, stroke=C["border"], sw=0.8)
    svg.text(0, y + 14, "S scene table   P properties   a action   s₀ start state   sᴛ end state.   Blue: given and clamped.   Amber: generated.", size=10.5, fill=grey)
    return svg.render("Six questions to one model: what is given, what is wanted, how each is answered, and whether it exists or is to be trained")


def figure_cap_build():
    """What to build: shared encoder, the regression head with event head and attribute dropout, the masked flow head, the text head."""
    svg = Svg(900, 584)
    grey, blue, amber = C["muted"], C["blue"], C["amber"]
    _box(svg, 0, 30, 190, 250, "Same tokens, same encoder", ["object tokens, action,", "global and joint tokens;", "MLPs; transformer", "",
                                                          "exists; head 2 starts", "from its weights"],
         fill=C["blue_fill"], stroke=blue, tcolor=blue, bsize=10.5, step=15)
    for y in (100, 330, 516):
        svg.path("M194,%d L226,%d" % (160, y), grey, sw=1.4, arrow=True)
    _box(svg, 230, 10, 330, 190, "Head 1: step-wise regression (exists)", [
        "block head + built-in motion + rules; 5-block chains;", "one pass per block",
        "answers: forward, restarts, counterfactual edits"], fill="#fff", stroke=blue, tcolor=blue, bsize=10.5, step=14)
    svg.rect(238, 92, 314, 98, fill=C["amber_fill"], stroke=amber, sw=1.2, rx=5)
    svg.text(246, 106, "add: event head, attribute dropout", size=11, weight="bold", fill=AMBER_TEXT)
    svg.lines(246, 123, ["per block: which event starts (contact, landing,", "topple) and when inside it; feeds the time input and",
                         "splits the block at the impact; attribute dropout:", "a property channel replaced by 'unknown' + a flag"], size=10, step=13.5)
    _box(svg, 230, 212, 330, 236, "Head 2: masked flow matching (to train)", None, fill="#fff", stroke=amber, tcolor=AMBER_TEXT)
    x0, y0 = 244, 242
    for k, (lab, st) in enumerate((("P", "w"), ("P", "g"), ("P", "w"), ("a", "w"))):
        fill, stroke = (C["blue_fill"], blue) if st == "g" else (C["amber_fill"], amber)
        svg.rect(x0 + k * 26, y0, 22, 22, fill=fill, stroke=stroke, sw=1.4, rx=4)
        svg.text(x0 + k * 26 + 11, y0 + 12, lab, size=11, anchor="middle", weight="bold", fill=C["text"] if st == "g" else AMBER_TEXT)
    for c in range(15):
        st = "g" if c == 0 or c == 14 else "w"
        fill, stroke = (C["blue_fill"], blue) if st == "g" else (C["amber_fill"], amber)
        svg.rect(x0 + 112 + c * 12, y0, 11, 22, fill=fill, stroke=stroke, sw=1.2, rx=3)
    svg.text(x0 + 112 + 90, y0 + 32, "Y: 15 chunks of 0.2 s (the cause mask shown)", size=9.5, anchor="middle", fill=grey)
    svg.text(x0, y0 + 32, "per object", size=9.5, fill=grey)
    svg.lines(244, 292, ["new output slots: a property token per movable object",
                         "(9 numbers) and the action token (42), next to the",
                         "motion chunks (90 numbers each)",
                         "every token has its own noise level: given tokens are",
                         "clean and clamped, hidden ones start as noise and are",
                         "denoised together; loss: flow matching on hidden tokens",
                         "masks per example: motion 40%, properties 15%, action",
                         "+ motion with both ends given 15%, some properties +",
                         "motion 15%, mixed 15%",
                         "sampling: 32 to 50 Euler steps; a set = N runs"], size=10, step=13.5)
    _box(svg, 230, 460, 330, 114, "Head 3: text (later)", [
        "projector: slot tokens -> prefix tokens -> small", "pretrained decoder (LoRA) -> one paragraph",
        "ground truth: event extractor + templates first,", "paraphrases and written descriptions later"],
        fill="#fff", stroke=amber, tcolor=AMBER_TEXT, bsize=10.5, step=14, dashed=True)
    _box(svg, 580, 10, 320, 330, "How we will know it works", [
        "forward: error, passing through, events (exists)",
        "",
        "properties: error and 90% coverage on the test",
        "attribute sweeps; wide where nothing in the",
        "recording depends on the property",
        "",
        "cause: re-run every sampled action in PhysX from",
        "s₀ with the true properties and measure the end-",
        "state error; is the true action inside the set;",
        "how wide the set is",
        "",
        "unknown properties: error against the share of",
        "properties hidden, compared with the engine run",
        "with the true values",
        "",
        "interventions: 2,000 PhysX restarts from stored",
        "test states with a second action",
        "",
        "events: first-contact time error, precision and",
        "recall at +-2 frames;  text: precision of its claims"], bsize=10.5, step=14)
    _box(svg, 580, 352, 320, 178, "What new data adds", [
        "actions at t > 0: a start-time channel on the",
        "action token, learned from the motion pilot's",
        "timed-intervention branches instead of restarts",
        "",
        "event records with evidence: targets for the",
        "event head instead of thresholds applied after",
        "",
        "written descriptions: training text for head 3"], fill=C["amber_fill"], stroke=amber, tcolor=AMBER_TEXT, bsize=10.5, step=14)
    return svg.render("What to build: one encoder, the existing regression head with an event head and attribute dropout, a masked flow-matching head, a text head")


def figure_cap_events():
    """What the generator records today, what the planned data round adds, and what is still missing, against what the heads need."""
    svg = Svg(900, 530)
    grey, blue, amber = C["muted"], C["blue"], C["amber"]
    green, red = "#2f9e44", C["red"]
    TX, PX, MX = 250, 510, 750
    for x, t in ((0, "what the heads need"), (TX, "recorded today"), (PX, "planned (dataset expansion plan)"), (MX, "still missing")):
        svg.text(x, 12, t, size=11.5, weight="bold", fill=grey)
    svg.line(0, 24, 900, 24, stroke=C["border"])

    def dot(x, y, state):
        col = {"yes": green, "part": amber, "no": red}[state]
        svg.circle(x, y, 5, col)
        if state == "part":
            svg.parts.append('<path d="M%g,%g a5,5 0 0,1 0,10 z" fill="#fff"/>' % (x, y - 5))

    rows = [
        (["contact start and end", "between objects, exact time"], ("yes", ["episodes at 1/1920 s"]), ("yes", ["kept, as versioned event sidecars"]), ["nothing"]),
        (["contact with the floor"], ("part", ["in 513 of 768 sampled records;", "README says none: audit per source"]), ("yes", ["verified floor and", "environment contacts"]), []),
        (["impact strength and direction"], ("no", ["peak impulse zero in 79% of", "episodes (read at the first report)"]), ("yes", ["impulses across the episode,", "contact points and normals"]), ["fix the impulse read", "in the generator now"]),
        (["landing, lift-off, rest, topple,", "container entry"], ("part", ["derived from states with thresholds", "(topple 45°, fall 0.5 m/s, rest", "0.05 m/s for 0.5 s)"]), ("yes", ["emitted by the generator with", "an evidence contract"]), []),
        (["slide or roll start and stop,", "loss of support"], ("no", ["needs contact points"]), ("yes", ["slipping, spinning, support", "transitions"]), []),
        (["actions that start at t > 0"], ("no", ["none; the engine applies pulls", "substep by substep: mechanism exists"]), ("part", ["motion pilot: factual against", "timed-intervention branches", "(authored previews)"]), ["a start time on the", "action record and", "token; volume"]),
        (["many actions on one start,", "and their end states"], ("yes", ["about 580 simulations per scene"]), ("yes", ["more layouts, ten actions each"]), ["nothing"]),
        (["object names, colours,", "task sentences"], ("yes", ["name, colour, category;", "instructions by language models"]), ("yes", ["kept"]), ["nothing"]),
        (["written descriptions"], ("no", ["none"]), ("part", ["templates that round-trip", "to the event list"]), ["free text: paraphrases,", "then human"]),
        (["horizon, padding, actual end", "of a clip"], ("part", ["n_valid for external clips only"]), ("yes", ["persisted with timestamps", "and hashes"]), []),
    ]
    for r, (need, now, plan, miss) in enumerate(rows):
        y = 40 + r * 46
        if r:
            svg.line(0, y - 9, 900, y - 9, stroke=C["border"], sw=0.7)
        svg.lines(0, y + 6, need, size=10.5, step=13, weight="bold")
        dot(TX + 6, y + 6, now[0]); svg.lines(TX + 18, y + 6, now[1], size=10, step=12.5)
        dot(PX + 6, y + 6, plan[0]); svg.lines(PX + 18, y + 6, plan[1], size=10, step=12.5)
        svg.lines(MX, y + 6, miss, size=10, step=12.5, fill=C["text"] if miss and miss[0] != "nothing" else grey)
    y = 40 + 10 * 46 - 6
    svg.line(0, y, 900, y, stroke=C["border"], sw=0.8)
    dot(6, y + 14, "yes"); svg.text(16, y + 14, "available", size=10.5, fill=grey)
    dot(96, y + 14, "part"); svg.text(106, y + 14, "partly, or derived with thresholds", size=10.5, fill=grey)
    dot(316, y + 14, "no"); svg.text(326, y + 14, "absent", size=10.5, fill=grey)
    return svg.render("What the generator records today, what the planned data round adds, and what is still missing, against what the heads need")


def main():
    S = load_sample()
    OUT.mkdir(parents=True, exist_ok=True)
    for name, text in (("web_io", figure_io(S)), ("web_training", figure_training(S)), ("web_step", figure_step(S)),
                       ("web_bidirectional", figure_bidirectional()), ("web_cap_data", figure_cap_data()),
                       ("web_cap_model", figure_cap_model()), ("web_cap_questions", figure_cap_questions()),
                       ("web_cap_build", figure_cap_build()), ("web_cap_events", figure_cap_events())):
        (OUT / (name + ".svg")).write_text(text, encoding="utf-8")
        print("wrote %s (%d bytes)" % (OUT / (name + ".svg"), len(text.encode("utf-8"))))
    return 0


if __name__ == "__main__":
    sys.exit(main())
