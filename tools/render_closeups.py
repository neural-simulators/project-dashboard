#!/usr/bin/env python3
"""Close-up renders of static-edit examples for the benchmark results page (Isaac job).

For each task, the objects the instruction involves (every object moved by the reference answer or by either model, plus the
objects the checks refer to, such as the table a chair must face) define a close-up camera, fitted from the open front side of
the room so that all of them, before and after, stay in the frame. The room is rendered four times from that camera: before
the edit, the reference answer, GPT-5.4's answer and Qwen3-VL-30B Thinking's answer, all posed exactly as submitted.
Writes ``static/images/benchmark/<task>/closeup_{before,truth,gpt54,qwen30t}.jpg`` and ``closeup.json`` (camera, ids).

    sbatch --partition=main --gres=gpu:a5000:1 /path/to/simagent/scripts/isaac_job.sbatch \\
        /path/to/project-dashboard/tools/render_closeups.py --tasks TASK [TASK ...]
"""
import argparse
import copy
import json
import math
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
PROVIDERS = ('gpt54', 'qwen30t')
SKIP_CATEGORIES = {'floor', 'wall', 'back wall', 'left wall', 'right wall', 'front wall', 'ceiling'}


def load(path):
    with open(path, 'r', encoding='utf-8') as handle:
        return json.load(handle)


def posed(manifest, changes):
    """Object records with the submitted positions and orientations applied (absolute replacements, as the evaluator does)."""
    objects = {o['id']: copy.deepcopy(o) for o in manifest['objects']}
    for change in changes or []:
        for field in ('position', 'quaternion_wxyz'):
            if change.get(field) is not None:
                objects[change['id']][field] = list(change[field])
    return objects


def relevant_ids(manifest, spec, change_sets):
    ids = set()
    for changes in change_sets:
        ids |= {c['id'] for c in changes or []}
    for predicate in spec.get('predicates', []):
        for key, value in predicate.items():
            if key.endswith('_id') and isinstance(value, str):
                ids.add(value)
            elif key.endswith('_ids') and isinstance(value, list):
                ids |= {v for v in value if isinstance(v, str)}
    objects = {o['id']: o for o in manifest['objects']}
    return sorted(i for i in ids if i in objects and objects[i].get('category') not in SKIP_CATEGORIES)


def fit_closeup(points, room, width=960, height=720, hfov=50., elevation_deg=55., azimuth_deg=-18.):
    """Camera on the open front side (negative y) looking down at the points; the closest distance that keeps all in view."""
    from simagent.composite_tasks import in_view
    lo = [min(p[j] for p in points) for j in range(3)]
    hi = [max(p[j] for p in points) for j in range(3)]
    target = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2]
    el, az = math.radians(elevation_deg), math.radians(azimuth_deg)
    direction = [math.sin(az) * math.cos(el), -math.cos(az) * math.cos(el), math.sin(el)]  # from target toward the eye
    camera = None
    for step in range(400):
        d = 1.0 + 0.05 * step
        eye = [target[j] + d * direction[j] for j in range(3)]
        camera = {'id': 'closeup', 'eye': eye, 'target': target, 'up': [0, 0, 1], 'width': width, 'height': height, 'hfov': hfov}
        if all(in_view(camera, p, margin=.08) for p in points):
            return camera
    raise ValueError('no close-up camera keeps every relevant object in view')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--simagent-root', type=Path, default=REPO.parent)
    parser.add_argument('--campaign', default='static_v31')
    parser.add_argument('--tasks', nargs='+', required=True)
    parser.add_argument('--out', type=Path, default=REPO / 'static/images/benchmark')
    args, kit_args = parser.parse_known_args()
    sys.argv = [sys.argv[0], *kit_args]
    root = args.simagent_root.resolve()
    sys.path.insert(0, str(root))
    from PIL import Image
    from simagent.benchmark_scenes import freeze
    from simagent.geometry import camera_calibration, world_aabb
    from simagent.isaac_backend import IsaacWorld, close_app
    run = root / 'runs/benchmark_v3' / args.campaign
    for task_id in args.tasks:
        bundle = run / 'public_bundles' / task_id
        manifest = load(bundle / 'scene_manifest.json')
        spec = load(run / 'private_inputs' / (task_id + '.json'))
        states = {'before': [], 'truth': load(run / 'witness' / task_id / 'witness_patch.json')['changes']}
        for provider in PROVIDERS:
            patch = run / 'cases' / task_id / (provider + '__patch') / 'prediction' / 'patch_v2.json'
            states[provider] = load(patch)['changes'] if patch.is_file() else None   # None: no usable answer, nothing to render
        ids = relevant_ids(manifest, spec, [c for c in states.values() if c])
        points = []
        for changes in states.values():
            if changes is None:
                continue
            objects = posed(manifest, changes)
            for key in ids:
                lo, hi = world_aabb(objects[key])
                points += [[(lo, hi)[i][0], (lo, hi)[j][1], (lo, hi)[k][2]] for i in (0, 1) for j in (0, 1) for k in (0, 1)]
        camera = fit_closeup(points, manifest['room_bounds_m'])
        camera['calibration'] = camera_calibration(camera)
        scene = copy.deepcopy(manifest)
        scene['cameras'] = [c for c in scene['cameras'] if c['id'] != 'closeup'] + [camera]
        freeze(scene)  # new snapshot hash, so the cached USD stage is rebuilt with the close-up camera
        out = args.out / task_id
        out.mkdir(parents=True, exist_ok=True)
        with IsaacWorld(scene, render=True) as world:
            for name, changes in states.items():
                if changes is None:
                    continue
                objects = posed(manifest, changes)
                moved = {c['id'] for s in states.values() if s for c in s}
                # every object moved in any state is reset to its pose in this state (the before pose when this answer left it alone)
                world.set_states({key: {'position': objects[key]['position'], 'quaternion_wxyz': objects[key]['quaternion_wxyz']}
                                  for key in moved if manifest_dynamic(manifest, key)})
                rgb = world.render(camera)
                image = Image.fromarray(rgb[..., :3]).convert('RGB').resize((720, 540), Image.LANCZOS)
                image.save(out / ('closeup_%s.jpg' % name), 'JPEG', quality=86, optimize=True)
                print(json.dumps({'task_id': task_id, 'state': name, 'saved': str(out / ('closeup_%s.jpg' % name))}), flush=True)
        with open(out / 'closeup.json', 'w', encoding='utf-8') as handle:
            json.dump({'task_id': task_id, 'relevant_ids': ids, 'camera': {k: camera[k] for k in ('eye', 'target', 'up', 'width', 'height', 'hfov')},
                       'states': {k: (v is not None) for k, v in states.items()},
                       'scope': 'Close-up of the objects the instruction involves; poses exactly as submitted, no settling.'}, handle, indent=1)
    close_app()


def manifest_dynamic(manifest, key):
    return any(o['id'] == key and o['motion_type'] == 'dynamic' for o in manifest['objects'])


if __name__ == '__main__':
    main()
