#!/usr/bin/env python3
"""Build the data and media of the benchmark-results block and page from the simagent campaigns.

Reads the protocol v3.1 campaigns of the simagent repository (static edits, floor launches, throws, direct launches and the
composite tasks when present) for GPT-5.4 and Qwen3-VL-30B Thinking, the random-answer baseline of every task, and the
reviewer summaries.  Writes ``static/data/benchmark_results.js`` (``window.BM_RESULTS``) and the downsized renders, frame
strips and short videos under ``static/images/benchmark/`` and ``static/media/benchmark/``.  Every number and picture is a
real record; the script fails instead of guessing when a required input is missing.

Needs Pillow (image resizing) and the ffmpeg binary that imageio-ffmpeg ships, so run it with the simagent Isaac interpreter:

    /path/to/simagent/.envs/isaac/bin/python tools/extract_benchmark_results.py [--simagent-root PATH] [--no-media]
"""
import argparse
import datetime
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
PROVIDERS = {'gpt54': 'GPT-5.4', 'qwen30t': 'Qwen3-VL-30B Thinking'}
PASS = {'PASS_NUMERIC_SCREEN', 'PASS_ACTION'}
# task type: campaign, condition, label, kind
TYPES = [
    ('static', 'static_v31', 'patch', 'Static edits', 'Move and turn furniture and objects; the answer is the new poses as JSON.'),
    ('launch', 'dynamic_v31', 'code_predict', 'Launch tasks', 'Give one object a velocity so that something happens; the answer is a program that computes it.'),
    ('throw', 'hard_v31', 'code_predict', 'Throws over a barrier or box rim', 'The same, with a ball that must fly over an obstacle; program answers.'),
    ('direct', 'launch_v31', 'launch', 'Launch tasks and throws, velocity as JSON', 'The same 80 tasks, answered with the velocity directly instead of a program.'),
    ('composite', 'composite_v1', 'launch', 'Composite tasks', 'Two or three objects set in motion at once: knock chairs over, shove the table, throw the ball; one velocity per object as JSON.'),
]
# Illustrative examples: a mix of rooms, furniture and task families, and of agreements and disagreements between the models.
EXAMPLES = {
    'static': ['b2_room_01_book_between_cups_and_face', 'b2_room_04_sofa_wall_and_chair', 'b2_room_08_chairs_gather_and_face',
               'b2_room_09_stool_box_swap_and_face', 'b2_room_12_swap_cups_and_turn_chair', 'b2_room_13_chairs_face_different_targets'],
    'launch': ['b2_room_01_ball_hit_blue_deadline', 'b2_room_09_off_table_into_open_box', 'b2_room_07_three_ball_contact_chain',
               'b2_room_06_box_spin_in_zone', 'b2_room_10_stool_topple_in_zone', 'b2_room_13_ball_pass_between_markers'],
    'throw': ['b2_room_03_ball_over_barrier_hit_blue', 'b2_room_11_lob_over_barrier_into_box', 'b2_room_12_toss_over_rim_into_box',
              'b2_room_05_toss_over_rim_into_box'],
    'direct': ['b2_room_02_ball_hit_blue_deadline', 'b2_room_10_off_table_into_open_box', 'b2_room_01_toss_over_rim_into_box', 'b2_room_14_lob_over_barrier_into_box'],
    'composite': None,  # chosen automatically: the first evaluated case of each family
}
VIDEOS = {'launch': 3, 'throw': 2, 'direct': 2, 'composite': 3}   # how many examples per type also get short videos
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
        if result.get('status') in PASS:
            return 'pass', record, result, reviewed
        if result.get('status') in ('FAIL_NUMERIC_SCREEN',):
            return 'fail', record, result, reviewed
        return 'fail', record, result, reviewed
    return 'pending', record, {}, reviewed


def plain_goal_lines(lines):
    """Turn the evaluator's goal lines into short readable statements."""
    out = []
    for line in lines or []:
        ok = line.startswith('PASS')
        body = line[5:]
        kind = body.rsplit('<-', 1)[-1].strip() if '<-' in body else ''
        data = {}
        try:
            data = json.loads(body[:body.rindex('<-')].strip()) if '<-' in body and body.strip().startswith('{') else {}
        except ValueError:
            data = {}
        text = {'contact_deadline': 'touched the target in time' if ok else 'did not touch the target in time',
                'no_contact': 'avoided the object it must not touch' if ok else 'touched an object it must not touch',
                'ordered_contacts': 'contacts happened in the required order' if ok else 'contacts did not happen in order',
                'end_region': 'ended inside the required area' if ok else 'ended outside the required area',
                'displacement': 'moved the required distance' if ok else 'moved too little or too far',
                'speed': 'came to rest in time' if ok else 'was still moving at 2 s',
                'clearance': 'stopped with the required gap' if ok else 'wrong gap to the obstacle',
                'tilt': 'tipped over as required' if ok else 'did not tip over enough',
                'yaw_change': 'turned as required' if ok else 'did not turn enough',
                'path_between': 'passed between the markers' if ok else 'did not pass between the markers',
                'physics audit': ('no interpenetration, stayed in the room' if ok else 'physics gate failed')}.get(kind, kind)
        if kind == 'contact_deadline' and data.get('contact_times_s'):
            text += ' (%.2f s)' % data['contact_times_s'][0]
        if kind == 'displacement' and 'final_displacement_m' in data:
            text += ' (%.2f m)' % data['final_displacement_m']
        if kind == 'physics audit' and 'penetration' in body:
            text = ('no interpenetration' if ok else 'objects interpenetrated')
        elif kind == 'physics audit' and 'room' in body:
            text = ('stayed inside the room' if ok else 'left the room')
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


def resize_jpeg(source, target, width):
    from PIL import Image
    target.parent.mkdir(parents=True, exist_ok=True)
    with Image.open(source) as image:
        image = image.convert('RGB')
        height = round(image.height * width / image.width)
        image.resize((width, height), Image.LANCZOS).save(target, 'JPEG', quality=82, optimize=True)


def frame_strip(frames_dir, target, indices=(0, 20, 40, 60), width=300):
    from PIL import Image, ImageDraw
    frames = []
    for index in indices:
        path = frames_dir / ('frame_%03d.png' % index)
        if not path.is_file():
            raise FileNotFoundError(str(path))
        with Image.open(path) as image:
            image = image.convert('RGB')
            frames.append(image.resize((width, round(image.height * width / image.width)), Image.LANCZOS))
    height = frames[0].height
    strip = Image.new('RGB', (width * len(frames) + 4 * (len(frames) - 1), height), '#ffffff')
    draw = ImageDraw.Draw(strip)
    for i, frame in enumerate(frames):
        x = i * (width + 4)
        strip.paste(frame, (x, 0))
        label = 't = %.2f s' % (indices[i] / 30.)
        draw.rectangle([x + 4, 4, x + 76, 20], fill='#ffffff')
        draw.text((x + 8, 6), label, fill='#333333')
    target.parent.mkdir(parents=True, exist_ok=True)
    strip.save(target, 'JPEG', quality=82, optimize=True)


def convert_video(source, target, ffmpeg):
    target.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run([ffmpeg, '-y', '-loglevel', 'error', '-i', str(source), '-vf', 'scale=480:-2', '-c:v', 'libx264', '-crf', '28',
                    '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', str(target)], check=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--simagent-root', type=Path, default=Path(os.environ.get('SIMAGENT_ROOT', REPO.parent)))
    parser.add_argument('--output', type=Path, default=REPO / 'static/data/benchmark_results.js')
    parser.add_argument('--no-media', action='store_true', help='numbers only; keep the images and videos already there')
    args = parser.parse_args()
    root = args.simagent_root.resolve()
    runs = root / 'runs/benchmark_v3'
    chance_dir = runs / 'chance_baseline_v1'
    images_dir, media_dir = REPO / 'static/images/benchmark', REPO / 'static/media/benchmark'
    ffmpeg = None
    if not args.no_media:
        try:
            import imageio_ffmpeg
            ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
        except ImportError:
            ffmpeg = shutil.which('ffmpeg')
    chance = {}
    for folder in chance_dir.iterdir() if chance_dir.is_dir() else []:
        search = folder / 'search.json'
        if search.is_file():
            summary = load(search).get('summary') or {}
            if summary.get('samples'):
                chance[folder.name] = summary['solved'] / summary['samples']

    types, examples, generated_media = [], {}, []
    for key, campaign, condition, label, blurb in TYPES:
        run = runs / campaign
        selection = run / 'selection.json'
        if not selection.is_file():
            types.append({'key': key, 'label': label, 'blurb': blurb, 'available': False, 'tasks': 0, 'note': 'not generated yet'})
            continue
        frozen = load(selection)
        jobs = {job['task_id']: job for job in frozen['jobs']}
        rows = {}
        for task_id, job in jobs.items():
            rows[task_id] = {'family': job['family'], 'instruction': job['instruction'], 'room': int(task_id.split('_')[2]),
                             'chance': chance.get(task_id), 'tier': tier(chance[task_id]) if task_id in chance else None, 'models': {}}
            for provider in PROVIDERS:
                folder = run / 'cases' / task_id / (provider + '__' + condition)
                status, record, result, reviewed = status_of(folder)
                rows[task_id]['models'][provider] = {'status': status, 'review': (reviewed.get('effective_result') if reviewed else None)}
        n = len(rows)
        per_model = {}
        for provider in PROVIDERS:
            statuses = [row['models'][provider]['status'] for row in rows.values()]
            evaluated = sum(s in ('pass', 'fail', 'no answer') for s in statuses)
            tiers = {}
            for name in ('easy', 'medium', 'hard'):
                members = [row for row in rows.values() if row['tier'] == name]
                tiers[name] = {'tasks': len(members), 'passed': sum(row['models'][provider]['status'] == 'pass' for row in members)}
            reviews = [(row['models'][provider]['status'], row['models'][provider]['review']) for row in rows.values() if row['models'][provider]['review'] in ('model_pass', 'model_fail', 'fail_verifiable', 'model_uncertain')]
            agree = sum((s == 'pass') == (r == 'model_pass') for s, r in reviews)
            per_model[provider] = {'passed': statuses.count('pass'), 'failed': statuses.count('fail'), 'no_answer': statuses.count('no answer'),
                                   'pending': n - evaluated, 'evaluated': evaluated, 'tiers': tiers,
                                   'reviews': len(reviews), 'review_agreement': agree}
        graded = [row['chance'] for row in rows.values() if row['chance'] is not None]
        complete = all(per_model[p]['pending'] == 0 for p in PROVIDERS)
        types.append({'key': key, 'label': label, 'blurb': blurb, 'available': True, 'tasks': n, 'complete': complete,
                      'rooms': len({row['room'] for row in rows.values()}), 'families': len({row['family'] for row in rows.values()}),
                      'chance_mean': (sum(graded) / len(graded)) if graded else None, 'graded': len(graded),
                      'tiers': {name: sum(row['tier'] == name for row in rows.values()) for name in ('easy', 'medium', 'hard')},
                      'models': per_model})
        # examples
        wanted = EXAMPLES.get(key)
        if wanted is None:
            seen, wanted = set(), []
            for task_id in sorted(rows):
                family = rows[task_id]['family']
                if family not in seen and all(rows[task_id]['models'][p]['status'] in ('pass', 'fail', 'no answer') for p in PROVIDERS):
                    seen.add(family); wanted.append(task_id)
        chosen = []
        for index, task_id in enumerate(wanted):
            if task_id not in rows:
                continue
            row = rows[task_id]
            if any(row['models'][p]['status'] == 'pending' for p in PROVIDERS):
                continue
            witness = run / 'witness' / task_id
            dynamic = key != 'static'
            example = {'task_id': task_id, 'type': key, 'room': row['room'], 'family': row['family'],
                       'family_label': FAMILY_LABELS.get(row['family'], row['family'].replace('_', ' ')), 'instruction': row['instruction'],
                       'chance': row['chance'], 'tier': row['tier'], 'models': {}, 'media': {}}
            if not args.no_media:
                if dynamic:
                    frame_strip(witness / 'frames', images_dir / task_id / 'truth_strip.jpg')
                    example['media']['truth_strip'] = 'static/images/benchmark/%s/truth_strip.jpg' % task_id
                    if ffmpeg and index < VIDEOS.get(key, 0) and (witness / 'rollout.mp4').is_file():
                        convert_video(witness / 'rollout.mp4', media_dir / task_id / 'truth.mp4', ffmpeg)
                        example['media']['truth_video'] = 'static/media/benchmark/%s/truth.mp4' % task_id
                else:
                    resize_jpeg(witness / 'before' / 'front.png', images_dir / task_id / 'before.jpg', 480)
                    resize_jpeg(witness / 'images' / 'front.png', images_dir / task_id / 'truth.jpg', 480)
                    example['media']['before'] = 'static/images/benchmark/%s/before.jpg' % task_id
                    example['media']['truth'] = 'static/images/benchmark/%s/truth.jpg' % task_id
            else:
                if dynamic:
                    example['media']['truth_strip'] = 'static/images/benchmark/%s/truth_strip.jpg' % task_id
                    if (media_dir / task_id / 'truth.mp4').is_file():
                        example['media']['truth_video'] = 'static/media/benchmark/%s/truth.mp4' % task_id
                else:
                    example['media']['before'] = 'static/images/benchmark/%s/before.jpg' % task_id
                    example['media']['truth'] = 'static/images/benchmark/%s/truth.jpg' % task_id
            witness_launch = witness / 'witness_launch.json'
            if witness_launch.is_file():
                example['truth_launch'] = load(witness_launch)
            for provider in PROVIDERS:
                folder = run / 'cases' / task_id / (provider + '__' + condition)
                status, record, result, reviewed = status_of(folder)
                judgment = (reviewed.get('advisory_model_judgment') or {}) if reviewed else {}
                entry = {'status': status, 'lines': [], 'reviewer': None, 'media': {}, 'answer': None}
                if reviewed:
                    entry['reviewer'] = {'overall': judgment.get('overall'), 'effective': reviewed.get('effective_result'),
                                         'reason': (judgment.get('reason') or '')[:260]}
                if status == 'no answer':
                    entry['error'] = (record.get('error') or record.get('contract_error') or 'no usable answer')[:160]
                if dynamic and result:
                    entry['lines'] = plain_goal_lines(result.get('goal_lines'))
                    entry['answer'] = result.get('launch')
                    forecast = result.get('self_prediction') or {}
                    if forecast.get('status') == 'scored':
                        entry['forecast_error_m'] = round(forecast['endpoint_error_m'], 2)
                    frames = folder / 'evaluation' / 'reference_media' / 'frames'
                    if not args.no_media and frames.is_dir():
                        frame_strip(frames, images_dir / task_id / (provider + '_strip.jpg'))
                        entry['media']['strip'] = 'static/images/benchmark/%s/%s_strip.jpg' % (task_id, provider)
                        video = folder / 'evaluation' / 'reference_media' / 'rollout.mp4'
                        if ffmpeg and index < VIDEOS.get(key, 0) and video.is_file():
                            convert_video(video, media_dir / task_id / (provider + '.mp4'), ffmpeg)
                            entry['media']['video'] = 'static/media/benchmark/%s/%s.mp4' % (task_id, provider)
                    elif args.no_media:
                        if (images_dir / task_id / (provider + '_strip.jpg')).is_file():
                            entry['media']['strip'] = 'static/images/benchmark/%s/%s_strip.jpg' % (task_id, provider)
                        if (media_dir / task_id / (provider + '.mp4')).is_file():
                            entry['media']['video'] = 'static/media/benchmark/%s/%s.mp4' % (task_id, provider)
                elif not dynamic and status in ('pass', 'fail'):
                    entry['lines'] = plain_static_lines((reviewed or {}).get('measurement_lines') or [])
                    patch = folder / 'prediction' / 'patch_v2.json'
                    if patch.is_file():
                        entry['answer'] = load(patch).get('changes')
                    committed = folder / 'evaluation' / 'committed' / 'front.png'
                    if not args.no_media and committed.is_file():
                        resize_jpeg(committed, images_dir / task_id / (provider + '.jpg'), 480)
                        entry['media']['after'] = 'static/images/benchmark/%s/%s.jpg' % (task_id, provider)
                    elif args.no_media and (images_dir / task_id / (provider + '.jpg')).is_file():
                        entry['media']['after'] = 'static/images/benchmark/%s/%s.jpg' % (task_id, provider)
                example['models'][provider] = entry
            chosen.append(example)
        examples[key] = chosen

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
        sample = {'task_id': task_id, 'instruction': task['instruction'], 'views': task['public_views'], 'objects': len(scene['objects']),
                  'object_row': {k: target[k] for k in ('id', 'label', 'position', 'mass_kg', 'friction') if k in target},
                  'prompt_tokens': (record.get('usage') or {}).get('input_tokens'), 'answer_tokens': (record.get('usage') or {}).get('visible_answer_tokens'),
                  'reasoning_tokens': (record.get('usage') or {}).get('reasoning_tokens'), 'status': status, 'provider': PROVIDERS[provider]}
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
        if not args.no_media:
            for view in task['public_views']:
                resize_jpeg(bundle / view, images_dir / 'pipeline' / (name + '_' + view.replace('.png', '.jpg')), 320)
        sample['view_images'] = ['static/images/benchmark/pipeline/%s_%s' % (name, view.replace('.png', '.jpg')) for view in task['public_views']]
        pipeline[name] = sample

    data = {'generated_at': datetime.datetime.now().strftime('%Y-%m-%d %H:%M'), 'protocol': 'v3.1', 'providers': PROVIDERS,
            'types': types, 'examples': examples, 'pipeline': pipeline,
            'difficulty': {'hard': 'random answers pass under 15 percent of the time', 'medium': '15 to 50 percent', 'easy': '50 percent or more'},
            'reviewer': 'GPT-5.4 looks at the rendered result (four frames of the simulation for launches, before and after renders for static edits) with the measured numbers in front of it and gives an advisory verdict; it can never overturn a failed measurement.'}
    header = ('// Generated by tools/extract_benchmark_results.py from the simagent repository; do not edit by hand.\n'
              '// Protocol v3.1 campaigns, GPT-5.4 and Qwen3-VL-30B Thinking; every number and picture is a real record.\n')
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(header + 'window.BM_RESULTS = ' + json.dumps(data, indent=1) + ';\n', encoding='utf-8')
    print('wrote', args.output, 'types', [(t['key'], t.get('tasks'), t.get('complete')) for t in types], 'examples', {k: len(v) for k, v in examples.items()})


if __name__ == '__main__':
    main()
