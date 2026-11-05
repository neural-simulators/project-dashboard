#!/usr/bin/env python3
"""Write static/data/masked_anim.js: one real Dataset V2 record for the masked-model animation (Next steps tab).

    OMP_NUM_THREADS=1 ../simagent/.envs/hybrid/bin/python tools/extract_masked_anim.py

The values go through the model's own encoder (simagent/unified/wm/mechanics.py, masked.decode_action_full), so the
properties and the action are what the masked model would be given. The masks come from the model's own masked.masks_from
and given_tool, with one fixed draw of their random choices. Only the PhysX record is stored: no model output.
"""
import hashlib
import json
import sys
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import torch

DASH = Path(__file__).resolve().parents[1]
SIM = DASH.parent / "simagent"
sys.path.insert(0, str(SIM))
from simagent.unified.wm import masked as MK                            # noqa: E402
from simagent.unified.wm import mechanics as MX                         # noqa: E402
from simagent.unified.wm.features import ACTION_TYPES                   # noqa: E402
from simagent.unified.wm.model import PROP_IDX                          # noqa: E402

RECORD = "billiards__r3/a0/factual"
SHARD = "shard00"
ROOT = DASH.parent / "datasets/mechanics_10k_v1"
FPS, PATCH, T = 60, 12, 480                                             # configs/wm/mechanics_v5/masked_oneshot_prior.json
LABELS = {"actor": "Cue ball", "actuator": "Piston"}
QUESTIONS = ("fwd", "prop", "cause", "prefix", "bridge", "unk")         # the six in the curriculum (masked.KINDS without inverse, end)
R_PRE, R_POST, UNK_SLOTS = .33, .395, [0, 3, 5, 6]                      # the draw shown: prefix 2 s; bridge 2 s + 1.6 s; four balls hidden


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def real_masks(enc, rec, K_all):
    """Per question, what masks_from and given_tool hide on this record: motion by body and patch, properties asked for
    (hidden, moved, not the tool, as masked_loss scores them), the action, the end state, whether the physics reference is on."""
    tensor = lambda a, ty: torch.as_tensor(np.array(a), dtype=ty)[None]
    b = {"ctx_mask": tensor(enc["ctx_mask"], torch.bool), "rich": tensor(enc["rich"], torch.float32), "frame_mask": tensor(rec["frame_mask"], torch.bool),
         "slot_mask": tensor(rec["slot_mask"], torch.bool), "frame0": tensor(rec["frame0"], torch.float32), "tool": tensor(rec["tool"], torch.bool),
         "moving": tensor(rec["moving"], torch.bool)}
    cfg = SimpleNamespace(tool_known=True, cause_tool_given=False)
    n, valid = enc["n_dyn"], int(rec["frame_mask"].sum()) // PATCH
    rnd = torch.zeros_like(b["ctx_mask"])
    rnd[0, UNK_SLOTS] = True
    out = {}
    for kind in QUESTIONS:
        mk = MK.masks_from(b, K_all, PATCH, {"k": torch.tensor([MK.KINDS.index(kind)]), "s": torch.ones(1), "r_pre": torch.tensor([R_PRE]),
                                             "r_post": torch.tensor([R_POST]), "rnd": rnd})
        tool_given = MK.given_tool(b, cfg, mk)[0]
        hy = mk["hidden_y"][0][:valid].tolist()
        asked = mk["hidden_p"][0][:n] & b["moving"][0][:n] & ~b["tool"][0][:n]
        reference = bool((~mk["a_hidden"] & ~(mk["hidden_p"] & b["ctx_mask"]).any(1))[0])
        out[kind] = {"y": ["".join("1" if h and not tool_given[i] else "0" for h in hy) for i in range(n)], "p": [int(x) for x in asked.tolist()],
                     "a": bool(mk["a_hidden"][0]), "end": bool(mk["end_given"][0]), "reference": reference}
    return out


def main():
    d = ROOT / SHARD / RECORD
    m, states, times, touching, events, fps_in = MX.read_record(d)
    horizon = float(m["horizon_s"])
    caps = {"m_mov": 48, "n_ctx": 112, "n_joint": 56, "a_max": 3, "n_field": 9, "n_parts": 32}
    enc = MX.encode_scene(m, caps, horizon, FPS)
    rec = MX.encode_record(m, states, times, touching, events, enc, caps, FPS, T, horizon, fps_in)
    n_dyn, ids = enc["n_dyn"], enc["ids"]
    K = int(rec["frame_mask"].sum()) // PATCH
    order = [m["_dyn_ids"].index(i) for i in ids[:n_dyn]]               # states in the encoder's slot order
    S = states[:, order]
    props = np.asarray(enc["rich"][:n_dyn])[:, PROP_IDX]
    objs = {o["id"]: o for o in m["objects"]}
    stride = fps_in // 15
    step = fps_in * PATCH // FPS
    bodies, ball = [], 0
    for i, name in enumerate(ids[:n_dyn]):
        o = objs[name]
        if name not in LABELS:
            ball += 1
        speed = np.linalg.norm(S[1:, i, 7:10], axis=-1)
        bodies.append({"id": name, "label": LABELS.get(name, f"Ball {ball}"), "tool": bool(rec["tool"][i]),
                       "r": float(o["aabb_local_max"][0]), "rgb": o["rgb"],
                       "mass": round(float(np.exp(props[i, 0])), 3), "friction": round(float(props[i, 1]), 3),
                       "restitution": round(float(props[i, 2]), 3),
                       "path": np.round(S[::stride, i, :2], 3).tolist(),
                       "speed": [round(float(speed[k * step:(k + 1) * step].mean()), 3) for k in range(K)]})
    ao = int(rec["act_obj"][0])
    a = torch.tensor(rec["actions"][0], dtype=torch.float32)
    pointer = torch.zeros(caps["m_mov"])
    pointer[ao] = 1
    dec = MK.decode_action_full(torch.cat([a, pointer])[None], act_ch=a.shape[0])
    pay = int(rec["act_payload"][0])
    tool = m["tool_program"]
    kind = lambda e: e.get("kind") or e.get("type")
    hits = [e["time_s"] for e in events if kind(e) == "contact_begin" and "actor" in e["objects"]
            and any(str(x).startswith("target") for x in e["objects"])]
    data = {"record": f"{SHARD}/{RECORD}", "horizon_s": horizon, "patch_s": PATCH / FPS, "K": K, "path_hz": 15,
            "n_objects": len(m["objects"]), "n_joints": len(m.get("joints", [])), "n_fields": int(rec["field_mask"].sum()),
            "bodies": bodies,
            "action": {"type": ACTION_TYPES[int(dec["type"][0])], "semantic": tool["semantic_action"], "object": bodies[ao]["label"], "payload": bodies[pay]["label"],
                       "force_N": round(float(dec["F"][0].norm()), 2), "onset_s": round(float(dec["onset_s"][0]), 2),
                       "end_s": round(float(dec["end_s"][0]), 2)},
            "first_hit_s": round(float(min(hits)), 2), "masks": real_masks(enc, rec, T // PATCH),
            "source": {"scene_sha256": sha(d / "scene.json"), "trajectory_sha256": sha(d / "trajectory.npz"),
                       "masked_py_sha256": sha(SIM / "simagent/unified/wm/masked.py"),
                       "config": "configs/wm/mechanics_v5/masked_oneshot_prior.json"}}
    text = "window.MASKED_ANIM = " + json.dumps(data, separators=(",", ":"), allow_nan=False) + ";\n"
    (DASH / "static/data/masked_anim.js").write_text(text, encoding="utf-8")
    print(len(text), "bytes;", K, "patches;", data["action"], "first hit", data["first_hit_s"])
    for kind, q in data["masks"].items():
        print(kind, q["y"][0], "props", sum(q["p"]), "action", q["a"], "end", q["end"], "reference", q["reference"])


if __name__ == "__main__":
    main()
