#!/usr/bin/env python3
"""Close-up clips of recorded simulations for the benchmark results page (Isaac job).

For each task, the recorded PhysX rollouts of the reference launch and of both models' launches are replayed (poses set
frame by frame, no new physics) from one camera fitted to the chosen objects over every frame of all three rollouts.
Writes ``static/media/benchmark/<task>/closeup_{truth,gpt54,qwen30t}.mp4`` and a first-frame poster per clip under
``static/images/benchmark/<task>/``.

    sbatch --partition=main --gres=gpu:a5000:1 --exclude=ccvl38,ccvl34 /path/to/simagent/scripts/isaac_job.sbatch \\
        /path/to/project-dashboard/tools/render_rollout_closeups.py --campaign composite_v1 --task TASK --objects o006 o007
"""
import argparse
import copy
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent


def load(path):
    with open(path, 'r', encoding='utf-8') as handle:
        return json.load(handle)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--simagent-root', type=Path, default=REPO.parent)
    parser.add_argument('--campaign', required=True)
    parser.add_argument('--condition', default='launch')
    parser.add_argument('--task', action='append', required=True, help='task id; repeat for several tasks')
    parser.add_argument('--objects', action='append', nargs='+', required=True, help='object ids to frame, one group per --task')
    args, kit_args = parser.parse_known_args()
    sys.argv = [sys.argv[0], *kit_args]
    if len(args.task) != len(args.objects):
        parser.error('give one --objects group per --task')
    root = args.simagent_root.resolve()
    sys.path.insert(0, str(root))
    sys.path.insert(0, str(HERE))
    import imageio.v2 as imageio
    from PIL import Image
    from render_closeups import fit_closeup
    from simagent.benchmark_scenes import freeze
    from simagent.geometry import camera_calibration, world_aabb
    from simagent.isaac_backend import IsaacWorld, close_app
    run = root / 'runs/benchmark_v3' / args.campaign
    for task_id, ids in zip(args.task, args.objects):
        manifest = load(run / 'public_bundles' / task_id / 'scene_manifest.json')
        job = next(j for j in load(run / 'selection.json')['jobs'] if j['task_id'] == task_id)
        rollouts = {'truth': load(Path(job['witness_patch']).parent / 'reference_rollout.json')}
        for provider in ('gpt54', 'qwen30t'):
            path = run / 'cases' / task_id / (provider + '__' + args.condition) / 'evaluation' / 'reference_rollout.json'
            if path.is_file():
                rollouts[provider] = load(path)
        objects = {o['id']: o for o in manifest['objects']}
        points = []
        for rollout in rollouts.values():
            for sample in rollout['states'][::5]:
                for state in sample['objects']:
                    if state['id'] in ids:
                        lo, hi = world_aabb(dict(objects[state['id']], position=state['position'], quaternion_wxyz=state['quaternion_wxyz']))
                        points += [[(lo, hi)[i][0], (lo, hi)[j][1], (lo, hi)[k][2]] for i in (0, 1) for j in (0, 1) for k in (0, 1)]
        camera = fit_closeup(points, manifest['room_bounds_m'], width=640, height=480, hfov=55.)
        camera['calibration'] = camera_calibration(camera)
        scene = copy.deepcopy(manifest)
        scene['cameras'] = [c for c in scene['cameras'] if c['id'] != 'closeup'] + [camera]
        freeze(scene)
        media, images = REPO / 'static/media/benchmark' / task_id, REPO / 'static/images/benchmark' / task_id
        media.mkdir(parents=True, exist_ok=True); images.mkdir(parents=True, exist_ok=True)
        with IsaacWorld(scene, render=True) as world:
            for name, rollout in rollouts.items():
                target = media / ('closeup_%s.mp4' % name)
                with imageio.get_writer(str(target), fps=30, macro_block_size=1, codec='libx264', quality=7, pixelformat='yuv420p',
                                        ffmpeg_params=['-movflags', '+faststart']) as writer:
                    for index, sample in enumerate(rollout['states']):
                        world.set_states({o['id']: o for o in sample['objects'] if o['id'] in world.records})
                        rgb = world.render(camera)[..., :3]
                        writer.append_data(rgb)
                        if index == 0:
                            Image.fromarray(rgb).save(images / ('closeup_%s_poster.jpg' % name), 'JPEG', quality=85)
                print(json.dumps({'task_id': task_id, 'clip': str(target), 'frames': len(rollout['states'])}), flush=True)
        with open(media / 'closeup.json', 'w', encoding='utf-8') as handle:
            json.dump({'task_id': task_id, 'objects': ids, 'camera': {k: camera[k] for k in ('eye', 'target', 'up', 'width', 'height', 'hfov')},
                       'scope': 'Replay of the recorded PhysX rollouts (no new physics) from a camera fitted to the listed objects.'}, handle, indent=1)
    close_app()


if __name__ == '__main__':
    main()
