#!/usr/bin/env python3
"""Package counter photographs, masks, geometry and genuine PhysX demonstration clips."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--simagent-root', type=Path, default=Path(__file__).resolve().parents[2])
    parser.add_argument('--output', type=Path, required=True, help='Fresh asset staging directory')
    parser.add_argument('--jar-run', type=Path, help='Optional current-scene jar drop; otherwise use the saved cylinder drop')
    parser.add_argument('--install', action='store_true', help='Copy packaged assets into this dashboard')
    args = parser.parse_args()
    import numpy as np
    import open3d as o3d
    from PIL import Image, ImageOps
    from pxr import Usd, UsdGeom
    root = args.simagent_root.resolve()
    out = args.output.resolve()
    out.mkdir(parents=True, exist_ok=False)
    images, media, data_folder = [out / 'static' / kind for kind in ['images/digital_twin', 'media/digital_twin', 'data']]
    for folder in [images, media, data_folder]:
        folder.mkdir(parents=True)
    manifest_path = root / 'scenes/counter_demo_supported_v1/scene_manifest.json'
    manifest = json.loads(manifest_path.read_text())
    geometry = root / 'data/counter_twin/gator_refinement_v2/multiview'
    reconstruction = root / 'data/counter_twin/sam3d_reconstruction_v2'
    inference = json.loads((reconstruction / 'receipt.json').read_text())
    inputs = {'manifest': {'path': str(manifest_path), 'sha256': sha(manifest_path)}}
    # The dense-MVS input inventory records the actual image subset.
    input_artifact = Path(json.loads((geometry / 'geometry_manifest.json').read_text())['source_points']).parents[2] / 'input' / 'input_artifact.json'
    inventory = json.loads(input_artifact.read_text())
    inputs['camera_inventory'] = {'path': str(input_artifact), 'sha256': sha(input_artifact)}
    result = {'capture_images': inventory['source_image_count'], 'mvs_images': inventory['image_count'],
              'mask_views': len(manifest['cameras']), 'objects': [], 'views': [], 'demos': []}
    for camera in manifest['cameras']:
        photo = Image.open(camera['source_image']).convert('RGB')
        photo.thumbnail((480, 320))
        name = camera['id'] + '.jpg'
        photo.save(images / name, quality=88)
        result['views'].append({'id': camera['id'], 'image': './static/images/digital_twin/' + name,
                                'position': camera['position'], 'rotation': camera['camera_to_world_opencv']})
        inputs[camera['id']] = {'path': camera['source_image'], 'sha256': sha(Path(camera['source_image']))}
    stage = Usd.Stage.Open(str(root / 'scenes/counter_demo_supported_v1/scene.usda'))
    labels = {'can_black': 'Black tin', 'can_red': 'Red tin', 'jar_coconut': 'Coconut-oil jar'}
    for obj in [o for o in manifest['objects'] if o['motion_type'] == 'dynamic']:
        key = obj['id']
        record = next(o for o in inference['objects'] if o['id'] == key)
        folder = reconstruction / key
        rgb = Image.open(folder / 'input.png').convert('RGB')
        mask = Image.open(folder / 'mask.png').convert('L')
        bounds = mask.getbbox()
        if bounds is None:
            raise ValueError(f'Empty SAM3D input mask: {key}')
        bounds = (max(0, bounds[0] - 24), max(0, bounds[1] - 24), min(rgb.width, bounds[2] + 24), min(rgb.height, bounds[3] + 24))
        crop = rgb.crop(bounds)
        binary = mask.crop(bounds)
        cutout = Image.new('RGB', rgb.size, '#edf1f5')
        cutout.paste(rgb, mask=mask)
        for kind, picture in [('rgb', crop), ('mask', binary.convert('RGB')), ('cutout', cutout.crop(bounds))]:
            picture = ImageOps.contain(picture, (280, 280), Image.Resampling.LANCZOS)
            tile = Image.new('RGB', (300, 300), '#edf1f5')
            tile.paste(picture, ((300 - picture.width) // 2, (300 - picture.height) // 2))
            tile.save(images / f'{key}_{kind}.jpg', quality=92)
        path = geometry / obj['reconstruction']['mesh']
        mesh = o3d.io.read_triangle_mesh(str(path)).simplify_quadric_decimation(1600)
        mesh.remove_degenerate_triangles().remove_unreferenced_vertices()
        mesh.compute_triangle_normals()
        vertices, triangles = np.asarray(mesh.vertices), np.asarray(mesh.triangles)
        colors = np.clip(np.asarray(mesh.vertex_colors), 0, 1)
        collider = UsdGeom.Mesh(stage.GetPrimAtPath(obj['usd_prim_path'] + '/Collider'))
        collision = {'vertices': np.round(np.array(collider.GetPointsAttr().Get()), 6).tolist(),
                     'triangles': np.array(collider.GetFaceVertexIndicesAttr().Get()).reshape(-1, 3).tolist()}
        result['objects'].append({'id': key, 'label': labels[key], 'position': obj['position'],
            'mass_kg': obj['mass_kg'], 'source_view': Path(record['source_image']).stem,
            'vertices': np.round(vertices, 6).tolist(), 'triangles': triangles.tolist(),
            'colors': np.round(colors, 3).tolist(), 'collider': collision,
            'rgb': f'./static/images/digital_twin/{key}_rgb.jpg',
            'mask': f'./static/images/digital_twin/{key}_mask.jpg',
            'cutout': f'./static/images/digital_twin/{key}_cutout.jpg'})
        inputs[key] = {'mesh': str(path), 'mesh_sha256': sha(path), 'input_sha256': sha(folder / 'input.png'),
                       'mask_sha256': sha(folder / 'mask.png'), 'crop_box_px': bounds,
                       'display_vertices': len(vertices), 'display_triangles': len(triangles)}
    scene_points = root / 'data/counter_twin/geometry_v2/context.ply'
    mesh = o3d.io.read_triangle_mesh(str(scene_points))
    points, colors = np.asarray(mesh.vertices), np.asarray(mesh.vertex_colors)
    keep = (np.abs(points[:, 0]) < .95) & (np.abs(points[:, 1]) < .85) & (points[:, 2] > -.06) & (points[:, 2] < .85)
    cloud = o3d.geometry.PointCloud(o3d.utility.Vector3dVector(points[keep]))
    cloud.colors = o3d.utility.Vector3dVector(colors[keep])
    cloud = cloud.voxel_down_sample(.016)
    indices = np.linspace(0, len(cloud.points) - 1, min(6500, len(cloud.points)), dtype=int)
    result['context'] = {'points': np.round(np.asarray(cloud.points)[indices], 4).tolist(),
                         'colors': np.round(np.asarray(cloud.colors)[indices], 3).tolist()}
    demos = [('topple', 'Topple the black tin', root / 'runs/counter_gator_v1/supported/can_topple', 'simulation.mp4'),
             ('throw', 'Throw the red tin at the jar', root / 'runs/counter_gator_v1/supported/can_throw_v2', 'simulation.mp4')]
    if args.jar_run:
        demos.append(('drop', 'Drop the jar', args.jar_run.resolve(), 'simulation.mp4'))
    else:
        demos.append(('drop', 'Drop the jar', root / 'runs/counter_twin_validation_v7/drop_jar', 'drop.mp4'))
    for key, label, folder, filename in demos:
        source = folder / filename
        target = media / f'{key}.mp4'
        subprocess.run(['ffmpeg', '-v', 'error', '-i', str(source), '-an', '-vf', 'scale=640:-2',
                        '-c:v', 'libx264', '-crf', '21', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', str(target)], check=True)
        subprocess.run(['ffmpeg', '-v', 'error', '-i', str(target), '-frames:v', '1', '-q:v', '2', str(images / f'{key}_poster.jpg')], check=True)
        probe = subprocess.check_output(['ffprobe', '-v', 'error', '-count_frames', '-select_streams', 'v:0',
            '-show_entries', 'stream=duration,nb_read_frames,r_frame_rate,width,height', '-of', 'json', str(target)], text=True)
        stream = json.loads(probe)['streams'][0]
        subprocess.run(['ffmpeg', '-v', 'error', '-i', str(target), '-f', 'null', '-'], check=True, capture_output=True)
        physics_path = folder / ('physics_receipt.json' if filename == 'simulation.mp4' else 'diagnostics.json')
        physics = json.loads(physics_path.read_text())
        trace_path = folder / ('trajectory.json' if filename == 'simulation.mp4' else 'rollout.json')
        trace = json.loads(trace_path.read_text())
        frames = trace['frames'] if isinstance(trace, dict) else trace
        if int(stream['nb_read_frames']) != len(frames):
            raise ValueError(f'Presentation clip changed the frame count: {key}')
        result['demos'].append({'id': key, 'label': label, 'video': f'./static/media/digital_twin/{key}.mp4',
            'poster': f'./static/images/digital_twin/{key}_poster.jpg', 'duration_s': float(stream['duration']),
            'fps': stream['r_frame_rate'], 'frames': len(frames),
            'collision_kind': 'supported mesh hull' if filename == 'simulation.mp4' else 'fitted cylinder',
            'states': [{'time_s': f['time_s'], 'objects': f.get('states', f.get('objects'))} for f in frames[::4]]})
        inputs['demo_' + key] = {'path': str(source), 'source_sha256': sha(source), 'display_sha256': sha(target),
                                'physics_sha256': sha(physics_path), 'metadata': stream,
                                'physics': physics.get('demo_checks', {'passed': physics.get('passed')})}
    output = data_folder / 'digital_twin.js'
    output.write_text('window.DIGITAL_TWIN = ' + json.dumps(result, separators=(',', ':'), allow_nan=False) + ';\n')
    receipt = {'inputs': inputs, 'asset_script_sha256': sha(Path(__file__)), 'data_sha256': sha(output),
               'scope': 'Presentation assets: actual images, simplified mesh display and actual PhysX video; proposed animations are schematic.'}
    (data_folder / 'digital_twin_provenance.json').write_text(json.dumps(receipt, indent=2) + '\n')
    if args.install:
        destination = Path(__file__).resolve().parents[1] / 'static'
        shutil.copytree(images, destination / 'images/digital_twin', dirs_exist_ok=True)
        shutil.copytree(media, destination / 'media/digital_twin', dirs_exist_ok=True)
        shutil.copy2(output, destination / 'data' / output.name)
    print(json.dumps({'event': 'digital_twin_assets', 'output': str(out), 'objects': len(result['objects']),
                      'views': len(result['views']), 'videos': len(result['demos']), 'data_bytes': output.stat().st_size}), flush=True)


if __name__ == '__main__':
    main()
