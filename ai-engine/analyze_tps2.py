import json
with open('cam_features.json', 'r') as f:
    data = json.load(f)
    for op in data['operations']:
        if op.get('id') == 'op_auto_1782209203508_5':
            geom = op.get('geometry', {})
            pts = geom.get('profile_points', []) or geom.get('boundary_points', [])
            print('Geometry points:', len(pts))
            print('Stepdown:', op.get('parameters', {}).get('stepdown'))
            top = geom.get('z_top', 0)
            bot = geom.get('z_bottom', 0)
            print(f'Top Z: {top}, Bot Z: {bot}, Diff: {top-bot}')
