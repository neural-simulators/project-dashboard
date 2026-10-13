#!/usr/bin/env python3
"""Data for the "How models are prompted" page: real prompts, scene rows and model answers from the simagent campaigns.

Three examples, each answered by GPT-5.4 and Qwen3-VL-30B Thinking under the same prompt:
  static  room 1, "put the orange book between the cups and turn the red chair to face the table" (answer: new poses as JSON)
  code    room 7, "toss the red ball over the gray barrier into the blue open box" (answer: a program that returns the launch)
  numbers the same throw, answered with the launch velocity directly as JSON

For each: the prompt split into its sections (length, a short real excerpt, a minimap of the prompt text), the two images the
model sees, the answers (JSON or program excerpts with line numbers), the simulated outcome (plan-view poses or the ball's
side-view path from the PhysX rollout), the verdict and the token counts. Writes ``static/data/how_it_works.js``
(``window.HW_DATA``) and ``static/images/how_it_works/*.jpg``. Run with the simagent Isaac interpreter (Pillow):

    /path/to/simagent/.envs/isaac/bin/python tools/extract_how_it_works.py [--simagent-root PATH]
"""
import argparse
import json
import math
import os
import re
import textwrap
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
PROVIDERS = {'gpt54': 'GPT-5.4', 'qwen30t': 'Qwen3-VL-30B Thinking'}
EXAMPLES = {
    'static': ('static_v31', 'b2_room_01_book_between_cups_and_face', 'patch'),
    'code': ('hard_v31', 'b2_room_07_lob_over_barrier_into_box', 'code_predict'),
    'numbers': ('launch_v31', 'b2_room_07_lob_over_barrier_into_box', 'launch'),
}
# Program excerpts shown in the animation (1-based inclusive line ranges of the real programs; everything else is elided).
CODE_EXCERPTS = {'gpt54': [(48, 49), (87, 92), (117, 117), (145, 145), (160, 163)],
                 'qwen30t': [(13, 14), (23, 30), (43, 48)]}
SECTION_STYLE = {   # plain label, one-line meaning, colour role
    'TASK': ('Instruction', 'The request in everyday words.', 'instruction'),
    'IMAGES': ('Two rendered views', 'Attached as images (the text-only models get none).', 'images'),
    'SCENE CONVENTIONS': ('Conventions', 'Units, axes and how poses are written.', 'rules'),
    'HOW THE ANSWER IS CHECKED': ('How it is checked', 'Every check and tolerance, stated in advance.', 'checks'),
    'HOW THE INSTRUCTION IS CHECKED': ('How it is checked', 'Every check and tolerance, stated in advance.', 'checks'),
    'DYNAMICS CONVENTIONS': ('Physics rules', 'Time step, gravity, friction and damping conventions.', 'rules'),
    'CONTROLLED OBJECT': ('What may be launched', 'The one object the model controls, and its velocity limits.', 'checks'),
    'ACTION SPACE': ('Action space', 'One launch, a velocity inside the limits; nothing else exists.', 'output'),
    'OUTPUT FORMAT': ('Answer format', 'Exactly what to send back.', 'output'),
    'SCENE JSON': ('The scene as data', 'One row per object: name, pose, size, mass, friction.', 'scene'),
    'TASK JSON': ('Task data', 'The same task in machine form.', 'rules'),
}
PLAN_IDS = ['o006', 'o007', 'o009', 'o010', 'o011', 'o014', 'o005']


def load(path):
    with open(path, 'r', encoding='utf-8') as handle:
        return json.load(handle)


def r3(v):
    return [round(float(x), 3) for x in v]


def split_prompt(text):
    heads = list(re.finditer(r'^([A-Z][A-Z /-]{3,}?)(?: \(.*\))?$', text, re.M))
    sections = []
    for i, m in enumerate(heads):
        end = heads[i + 1].start() if i + 1 < len(heads) else len(text)
        name = m.group(1).strip()
        key = name if name in SECTION_STYLE else next((k for k in sorted(SECTION_STYLE, key=len, reverse=True) if name.startswith(k) and k != 'TASK'), name)
        sections.append({'key': key, 'text': text[m.start():end]})
    return sections


def excerpt(section, scene, focus_ids):
    key, body = section['key'], section['text']
    lines = [l for l in body.split('\n')[1:] if l.strip()]
    if key == 'TASK':
        return [lines[0]]
    if key == 'SCENE JSON':
        rows = []
        for o in scene['objects']:
            if o['id'] in focus_ids:
                g = o.get('geometry', {})
                size = [round(b - a, 2) for a, b in zip(g.get('aabb_local_min', [0, 0, 0]), g.get('aabb_local_max', [0, 0, 0]))]
                row = {'id': o['id'], 'label': o['label'], 'position': r3(o['position']), 'quaternion_wxyz': r3(o['quaternion_wxyz']),
                       'size_m': size, 'mass_kg': o.get('mass_kg'), 'friction': o.get('friction')}
                for extra in ('restitution', 'linear_damping'):
                    if o.get(extra) is not None and key == 'SCENE JSON' and o.get('category') == 'ball':
                        row[extra] = o[extra]
                rows.append(json.dumps(row))
        return rows + ['... and %d more objects, the room size, the support surfaces and the cameras' % (len(scene['objects']) - len(rows))]
    if key == 'TASK JSON':
        task = json.loads(body.split('\n', 1)[1])
        if 'control' in task:
            c = task['control']
            return ['"control": {"selector": %s,' % json.dumps(c['selector']),
                    ' "linear_velocity_bounds": %s,' % json.dumps(c['linear_velocity_bounds']),
                    ' "angular_velocity_bounds": %s}' % json.dumps(c['angular_velocity_bounds'])]
        return ['"allowed_object_ids": [%d movable objects, the target is not revealed]' % len(task.get('allowed_object_ids', []))]
    out = []
    for l in lines:
        out.append(l if len(l) <= 150 else l[:147] + '...')
        if len(out) >= 4:
            break
    return out


def minimap(sections, width=150):
    rows = []
    for index, s in enumerate(sections):
        for line in s['text'].split('\n'):
            for chunk in (textwrap.wrap(line, width) or ['']):
                rows.append([index, len(chunk)])
    return rows


def yaw_and_tilt(q):
    w, x, y, z = q
    fx = 2 * (x * y - w * z); fy = 1 - 2 * (x * x + z * z)       # local +y axis in world (front of chairs and sofas)
    upz = 1 - 2 * (x * x + y * y)                                # local z axis, vertical component
    return math.atan2(fy, fx), math.degrees(math.acos(max(-1., min(1., upz))))


def rotate(q, v):
    w, x, y, z = q
    tx, ty, tz = 2 * (y * v[2] - z * v[1]), 2 * (z * v[0] - x * v[2]), 2 * (x * v[1] - y * v[0])
    return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)]


def hull(points):
    pts = sorted(set((round(a, 4), round(b, 4)) for a, b in points))
    if len(pts) < 3:
        return pts
    def cross(o, a, b): return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    lower, upper = [], []
    for p in pts:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], p) <= 0: lower.pop()
        lower.append(p)
    for p in reversed(pts):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], p) <= 0: upper.pop()
        upper.append(p)
    return lower[:-1] + upper[:-1]


def plan_object(o, pose=None):
    """Floor-plan footprint: the object's rotated box projected onto the floor (a convex polygon in world x, y)."""
    p = (pose or {}).get('position') or o['position']
    q = (pose or {}).get('quaternion_wxyz') or o['quaternion_wxyz']
    g = o['geometry']
    lo, hi = g['aabb_local_min'], g['aabb_local_max']
    corners = [rotate(q, [(lo, hi)[i][0], (lo, hi)[j][1], (lo, hi)[k][2]]) for i in (0, 1) for j in (0, 1) for k in (0, 1)]
    heading, tilt = yaw_and_tilt(q)
    return {'id': o['id'], 'label': o['label'], 'category': o['category'], 'color': o.get('color'), 'x': round(p[0], 3), 'y': round(p[1], 3),
            'z': round(p[2], 3), 'poly': [[round(p[0] + a, 3), round(p[1] + b, 3)] for a, b in hull([(c[0], c[1]) for c in corners])],
            'heading': round(heading, 4), 'tilt_deg': round(tilt, 1), 'front': g.get('semantic_front_axis_local') is not None}


def ball_path(rollout, ball='o024'):
    return [r3(next(o for o in s['objects'] if o['id'] == ball)['position']) for s in rollout['states']]


def plain_lines(lines):
    out = []
    for l in lines or []:
        ok = l.startswith('PASS'); body = l[5:]
        key = body.split(':')[0].strip()
        if '<-' in body:
            key = body.rsplit('<-', 1)[1].strip()
        text = {'between': 'book between the cups', 'support': 'book resting on the table', 'face': 'chair faces the table',
                'interpenetration': 'nothing overlaps', 'settling': 'stays put after one second', 'inside room bounds': 'inside the room',
                'no_contact': 'never touches the barrier', 'end_region': 'ends inside the box', 'speed': 'comes to rest',
                'physics audit': 'no overlap, stays in the room'}.get(key)
        if text and (ok or text not in [o[5:] for o in out]):
            out.append(('PASS ' if ok else 'FAIL ') + text)
    seen, unique = set(), []
    for l in out:
        if l[5:] not in seen:
            seen.add(l[5:]); unique.append(l)
    return unique


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--simagent-root', type=Path, default=Path(os.environ.get('SIMAGENT_ROOT', REPO.parent)))
    parser.add_argument('--output', type=Path, default=REPO / 'static/data/how_it_works.js')
    args = parser.parse_args()
    from PIL import Image
    root = args.simagent_root.resolve()
    runs = root / 'runs/benchmark_v3'
    images = REPO / 'static/images/how_it_works'
    images.mkdir(parents=True, exist_ok=True)
    data = {'providers': PROVIDERS, 'examples': {}}
    for key, (campaign, task_id, condition) in EXAMPLES.items():
        run = runs / campaign
        bundle = run / 'public_bundles' / task_id
        task, manifest = load(bundle / 'task.json'), load(bundle / 'scene_manifest.json')
        spec = load(run / 'private_inputs' / (task_id + '.json'))
        job = next(j for j in load(run / 'selection.json')['jobs'] if j['task_id'] == task_id)
        gpt = run / 'cases' / task_id / ('gpt54__' + condition)
        prompt = (gpt / 'prediction' / 'prompt.txt').read_text(encoding='utf-8')
        scene = load(gpt / 'prediction' / 'model_scene.json')
        sections = split_prompt(prompt)
        focus = ['o011', 'o007'] if key == 'static' else ['o024', 'o027']
        views = []
        for view in task['public_views']:
            target = images / ('%s_%s' % (key, view.replace('.png', '.jpg')))
            with Image.open(bundle / view) as im:
                im.convert('RGB').resize((480, 360), Image.LANCZOS).save(target, 'JPEG', quality=85, optimize=True)
            views.append(str(target.relative_to(REPO)))
        # the images are separate inputs; show them right after the instruction
        shown = []
        for s in sections:
            label, meaning, role = SECTION_STYLE.get(s['key'], (s['key'].title(), '', 'rules'))
            shown.append({'key': s['key'], 'label': label, 'meaning': meaning, 'role': role, 'chars': len(s['text']),
                          'excerpt': excerpt(s, scene, focus)})
            if s['key'] == 'TASK':
                shown.append({'key': 'IMAGES', 'label': SECTION_STYLE['IMAGES'][0], 'meaning': SECTION_STYLE['IMAGES'][1], 'role': 'images',
                              'chars': 0, 'excerpt': [], 'views': views})
        example = {'task_id': task_id, 'room': int(task_id.split('_')[2]), 'instruction': task['instruction'], 'condition': condition,
                   'prompt': {'sections': shown, 'chars': len(prompt), 'minimap': minimap([s for s in sections])}, 'models': {}}
        # minimap section indices refer to the text sections; map them onto the shown list (which has the image entry inserted)
        index_map = [i for i, s in enumerate(shown) if s['key'] != 'IMAGES']
        example['prompt']['minimap'] = [[index_map[i], n] for i, n in example['prompt']['minimap']]
        if key == 'static':
            witness = load(run / 'witness' / task_id / 'witness_patch.json')['changes']
            objects = {o['id']: o for o in manifest['objects']}
            example['plan'] = {'before': [plan_object(objects[i]) for i in PLAN_IDS if i in objects]}
            example['reference'] = {'answer': [{k: (r3(v) if isinstance(v, list) else v) for k, v in c.items()} for c in witness],
                                    'after': [plan_object(objects[i], next((c for c in witness if c['id'] == i), None)) for i in PLAN_IDS if i in objects]}
        else:
            ref = load(Path(job['witness_patch']).parent / 'reference_rollout.json')
            example['reference'] = {'answer': [{'id': c['id'], 'linear_velocity': r3(c['linear_velocity'])} for c in ref['initial_changes']],
                                    'path': ball_path(ref)}
            objects = {o['id']: o for o in manifest['objects']}
            parts = [objects[i] for i in ('o027', 'o030', 'o031', 'o032') if i in objects]
            example['side'] = {'ball_radius': objects['o024']['primitive']['radius'],
                               'boxes': [{'id': o['id'], 'label': o['label'], 'x': o['position'][0], 'z': o['position'][2],
                                          'sx': o['primitive']['size'][0], 'sz': o['primitive']['size'][2]} for o in parts]}
        for provider in PROVIDERS:
            folder = run / 'cases' / task_id / (provider + '__' + condition)
            record = load(folder / 'prediction' / 'attempt_record.json')
            usage = record.get('usage') or {}
            entry = {'input_tokens': usage.get('input_tokens'), 'answer_tokens': usage.get('visible_answer_tokens'),
                     'reasoning_tokens': usage.get('reasoning_tokens')}
            if key == 'static':
                patch = load(folder / 'prediction' / 'patch_v2.json')['changes']
                entry['answer'] = [{k: (r3(v) if isinstance(v, list) else v) for k, v in c.items()} for c in patch]
                objects = {o['id']: o for o in manifest['objects']}
                entry['after'] = [plan_object(objects[i], next((c for c in patch if c['id'] == i), None)) for i in PLAN_IDS if i in objects]
                review = load(folder / 'common_review' / 'review_summary.json')
                entry['checks'] = plain_lines(review['measurement_lines'])
                entry['status'] = 'pass' if review['deterministic_status'] == 'PASS_NUMERIC_SCREEN' else 'fail'
                entry['book_height_above_table_m'] = round(next(c for c in patch if c['id'] == 'o011')['position'][2] - witness[0]['position'][2], 3)
            else:
                result = load(folder / 'evaluation' / 'dyncode_result.json')
                entry['status'] = 'pass' if result['action_status'] == 'PASS_ACTION' else 'fail'
                entry['checks'] = plain_lines(result['goal_lines'])
                entry['launch'] = [{'id': a['id'], 'linear_velocity': r3(a['linear_velocity'])} for a in result['launch']]
                entry['path'] = ball_path(load(folder / 'evaluation' / 'reference_rollout.json'))
                if condition == 'launch':
                    entry['answer_text'] = (folder / 'prediction' / 'submission.json').read_text(encoding='utf-8').strip()
                else:
                    code = (folder / 'prediction' / 'code.py').read_text(encoding='utf-8').split('\n')
                    entry['program_lines'] = len((folder / 'prediction' / 'code.py').read_text(encoding='utf-8').rstrip('\n').split('\n'))
                    entry['excerpt'] = [{'from': a, 'lines': code[a - 1:b]} for a, b in CODE_EXCERPTS[provider]]
            example['models'][provider] = entry
        data['examples'][key] = example
    data['same_for_both'] = [
        ['Same prompt text', 'word for word, including every rule and tolerance'],
        ['Same two images', 'for the two vision models'],
        ['One answer', 'no tools, no feedback, no second try'],
        ['Same answer length limit', 'and the same hidden thinking budget, 24,576 tokens'],
        ['Same judge', 'the PhysX simulator, then a reviewer AI that cannot overrule it'],
    ]
    header = ('// Generated by tools/extract_how_it_works.py from the simagent repository; do not edit by hand.\n'
              '// Real prompts, scene rows, answers and simulated outcomes of GPT-5.4 and Qwen3-VL-30B Thinking.\n')
    args.output.write_text(header + 'window.HW_DATA = ' + json.dumps(data, indent=1) + ';\n', encoding='utf-8')
    print('wrote', args.output, {k: (len(v['prompt']['sections']), v['prompt']['chars'], len(v['prompt']['minimap'])) for k, v in data['examples'].items()})


if __name__ == '__main__':
    main()
