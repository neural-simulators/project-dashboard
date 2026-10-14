#!/usr/bin/env python3
"""Data for the "How models are prompted" page: one real attempt, step by step, from the simagent campaigns.

Three examples, each answered by GPT-5.4 and Qwen3-VL-30B Thinking under the same prompt:
  static   room 1, "put the orange book between the cups and turn the red chair to face the table" (answer: new poses as JSON)
  numbers  room 7, "toss the red ball over the gray barrier into the blue open box" (answer: the launch velocity as JSON)
  code     the same throw, answered with a program that returns the launch

For every example the page walks through seven steps with the real records: the task and the images the model sees, the
full prompt split into its sections (the scene also as a table), the answer format (the strict JSON schema sent with the
request, or the program contract), each model's raw answer and token use, the harness steps from the answer to the
simulation with the actual values, every check with its measured value and limit, and the outcome (close-up renders or
the PhysX rollout videos). Writes ``static/data/how_it_works.js`` (``window.HW_DATA``), the task views under
``static/images/how_it_works/`` and the rollout clips under ``static/media/how_it_works/``. Run with the simagent Isaac
interpreter (Pillow):

    /path/to/simagent/.envs/isaac/bin/python tools/extract_how_it_works.py [--simagent-root PATH]

The static example's close-ups come from the benchmark results page (tools/extract_benchmark_results.py); the extractor
fails if they are missing instead of drawing something else.
"""
import argparse
import json
import math
import os
import re
import shutil
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
PROVIDERS = {'gpt54': 'GPT-5.4', 'qwen30t': 'Qwen3-VL-30B Thinking'}
EXAMPLES = {   # key: (campaign, task, condition, label)
    'static': ('static_v31', 'b2_room_01_book_between_cups_and_face', 'patch', 'Static edit: book between the cups'),
    'numbers': ('launch_v31', 'b2_room_07_lob_over_barrier_into_box', 'launch', 'Throw, answered with numbers'),
    'code': ('hard_v31', 'b2_room_07_lob_over_barrier_into_box', 'code_predict', 'Throw, answered with a program'),
}
SECTION_STYLE = {   # plain label, one-line meaning, colour role
    'TASK': ('Instruction', 'The request in everyday words, and a note that two labelled images are attached.', 'instruction'),
    'SCENE CONVENTIONS': ('Conventions', 'Units, axes, how poses and bounding boxes are written.', 'rules'),
    'HOW THE ANSWER IS CHECKED': ('How it is checked', 'Every check and tolerance, stated in advance.', 'checks'),
    'HOW THE INSTRUCTION IS CHECKED': ('How it is checked', 'Every check and tolerance, stated in advance.', 'checks'),
    'DYNAMICS CONVENTIONS': ('Physics rules', 'Duration, time step, gravity, how friction and bounciness combine.', 'rules'),
    'CONTROLLED OBJECT': ('What may be launched', 'The one object the model controls, and where its velocity limits are.', 'checks'),
    'ACTION SPACE': ('Action space', 'One launch, a velocity inside the limits; nothing else exists.', 'output'),
    'OUTPUT FORMAT': ('Answer format', 'Exactly what to send back.', 'output'),
    'SCENE JSON': ('The scene as data', 'Every object: pose, size, mass, friction, bounciness (one line of JSON).', 'scene'),
    'TASK JSON': ('Task data', 'The same task in machine form.', 'rules'),
}
GOAL_NAMES = {'no_contact': 'never touches', 'end_region': 'ends inside the region', 'speed': 'has come to rest',
              'contact_deadline': 'touches in time', 'displacement': 'moves the required distance'}


def load(path):
    with open(path, 'r', encoding='utf-8') as handle:
        return json.load(handle)


def r3(v):
    return [round(float(x), 3) for x in v]


def fmt(x, digits=2):
    return ('%.' + str(digits) + 'f') % x


def split_prompt(text):
    heads = list(re.finditer(r'^([A-Z][A-Z /-]{3,}?)(?: \(.*\))?$', text, re.M))
    sections = []
    for i, m in enumerate(heads):
        end = heads[i + 1].start() if i + 1 < len(heads) else len(text)
        name = m.group(1).strip()
        key = name if name in SECTION_STYLE else next((k for k in sorted(SECTION_STYLE, key=len, reverse=True) if name.startswith(k) and k != 'TASK'), name)
        sections.append({'key': key, 'text': text[m.start():end].rstrip('\n')})
    if not sections or sections[0]['key'] != 'TASK':
        raise SystemExit('prompt does not start with its TASK section')
    return sections


def scene_rows(scene):
    """The scene as the model reads it, one row per object (the numbers it gets, rounded for the table)."""
    rows = []
    for o in scene['objects']:
        g = o.get('geometry', {})
        size = [round(b - a, 2) for a, b in zip(g.get('aabb_local_min', [0, 0, 0]), g.get('aabb_local_max', [0, 0, 0]))]
        rows.append({'id': o['id'], 'label': o['label'], 'moves': o.get('motion_type') == 'dynamic', 'position': r3(o['position']),
                     'size': size, 'mass': o.get('mass_kg'), 'friction': o.get('friction'), 'restitution': o.get('restitution')})
    return rows


def pretty(obj):
    """Indented JSON with every flat list (numbers, type names) on one line, as a person would lay it out."""
    text = json.dumps(obj, indent=2)
    return re.sub(r'\[\s+([^\[\]{}]*?)\s+\]', lambda m: '[' + ', '.join(x.strip() for x in m.group(1).split(',')) + ']', text)


def norm(v):
    return math.sqrt(sum(x * x for x in v))


def static_checks(diag, labels):
    """Every check of the static screen with what was measured and the limit, from evaluation/diagnostics.json."""
    rows = []
    for p in diag['instruction']['predicates']:
        pr, m = p['predicate'], p['measurements']
        if pr['kind'] == 'between':
            name = '%s between the %s and the %s' % (labels[pr['object_id']], labels[pr['target_ids'][0]], labels[pr['target_ids'][1]])
            measured = '%s mm off the line between them, %d%% of the way along' % (fmt(1000 * m['perpendicular_distance_m'], 1), round(100 * m['segment_fraction']))
            limit = 'at most %d mm off the line, between the two' % round(1000 * pr['max_perpendicular_m'])
        elif pr['kind'] == 'supported_by':
            name = '%s rests on the %s' % (labels[pr['object_id']], labels[pr['support_id']])
            measured = '%d%% of its footprint over it, %s mm above it' % (round(100 * m['bounds_coverage_fraction']), fmt(1000 * m['vertical_gap_m'], 1))
            limit = 'at least %d%% of the footprint, -3 to 20 mm above' % round(100 * pr.get('min_fraction', .65))
        elif pr['kind'] == 'face':
            name = '%s faces the %s' % (labels[pr['object_id']], labels[pr['target_id']])
            measured = '%s degrees off' % fmt(m['facing_error_deg'], 1)
            limit = 'at most %d degrees' % pr['max_angle_deg']
        else:
            name, measured, limit = pr['kind'], json.dumps(m), json.dumps({k: v for k, v in pr.items() if k != 'kind'})
        rows.append({'group': 'instruction', 'name': name, 'measured': measured, 'limit': limit, 'passed': bool(p['passed'])})
    kept = diag['instruction']['preserved_unmentioned']
    moved = [labels.get(k, k) for k, ok in kept.items() if not ok]
    rows.append({'group': 'instruction', 'name': 'Everything not mentioned stays where it was', 'measured': 'moved: ' + ', '.join(moved) if moved else '%d objects unchanged' % len(kept),
                 'limit': 'exactly unchanged', 'passed': not moved})
    pol, checks = diag['policy'], diag['checks']
    overlap = max(0., -diag['geometry']['minimum_contact_distance_m'])
    rows.append({'group': 'physics', 'name': 'No two objects overlap', 'measured': 'deepest overlap %s mm' % fmt(1000 * overlap, 2),
                 'limit': 'at most %d mm' % round(1000 * pol['max_penetration_m']), 'passed': bool(checks['penetration'])})
    rows.append({'group': 'physics', 'name': 'Everything inside the room', 'measured': 'inside' if checks['room_bounds'] else 'outside',
                 'limit': 'walls and floor, %d mm tolerance' % round(1000 * pol['max_room_violation_m']), 'passed': bool(checks['room_bounds'])})
    upright = diag['measurements'].get('upright_angle_deg') or {}
    if upright:
        worst = max(upright, key=upright.get)
        rows.append({'group': 'physics', 'name': 'Moved furniture stays upright', 'measured': '%s tilted %s degrees' % (labels.get(worst, worst), fmt(upright[worst], 1)),
                     'limit': 'at most %d degrees' % round(pol['max_upright_angle_deg']), 'passed': bool(checks['upright'])})
    settle = diag['measurements']['settling']
    drift = max(settle, key=lambda k: settle[k]['translation_m'])
    turn = max(settle, key=lambda k: settle[k]['rotation_deg'])
    speed = max(settle, key=lambda k: settle[k]['final_speed_m_s'])
    rows.append({'group': 'physics', 'name': 'Nothing moves while the scene settles for 1 s',
                 'measured': 'largest drift %s mm (%s)' % (fmt(1000 * settle[drift]['translation_m'], 1), labels.get(drift, drift)),
                 'limit': 'at most %d mm' % round(1000 * pol['max_settling_translation_m']), 'passed': bool(checks['settling_translation'])})
    rows.append({'group': 'physics', 'name': 'Nothing turns while it settles', 'measured': 'largest turn %s degrees (%s)' % (fmt(settle[turn]['rotation_deg'], 2), labels.get(turn, turn)),
                 'limit': 'at most %d degrees' % round(pol['max_settling_rotation_deg']), 'passed': bool(checks['settling_rotation'])})
    rows.append({'group': 'physics', 'name': 'Everything at rest after 1 s', 'measured': 'fastest %s m/s' % fmt(settle[speed]['final_speed_m_s'], 3),
                 'limit': 'at most %s m/s' % fmt(pol['max_final_speed_m_s'], 2), 'passed': bool(checks['final_speed'])})
    return rows


def launch_checks(result, labels):
    """Every goal row and physics screen of a launch, from evaluation/dyncode_result.json."""
    rows = []
    for row in result['action_goal_checks']['rows']:
        req, m = row['requirement'], row.get('measurements') or {}
        kind = req['kind']
        if kind == 'no_contact':
            a, b = req['object_ids']
            name = '%s never touches the %s' % (labels.get(a, a), labels.get(b, b))
            times = m.get('contact_times_s') or []
            measured = 'first touch at %s s' % fmt(times[0], 2) if times else 'no contact in %s s' % fmt(m.get('deadline_s', 2.), 0)
            limit = 'no contact during the %s s' % fmt(m.get('deadline_s', 2.), 0)
        elif kind == 'end_region':
            lo, hi = m['body_world_aabb_min'], m['body_world_aabb_max']
            blo, bhi = req['bounds_min'], req['bounds_max']
            name = '%s ends inside the target region' % labels.get(req['object_id'], req['object_id'])
            measured = 'its box at 2 s: x %s to %s, z %s to %s m' % (fmt(lo[0]), fmt(hi[0]), fmt(lo[2]), fmt(hi[2]))
            limit = 'x %s to %s, y %s to %s, z %s to %s m (%d mm tolerance)' % (fmt(blo[0]), fmt(bhi[0]), fmt(blo[1]), fmt(bhi[1]), fmt(blo[2]), fmt(bhi[2]),
                                                                                 round(1000 * req.get('tolerance_m', 0)))
        elif kind == 'speed':
            name = '%s has come to rest' % labels.get(req['object_id'], req['object_id'])
            measured = '%s m/s at 2 s' % fmt(m['final_linear_speed_m_s'], 3)
            limit = 'at most %s m/s' % fmt(req['max_speed_m_s'], 2)
        else:
            name = GOAL_NAMES.get(kind, kind)
            measured = json.dumps({k: (round(v, 3) if isinstance(v, float) else v) for k, v in m.items()})[:160]
            limit = json.dumps({k: v for k, v in req.items() if k != 'kind'})[:160]
        rows.append({'group': 'instruction', 'name': name, 'measured': measured, 'limit': limit, 'passed': bool(row['passed'])})
    audit = result['action_physics_audit']
    overlap = max(0., -audit['minimum_global_contact_distance_m'])
    rows.append({'group': 'physics', 'name': 'No two objects overlap at any moment', 'measured': 'deepest overlap %s mm' % fmt(1000 * overlap, 3),
                 'limit': 'at most 5 mm', 'passed': overlap <= .005})
    room = result['room_audit']
    rows.append({'group': 'physics', 'name': 'Everything stays inside the room', 'measured': 'worst %s mm outside' % fmt(1000 * (room['worst'].get('violation_m') or 0.), 1),
                 'limit': 'walls %d mm, floor %d mm tolerance' % (round(1000 * room['policy']['horizontal_margin_m']), round(1000 * room['policy']['floor_margin_m'])),
                 'passed': bool(room['passed'])})
    return rows


def review(folder):
    path = folder / 'common_review' / 'review_summary.json'
    if not path.is_file():
        return None
    rv = load(path)
    adv = rv.get('advisory_model_judgment') or {}
    overall = adv.get('overall') or adv.get('verdict')
    reason = adv.get('reason') or adv.get('rationale') or adv.get('notes')
    return {'overall': overall, 'reason': reason} if overall else None


def copy_clip(src, name):
    target = REPO / 'static/media/how_it_works' / name
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(src, target)
    return str(target.relative_to(REPO))


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
    data = {'providers': PROVIDERS, 'order': list(EXAMPLES), 'examples': {}}
    for key, (campaign, task_id, condition, title) in EXAMPLES.items():
        run = runs / campaign
        bundle = run / 'public_bundles' / task_id
        task, manifest = load(bundle / 'task.json'), load(bundle / 'scene_manifest.json')
        labels = {o['id']: o['label'] for o in manifest['objects']}
        gpt = run / 'cases' / task_id / ('gpt54__' + condition)
        prompt = (gpt / 'prediction' / 'prompt.txt').read_text(encoding='utf-8')
        for provider in PROVIDERS:
            other = (run / 'cases' / task_id / (provider + '__' + condition) / 'prediction' / 'prompt.txt').read_text(encoding='utf-8')
            if other != prompt:
                raise SystemExit('%s: the two models did not get the same prompt' % task_id)
        scene = load(gpt / 'prediction' / 'model_scene.json')
        views = []
        for view in task['public_views']:
            target = images / ('%s_%s' % (key, view.replace('.png', '.jpg')))
            with Image.open(bundle / view) as im:
                im.convert('RGB').resize((640, 480), Image.LANCZOS).save(target, 'JPEG', quality=86, optimize=True)
            views.append({'src': str(target.relative_to(REPO)), 'label': view.replace('.png', '')})
        chance = load(runs / 'chance_baseline_v1' / task_id / 'search.json')['summary']
        sections = []
        for s in split_prompt(prompt):
            label, meaning, role = SECTION_STYLE.get(s['key'], (s['key'].title(), '', 'rules'))
            sections.append({'key': s['key'], 'label': label, 'meaning': meaning, 'role': role, 'chars': len(s['text']), 'text': s['text']})
        kind = 'static' if task['output_type'] == 'static_scene_patch' else 'launch'
        example = {'title': title, 'task_id': task_id, 'room': int(task_id.split('_')[2]), 'kind': kind, 'condition': condition,
                   'instruction': task['instruction'], 'views': views,
                   'chance': {'passes': chance.get('solved', chance.get('confirmed', 0)), 'samples': chance['samples'],
                              'what': 'random placements of the objects involved' if kind == 'static' else 'random launches inside the allowed range'},
                   'prompt': {'chars': len(prompt), 'sections': sections, 'scene_rows': scene_rows(scene)}, 'models': {}}
        if kind == 'launch':
            c = task['control']
            ctl = next(o for o in manifest['objects'] if o.get('color') == c['selector'].get('color') and o.get('category') == c['selector'].get('category'))
            pairs = lambda b: [[lo, hi] for lo, hi in zip(b['min'], b['max'])] if isinstance(b, dict) else b      # [[low, high]] per axis
            example['control'] = {'id': ctl['id'], 'label': ctl['label'], 'linear': pairs(c['linear_velocity_bounds']), 'angular': pairs(c['angular_velocity_bounds']),
                                  'position': r3(ctl['position'])}
        # the answer format: the strict schema sent with the request, or the program contract
        request = load(gpt / 'prediction' / 'api' / 'request.json')
        fmt_block = (request.get('text') or {}).get('format')
        out_section = next(s['text'] for s in sections if s['key'] == 'OUTPUT FORMAT')
        if fmt_block:
            schema = json.loads(json.dumps(fmt_block['schema']))
            props = schema.get('properties', {})
            if 'snapshot_hash' in props and props['snapshot_hash'].get('enum'):
                props['snapshot_hash']['enum'] = [props['snapshot_hash']['enum'][0][:12] + '...']
            example['format'] = {'kind': 'schema', 'name': fmt_block['name'], 'strict': bool(fmt_block.get('strict')),
                                 'schema_text': pretty(schema), 'section': out_section}
        else:
            example['format'] = {'kind': 'program', 'section': out_section}
        for provider in PROVIDERS:
            folder = run / 'cases' / task_id / (provider + '__' + condition)
            record = load(folder / 'prediction' / 'attempt_record.json')
            usage = record.get('usage') or {}
            req = load(folder / 'prediction' / 'api' / 'request.json')
            entry = {'input_tokens': usage.get('input_tokens'), 'answer_tokens': usage.get('visible_answer_tokens'),
                     'thinking_tokens': usage.get('reasoning_tokens'), 'answer_budget': usage.get('answer_budget_tokens'),
                     'output_limit': req.get('max_output_tokens') or req.get('max_tokens'), 'contract': record.get('contract_status'),
                     'review': review(folder)}
            if condition == 'code_predict':
                code = (folder / 'prediction' / 'code.py').read_text(encoding='utf-8').rstrip('\n')
                sandbox = load(folder / 'prediction' / 'sandbox_result.json')
                entry['program'] = code
                entry['sandbox'] = {'status': sandbox['status'], 'seconds': round(sandbox['elapsed_s'], 2), 'limits': sandbox['sandbox']}
                forecast = load(folder / 'evaluation' / 'dyncode_result.json').get('self_prediction') or {}
                if forecast.get('status') == 'scored':
                    entry['forecast'] = {'predicted': r3(forecast['predicted_final_position']), 'actual': r3(forecast['actual_final_position']),
                                         'error_m': round(forecast['endpoint_error_m'], 3)}
            else:
                raw = (folder / 'prediction' / 'submission.json').read_text(encoding='utf-8')
                parsed = json.loads(raw)
                if isinstance(parsed, dict) and parsed.get('snapshot_hash'):
                    parsed['snapshot_hash'] = parsed['snapshot_hash'][:12] + '...'
                entry['reason'] = parsed.pop('reason', None) if isinstance(parsed, dict) else None
                entry['answer_text'] = pretty(parsed)
            if kind == 'static':
                sub = load(folder / 'prediction' / 'submission.json')
                patch = load(folder / 'prediction' / 'patch_v2.json')
                steps = []
                for change, out in zip(sub['changes'], patch['changes']):
                    item = {'id': change['id'], 'label': labels[change['id']], 'kept': [k for k in ('position', 'quaternion_wxyz') if change.get(k) is None]}
                    if change.get('quaternion_wxyz') is not None:
                        item['quaternion_in'] = change['quaternion_wxyz']
                        item['quaternion_norm_in'] = round(norm(change['quaternion_wxyz']), 9)
                        item['quaternion_out'] = [round(x, 9) for x in out['quaternion_wxyz']]
                    if change.get('position') is not None:
                        item['position'] = change['position']
                    steps.append(item)
                entry['conversion'] = steps
                diag = load(folder / 'evaluation' / 'diagnostics.json')
                entry['checks'] = static_checks(diag, labels)
                entry['status'] = 'pass' if diag['status'] == 'PASS_NUMERIC_SCREEN' else 'fail'
                entry['moved_ids'] = [c['id'] for c in patch['changes']]
            else:
                result = load(folder / 'evaluation' / 'dyncode_result.json')
                entry['launch'] = [{'id': a['id'], 'linear_velocity': r3(a['linear_velocity']),
                                    'angular_velocity': r3(a['angular_velocity']) if a.get('angular_velocity') else None} for a in result['launch']]
                entry['checks'] = launch_checks(result, labels)
                entry['status'] = 'pass' if result['action_status'] == 'PASS_ACTION' else 'fail'
                entry['video'] = copy_clip(folder / 'evaluation' / 'reference_media' / 'rollout.mp4', '%s_%s.mp4' % (key, provider))
            example['models'][provider] = entry
        if kind == 'static':
            bench = REPO / 'static/images/benchmark' / task_id
            needed = ['overview.jpg', 'closeup_before.jpg', 'closeup_truth.jpg'] + ['closeup_%s.jpg' % p for p in PROVIDERS]
            missing = [n for n in needed if not (bench / n).is_file()]
            if missing:
                raise SystemExit('missing close-ups from the benchmark page: %s (run tools/extract_benchmark_results.py)' % missing)
            example['result'] = {'overview': 'static/images/benchmark/%s/overview.jpg' % task_id,
                                 'before': 'static/images/benchmark/%s/closeup_before.jpg' % task_id,
                                 'reference': 'static/images/benchmark/%s/closeup_truth.jpg' % task_id,
                                 'models': {p: 'static/images/benchmark/%s/closeup_%s.jpg' % (task_id, p) for p in PROVIDERS}}
        else:
            witness = load(run / 'witness' / task_id / 'witness_launch.json')     # a list of launches, one per controlled object
            change = witness[0] if isinstance(witness, list) else (witness.get('initial_changes') or [witness])[0]
            example['reference'] = {'linear_velocity': r3(change['linear_velocity'])}
            example['result'] = {'reference': copy_clip(run / 'witness' / task_id / 'rollout.mp4', '%s_reference.mp4' % key)}
        data['examples'][key] = example
    data['same_for_both'] = [
        ['Same prompt text', 'word for word, including every rule and tolerance'],
        ['Same two images', 'for the two vision models'],
        ['One answer', 'no tools, no feedback, no second try'],
        ['Same answer length limit', 'and the same hidden thinking allowance, 24,576 tokens, where the context window allows'],
        ['Same judge', 'the PhysX simulator, then a reviewer AI that cannot overrule it'],
    ]
    header = ('// Generated by tools/extract_how_it_works.py from the simagent repository; do not edit by hand.\n'
              '// Real prompts, schemas, answers, harness steps, checks and outcomes of GPT-5.4 and Qwen3-VL-30B Thinking.\n')
    args.output.write_text(header + 'window.HW_DATA = ' + json.dumps(data, indent=1) + ';\n', encoding='utf-8')
    print('wrote', args.output, {k: (len(v['prompt']['sections']), v['prompt']['chars'], [m['status'] for m in v['models'].values()]) for k, v in data['examples'].items()})


if __name__ == '__main__':
    main()
