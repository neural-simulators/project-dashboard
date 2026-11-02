#!/usr/bin/env python3
"""Extract the real Dataset V2 records that drive the planner and reasoner animations of the post-training page.

Reads two roots of the mechanics dataset through the simagent checkout's own modules (the planner's action and goal
contracts, the reasoner's example builder and scorer), so every number on the page is what the pipelines compute:
the recorded actions and their measured outcomes, the goal verdicts, the counterfactual pair with its measured answer
and the scorer's components for a few answers. Trajectories are subsampled to 30 Hz, floats rounded to 3 decimals.
Writes ``static/data/post_training_v2.js`` defining ``window.POST_TRAINING_V2``. Fails instead of guessing.

    PYTHONNOUSERSITE=1 <simagent>/.envs/visual_data/bin/python tools/extract_v2_models_sample.py \
        --simagent-root /path/to/simagent [--dataset PATH] [--goals PATH] [--output PATH]
"""
import argparse
import datetime
import hashlib
import json
import math
import sys
from pathlib import Path

ROOTS = (('sliding__r3', 'Pushed block', 'A piston pushes a wooden block across the floor.'),
         ('bowling__r0', 'Bowling pins', 'A piston pushes a rubber ball into six pins.'))
STEP = 4                      # 120 Hz records -> 30 Hz on the page
MAX_FURNITURE_DISTANCE = 3.5  # furniture drawn in the plan view, from the rig's centre


def rnd(x, d=3):
    return round(float(x), d)


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def tilt_and_axis(q):
    """Tilt of the local z axis from vertical (degrees) and its horizontal direction, from a w,x,y,z quaternion."""
    w, x, y, z = q
    zz = 1 - 2 * (x * x + y * y)
    axis = (2 * (x * z + w * y), 2 * (y * z - w * x))
    return math.degrees(math.acos(max(-1., min(1., zz)))), axis


def rig_objects(manifest, names):
    out = []
    for o in manifest['objects']:
        if 'source_object_id' in o or o['id'] == 'floor' or o['id'].startswith('wall_'):
            continue
        parts = (o.get('shape') or {}).get('parts') or []
        kind, size = 'box', [o['aabb_local_max'][i] - o['aabb_local_min'][i] for i in range(3)]
        if parts and parts[0]['kind'] == 'sphere':
            kind, size = 'sphere', [2 * parts[0]['radius']] * 3
        elif parts and parts[0]['kind'] == 'convex':
            kind = 'pin'
        out.append({'id': o['id'], 'label': names.get(o['id'], o['id']), 'kind': kind, 'size': [rnd(v) for v in size],
                    'position': [rnd(v) for v in o['position']], 'motion_type': o['motion_type'], 'material': o.get('material'),
                    'mass_kg': rnd(o.get('mass_kg', 0.)), 'friction': rnd(o.get('friction', 0.)), 'restitution': rnd(o.get('restitution', 0.))})
    return out


def furniture(manifest, centre):
    out = []
    for o in manifest['source_layout']['objects']:
        if math.dist(o['position_m'][:2], centre) > MAX_FURNITURE_DISTANCE:
            continue
        out.append({'category': o['category'], 'position': [rnd(v) for v in o['position_m'][:2]], 'size': [rnd(v) for v in o['size_m'][:2]], 'yaw': rnd(o['yaw_rad'])})
    return out


def trajectory(folder, pins):
    import numpy as np
    record = json.loads((folder / 'trajectory.json').read_text())
    with np.load(folder / 'trajectory.npz', allow_pickle=False) as archive:
        states = archive['states'][::STEP]
    out = {}
    for i, oid in enumerate(record['dyn_ids']):
        if oid in pins:
            rows = []
            for state in states:
                tilt, axis = tilt_and_axis(state[i, 3:7])
                rows.append([rnd(state[i, 0]), rnd(state[i, 1]), rnd(tilt, 1), rnd(axis[0], 2), rnd(axis[1], 2)])
            out[oid] = rows
        else:
            out[oid] = [[rnd(s[i, 0]), rnd(s[i, 1])] for s in states]
    return out


def measurements(folder):
    qa = json.loads((folder / 'qa.json').read_text())
    return {row['type']: row.get('answer') for row in qa['rows'] if row.get('semantic') is True}


def events(folder, names):
    keep = ('tool_start', 'tool_stop', 'contact_begin', 'contact_end', 'comes_to_rest', 'property_change', 'topple', 'first_topple')
    out = []
    for e in json.loads((folder / 'events.json').read_text())['events']:
        background = any(x == 'floor' or (x.startswith(('wall_', 'o', 'bg_')) and x != 'actor') for x in e.get('objects', []))
        settling = e['kind'] == 'comes_to_rest' and e['time_s'] < 0.3          # the pins settling onto the floor before the push
        if e['kind'] in keep and not background and not settling:
            out.append([rnd(e['time_s']), e['kind'], [names.get(x, x) for x in e.get('objects', [])]])
    return out[:14]


def planner_example(root_dir, title, blurb, catalog, actions, goals, names):
    saved0 = json.loads((root_dir / 'a0/factual/scene.json').read_text())
    space = actions.action_space(saved0)
    base = actions.execution_manifest(saved0)
    root = json.loads((root_dir / 'root.json').read_text())
    pins = set(saved0.get('topple_objects') or [])
    rows = []
    for entry in sorted(root['actions'], key=lambda a: a['index']):
        folder = root_dir / f"a{entry['index']}/factual"
        saved = json.loads((folder / 'scene.json').read_text())
        action = actions.recorded_action(base, saved, space)
        rows.append({'index': entry['index'], 'action': {k: (rnd(v) if isinstance(v, float) else v) for k, v in action.items()},
                     'program': {k: saved['tool_program'].get(k) for k in ('force_N', 'start_s', 'stop_s')}, 'measurements': measurements(folder),
                     'traj': trajectory(folder, pins), 'qa_path': str(folder / 'qa.json')})
    selected = []
    for goal in goals.goals_for(saved0, catalog):
        verdicts = [goals.score(goal, json.loads(Path(r['qa_path']).read_text()) | {'fps': saved0['fps']}) for r in rows]
        flags = [v['success'] for v in verdicts]
        if True in flags and False in flags:
            selected.append({'goal': goal, 'instruction': goals.instruction(saved0, goal), 'verdicts': flags, 'values': [v['value'] for v in verdicts]})
    if not selected:
        raise SystemExit(f'{root_dir.name}: no goal with mixed verdicts among its recorded actions')
    order = ('travel_distance', 'count_toppled', 'max_height', 'max_rotation', 'rebound_height', 'oscillation_count', 'ends_inside', 'time_to_rest')
    selected.sort(key=lambda g: (order.index(g['goal']['metric']), g['goal']['op'] != '>='))
    selected = selected[:2]
    for r in rows:
        r.pop('qa_path')
    messages = actions.messages(saved0, space, selected[0]['instruction'])
    user = messages[1]['content']
    tail = user[user.index('Allowed parameters:'):]
    centre = [sum(o['position'][k] for o in rig_objects(base, names)) / max(1, len(rig_objects(base, names))) for k in range(2)]
    return {'id': root_dir.name, 'family': saved0['family'], 'title': title, 'blurb': blurb, 'room': saved0['source_layout']['room_size_m'],
            'horizon_s': saved0['horizon_s'], 'fps_out': saved0['fps'] // STEP, 'objects': rig_objects(base, names), 'furniture': furniture(saved0, centre),
            'topple_objects': sorted(pins), 'program': {k: saved0['tool_program'].get(k) for k in ('mode', 'object', 'payload', 'force_N', 'start_s', 'stop_s', 'semantic_action')},
            'drive_factor_knob': saved0['variant']['knobs']['drive_factor'], 'action_space': space, 'actions': rows, 'goals': selected,
            'prompt_system': messages[0]['content'], 'prompt_user_tail': tail, 'prompt_chars': len(messages[0]['content']) + len(user)}


def plausible_answer(target, measured):
    """A partly right answer of the kind a model writes: comparisons right, one quantity off, a contact missed, a position off."""
    answer = json.loads(measured)
    for row in target['quantities']:
        if row['answer_status'] == 'measured' and isinstance(row['answer'], (int, float)) and row['type'] not in ('count_toppled',):
            answer['quantities'][row['id']] = rnd(row['answer'] * 0.7)
            break
    if len(answer['outcome']['first_contacts']) > 1:
        answer['outcome']['first_contacts'] = answer['outcome']['first_contacts'][:-1]
    if answer['outcome']['toppled']:
        answer['outcome']['toppled'] = answer['outcome']['toppled'][:-1]
    first = next(iter(answer['outcome']['final_positions']))
    p = answer['outcome']['final_positions'][first]
    answer['outcome']['final_positions'][first] = [rnd(p[0] - 1.0), p[1], p[2]]
    answer['summary'] = 'The change matters; the block goes much farther.' if 'block' in first else 'About the same outcome as before.'
    return json.dumps(answer, separators=(',', ':'))


def reasoner_example(group, build, scoring, no_change_answer, names, title):
    rows, bad = build.examples_of(group, 'observed', 12)
    if bad:
        raise SystemExit(f"{group['root']}: quarantined pairs {bad}")
    row = next(r for r in rows if r['branch'] == 'counterfactual')
    target = json.loads(row['target_json'])
    measured = row['completion'][0]['content']
    factual = group['branches']['factual']
    alternative = group['branches']['counterfactual']
    scene = json.loads((alternative / 'scene.json').read_text())
    decl = scene['counterfactual']
    base = json.loads((factual / 'scene.json').read_text())
    before = next(o for o in base['objects'] if o['id'] == decl['object'])[decl['attribute']]
    pins = set(base.get('topple_objects') or [])
    answers = [('the measured answer', measured, 'what the simulator recorded for the changed run'),
               ('the no-change answer', json.dumps(no_change_answer(target), separators=(',', ':')), 'copies the observed run and says "about the same" everywhere'),
               ('a partly right answer', plausible_answer(target, measured), 'right comparisons, one quantity off, one contact missed, one position off'),
               ('prose, no JSON', 'The block slides much farther than before and never comes to rest.', 'an answer that breaks the contract')]
    scored = []
    for name, text, note in answers:
        s = scoring.score_answer(text, target)
        scored.append({'name': name, 'note': note, 'text': text, 'reward': rnd(s['reward'], 3), 'parsed': s['parsed'],
                       'components': {k: rnd(s[k], 3) for k in scoring.COMPONENTS}})
    rewards = [s['reward'] for s in scored]
    mean = sum(rewards) / len(rewards)
    std = math.sqrt(sum((r - mean) ** 2 for r in rewards) / (len(rewards) - 1))
    for s in scored:
        s['advantage'] = rnd((s['reward'] - mean) / (std + 1e-4), 3)
    questions = ([{'id': c['id'], 'kind': 'comparison', 'text': c['question'], 'answer': c['answer'], 'observed': c['observed'], 'alternative': c['alternative']} for c in target['comparisons']]
                 + [{'id': q['id'], 'kind': 'quantity', 'text': q['question'], 'unit': q['unit'], 'answer': q['answer'], 'observed_display': q['observed_display'], 'status': q['answer_status']} for q in target['quantities']])
    objects = rig_objects(base, names)
    centre = [sum(o['position'][k] for o in objects) / len(objects) for k in range(2)]
    return {'id': row['example_id'], 'root': group['root'], 'family': group['family'], 'title': title, 'room': base['source_layout']['room_size_m'],
            'horizon_s': base['horizon_s'], 'fps_out': base['fps'] // STEP, 'objects': objects, 'furniture': furniture(base, centre), 'topple_objects': sorted(pins),
            'change': {'object': names.get(decl['object'], decl['object']), 'attribute': decl['attribute'], 'before': rnd(before), 'after': rnd(decl['value'])},
            'program': {k: base['tool_program'].get(k) for k in ('mode', 'force_N', 'start_s', 'stop_s', 'semantic_action')},
            'factual': {'traj': trajectory(factual, pins), 'events': events(factual, names), 'measurements': measurements(factual), 'outcome': target['factual_outcome']},
            'alternative': {'traj': trajectory(alternative, pins), 'events': events(alternative, names), 'measurements': measurements(alternative), 'outcome': target['outcome']},
            'questions': questions, 'prompt_system': row['prompt'][0]['content'], 'prompt_user': row['prompt'][1]['content'], 'target_answer': measured,
            'answers': scored, 'group': {'mean': rnd(mean, 3), 'std': rnd(std, 3)}, 'prompt_chars': row['meta']['prompt_chars'],
            'input_sha256': {k: v for k, v in row['meta']['input_sha256'].items() if k.endswith(('scene.json', 'qa.json', 'events.json', 'trajectory.npz'))} if 'input_sha256' in row['meta'] else {}}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    here = Path(__file__).resolve().parents[1]
    parser.add_argument('--simagent-root', default=str(here.parent / 'simagent'))
    parser.add_argument('--dataset', help='mechanics dataset root (default: <simagent parent>/datasets/mechanics_10k_v1)')
    parser.add_argument('--goals', help='frozen planner goal catalog (default: the 1 November calibrated build)')
    parser.add_argument('--output', default=str(here / 'static/data/post_training_v2.js'))
    args = parser.parse_args(argv)
    root = Path(args.simagent_root).resolve()
    dataset = Path(args.dataset) if args.dataset else root.parent / 'datasets/mechanics_10k_v1'
    goals_path = Path(args.goals) if args.goals else root / 'runs/planner_fix_20261101_v1/calibrated_build_v3/goals.json'
    for path in (root, dataset, goals_path):
        if not path.exists():
            raise SystemExit(f'missing input: {path}')
    sys.path.insert(0, str(root))
    from simagent.planner import actions, goals
    from simagent.reasoner import scoring
    from simagent.reasoner.records import discover
    from simagent.unified.simulation_language import object_names
    from scripts.reasoner import build_reasoner_data as build
    from scripts.reasoner.eval_reasoner import no_change_answer
    catalog = json.loads(goals_path.read_text())
    groups, _ = discover(dataset)
    planner, reasoner, hashes = [], [], {}
    for name, title, blurb in ROOTS:
        group = next(g for g in groups if g['root'] == name and g['action_index'] == 0)
        base = json.loads((group['branches']['factual'] / 'scene.json').read_text())
        names = object_names(base)
        planner.append(planner_example(group['root_dir'], title, blurb, catalog, actions, goals, names))
        reasoner.append(reasoner_example(group, build, scoring, no_change_answer, names, title))
        for k in range(3):
            for fname in ('scene.json', 'qa.json', 'trajectory.npz'):
                p = group['root_dir'] / f'a{k}/factual' / fname
                hashes[str(p.relative_to(dataset))] = sha(p)
        for fname in ('scene.json', 'qa.json', 'trajectory.npz', 'events.json'):
            p = group['branches']['counterfactual'] / fname
            hashes[str(p.relative_to(dataset))] = sha(p)
    constants = {
        'reasoner': {'reward_weights': scoring.WEIGHTS, 'tolerances': {'relative': scoring.REL_TOL, 'absolute': scoring.ABS_TOL, 'position_m': scoring.POS_TOL_M, 'contact_time_s': scoring.CONTACT_TIME_TOL_S},
                     'grpo': {'generations': 8, 'learning_rate': 1e-5, 'kl_beta': 0.02, 'clip_epsilon': 0.2, 'loss': 'dapo (token-level, normalised by the completion tokens of the batch)',
                              'temperature': 1.0, 'completion_cap_tokens': 1536, 'prompt_cap_tokens': 10240},
                     'sft': {'learning_rate': 1e-4, 'epochs': 2, 'lora_rank': 32, 'lora_alpha': 64}, 'base_model': 'Qwen3-8B'},
        'planner': {'limits': actions.LIMITS, 'drive_range': [0.7, 1.4], 'lateral_fraction': [-0.25, 0.25], 'yaw_deg': [-8, 8],
                    'sft': {'learning_rate': 1e-4, 'epochs': 2, 'lora_rank': 32, 'lora_alpha': 64}, 'dpo': {'learning_rate': 2e-5, 'beta': 0.1, 'epochs': 2},
                    'goal_calibration': 'nearest-rank 25th and 75th percentiles of the training baselines, per family and metric', 'base_model': 'Qwen3-8B or Qwen2.5-7B'}}
    data = {'generated': datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='seconds'), 'dataset': str(dataset), 'goals_catalog': str(goals_path),
            'record_sha256': hashes, 'planner': planner, 'reasoner': reasoner, 'constants': constants}
    header = ('// Generated by tools/extract_v2_models_sample.py from the simagent checkout and Dataset V2; do not edit by hand.\n'
              '// Real records: roots %s of the mechanics dataset, their recorded actions, measured outcomes, goal verdicts, the\n'
              '// counterfactual pair with its measured answer and the scorer\'s components. 30 Hz, 3 decimals; metres, seconds, degrees.\n' % ', '.join(r[0] for r in ROOTS))
    text = header + 'window.POST_TRAINING_V2 = ' + json.dumps(data, separators=(',', ':'), allow_nan=False) + ';\n'
    Path(args.output).write_text(text)
    print(f'wrote {args.output}: {len(text) / 1024:.0f} KB, planner examples {len(planner)}, reasoner examples {len(reasoner)}')


if __name__ == '__main__':
    sys.exit(main())
