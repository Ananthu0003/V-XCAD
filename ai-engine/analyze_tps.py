import json
with open('cam_features.json', 'r') as f:
    data = json.load(f)
    print('Operations:', len(data['operations']))
    for op in data['operations']:
        tps = op.get('toolpaths', [])
        print(f"{op['type']} ({op.get('id')}): {len(tps)} segments")
        if tps:
            print(f"  First segment: {tps[0]}")
            print(f"  Last segment: {tps[-1]}")
