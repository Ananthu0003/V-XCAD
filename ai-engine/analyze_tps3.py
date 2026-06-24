import json
with open('cam_features.json', 'r') as f:
    data = json.load(f)
    for op in data['operations']:
        if op.get('id') == 'op_auto_1782209203508_5':
            geom = op.get('geometry', {})
            pts = geom.get('profile_points', []) or geom.get('boundary_points', [])
            for p in pts[:10]: print(p)
