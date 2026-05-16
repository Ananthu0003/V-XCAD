import ast
import sys

with open(r'c:\Projects\cad_copilot\ai-engine\app\services\parameter_render.py', 'r', encoding='utf-8') as f:
    content = f.read()

# Extract the harness template string
start_marker = 'RENDER_HARNESS_TEMPLATE = r"""'
end_marker = '"""'
start_idx = content.index(start_marker) + len(start_marker)
# Find the closing """ after the start
remaining = content[start_idx:]
end_idx = start_idx + remaining.index('\n"""')
harness = content[start_idx:end_idx]

# Find all json references in the harness
print("=== json references in harness ===")
for i, line in enumerate(harness.splitlines(), 1):
    stripped = line.strip()
    if 'json' in stripped and not stripped.startswith('#'):
        print(f"  Harness line {i}: {stripped!r}")

# Parse the harness as AST to check scoping
print("\n=== AST scoping analysis for run() ===")
try:
    tree = ast.parse(harness)
    for node in ast.walk(tree):
        if isinstance(node, ast.FunctionDef) and node.name == 'run':
            # Check for any Import nodes inside run()
            for child in ast.walk(node):
                if isinstance(child, ast.Import):
                    for alias in child.names:
                        print(f"  import {alias.name} at line {child.lineno}")
                elif isinstance(child, ast.ImportFrom):
                    print(f"  from {child.module} import ... at line {child.lineno}")
    print("Done")
except SyntaxError as e:
    print(f"SyntaxError: {e}")
