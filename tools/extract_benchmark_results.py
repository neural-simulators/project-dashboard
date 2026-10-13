#!/usr/bin/env python3
"""Build the data and media of the benchmark-results block and page from the simagent campaigns.

Reads the benchmark campaigns of the simagent repository (static edits, launches, throws, direct-answer launches and the
composite tasks when present) for GPT-5.4 and Qwen3-VL-30B Thinking, the random-answer pass rate of every task, and the
reviewer summaries.  Writes ``static/data/benchmark_results.js`` (``window.BM_RESULTS``) and the media under
``static/images/benchmark/`` and ``static/media/benchmark/``:

* dynamic examples: the simulator clips of the reference launch and of both models' launches, copied at their native
  640 x 480 (no re-encoding; the index is moved to the front for web playback), with the first frame as the poster;
* static examples: the room before the edit from the overview camera, with the area of interest outlined, and close-ups
  of the reference answer and both models' answers rendered by ``tools/render_closeups.py`` (an Isaac job).

Every number and picture is a real record; the script fails instead of guessing when a required input is missing.
Needs Pillow and the ffmpeg binary that imageio-ffmpeg ships, so run it with the simagent Isaac interpreter:

    /path/to/simagent/.envs/isaac/bin/python tools/extract_benchmark_results.py [--simagent-root PATH]
"""
import argparse
import datetime
import json
import math
import os
import shutil
import subprocess
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
PROVIDERS = {'gpt54': 'GPT-5.4', 'qwen30t': 'Qwen3-VL-30B Thinking'}
PASS = {'PASS_NUMERIC_SCREEN', 'PASS_ACTION'}
# task type: campaign, condition, label, short description
TYPES = [
    ('static', 'static_v31', 'patch', 'Static edits', 'Move and turn furniture and objects; the answer is the new poses.'),
    ('launch', 'dynamic_v31', 'code_predict', 'Launch tasks', 'Give one object a velocity so that something happens; the answer is a program that computes it.'),
    ('throw', 'hard_v31', 'code_predict', 'Throws over a barrier or box rim', 'The ball must fly over an obstacle; program answers.'),
    ('direct', 'launch_v31', 'launch', 'Launch tasks and throws, velocity as numbers', 'The same 80 tasks, answered with the velocity directly instead of a program.'),
    ('composite', 'composite_v1', 'launch', 'Composite tasks', 'Two or three objects set in motion at once: knock chairs over, shove the table, throw the ball.'),
]
# The four examples shown first: one static edit, a hard and a medium launch, one throw; a mix of verdicts, including one of
# GPT-5.4's rare failures (the stool barely pushed).
FEATURED = [('static', 'b2_room_01_book_between_cups_and_face', 'Static edit'),
            ('launch', 'b2_room_14_three_ball_contact_chain', 'Launch task, hard'),
            ('launch', 'b2_room_10_stool_topple_in_zone', 'Launch task, medium'),
            ('throw', 'b2_room_07_lob_over_barrier_into_box', 'Throw, hard')]
EXAMPLES = {
    'static': ['b2_room_01_book_between_cups_and_face', 'b2_room_04_sofa_wall_and_chair', 'b2_room_08_chairs_gather_and_face',
               'b2_room_09_stool_box_swap_and_face', 'b2_room_12_swap_cups_and_turn_chair', 'b2_room_13_chairs_face_different_targets'],
    'launch': ['b2_room_14_three_ball_contact_chain', 'b2_room_10_stool_topple_in_zone', 'b2_room_07_three_ball_contact_chain',
               'b2_room_01_ball_hit_blue_deadline', 'b2_room_06_box_spin_in_zone', 'b2_room_13_ball_pass_between_markers',
               'b2_room_09_off_table_into_open_box'],
    'throw': ['b2_room_07_lob_over_barrier_into_box', 'b2_room_03_ball_over_barrier_hit_blue', 'b2_room_12_toss_over_rim_into_box',
              'b2_room_05_toss_over_rim_into_box', 'b2_room_11_lob_over_barrier_into_box'],
    'direct': ['b2_room_02_ball_hit_blue_deadline', 'b2_room_10_off_table_into_open_box', 'b2_room_01_toss_over_rim_into_box',
               'b2_room_14_lob_over_barrier_into_box'],
    # one task where GPT-5.4 meets the goal (three objects) and one where it fails (the chair does not tip); a Qwen success is
    # appended automatically when one exists (pick_contrasts covers the case where none of these is evaluated yet)
    'composite': ['b2_room_03_topple_chair_shove_table_and_wall_rebound', 'b2_room_01_shove_table_and_topple_chair'],
}
FAMILY_LABELS = {
    'chair_approach': 'Bring a chair closer to the table', 'chairs_gather_and_face': 'Gather two chairs and face the table',
    'swap_and_face_chairs': 'Swap two chairs, then face the table', 'sofa_wall_and_chair': 'Sofa against the wall, chair faces it',
    'swap_cups_and_turn_chair': 'Swap two cups, turn a chair', 'stool_box_swap_and_face': 'Swap a stool and a box, turn a chair',
    'cups_group_and_turn_chair': 'Group the cups mid-table, turn a chair', 'book_between_cups_and_face': 'Book between the cups, chair faces the table',
    'chairs_face_different_targets': 'Turn two chairs toward different targets', 'sofa_wall_and_cup_swap': 'Sofa against the wall, swap the cups',
    'ball_hit_blue_deadline': 'Hit the blue ball within 1.5 s', 'ball_hit_heavier_blue': 'Hit a heavier ball', 'three_ball_contact_chain': 'Three-ball chain',
    'glancing_ball_impact': 'Glancing impact', 'ball_hit_blue_avoid_green': 'Hit one ball, avoid another', 'box_strike_ball_into_zone': 'Box strikes a ball into a region',
    'off_table_into_open_box': 'Roll off the table into the open box', 'airborne_ball_into_open_box': 'Launch into the open box',
    'wall_rebound_return_zone': 'Bounce off the wall and return', 'floor_then_wall_rebound': 'Floor then wall rebound',
    'box_travel_distance_band': 'Slide a box about half a metre', 'box_stop_before_barrier': 'Stop a box before a barrier',
    'ball_stop_before_barrier': 'Stop a ball before a barrier', 'ball_pass_between_markers': 'Pass between two markers',
    'stool_topple_in_zone': 'Topple the stool', 'box_spin_in_zone': 'Spin the box in place',
    'lob_over_barrier_into_box': 'Lob over the barrier into the box', 'toss_over_rim_into_box': 'Toss over the rim into the box',
    'ball_over_barrier_hit_blue': 'Over the barrier, hit the blue ball',
    'topple_chair_and_wall_rebound': 'Knock a chair over and bounce the ball off the wall', 'shove_table_and_toss_into_box': 'Shove the table and toss the ball into the box',
    'topple_two_chairs_and_over_barrier': 'Knock two chairs over and send the ball over the barrier', 'shove_table_and_topple_chair': 'Shove the table and knock a chair over',
    'topple_chair_shove_table_and_wall_rebound': 'Chair over, table shoved, ball off the wall', 'topple_chair_and_box_before_barrier': 'Knock a chair over and stop the box before the barrier'}
PIPELINE_STATIC = ('static_v31', 'b2_room_01_book_between_cups_and_face', 'gpt54', 'patch')
PIPELINE_LAUNCH = ('dynamic_v31', 'b2_room_01_ball_hit_blue_deadline', 'gpt54', 'code_predict')


def load(path):
    with open(path, 'r', encoding='utf-8') as handle:
        return json.load(handle)


def tier(rate):
    return 'hard' if rate < .15 else ('medium' if rate < .5 else 'easy')


def status_of(folder):
    """pass | fail | no answer | pending, plus the record files of one attempt folder."""
    attempt = folder / 'prediction' / 'attempt_record.json'
    if not attempt.is_file():
        return 'pending', {}, {}, {}
    record = load(attempt)
    if record.get('contract_status') != 'valid':
        return 'no answer', record, {}, {}
    dyn, diag = folder / 'evaluation' / 'dyncode_result.json', folder / 'evaluation' / 'diagnostics.json'
    review = folder / 'common_review' / 'review_summary.json'
    reviewed = load(review) if review.is_file() else {}
    if dyn.is_file():
        result = load(dyn)
        return ('pass' if result.get('action_status') == 'PASS_ACTION' else 'fail'), record, result, reviewed
    if diag.is_file() and (folder / 'evaluate_timing.json').is_file():
        result = load(diag)
        return ('pass' if result.get('status') in PASS else 'fail'), record, result, reviewed
    return 'pending', record, {}, reviewed


def pick_contrasts(rows):
    """Examples chosen by verdict: one where GPT-5.4 meets the goal and one where it fails, covering a Qwen success and a Qwen
    failure when they exist; a simulated failure (with a clip) is preferred over a rejected answer, and families differ."""
    done = {t: r for t, r in rows.items() if all(r['models'][p]['status'] in ('pass', 'fail', 'no answer') for p in PROVIDERS)}
    def find(gpt, qwen, avoid):
        for task_id in sorted(done):
            r = done[task_id]
            if r['family'] in avoid:
                continue
            if r['models']['gpt54']['status'] == gpt and r['models']['qwen30t']['status'] in qwen:
                return task_id
        return None
    picks = []
    for gpt, qwen in (('pass', ('pass',)), ('fail', ('fail',)), ('pass', ('fail',)), ('fail', ('pass', 'no answer')), ('pass', ('no answer',)), ('fail', ('no answer',))):
        if len(picks) >= 2 and any(done[t]['models']['qwen30t']['status'] == 'pass' for t in picks) and \
                any(done[t]['models']['gpt54']['status'] == 'fail' for t in picks) or len(picks) >= 3:
            break
        task_id = find(gpt, qwen, {done[t]['family'] for t in picks})
        if task_id and task_id not in picks:
            picks.append(task_id)
    return picks


# ---------- plain-language wording ----------
def name_of(labels, key):
    return 'the ' + labels.get(key, key)


def side_of_wall(axis, side):
    return {(1, 'max'): 'back', (1, 'min'): 'front', (0, 'max'): 'right', (0, 'min'): 'left'}.get((axis, side), '')


def predicate_text(p, labels):
    n = lambda k: name_of(labels, k)
    kind = p['kind']
    if kind == 'closer':
        return '%s at least %.2f m closer to %s' % (n(p['object_id']), p.get('min_reduction_m', .2), n(p['target_id']))
    if kind == 'face':
        return '%s faces %s (within %d degrees)' % (n(p['object_id']), n(p['target_id']), p.get('max_angle_deg', 15))
    if kind == 'swap_xy':
        a, b = p['object_ids']
        return '%s and %s swap places (within %.1f cm)' % (n(a), n(b), 100 * p.get('tolerance_m', .035))
    if kind == 'wall_gap':
        return '%s against the %s wall (gap %.1f to %.0f cm)' % (n(p['object_id']), side_of_wall(p.get('axis'), p.get('side')), 100 * p['gap_min_m'], 100 * p['gap_max_m'])
    if kind == 'near':
        return '%s right next to %s (gap %.1f to %.0f cm)' % (n(p['object_id']), n(p['target_id']), 100 * p['min_gap_m'], 100 * p['max_gap_m'])
    if kind == 'supported_by':
        return '%s resting on %s' % (n(p['object_id']), n(p['support_id']))
    if kind == 'between':
        a, b = p['target_ids']
        return '%s between %s and %s' % (n(p['object_id']), n(a), n(b))
    return kind.replace('_', ' ')


def region_name(goal, manifest, spec=None):
    for container in manifest.get('containers', []):
        inner = container.get('interior_bounds_world_m') or {}
        if inner and all(abs(a - b) < 1e-6 for a, b in zip(inner.get('min', []), goal['bounds_min'])):
            return 'inside the ' + container['label']
    room = manifest['room_bounds_m']
    if goal['bounds_min'][0] <= room['min'][0] + 1e-6 and goal['bounds_max'][0] >= room['max'][0] - 1e-6 and goal['bounds_min'][2] > .3:
        return 'still up on the table'          # composite shove: whatever stood on the table must stay on it
    kinds = {(g['kind'], g.get('object_id')) for g in (spec or {}).get('goal_requirements', [])}
    if ('tilt', goal['object_id']) in kinds:
        return 'near where it stood'
    if any(g['kind'] == 'contact_deadline' and goal['object_id'] in g['object_ids'] and any('wall' in str(i) or i == 'o004' for i in g['object_ids'])
           for g in (spec or {}).get('goal_requirements', [])):
        return 'back on the open floor in front of the wall'
    return 'inside the target area'


def requirement_text(g, labels, manifest, spec=None):
    n = lambda k: name_of(labels, k)
    kind = g['kind']
    if kind == 'contact_deadline':
        a, b = g['object_ids']
        return '%s touches %s within %.1f s' % (n(a), n(b), g.get('deadline_s', 2.))
    if kind == 'no_contact':
        a, b = g['object_ids']
        return '%s never touches %s' % (n(a), n(b))
    if kind == 'ordered_contacts':
        pairs = g['pairs']
        return ', then '.join('%s hits %s' % (n(a), n(b)) for a, b in pairs) + ', within %.1f s' % g.get('deadline_s', 2.)
    if kind == 'end_region':
        where = region_name(g, manifest, spec)
        return ('%s stays on the table' % n(g['object_id'])) if where == 'still up on the table' else '%s ends %s' % (n(g['object_id']), where)
    if kind == 'displacement':
        return '%s moves %.2f to %.2f m' % (n(g['object_id']), g.get('min_distance_m', 0.), min(g.get('max_distance_m', 4.), 4.))
    if kind == 'speed':
        return '%s has come to rest at 2 s' % n(g['object_id'])
    if kind == 'clearance':
        return '%s stops %.0f to %.0f cm short of %s' % (n(g['object_id']), 100 * g.get('min_gap_m', 0.), 100 * g.get('max_gap_m', 0.), n(g['obstacle_id']))
    if kind == 'tilt':
        return '%s tips over (at least %d degrees)' % (n(g['object_id']), g.get('min_angle_deg', 50))
    if kind == 'yaw_change':
        return '%s turns at least %d degrees' % (n(g['object_id']), g.get('min_angle_deg', 30))
    if kind == 'path_between':
        a, b = g['marker_ids']
        return '%s passes between %s and %s' % (n(g['object_id']), n(a), n(b))
    return kind.replace('_', ' ')


def plain_goal_lines(lines):
    """The evaluator's goal lines as short readable statements, in requirement order."""
    out = []
    for line in lines or []:
        ok = line.startswith('PASS')
        body = line[5:]
        kind = body.rsplit('<-', 1)[-1].strip() if '<-' in body else ''
        data = {}
        if '<-' in body and body.strip().startswith('{'):
            try:
                data = json.loads(body[:body.rindex('<-')].strip())
            except ValueError:
                data = {}
        text = {'contact_deadline': 'touched the target in time' if ok else 'did not touch the target in time',
                'no_contact': 'avoided what it must not touch' if ok else 'touched what it must not touch',
                'ordered_contacts': 'contacts in the required order' if ok else 'contacts missing or out of order',
                'end_region': 'ended in the required place' if ok else 'ended in the wrong place',
                'displacement': 'moved the required distance' if ok else 'moved too little or too far',
                'speed': 'came to rest' if ok else 'still moving at 2 s',
                'clearance': 'stopped with the required gap' if ok else 'wrong gap to the obstacle',
                'tilt': 'tipped over' if ok else 'did not tip over',
                'yaw_change': 'turned enough' if ok else 'did not turn enough',
                'path_between': 'passed between the markers' if ok else 'missed the gap between the markers'}.get(kind, kind)
        if kind == 'contact_deadline' and data.get('contact_times_s'):
            text += ' (%.2f s)' % data['contact_times_s'][0]
        if kind == 'displacement' and 'final_displacement_m' in data:
            text += ' (%.2f m)' % data['final_displacement_m']
        if kind == 'tilt' and 'final_tilt_from_world_up_deg' in data:
            text += ' (%.0f degrees)' % data['final_tilt_from_world_up_deg']
        if kind == 'physics audit':
            text = ('no interpenetration' if ok else 'objects interpenetrated') if 'penetration' in body else ('stayed inside the room' if ok else 'left the room')
        out.append(('PASS ' if ok else 'FAIL ') + text)
    return out


def plain_static_lines(lines):
    out = []
    for line in lines or []:
        ok = line.startswith('PASS'); body = line[5:]
        key = body.split(':')[0].strip()
        text = {'closer': 'closer to the target', 'face': 'faces the target', 'swap': 'swapped places', 'wall gap': 'against the wall',
                'near': 'next to the target', 'support': 'resting on its support', 'between': 'between the two objects',
                'interpenetration': 'no interpenetration', 'settling': 'stays put after settling', 'inside room bounds': 'inside the room',
                'unchanged pose': 'other objects unchanged'}.get(key, key)
        out.append(('PASS ' if ok else 'FAIL ') + text)
    return out


# ---------- media ----------
def save_jpeg(source, target, width=None, box=None):
    from PIL import Image, ImageDraw
    target.parent.mkdir(parents=True, exist_ok=True)
    with Image.open(source) as image:
        image = image.convert('RGB')
        if box:
            draw = ImageDraw.Draw(image)
            x0, y0, x1, y1 = box
            for i in range(0, 4):   # a dashed amber outline, 3 px
                for x in range(int(x0), int(x1), 12):
                    draw.line([(x, y0 + i - 1), (min(x + 7, x1), y0 + i - 1)], fill='#f5a623')
                    draw.line([(x, y1 + i - 1), (min(x + 7, x1), y1 + i - 1)], fill='#f5a623')
                for y in range(int(y0), int(y1), 12):
                    draw.line([(x0 + i - 1, y), (x0 + i - 1, min(y + 7, y1))], fill='#f5a623')
                    draw.line([(x1 + i - 1, y), (x1 + i - 1, min(y + 7, y1))], fill='#f5a623')
        if width and image.width != width:
            image = image.resize((width, round(image.height * width / image.width)), Image.LANCZOS)
        image.save(target, 'JPEG', quality=85, optimize=True)


def copy_clip(source, target, ffmpeg):
    target.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run([ffmpeg, '-y', '-loglevel', 'error', '-i', str(source), '-c', 'copy', '-movflags', '+faststart', '-an', str(target)], check=True)


def project_box(camera, points, margin=24):
    """Pixel rectangle around the projection of world points in a pinhole camera (x right, y down), clipped to the image."""
    eye, target, up = camera['eye'], camera['target'], camera.get('up', [0, 0, 1])
    def unit(v):
        n = math.sqrt(sum(x * x for x in v)); return [x / n for x in v]
    f = unit([t - e for t, e in zip(target, eye)])
    r = unit([f[1] * up[2] - f[2] * up[1], f[2] * up[0] - f[0] * up[2], f[0] * up[1] - f[1] * up[0]])
    u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]]
    W, H = camera['width'], camera['height']
    focal = (W / 2) / math.tan(math.radians(camera['hfov']) / 2)
    xs, ys = [], []
    for p in points:
        d = [a - b for a, b in zip(p, eye)]
        z = sum(a * b for a, b in zip(d, f))
        if z <= 1e-6:
            continue
        xs.append(W / 2 + focal * sum(a * b for a, b in zip(d, r)) / z)
        ys.append(H / 2 - focal * sum(a * b for a, b in zip(d, u)) / z)
    if not xs:
        return None
    return [max(2, min(xs) - margin), max(2, min(ys) - margin), min(W - 3, max(xs) + margin), min(H - 3, max(ys) + margin)]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--simagent-root', type=Path, default=Path(os.environ.get('SIMAGENT_ROOT', REPO.parent)))
    parser.add_argument('--output', type=Path, default=REPO / 'static/data/benchmark_results.js')
    args = parser.parse_args()
    root = args.simagent_root.resolve()
    import sys
    sys.path.insert(0, str(root))
    from simagent.geometry import world_aabb
    runs = root / 'runs/benchmark_v3'
    chance_dir = runs / 'chance_baseline_v1'
    images_dir, media_dir = REPO / 'static/images/benchmark', REPO / 'static/media/benchmark'
    try:
        import imageio_ffmpeg
        ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    except ImportError:
        ffmpeg = shutil.which('ffmpeg')
    if not ffmpeg:
        raise RuntimeError('ffmpeg not found; run with the simagent Isaac interpreter')
    chance = {}
    for folder in chance_dir.iterdir() if chance_dir.is_dir() else []:
        search = folder / 'search.json'
        if search.is_file():
            summary = load(search).get('summary') or {}
            if summary.get('samples'):
                chance[folder.name] = summary['solved'] / summary['samples']
    rel = lambda path: str(path.relative_to(REPO))

    types, examples = [], {}
    for key, campaign, condition, label, blurb in TYPES:
        run = runs / campaign
        if not (run / 'selection.json').is_file():
            types.append({'key': key, 'label': label, 'blurb': blurb, 'available': False, 'tasks': 0, 'note': 'in progress'})
            continue
        frozen = load(run / 'selection.json')
        jobs = {job['task_id']: job for job in frozen['jobs']}
        rows = {}
        for task_id, job in jobs.items():
            rows[task_id] = {'family': job['family'], 'instruction': job['instruction'], 'room': int(task_id.split('_')[2]),
                             'chance': chance.get(task_id), 'tier': tier(chance[task_id]) if task_id in chance else None, 'models': {}}
            for provider in PROVIDERS:
                status, record, result, reviewed = status_of(run / 'cases' / task_id / (provider + '__' + condition))
                rows[task_id]['models'][provider] = {'status': status, 'review': reviewed.get('effective_result') if reviewed else None}
        n = len(rows)
        per_model = {}
        for provider in PROVIDERS:
            statuses = [row['models'][provider]['status'] for row in rows.values()]
            evaluated = sum(s in ('pass', 'fail', 'no answer') for s in statuses)
            tiers = {name: {'tasks': sum(row['tier'] == name for row in rows.values()),
                            'passed': sum(row['tier'] == name and row['models'][provider]['status'] == 'pass' for row in rows.values())}
                     for name in ('easy', 'medium', 'hard')}
            reviews = [(row['models'][provider]['status'], row['models'][provider]['review']) for row in rows.values()
                       if row['models'][provider]['review'] in ('model_pass', 'model_fail', 'fail_verifiable', 'model_uncertain')]
            per_model[provider] = {'passed': statuses.count('pass'), 'failed': statuses.count('fail'), 'no_answer': statuses.count('no answer'),
                                   'pending': n - evaluated, 'evaluated': evaluated, 'tiers': tiers, 'reviews': len(reviews),
                                   'review_agreement': sum((s == 'pass') == (r == 'model_pass') for s, r in reviews)}
        graded = [row['chance'] for row in rows.values() if row['chance'] is not None]
        types.append({'key': key, 'label': label, 'blurb': blurb, 'available': True, 'tasks': n,
                      'complete': all(per_model[p]['pending'] == 0 for p in PROVIDERS),
                      'rooms': len({row['room'] for row in rows.values()}), 'families': len({row['family'] for row in rows.values()}),
                      'chance_mean': (sum(graded) / len(graded)) if graded else None, 'graded': len(graded),
                      'tiers': {name: sum(row['tier'] == name for row in rows.values()) for name in ('easy', 'medium', 'hard')},
                      'models': per_model})

        wanted = EXAMPLES.get(key)
        if wanted is None:
            wanted = pick_contrasts(rows)
        elif key == 'composite':
            qwen_pass = [t for t in sorted(rows) if rows[t]['models']['qwen30t']['status'] == 'pass' and t not in wanted]
            if qwen_pass and not any(rows.get(t, {}).get('models', {}).get('qwen30t', {}).get('status') == 'pass' for t in wanted):
                wanted = wanted + qwen_pass[:1]
        chosen = []
        for task_id in wanted:
            if task_id not in rows or any(rows[task_id]['models'][p]['status'] == 'pending' for p in PROVIDERS):
                continue
            row = rows[task_id]
            witness = run / 'witness' / task_id
            bundle = run / 'public_bundles' / task_id
            manifest = load(bundle / 'scene_manifest.json')
            spec = load(run / 'private_inputs' / (task_id + '.json'))
            labels = {o['id']: o['label'] for o in manifest['objects']}
            dynamic = key != 'static'
            example = {'task_id': task_id, 'type': key, 'room': row['room'], 'family': row['family'],
                       'family_label': FAMILY_LABELS.get(row['family'], row['family'].replace('_', ' ')), 'instruction': row['instruction'],
                       'chance': row['chance'], 'tier': row['tier'], 'models': {}, 'truth': {}}
            out_images, out_media = images_dir / task_id, media_dir / task_id
            if dynamic:
                example['truth']['requirements'] = [requirement_text(g, labels, manifest, spec) for g in spec.get('goal_requirements', [])]
                launch = load(witness / 'witness_launch.json') if (witness / 'witness_launch.json').is_file() else None
                example['truth']['launch'] = [dict(a, label=labels.get(a['id'], a['id'])) for a in launch] if launch else launch
                save_jpeg(witness / 'frames' / 'frame_000.png', out_images / 'truth_poster.jpg')
                copy_clip(witness / 'rollout.mp4', out_media / 'truth.mp4', ffmpeg)
                example['truth'].update(poster=rel(out_images / 'truth_poster.jpg'), video=rel(out_media / 'truth.mp4'))
            else:
                example['truth']['requirements'] = [predicate_text(p, labels) for p in spec.get('predicates', [])]
                closeup = images_dir / task_id / 'closeup.json'
                box = None
                if closeup.is_file():
                    info = load(closeup)
                    front = next(c for c in manifest['cameras'] if c['id'] == 'front')
                    points = []
                    for key_id in info['relevant_ids']:
                        lo, hi = world_aabb(next(o for o in manifest['objects'] if o['id'] == key_id))
                        points += [[(lo, hi)[i][0], (lo, hi)[j][1], (lo, hi)[k][2]] for i in (0, 1) for j in (0, 1) for k in (0, 1)]
                    box = project_box(front, points)
                save_jpeg(witness / 'before' / 'front.png', out_images / 'overview.jpg', box=box)
                example['truth']['overview'] = rel(out_images / 'overview.jpg')
                for name in ('before', 'truth'):
                    image = images_dir / task_id / ('closeup_%s.jpg' % name)
                    if image.is_file():
                        example['truth']['closeup_' + name] = rel(image)
                if 'closeup_truth' not in example['truth']:   # close-ups not rendered yet: the overview render stands in
                    save_jpeg(witness / 'images' / 'front.png', out_images / 'truth.jpg')
                    example['truth']['closeup_truth'] = rel(out_images / 'truth.jpg')
            for provider in PROVIDERS:
                folder = run / 'cases' / task_id / (provider + '__' + condition)
                status, record, result, reviewed = status_of(folder)
                judgment = (reviewed.get('advisory_model_judgment') or {}) if reviewed else {}
                entry = {'status': status, 'lines': [], 'reviewer': None, 'answer': None}
                if reviewed:
                    entry['reviewer'] = {'overall': judgment.get('overall'), 'reason': (judgment.get('reason') or '')[:240]}
                if status == 'no answer':
                    entry['error'] = 'no usable answer: ' + (record.get('error') or record.get('contract_error') or '')[:120]
                if dynamic and result:
                    entry['lines'] = plain_goal_lines(result.get('goal_lines'))
                    entry['answer'] = [dict(a, label=labels.get(a['id'], a['id'])) for a in (result.get('launch') or [])]
                    forecast = result.get('self_prediction') or {}
                    if forecast.get('status') == 'scored':
                        entry['forecast_error_m'] = round(forecast['endpoint_error_m'], 2)
                    frames = folder / 'evaluation' / 'reference_media'
                    if (frames / 'rollout.mp4').is_file():
                        save_jpeg(frames / 'frames' / 'frame_000.png', out_images / (provider + '_poster.jpg'))
                        copy_clip(frames / 'rollout.mp4', out_media / (provider + '.mp4'), ffmpeg)
                        entry.update(poster=rel(out_images / (provider + '_poster.jpg')), video=rel(out_media / (provider + '.mp4')))
                elif not dynamic and status in ('pass', 'fail'):
                    entry['lines'] = plain_static_lines((reviewed or {}).get('measurement_lines') or [])
                    patch = folder / 'prediction' / 'patch_v2.json'
                    entry['answer'] = load(patch).get('changes') if patch.is_file() else None
                    image = images_dir / task_id / ('closeup_%s.jpg' % provider)
                    if image.is_file():
                        entry['closeup'] = rel(image)
                    else:
                        save_jpeg(folder / 'evaluation' / 'committed' / 'front.png', out_images / (provider + '.jpg'))
                        entry['closeup'] = rel(out_images / (provider + '.jpg'))
                example['models'][provider] = entry
            chosen.append(example)
        examples[key] = chosen

    featured = []
    for key, task_id, headline in FEATURED:
        match = next((e for e in examples.get(key, []) if e['task_id'] == task_id), None)
        if match is None:
            raise RuntimeError('featured example %s is missing or not evaluated' % task_id)
        featured.append(dict(match, headline=headline))

    # pipeline samples (real records): one static edit and one launch, GPT-5.4's attempts
    pipeline = {}
    for name, (campaign, task_id, provider, condition) in (('static', PIPELINE_STATIC), ('launch', PIPELINE_LAUNCH)):
        run = runs / campaign
        folder = run / 'cases' / task_id / (provider + '__' + condition)
        bundle = run / 'public_bundles' / task_id
        task = load(bundle / 'task.json')
        scene = load(folder / 'prediction' / 'model_scene.json')
        target = next(o for o in scene['objects'] if o['id'] == ('o011' if name == 'static' else 'o024'))
        status, record, result, reviewed = status_of(folder)
        usage = record.get('usage') or {}
        sample = {'task_id': task_id, 'instruction': task['instruction'], 'objects': len(scene['objects']),
                  'object_row': {k: target[k] for k in ('id', 'label', 'position', 'mass_kg', 'friction') if k in target},
                  'prompt_tokens': usage.get('input_tokens'), 'answer_tokens': usage.get('visible_answer_tokens'),
                  'reasoning_tokens': usage.get('reasoning_tokens'), 'status': status, 'provider': PROVIDERS[provider]}
        if name == 'static':
            sample['answer'] = load(folder / 'prediction' / 'patch_v2.json')['changes']
            sample['checks'] = plain_static_lines((reviewed or {}).get('measurement_lines') or [])
        else:
            sample['answer'] = result.get('launch')
            sample['checks'] = plain_goal_lines(result.get('goal_lines'))
            sample['program_lines'] = sum(1 for _ in open(folder / 'prediction' / 'code.py', encoding='utf-8'))
        if reviewed:
            judgment = reviewed.get('advisory_model_judgment') or {}
            sample['reviewer'] = {'overall': judgment.get('overall'), 'reason': (judgment.get('reason') or '')[:220]}
        sample['view_images'] = []
        for view in task['public_views']:
            target_path = images_dir / 'pipeline' / (name + '_' + view.replace('.png', '.jpg'))
            save_jpeg(bundle / view, target_path, width=480)
            sample['view_images'].append(rel(target_path))
        pipeline[name] = sample

    data = {'generated_at': datetime.datetime.now().strftime('%Y-%m-%d %H:%M'), 'providers': PROVIDERS,
            'types': types, 'examples': examples, 'featured': featured, 'pipeline': pipeline,
            'difficulty': {'hard': 'random answers pass under 15 percent of the time', 'medium': '15 to 50 percent', 'easy': '50 percent or more'}}
    header = ('// Generated by tools/extract_benchmark_results.py from the simagent repository; do not edit by hand.\n'
              '// GPT-5.4 and Qwen3-VL-30B Thinking on the benchmark; every number and picture is a real record.\n')
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(header + 'window.BM_RESULTS = ' + json.dumps(data, indent=1) + ';\n', encoding='utf-8')
    print('wrote', args.output, 'types', [(t['key'], t.get('tasks'), t.get('complete')) for t in types],
          'examples', {k: len(v) for k, v in examples.items()}, 'featured', [f['task_id'] for f in featured])


if __name__ == '__main__':
    main()
