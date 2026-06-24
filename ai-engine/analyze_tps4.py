import json
with open('cam_features.json', 'r') as f:
    data = json.load(f)
    print('Validation warnings:', data.get('validation', {}).get('warnings', []))
    print('Validation errors:', data.get('validation', {}).get('errors', []))
    print('Coord warnings:', data.get('coordinate_validation', {}).get('warnings', []))
    print('Coord errors:', data.get('coordinate_validation', {}).get('errors', []))
