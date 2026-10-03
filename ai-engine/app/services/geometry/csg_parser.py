# import re
# from typing import Any, List, Dict, Tuple
# from pathlib import Path

# from build123d import (
#     Box, Cylinder, Cone, Location, Compound, Rotation, Sphere, 
#     Circle, Rectangle, Polygon, extrude, revolve, Axis, Face, 
#     Shell, Solid, Polyline, make_hull, Plane, Color, Vector
# )

# class ASTNode:
#     def __init__(self, name: str, attrs: Dict[str, Any] = None, children: List['ASTNode'] = None, pos_args: List[Any] = None):
#         self.name = name
#         self.attrs = attrs or {}
#         self.children = children or []
#         self.pos_args = pos_args or []

# def strip_comments(text: str) -> str:
#     text = re.sub(r'//.*', '', text)
#     text = re.sub(r'/\*.*?\*/', '', text, flags=re.DOTALL)
#     # Strip modifier characters (#, %, !, *) when prefixing an identifier
#     text = re.sub(r'(^|[\s(){}[\]=,;])([#%!*])(?=[a-zA-Z_$])', r'\1', text)
#     return text

# def tokenize(text: str) -> List[Tuple[str, str]]:
#     text = strip_comments(text)
#     token_re = re.compile(
#         r'\s*(?:'
#         r'(?P<number>-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)'
#         r'|(?P<boolean>true|false)'
#         r'|(?P<ident>\$?[a-zA-Z_][a-zA-Z0-9_]*)'
#         r'|(?P<sym>[(){}[\]=,;])'
#         r')'
#     )
#     tokens = []
#     pos = 0
#     while pos < len(text):
#         match = token_re.match(text, pos)
#         if not match:
#             if text[pos].isspace():
#                 pos += 1
#                 continue
#             raise ValueError(f"Unexpected character in CSG string at position {pos}: {text[pos:pos+10]!r}")
        
#         group = match.lastgroup
#         value = match.group(group)
#         tokens.append((value, group))
#         pos = match.end()
#     return tokens

# def parse_value(tokens: List[Tuple[str, str]], index: int) -> Tuple[Any, int]:
#     if index >= len(tokens):
#         raise ValueError("Unexpected end of tokens while parsing value")
        
#     token_val, token_type = tokens[index]
    
#     if token_type == 'number':
#         val = float(token_val) if '.' in token_val else int(token_val)
#         return val, index + 1
        
#     elif token_type == 'boolean':
#         val = token_val == 'true'
#         return val, index + 1
        
#     elif token_val == '[':
#         index += 1
#         arr = []
#         while index < len(tokens) and tokens[index][0] != ']':
#             item_val, item_index = parse_value(tokens, index)
#             arr.append(item_val)
#             index = item_index
#             if index < len(tokens) and tokens[index][0] == ',':
#                 index += 1
#         if index >= len(tokens) or tokens[index][0] != ']':
#             raise ValueError(f"Expected ']' at token {index}")
#         return arr, index + 1
        
#     elif token_type == 'ident':
#         return token_val, index + 1
        
#     else:
#         raise ValueError(f"Unexpected token type {token_type} for value: {token_val}")

# def parse_statement(tokens: List[Tuple[str, str]], index: int) -> Tuple[ASTNode, int]:
#     if index >= len(tokens):
#         raise ValueError("Unexpected end of tokens while parsing statement")
        
#     token_val, token_type = tokens[index]
#     if token_type != 'ident':
#         raise ValueError(f"Expected identifier at token {index}: {token_val}")
    
#     name = token_val
#     index += 1
    
#     if index >= len(tokens) or tokens[index][0] != '(':
#         raise ValueError(f"Expected '(' after {name} at token {index}")
#     index += 1
    
#     attrs = {}
#     pos_args = []
#     while index < len(tokens) and tokens[index][0] != ')':
#         is_named = (
#             index + 1 < len(tokens)
#             and tokens[index][1] == 'ident'
#             and tokens[index + 1][0] == '='
#         )
        
#         if is_named:
#             attr_name_val = tokens[index][0]
#             index += 2
#             val, index = parse_value(tokens, index)
#             attrs[attr_name_val] = val
#         else:
#             val, index = parse_value(tokens, index)
#             pos_args.append(val)
        
#         if index < len(tokens) and tokens[index][0] == ',':
#             index += 1
            
#     if index >= len(tokens) or tokens[index][0] != ')':
#         raise ValueError(f"Expected ')' at token {index}")
#     index += 1
    
#     if index < len(tokens) and tokens[index][0] == ';':
#         index += 1
#         return ASTNode(name, attrs=attrs, pos_args=pos_args), index
        
#     elif index < len(tokens) and tokens[index][0] == '{':
#         index += 1
#         children, index = parse_statements(tokens, index)
#         if index >= len(tokens) or tokens[index][0] != '}':
#             raise ValueError(f"Expected '}}' at token {index}")
#         index += 1
#         return ASTNode(name, attrs=attrs, children=children, pos_args=pos_args), index
        
#     else:
#         raise ValueError(f"Expected ';' or '{{' at token {index}: {tokens[index][0] if index < len(tokens) else 'EOF'}")

# def parse_statements(tokens: List[Tuple[str, str]], index: int) -> Tuple[List[ASTNode], int]:
#     statements = []
#     while index < len(tokens):
#         if tokens[index][0] == '}':
#             break
#         node, index = parse_statement(tokens, index)
#         statements.append(node)
#     return statements, index

# def flatten_compound(shape) -> List[Any]:
#     if shape is None:
#         return []
#     if isinstance(shape, (list, tuple)):
#         flat = []
#         for child in shape:
#             flat.extend(flatten_compound(child))
#         return [f for f in flat if f is not None]
#     elif isinstance(shape, Compound):
#         flat = []
#         for child in shape:
#             flat.extend(flatten_compound(child))
#         return [f for f in flat if f is not None]
#     else:
#         return [shape]

# def flatten_and_clear(shape) -> List[Any]:
#     flat = flatten_compound(shape)
#     for s in flat:
#         try:
#             s.parent = None
#         except Exception:
#             pass
#     return flat

# def make_compound_safe(shapes: List[Any]) -> Compound:
#     for s in shapes:
#         try:
#             s.parent = None
#         except Exception:
#             pass
#     try:
#         return Compound(children=shapes)
#     except Exception:
#         flat = []
#         for s in shapes:
#             flat.extend(flatten_compound(s))
#         for s in flat:
#             try:
#                 s.parent = None
#             except Exception:
#                 pass
#         try:
#             return Compound(children=flat)
#         except Exception:
#             return Compound(children=[])

# def evaluate_node(node: ASTNode) -> Any:
#     try:
#         shape = _evaluate_node_impl(node)
#         if shape is not None:
#             try:
#                 shape.parent = None
#             except Exception:
#                 pass
#         return shape
#     except Exception as e:
#         print(f"Failed parsing node: {node.name}")
#         print(f"Error details: {e}")
#         return None

# def _evaluate_node_impl(node: ASTNode) -> Any:
#     name = node.name.lower()
    
#     # Strip non-geometric metadata and convert 'undef' string values to None
#     node.attrs = {k: (None if v == 'undef' else v) for k, v in node.attrs.items() if not k.startswith('$')}
    
#     # ── 3D Primitives ──
#     if name == 'cube':
#         size = None
#         center = None
#         if len(node.pos_args) >= 1:
#             size = node.pos_args[0]
#         if len(node.pos_args) >= 2:
#             center = node.pos_args[1]
        
#         if 'size' in node.attrs: size = node.attrs['size']
#         if 'center' in node.attrs: center = node.attrs['center']
        
#         if size is None: size = [1.0, 1.0, 1.0]
#         if isinstance(size, (int, float)):
#             size = [float(size)] * 3
#         x, y, z = float(size[0]), float(size[1]), float(size[2])
#         if center is None: center = False
        
#         shape = Box(x, y, z)
#         if not center:
#             shape = Location((x / 2.0, y / 2.0, z / 2.0)) * shape
#         return shape
        
#     elif name == 'cylinder':
#         h = None
#         r = None
#         r1 = None
#         r2 = None
#         d = None
#         d1 = None
#         d2 = None
#         center = None

#         if len(node.pos_args) == 1:
#             h = node.pos_args[0]
#         elif len(node.pos_args) == 2:
#             h = node.pos_args[0]
#             if isinstance(node.pos_args[1], bool):
#                 center = node.pos_args[1]
#             else:
#                 r = node.pos_args[1]
#         elif len(node.pos_args) == 3:
#             h = node.pos_args[0]
#             if isinstance(node.pos_args[2], bool):
#                 r = node.pos_args[1]
#                 center = node.pos_args[2]
#             else:
#                 r1 = node.pos_args[1]
#                 r2 = node.pos_args[2]
#         elif len(node.pos_args) >= 4:
#             h = node.pos_args[0]
#             r1 = node.pos_args[1]
#             r2 = node.pos_args[2]
#             center = node.pos_args[3]

#         if 'h' in node.attrs: h = node.attrs['h']
#         if 'r' in node.attrs: r = node.attrs['r']
#         if 'r1' in node.attrs: r1 = node.attrs['r1']
#         if 'r2' in node.attrs: r2 = node.attrs['r2']
#         if 'd' in node.attrs: d = node.attrs['d']
#         if 'd1' in node.attrs: d1 = node.attrs['d1']
#         if 'd2' in node.attrs: d2 = node.attrs['d2']
#         if 'center' in node.attrs: center = node.attrs['center']

#         if h is None: h = 1.0
#         h = float(h)
#         if center is None: center = False

#         if r1 is None and d1 is not None: r1 = float(d1) / 2.0
#         if r2 is None and d2 is not None: r2 = float(d2) / 2.0

#         if r1 is None and r2 is None:
#             if r is not None:
#                 r1 = r2 = float(r)
#             elif d is not None:
#                 r1 = r2 = float(d) / 2.0
#             else:
#                 r1 = r2 = 1.0
#         elif r1 is not None and r2 is None:
#             r2 = r1
#         elif r2 is not None and r1 is None:
#             r1 = r2

#         r1 = float(r1)
#         r2 = float(r2)

#         if abs(r1 - r2) < 1e-6:
#             shape = Cylinder(radius=r1, height=h)
#         else:
#             shape = Cone(bottom_radius=r1, top_radius=r2, height=h)
            
#         if not center:
#             shape = Location((0, 0, h / 2.0)) * shape
#         return shape

#     elif name == 'sphere':
#         r = None
#         d = None
#         if len(node.pos_args) >= 1:
#             r = node.pos_args[0]
#         if 'r' in node.attrs: r = node.attrs['r']
#         if 'd' in node.attrs: d = node.attrs['d']

#         if r is None and d is not None:
#             r = float(d) / 2.0
#         if r is None:
#             r = 1.0
#         r = float(r)
#         return Sphere(radius=r)

#     # ── 2D Primitives ──
#     elif name == 'circle':
#         r = None
#         d = None
#         if len(node.pos_args) >= 1:
#             r = node.pos_args[0]
#         if 'r' in node.attrs: r = node.attrs['r']
#         if 'd' in node.attrs: d = node.attrs['d']
#         if 'r1' in node.attrs: r = node.attrs['r1']
#         if 'd1' in node.attrs: r = float(node.attrs['d1']) / 2.0

#         if r is None and d is not None:
#             r = float(d) / 2.0
#         if r is None:
#             r = 1.0
#         r = float(r)
#         return Circle(radius=r)

#     elif name == 'square':
#         size = None
#         center = None
#         if len(node.pos_args) >= 1:
#             size = node.pos_args[0]
#         if len(node.pos_args) >= 2:
#             center = node.pos_args[1]

#         if 'size' in node.attrs: size = node.attrs['size']
#         if 'center' in node.attrs: center = node.attrs['center']

#         if size is None: size = [1.0, 1.0]
#         if isinstance(size, (int, float)):
#             size = [float(size), float(size)]
#         elif isinstance(size, (list, tuple)):
#             if len(size) == 1:
#                 size = [float(size[0]), float(size[0])]
#             elif len(size) >= 2:
#                 size = [float(size[0]), float(size[1])]
#         x, y = float(size[0]), float(size[1])
#         if center is None: center = False
        
#         shape = Rectangle(x, y)
#         if not center:
#             shape = Location((x / 2.0, y / 2.0)) * shape
#         return shape

#     elif name == 'polygon':
#         points = None
#         if len(node.pos_args) >= 1:
#             points = node.pos_args[0]
#         if 'points' in node.attrs: points = node.attrs['points']

#         if points and len(points) >= 3:
#             pts = [tuple(float(coord) for coord in pt) for pt in points]
#             poly = None
#             try:
#                 poly = Polygon(pts)
#             except Exception:
#                 try:
#                     poly = Polygon(*pts)
#                 except Exception:
#                     try:
#                         poly = Face(Polyline(*pts, close=True))
#                     except Exception:
#                         pass

#             if poly is not None:
#                 try:
#                     from build123d import Face
#                     if not isinstance(poly, Face):
#                         try:
#                             poly = Face.make_from_wires(poly)
#                         except Exception:
#                             try:
#                                 poly = poly.faces()[0]
#                             except Exception:
#                                 pass
#                 except Exception:
#                     pass
#                 return poly
#         return None

#     elif name == 'polyhedron':
#         points = None
#         faces = None
#         if len(node.pos_args) >= 1:
#             points = node.pos_args[0]
#         if len(node.pos_args) >= 2:
#             faces = node.pos_args[1]

#         if 'points' in node.attrs: points = node.attrs['points']
#         if 'faces' in node.attrs: faces = node.attrs['faces']
#         if not faces and 'triangles' in node.attrs: faces = node.attrs['triangles']

#         if points and faces:
#             try:
#                 built_faces = []
#                 for face_indices in faces:
#                     if len(face_indices) < 3:
#                         continue
#                     try:
#                         face_pts = [tuple(float(coord) for coord in points[int(i)]) for i in face_indices]
#                         built_faces.append(Face(Polyline(*face_pts, close=True)))
#                     except Exception:
#                         pass
#                 if not built_faces:
#                     return None
#                 try:
#                     try:
#                         shell = Shell.make_shell(built_faces)
#                     except AttributeError:
#                         shell = Shell(built_faces)
#                     return Solid.make_solid(shell)
#                 except Exception:
#                     try:
#                         return shell
#                     except Exception:
#                         return Compound(children=built_faces)
#             except Exception:
#                 return None
#         return None

#     elif name == 'text':
#         txt = ""
#         if len(node.pos_args) >= 1: txt = str(node.pos_args[0])
#         elif 'text' in node.attrs: txt = str(node.attrs['text'])
#         elif 'txt' in node.attrs: txt = str(node.attrs['txt'])

#         size = 10.0
#         if len(node.pos_args) >= 2: size = float(node.pos_args[1])
#         elif 'size' in node.attrs: size = float(node.attrs['size'])

#         font = "Arial"
#         if 'font' in node.attrs: font = str(node.attrs['font'])

#         halign = node.attrs.get('halign', 'left')
#         valign = node.attrs.get('valign', 'baseline')

#         align = None
#         try:
#             from build123d import Align
#             h_map = {
#                 'left': Align.MIN,
#                 'center': Align.CENTER,
#                 'right': Align.MAX
#             }
#             v_map = {
#                 'bottom': Align.MIN,
#                 'baseline': Align.MIN,
#                 'center': Align.CENTER,
#                 'top': Align.MAX
#             }
#             align = (h_map.get(halign.lower(), Align.MIN), v_map.get(valign.lower(), Align.MIN))
#         except Exception:
#             pass

#         try:
#             if align:
#                 return Compound.make_text(txt=txt, font_size=size, font=font, align=align)
#             else:
#                 return Compound.make_text(txt=txt, font_size=size, font=font)
#         except Exception:
#             try:
#                 return Compound.make_text(txt, size, font)
#             except Exception:
#                 return Rectangle(size, size)

#     # ── Extrusions ──
#     elif name == 'linear_extrude':
#         height = float(node.attrs.get('height', 1.0))
#         center = bool(node.attrs.get('center', False))
        
#         child_shapes = [evaluate_node(c) for c in node.children]
#         child_shapes = [s for s in child_shapes if s is not None]
#         if not child_shapes: return None
            
#         if len(child_shapes) > 1:
#             try:
#                 base_face = child_shapes[0]
#                 for s in child_shapes[1:]:
#                     base_face = base_face.fuse(s)
#                 combined = base_face
#             except Exception:
#                 combined = make_compound_safe(child_shapes)
#         else:
#             combined = child_shapes[0]
            
#         try:
#             taper_angle = 0.0
#             scale = node.attrs.get('scale', 1.0)
#             if scale is not None and isinstance(scale, (int, float)) and abs(scale - 1.0) > 1e-4:
#                 import math
#                 taper_angle = math.degrees(math.atan((scale - 1.0) * 5.0 / height))
            
#             # Forced +Z extrusion to match OpenSCAD
#             if abs(taper_angle) > 1e-4:
#                 extruded = extrude(combined, amount=height, taper=taper_angle, dir=(0, 0, 1)) 
#             else:
#                 extruded = extrude(combined, amount=height, dir=(0, 0, 1))

#             if center:
#                 extruded = Location((0, 0, -height / 2.0)) * extruded
#             return extruded
#         except Exception as e:
#             print(f"Extrusion failed: {e}")
#             return combined

#     elif name == 'rotate_extrude':
#         angle = None
#         if len(node.pos_args) >= 1:
#             angle = node.pos_args[0]
#         if 'angle' in node.attrs: angle = node.attrs['angle']

#         if angle is None: angle = 360.0
#         angle = float(angle)

#         child_shapes = [evaluate_node(c) for c in node.children]
#         child_shapes = [s for s in child_shapes if s is not None]
#         if not child_shapes:
#             return None
            
#         combined = child_shapes[0] if len(child_shapes) == 1 else make_compound_safe(child_shapes)
              
#         try:
#             xz_profile = Rotation(90, 0, 0) * combined
#             return revolve(xz_profile, axis=Axis.Z, revolution_arc=angle)
#         except Exception:
#             try:
#                 return revolve(combined, axis=Axis.Y, revolution_arc=angle)
#             except Exception:
#                 return combined

#     # ── Transforms ──
#     elif name == 'translate':
#         v = None
#         if len(node.pos_args) >= 1: v = node.pos_args[0]
#         elif 'v' in node.attrs: v = node.attrs['v']
#         if v is None: v = [0.0, 0.0, 0.0]

#         if isinstance(v, (int, float)):
#             v = [float(v), 0.0, 0.0]
#         elif not isinstance(v, (list, tuple)) or len(v) < 3:
#             v = [0.0, 0.0, 0.0]

#         loc = Location((v[0], v[1], v[2]))
        
#         child_shapes = [evaluate_node(c) for c in node.children]
#         child_shapes = [s for s in child_shapes if s is not None]
#         if not child_shapes: return None
        
#         combined = child_shapes[0] if len(child_shapes) == 1 else make_compound_safe(child_shapes)
#         return loc * combined
        
#     elif name == 'rotate':
#         a = None
#         if len(node.pos_args) >= 1: a = node.pos_args[0]
#         elif 'a' in node.attrs: a = node.attrs['a']
#         if a is None: a = [0.0, 0.0, 0.0]

#         if isinstance(a, (int, float)):
#             a = [0.0, 0.0, float(a)]
#         elif not isinstance(a, (list, tuple)) or len(a) < 3:
#             a = [0.0, 0.0, 0.0]

#         try:
#             loc = Rotation(a[0], a[1], a[2])
#         except Exception:
#             try:
#                 loc = Location((0, 0, 0), (a[0], a[1], a[2]))
#             except Exception:
#                 loc = Location((0, 0, 0))
        
#         child_shapes = [evaluate_node(c) for c in node.children]
#         child_shapes = [s for s in child_shapes if s is not None]
#         if not child_shapes: return None
        
#         combined = child_shapes[0] if len(child_shapes) == 1 else make_compound_safe(child_shapes)
#         return loc * combined

#     elif name == 'scale':
#         v = None
#         if node.pos_args: v = node.pos_args[0]
#         elif 'v' in node.attrs: v = node.attrs['v']

#         if v is None: v = [1.0, 1.0, 1.0]
#         elif isinstance(v, (int, float)): v = [float(v)] * 3

#         child_shapes = [evaluate_node(c) for c in node.children]
#         child_shapes = [s for s in child_shapes if s is not None]
#         if not child_shapes: return None

#         combined = child_shapes[0] if len(child_shapes) == 1 else make_compound_safe(child_shapes)

#         try:
#             return combined.scale((v[0], v[1], v[2]))
#         except Exception:
#             return combined

#     elif name == 'mirror':
#         v = None
#         if len(node.pos_args) >= 1: v = node.pos_args[0]
#         elif 'v' in node.attrs: v = node.attrs['v']
#         if v is None: v = [1.0, 0.0, 0.0]

#         child_shapes = [evaluate_node(c) for c in node.children]
#         child_shapes = [s for s in child_shapes if s is not None]
#         if not child_shapes: return None
#         combined = child_shapes[0] if len(child_shapes) == 1 else make_compound_safe(child_shapes)

#         try:
#             plane = Plane(origin=(0, 0, 0), direction=(v[0], v[1], v[2]))
#         except TypeError:
#             try:
#                 plane = Plane(origin=(0, 0, 0), z_dir=(v[0], v[1], v[2]))
#             except TypeError:
#                 plane = Plane.XY

#         try:
#             return combined.mirror(about=plane)
#         except Exception:
#             try:
#                 return combined.mirror(plane)
#             except Exception:
#                 return combined

#     elif name == 'color':
#         c = None
#         if len(node.pos_args) >= 1: c = node.pos_args[0]
#         elif 'c' in node.attrs: c = node.attrs['c']

#         child_shapes = [evaluate_node(c) for c in node.children]
#         child_shapes = [s for s in child_shapes if s is not None]
#         if not child_shapes: return None
#         combined = child_shapes[0] if len(child_shapes) == 1 else make_compound_safe(child_shapes)

#         if c is not None:
#             try:
#                 color_obj = None
#                 if isinstance(c, str):
#                     color_obj = Color(c)
#                 elif isinstance(c, (list, tuple)) and len(c) >= 3:
#                     if len(c) == 3:
#                         color_obj = Color(float(c[0]), float(c[1]), float(c[2]))
#                     else:
#                         color_obj = Color(float(c[0]), float(c[1]), float(c[2]), float(c[3]))

#                 if color_obj is not None:
#                     for s in flatten_compound(combined):
#                         s.color = color_obj
#             except Exception as e:
#                 print(f"Error applying color: {e}")
#         return combined

#     elif name == 'offset':
#         amount = None
#         if len(node.pos_args) >= 1: amount = node.pos_args[0]
#         elif 'r' in node.attrs: amount = node.attrs['r']
#         elif 'delta' in node.attrs: amount = node.attrs['delta']

#         if amount is None: amount = 1.0
#         amount = float(amount)

#         child_shapes = [evaluate_node(c) for c in node.children]
#         child_shapes = [s for s in child_shapes if s is not None]
#         if not child_shapes: return None
#         combined = child_shapes[0] if len(child_shapes) == 1 else make_compound_safe(child_shapes)

#         try:
#             return combined.offset_2d(amount)
#         except Exception:
#             try:
#                 return combined.offset_2d(amount=amount)
#             except Exception:
#                 try:
#                     return combined.offset(amount)
#                 except Exception:
#                     try:
#                         return combined.offset(amount=amount)
#                     except Exception:
#                         try:
#                             from build123d import offset
#                             return offset(combined, amount)
#                         except Exception:
#                             return combined

#     elif name == 'projection':
#         cut = False
#         if len(node.pos_args) >= 1: cut = bool(node.pos_args[0])
#         elif 'cut' in node.attrs: cut = bool(node.attrs['cut'])

#         child_shapes = [evaluate_node(c) for c in node.children]
#         child_shapes = [s for s in child_shapes if s is not None]
#         if not child_shapes: return None
#         combined = child_shapes[0] if len(child_shapes) == 1 else make_compound_safe(child_shapes)

#         if cut:
#             try:
#                 return combined.section(Plane.XY)
#             except Exception:
#                 try:
#                     bbox = combined.bounding_box()
#                     dx = (bbox.max.X - bbox.min.X) * 1.5
#                     dy = (bbox.max.Y - bbox.min.Y) * 1.5
#                     cutter = Box(dx, dy, 1e-4)
#                     return combined & cutter
#                 except Exception:
#                     return combined
#         else:
#             try:
#                 return combined.project(Plane.XY)
#             except Exception:
#                 try:
#                     projected_faces = []
#                     for face in combined.faces():
#                         try:
#                             projected_faces.append(face.project_to_viewport(Plane.XY))
#                         except Exception:
#                             pass
#                     if projected_faces:
#                         proj_combined = projected_faces[0]
#                         for pf in projected_faces[1:]:
#                             try:
#                                 proj_combined = proj_combined.fuse(pf)
#                             except Exception:
#                                 proj_combined = proj_combined + pf
#                         return proj_combined
#                 except Exception:
#                     pass
#             return combined

#     elif name == 'resize':
#         newsize = None
#         if len(node.pos_args) >= 1: newsize = node.pos_args[0]
#         elif 'newsize' in node.attrs: newsize = node.attrs['newsize']
        
#         child_shapes = [evaluate_node(c) for c in node.children]
#         child_shapes = [s for s in child_shapes if s is not None]
#         if not child_shapes: return None
#         combined = child_shapes[0] if len(child_shapes) == 1 else make_compound_safe(child_shapes)
        
#         if newsize and len(newsize) >= 3:
#             try:
#                 bbox = combined.bounding_box()
#                 current_x = bbox.max.X - bbox.min.X
#                 current_y = bbox.max.Y - bbox.min.Y
#                 current_z = bbox.max.Z - bbox.min.Z
                
#                 scale_x = float(newsize[0]) / current_x if current_x > 1e-6 else 1.0
#                 scale_y = float(newsize[1]) / current_y if current_y > 1e-6 else 1.0
#                 scale_z = float(newsize[2]) / current_z if current_z > 1e-6 else 1.0
                
#                 return combined.scale((scale_x, scale_y, scale_z))
#             except Exception:
#                 return combined
#         return combined

#     elif name == 'minkowski':
#         child_shapes = [evaluate_node(c) for c in node.children]
#         child_shapes = [s for s in child_shapes if s is not None]
#         if not child_shapes: return None
#         combined = child_shapes[0] if len(child_shapes) == 1 else make_compound_safe(child_shapes)
        
#         offset_radius = None
#         for c in node.children:
#             c_name = c.name.lower()
#             if c_name in ('circle', 'sphere'):
#                 r = None
#                 if len(c.pos_args) >= 1: r = c.pos_args[0]
#                 elif 'r' in c.attrs: r = c.attrs['r']
#                 elif 'd' in c.attrs: r = float(c.attrs['d']) / 2.0
#                 if r is not None:
#                     offset_radius = float(r)
#                     break
        
#         if offset_radius is not None:
#             try:
#                 return combined.offset_2d(offset_radius)
#             except Exception:
#                 try:
#                     return combined.offset(offset_radius)
#                 except Exception:
#                     pass
#         return combined

#     elif name in ('render', 'cache'):
#         child_shapes = [evaluate_node(c) for c in node.children]
#         child_shapes = [s for s in child_shapes if s is not None]
#         if not child_shapes: return None
#         return child_shapes[0] if len(child_shapes) == 1 else make_compound_safe(child_shapes)

#     elif name == 'intersection_for':
#         child_shapes = [evaluate_node(c) for c in node.children]
#         child_shapes = [s for s in child_shapes if s is not None]
#         if not child_shapes: return None
            
#         combined_list = flatten_and_clear(child_shapes[0])
#         for s in child_shapes[1:]:
#             cutters = flatten_and_clear(s)
#             for cutter in cutters:
#                 new_combined = []
#                 for child in combined_list:
#                     try:
#                         inter = child & cutter
#                         new_combined.extend(flatten_and_clear(inter))
#                     except Exception:
#                         pass
#                 combined_list = new_combined
            
#         for s in combined_list:
#             try:
#                 s.parent = None
#             except Exception:
#                 pass
            
#         if not combined_list: return None
#         return combined_list[0] if len(combined_list) == 1 else make_compound_safe(combined_list)

#     elif name == 'surface':
#         return Box(10, 10, 1)

#     elif name == 'multmatrix':
#         matrix = None
#         if node.pos_args: matrix = node.pos_args[0]
#         elif 'm' in node.attrs: matrix = node.attrs['m']
#         elif 'matrix' in node.attrs: matrix = node.attrs['matrix']
            
#         if matrix and len(matrix) >= 3 and all(len(row) >= 4 for row in matrix[:3]):
#             try:
#                 from OCP.gp import gp_Trsf
#                 trsf = gp_Trsf()
#                 trsf.SetValues(
#                     float(matrix[0][0]), float(matrix[0][1]), float(matrix[0][2]), float(matrix[0][3]),
#                     float(matrix[1][0]), float(matrix[1][1]), float(matrix[1][2]), float(matrix[1][3]),
#                     float(matrix[2][0]), float(matrix[2][1]), float(matrix[2][2]), float(matrix[2][3])
#                 )
#                 loc = Location(trsf)
#             except Exception:
#                 try:
#                     # Fallback to apply at least the translation vector if rotation matrix fails
#                     loc = Location((float(matrix[0][3]), float(matrix[1][3]), float(matrix[2][3])))
#                 except Exception:
#                     loc = Location((0, 0, 0))
#         else:
#             loc = Location((0, 0, 0))
            
#         child_shapes = [evaluate_node(c) for c in node.children]
#         child_shapes = [s for s in child_shapes if s is not None]
#         if not child_shapes: return None
            
#         combined = child_shapes[0] if len(child_shapes) == 1 else make_compound_safe(child_shapes)
#         return loc * combined
        
#     # ── Clean Boolean Operators ──
#     elif name in ('union', 'group'):
#         child_shapes = [evaluate_node(c) for c in node.children]
#         child_shapes = [s for s in child_shapes if s is not None]
#         if not child_shapes: return None
            
#         fused_shapes = []
#         for s in child_shapes:
#             fused = False
#             for i, existing in enumerate(fused_shapes):
#                 try:
#                     fused_shapes[i] = existing.fuse(s)
#                     fused = True
#                     break
#                 except Exception:
#                     try:
#                         fused_shapes[i] = existing + s
#                         fused = True
#                         break
#                     except Exception:
#                         pass
#             if not fused:
#                 fused_shapes.append(s)
                
#         if len(fused_shapes) == 1:
#             return fused_shapes[0]
#         else:
#             return make_compound_safe(fused_shapes)
        
#     elif name == 'difference':
#         child_shapes = [evaluate_node(c) for c in node.children]
#         child_shapes = [s for s in child_shapes if s is not None]
#         if not child_shapes: return None
            
#         combined = child_shapes[0]
#         for s in child_shapes[1:]:
#             try:
#                 # Attempt standard topological cut
#                 combined = combined - s
#             except Exception:
#                 try:
#                     base_parts = flatten_and_clear(combined)
#                     cutters = flatten_and_clear(s)
#                     new_combined = []
#                     for base in base_parts:
#                         current = base
#                         for cutter in cutters:
#                             try:
#                                 current = current - cutter
#                             except Exception:
#                                 try:
#                                     # Calculate bounding box center to properly scale locally
#                                     bbox = cutter.bounding_box()
#                                     cx, cy, cz = bbox.center().X, bbox.center().Y, bbox.center().Z
                                    
#                                     cutter_centered = cutter.moved(Location((-cx, -cy, -cz)))
#                                     cutter_scaled = cutter_centered.scale(1.0001)
#                                     expanded_cutter = cutter_scaled.moved(Location((cx, cy, cz)))
                                    
#                                     current = current - expanded_cutter
#                                 except Exception:
#                                     pass
#                         new_combined.append(current)
#                     combined = new_combined[0] if len(new_combined) == 1 else make_compound_safe(new_combined)
#                 except Exception:
#                     pass
#         return combined
        
#     elif name == 'intersection':
#         child_shapes = [evaluate_node(c) for c in node.children]
#         child_shapes = [s for s in child_shapes if s is not None]
#         if not child_shapes: return None
            
#         combined = child_shapes[0]
#         for s in child_shapes[1:]:
#             try:
#                 combined = combined & s
#             except Exception:
#                 try:
#                     base_parts = flatten_and_clear(combined)
#                     cutters = flatten_and_clear(s)
#                     new_combined = []
#                     for base in base_parts:
#                         for cutter in cutters:
#                             try:
#                                 inter = base & cutter
#                                 new_combined.extend(flatten_and_clear(inter))
#                             except Exception:
#                                 pass
#                     if new_combined:
#                         if len(new_combined) == 1:
#                             combined = new_combined[0]
#                         else:
#                             combined = make_compound_safe(new_combined)
#                 except Exception:
#                     pass
#         return combined
        
#     elif name == 'hull':
#         child_shapes = [evaluate_node(c) for c in node.children]
#         child_shapes = [s for s in child_shapes if s is not None]
#         if not child_shapes: return None
#         try:
#             flat_shapes = []
#             for s in child_shapes:
#                 flat_shapes.extend(flatten_and_clear(s))
            
#             vertices = []
#             for s in flat_shapes:
#                 try:
#                     vertices.extend(s.vertices())
#                 except Exception:
#                     pass
            
#             if vertices:
#                 try:
#                     return make_hull(vertices)
#                 except Exception:
#                     pass
            
#             try:
#                 return make_hull(flat_shapes)
#             except Exception:
#                 return make_hull(child_shapes)
#         except Exception:
#             return make_compound_safe(child_shapes)
            
#     else:
#         child_shapes = [evaluate_node(c) for c in node.children]
#         child_shapes = [s for s in child_shapes if s is not None]
#         if not child_shapes: return None
#         return child_shapes[0] if len(child_shapes) == 1 else make_compound_safe(child_shapes)

# class CSGParser:
#     @staticmethod
#     def parse(csg_string: str) -> Any:
#         tokens = tokenize(csg_string)
#         nodes, _ = parse_statements(tokens, 0)
#         shapes = [evaluate_node(n) for n in nodes]
#         shapes = [s for s in shapes if s is not None]
        
#         if not shapes:
#             raise ValueError("No valid geometry could be evaluated from the CSG tree.")
            
#         for s in shapes:
#             try:
#                 s.parent = None
#             except Exception:
#                 pass
                
#         if len(shapes) == 1:
#             return shapes[0]
#         else:
#             return make_compound_safe(shapes)

# def export_to_step(shape, filename: str) -> None:
#     from build123d import export_step
#     try:
#         shape.parent = None
#     except Exception:
#         pass
#     for s in flatten_compound(shape):
#         try:
#             s.parent = None
#         except Exception:
#             pass
#     export_step(shape, filename)

"""
csg_parser_fixed.py
===================
Corrected OpenSCAD CSG → build123d parser for reliable STEP generation.
"""

import re
import math
from typing import Any, List, Dict, Tuple
from pathlib import Path

from build123d import (
    Box, Cylinder, Cone, Location, Compound, Rotation, Sphere,
    Circle, Rectangle, Polygon, extrude, revolve, Axis, Face,
    Shell, Solid, Polyline, Plane, Color, Vector, Wire, Edge,
    import_step, export_step,
)

# ---------------------------------------------------------------------------
# AST
# ---------------------------------------------------------------------------

class ASTNode:
    def __init__(self, name: str, attrs: Dict[str, Any] = None,
                 children: List['ASTNode'] = None, pos_args: List[Any] = None):
        self.name = name
        self.attrs = attrs or {}
        self.children = children or []
        self.pos_args = pos_args or []

# ---------------------------------------------------------------------------
# Tokeniser / Parser
# ---------------------------------------------------------------------------

def strip_comments(text: str) -> str:
    text = re.sub(r'//.*', '', text)
    text = re.sub(r'/\*.*?\*/', '', text, flags=re.DOTALL)
    # Strip OpenSCAD modifier prefixes (#, %, !, *) safely
    text = re.sub(r'(?<![a-zA-Z0-9_])([#%!*])(?=[a-zA-Z_$])', '', text)
    return text

def tokenize(text: str) -> List[Tuple[str, str]]:
    text = strip_comments(text)
    token_re = re.compile(
        r'\s*(?:'
        r'(?P<number>-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)'
        r'|(?P<boolean>true|false)'
        r'|(?P<ident>\$?[a-zA-Z_][a-zA-Z0-9_]*)'
        r'|(?P<sym>[(){}[\]=,;])'
        r')'
    )
    tokens: List[Tuple[str, str]] = []
    pos = 0
    while pos < len(text):
        m = token_re.match(text, pos)
        if not m:
            if text[pos].isspace():
                pos += 1
                continue
            pos += 1
            continue
        group = m.lastgroup
        tokens.append((m.group(group), group))
        pos = m.end()
    return tokens

def parse_value(tokens: List[Tuple[str, str]], index: int) -> Tuple[Any, int]:
    if index >= len(tokens):
        raise ValueError("Unexpected end of tokens while parsing value")

    token_val, token_type = tokens[index]

    if token_type == 'number':
        val = float(token_val) if '.' in token_val or 'e' in token_val.lower() else int(token_val)
        return val, index + 1
    elif token_type == 'boolean':
        return (token_val == 'true'), index + 1
    elif token_val == '[':
        index += 1
        arr: List[Any] = []
        while index < len(tokens) and tokens[index][0] != ']':
            item_val, index = parse_value(tokens, index)
            arr.append(item_val)
            if index < len(tokens) and tokens[index][0] == ',':
                index += 1
        if index >= len(tokens) or tokens[index][0] != ']':
            raise ValueError(f"Expected ']' at token {index}")
        return arr, index + 1
    elif token_type == 'ident':
        return token_val, index + 1
    else:
        raise ValueError(f"Unexpected token type {token_type!r}: {token_val!r}")

def parse_statement(tokens: List[Tuple[str, str]], index: int) -> Tuple[ASTNode, int]:
    if index >= len(tokens):
        raise ValueError("Unexpected end of tokens while parsing statement")

    token_val, token_type = tokens[index]
    if token_type != 'ident':
        raise ValueError(f"Expected identifier at token {index}: {token_val!r}")

    name = token_val
    index += 1

    if index >= len(tokens) or tokens[index][0] != '(':
        raise ValueError(f"Expected '(' after '{name}' at token {index}")
    index += 1

    attrs: Dict[str, Any] = {}
    pos_args: List[Any] = []

    while index < len(tokens) and tokens[index][0] != ')':
        is_named = (
            index + 1 < len(tokens)
            and tokens[index][1] == 'ident'
            and tokens[index + 1][0] == '='
        )
        if is_named:
            attr_name = tokens[index][0]
            index += 2
            val, index = parse_value(tokens, index)
            attrs[attr_name] = val
        else:
            val, index = parse_value(tokens, index)
            pos_args.append(val)

        if index < len(tokens) and tokens[index][0] == ',':
            index += 1

    if index >= len(tokens) or tokens[index][0] != ')':
        raise ValueError(f"Expected ')' at token {index}")
    index += 1

    if index < len(tokens) and tokens[index][0] == ';':
        return ASTNode(name, attrs=attrs, pos_args=pos_args), index + 1
    elif index < len(tokens) and tokens[index][0] == '{':
        index += 1
        children, index = parse_statements(tokens, index)
        if index >= len(tokens) or tokens[index][0] != '}':
            raise ValueError(f"Expected '}}' at token {index}")
        return ASTNode(name, attrs=attrs, children=children, pos_args=pos_args), index + 1
    else:
        tok = tokens[index][0] if index < len(tokens) else 'EOF'
        raise ValueError(f"Expected ';' or '{{' at token {index}: {tok!r}")

def parse_statements(tokens: List[Tuple[str, str]], index: int) -> Tuple[List[ASTNode], int]:
    statements: List[ASTNode] = []
    while index < len(tokens):
        if tokens[index][0] == '}':
            break
        node, index = parse_statement(tokens, index)
        statements.append(node)
    return statements, index

# ---------------------------------------------------------------------------
# Shape utilities
# ---------------------------------------------------------------------------

def flatten_compound(shape) -> List[Any]:
    if shape is None:
        return []
    if isinstance(shape, (list, tuple)):
        flat: List[Any] = []
        for child in shape:
            flat.extend(flatten_compound(child))
        return [f for f in flat if f is not None]
    if isinstance(shape, Compound):
        flat = []
        try:
            for child in shape:
                flat.extend(flatten_compound(child))
        except Exception:
            try:
                for child in shape.compounds():
                    flat.extend(flatten_compound(child))
            except Exception:
                return [shape]
        return [f for f in flat if f is not None]
    return [shape]

def flatten_and_clear(shape) -> List[Any]:
    flat = flatten_compound(shape)
    for s in flat:
        try:
            s.parent = None
        except Exception:
            pass
    return flat

def make_compound_safe(shapes: List[Any]) -> Compound:
    for s in shapes:
        try:
            s.parent = None
        except Exception:
            pass
    try:
        return Compound(children=shapes)
    except Exception:
        flat: List[Any] = []
        for s in shapes:
            flat.extend(flatten_compound(s))
        for s in flat:
            try:
                s.parent = None
            except Exception:
                pass
        try:
            return Compound(children=flat)
        except Exception:
            return Compound(children=[])

def _non_uniform_scale(shape, sx: float, sy: float, sz: float):
    from OCP.BRepBuilderAPI import BRepBuilderAPI_GTransform
    from OCP.gp import gp_GTrsf
    gt = gp_GTrsf()
    gt.SetValue(1, 1, sx)
    gt.SetValue(2, 2, sy)
    gt.SetValue(3, 3, sz)
    transformer = BRepBuilderAPI_GTransform(shape.wrapped, gt, True)
    from build123d import Shape
    return Shape.cast(transformer.Shape())

def _hull_from_shapes(shapes: List[Any]) -> Any:
    try:
        import numpy as np
        from scipy.spatial import ConvexHull
    except ImportError:
        return make_compound_safe(shapes)

    pts: List[Tuple[float, float, float]] = []
    for shape in shapes:
        try:
            for edge in shape.edges():
                for t in np.linspace(0, 1, 24, endpoint=False):
                    v = edge.position_at(t)
                    pts.append((v.X, v.Y, v.Z))
        except Exception:
            pass

    if len(pts) < 4:
        return make_compound_safe(shapes)

    arr = np.array(pts)
    z_range = arr[:, 2].max() - arr[:, 2].min()
    
    if z_range < 1e-6:
        arr2d = arr[:, :2]
        if len(arr2d) < 3:
            return make_compound_safe(shapes)
        try:
            ch = ConvexHull(arr2d)
            hull_pts = arr2d[ch.vertices].tolist()
            edges = [
                Edge.make_line(
                    (hull_pts[i][0], hull_pts[i][1], 0),
                    (hull_pts[(i + 1) % len(hull_pts)][0], hull_pts[(i + 1) % len(hull_pts)][1], 0),
                )
                for i in range(len(hull_pts))
            ]
            return Face(Wire(edges))
        except Exception:
            return make_compound_safe(shapes)
    else:
        if len(arr) < 4:
            return make_compound_safe(shapes)
        try:
            ch = ConvexHull(arr)
            faces_built: List[Face] = []
            for simplex in ch.simplices:
                tri_pts = [arr[i].tolist() + [0] if len(arr[i]) == 2 else arr[i].tolist() for i in simplex]
                edges = [Edge.make_line(tuple(tri_pts[j]), tuple(tri_pts[(j + 1) % 3])) for j in range(3)]
                try:
                    faces_built.append(Face(Wire(edges)))
                except Exception:
                    pass
            if faces_built:
                sh = Shell(faces_built)
                try:
                    return Solid(sh)
                except Exception:
                    return sh
        except Exception:
            pass
        return make_compound_safe(shapes)

def _clean_value(v: Any) -> Any:
    return None if v == 'undef' else v

# ---------------------------------------------------------------------------
# Evaluator
# ---------------------------------------------------------------------------

def evaluate_node(node: ASTNode) -> Any:
    try:
        shape = _evaluate_node_impl(node)
        if shape is not None:
            try:
                shape.parent = None
            except Exception:
                pass
        return shape
    except Exception as e:
        print(f"[csg_parser] Failed evaluating node '{node.name}': {e}")
        return None

def _evaluate_node_impl(node: ASTNode) -> Any:
    name = node.name.lower()

    node.attrs = {k: _clean_value(v) for k, v in node.attrs.items() if not k.startswith('$')}
    node.pos_args = [_clean_value(v) for v in node.pos_args]

    # ── 3D Primitives ──────────────────────────────────────────────────────
    if name == 'cube':
        size = node.pos_args[0] if node.pos_args else node.attrs.get('size')
        center = (node.pos_args[1] if len(node.pos_args) >= 2 else node.attrs.get('center', False))
        if size is None:
            size = [1.0, 1.0, 1.0]
        if isinstance(size, (int, float)):
            size = [float(size)] * 3
        x, y, z = float(size[0]), float(size[1]), float(size[2])
        shape = Box(x, y, z)
        if not center:
            shape = Location((x / 2.0, y / 2.0, z / 2.0)) * shape
        return shape

    elif name == 'cylinder':
        h = r = r1 = r2 = d = d1 = d2 = center = None

        if len(node.pos_args) == 1:
            h = node.pos_args[0]
        elif len(node.pos_args) == 2:
            h = node.pos_args[0]
            if isinstance(node.pos_args[1], bool):
                center = node.pos_args[1]
            else:
                r = node.pos_args[1]
        elif len(node.pos_args) == 3:
            h = node.pos_args[0]
            if isinstance(node.pos_args[2], bool):
                r = node.pos_args[1]; center = node.pos_args[2]
            else:
                r1 = node.pos_args[1]; r2 = node.pos_args[2]
        elif len(node.pos_args) >= 4:
            h = node.pos_args[0]; r1 = node.pos_args[1]
            r2 = node.pos_args[2]; center = node.pos_args[3]

        if 'h'  in node.attrs: h  = node.attrs['h']
        if 'r'  in node.attrs: r  = node.attrs['r']
        if 'r1' in node.attrs: r1 = node.attrs['r1']
        if 'r2' in node.attrs: r2 = node.attrs['r2']
        if 'd'  in node.attrs: d  = node.attrs['d']
        if 'd1' in node.attrs: d1 = node.attrs['d1']
        if 'd2' in node.attrs: d2 = node.attrs['d2']
        if 'center' in node.attrs: center = node.attrs['center']

        h = float(h) if h is not None else 1.0
        center = bool(center) if center is not None else False

        if r1 is None and d1 is not None: r1 = float(d1) / 2.0
        if r2 is None and d2 is not None: r2 = float(d2) / 2.0

        if r1 is None and r2 is None:
            if r is not None: r1 = r2 = float(r)
            elif d is not None: r1 = r2 = float(d) / 2.0
            else: r1 = r2 = 1.0
        elif r1 is not None and r2 is None: r2 = r1
        elif r2 is not None and r1 is None: r1 = r2

        r1, r2 = float(r1), float(r2)
        shape = Cylinder(radius=r1, height=h) if abs(r1 - r2) < 1e-6 else Cone(bottom_radius=r1, top_radius=r2, height=h)
        if not center:
            shape = Location((0, 0, h / 2.0)) * shape
        return shape

    elif name == 'sphere':
        r = node.pos_args[0] if node.pos_args else node.attrs.get('r')
        d = node.attrs.get('d')
        if r is None and d is not None:
            r = float(d) / 2.0
        return Sphere(radius=float(r) if r is not None else 1.0)

    # ── 2D Primitives ──────────────────────────────────────────────────────
    elif name == 'circle':
        r = node.pos_args[0] if node.pos_args else node.attrs.get('r')
        d = node.attrs.get('d')
        if 'r1' in node.attrs: r = node.attrs['r1']
        if 'd1' in node.attrs: r = float(node.attrs['d1']) / 2.0
        if r is None and d is not None: r = float(d) / 2.0
        return Circle(radius=float(r) if r is not None else 1.0)

    elif name == 'square':
        size   = node.pos_args[0] if node.pos_args else node.attrs.get('size')
        center = (node.pos_args[1] if len(node.pos_args) >= 2 else node.attrs.get('center', False))
        if size is None: size = [1.0, 1.0]
        if isinstance(size, (int, float)): size = [float(size)] * 2
        elif len(size) == 1: size = [float(size[0])] * 2
        x, y = float(size[0]), float(size[1])
        shape = Rectangle(x, y)
        if not center:
            shape = Location((x / 2.0, y / 2.0)) * shape
        return shape

    elif name == 'polygon':
        points = (node.pos_args[0] if node.pos_args else node.attrs.get('points'))
        if points and len(points) >= 3:
            pts = [tuple(float(c) for c in pt) for pt in points]
            try:
                return Polygon(pts, align=None)
            except Exception:
                pass
            try:
                pts3 = [(p[0], p[1], 0.0) for p in pts]
                edges = [Edge.make_line(pts3[i], pts3[(i + 1) % len(pts3)]) for i in range(len(pts3))]
                return Face(Wire(edges))
            except Exception:
                pass
        return None

    elif name == 'polyhedron':
        points = (node.pos_args[0] if node.pos_args else node.attrs.get('points'))
        faces_idx = (node.pos_args[1] if len(node.pos_args) >= 2 else node.attrs.get('faces') or node.attrs.get('triangles'))
        if not (points and faces_idx):
            return None
        try:
            built_faces: List[Face] = []
            for fi in faces_idx:
                if len(fi) < 3:
                    continue
                try:
                    fp = [tuple(float(c) for c in points[int(i)]) for i in fi]
                    edges = [Edge.make_line(fp[j], fp[(j + 1) % len(fp)]) for j in range(len(fp))]
                    built_faces.append(Face(Wire(edges)))
                except Exception:
                    pass
            if not built_faces:
                return None
            sh = Shell(built_faces)
            try:
                return Solid(sh)
            except Exception:
                from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeSolid
                ms = BRepBuilderAPI_MakeSolid(sh.wrapped)
                return Solid.cast(ms.Solid())
        except Exception:
            return None

    elif name == 'text':
        txt  = (str(node.pos_args[0]) if node.pos_args else str(node.attrs.get('text', node.attrs.get('txt', ''))))
        size = float(node.pos_args[1] if len(node.pos_args) >= 2 else node.attrs.get('size', 10.0))
        font = str(node.attrs.get('font', 'Arial'))
        halign = node.attrs.get('halign', 'left')
        valign = node.attrs.get('valign', 'baseline')
        try:
            from build123d import Align
            h_map = {'left': Align.MIN, 'center': Align.CENTER, 'right': Align.MAX}
            v_map = {'bottom': Align.MIN, 'baseline': Align.MIN, 'center': Align.CENTER, 'top': Align.MAX}
            align = (h_map.get(halign.lower(), Align.MIN), v_map.get(valign.lower(), Align.MIN))
            return Compound.make_text(txt=txt, font_size=size, font=font, align=align)
        except Exception:
            try:
                return Compound.make_text(txt=txt, font_size=size, font=font)
            except Exception:
                return Rectangle(size, size)

    # ── Extrusions ──────────────────────────────────────────────────────────
    elif name == 'linear_extrude':
        height = float(node.attrs.get('height', 1.0))
        center = bool(node.attrs.get('center', False))
        scale  = node.attrs.get('scale', 1.0)

        child_shapes = [s for s in (evaluate_node(c) for c in node.children) if s is not None]
        if not child_shapes:
            return None

        if len(child_shapes) > 1:
            combined = child_shapes[0]
            for s in child_shapes[1:]:
                try:
                    combined = combined.fuse(s)
                except Exception:
                    combined = make_compound_safe([combined, s])
        else:
            combined = child_shapes[0]

        try:
            taper = 0.0
            if scale is not None and isinstance(scale, (int, float)) and abs(float(scale) - 1.0) > 1e-4:
                taper = math.degrees(math.atan((float(scale) - 1.0) * 5.0 / height))

            extruded = (extrude(combined, amount=height, taper=taper, dir=(0, 0, 1))
                        if abs(taper) > 1e-4
                        else extrude(combined, amount=height, dir=(0, 0, 1)))
            if center:
                extruded = Location((0, 0, -height / 2.0)) * extruded
            return extruded
        except Exception as e:
            print(f"[csg_parser] linear_extrude failed: {e}")
            return combined

    elif name == 'rotate_extrude':
        angle = (node.pos_args[0] if node.pos_args else node.attrs.get('angle', 360.0))
        angle = float(angle)

        child_shapes = [s for s in (evaluate_node(c) for c in node.children) if s is not None]
        if not child_shapes:
            return None
        combined = child_shapes[0] if len(child_shapes) == 1 else make_compound_safe(child_shapes)

        try:
            xz_profile = Rotation(90, 0, 0) * combined
            return revolve(xz_profile, axis=Axis.Z, revolution_arc=angle)
        except Exception:
            try:
                return revolve(combined, axis=Axis.Y, revolution_arc=angle)
            except Exception:
                return combined

    # ── Transforms ──────────────────────────────────────────────────────────
    elif name == 'translate':
        v = (node.pos_args[0] if node.pos_args else node.attrs.get('v', [0, 0, 0]))
        if isinstance(v, (int, float)):
            v = [float(v), 0.0, 0.0]
        elif not isinstance(v, (list, tuple)) or len(v) < 3:
            v = [0.0, 0.0, 0.0]
        loc = Location((float(v[0]), float(v[1]), float(v[2])))

        child_shapes = [s for s in (evaluate_node(c) for c in node.children) if s is not None]
        if not child_shapes:
            return None
        combined = child_shapes[0] if len(child_shapes) == 1 else make_compound_safe(child_shapes)
        return loc * combined

    elif name == 'rotate':
        a = (node.pos_args[0] if node.pos_args else node.attrs.get('a', [0, 0, 0]))
        if isinstance(a, (int, float)):
            a = [0.0, 0.0, float(a)]
        elif not isinstance(a, (list, tuple)) or len(a) < 3:
            a = [0.0, 0.0, 0.0]
        try:
            loc = Rotation(float(a[0]), float(a[1]), float(a[2]))
        except Exception:
            loc = Location((0, 0, 0))

        child_shapes = [s for s in (evaluate_node(c) for c in node.children) if s is not None]
        if not child_shapes:
            return None
        combined = child_shapes[0] if len(child_shapes) == 1 else make_compound_safe(child_shapes)
        return loc * combined

    elif name == 'scale':
        v = (node.pos_args[0] if node.pos_args else node.attrs.get('v'))
        if v is None:
            v = [1.0, 1.0, 1.0]
        elif isinstance(v, (int, float)):
            v = [float(v)] * 3

        child_shapes = [s for s in (evaluate_node(c) for c in node.children) if s is not None]
        if not child_shapes:
            return None
        combined = child_shapes[0] if len(child_shapes) == 1 else make_compound_safe(child_shapes)

        sx, sy, sz = float(v[0]), float(v[1]), float(v[2])
        if abs(sx - sy) < 1e-9 and abs(sx - sz) < 1e-9:
            try:
                return combined.scale(sx)
            except Exception:
                pass
        try:
            return _non_uniform_scale(combined, sx, sy, sz)
        except Exception:
            return combined

    elif name == 'mirror':
        v = (node.pos_args[0] if node.pos_args else node.attrs.get('v', [1, 0, 0]))
        if v is None:
            v = [1.0, 0.0, 0.0]

        child_shapes = [s for s in (evaluate_node(c) for c in node.children) if s is not None]
        if not child_shapes:
            return None
        combined = child_shapes[0] if len(child_shapes) == 1 else make_compound_safe(child_shapes)

        try:
            plane = Plane(origin=(0, 0, 0), z_dir=(float(v[0]), float(v[1]), float(v[2])))
        except Exception:
            plane = Plane.XY

        try:
            return combined.mirror(about=plane)
        except Exception:
            try:
                return combined.mirror(plane)
            except Exception:
                return combined

    elif name == 'color':
        color_value = (node.pos_args[0] if node.pos_args else node.attrs.get('c'))

        child_shapes = [s for s in (evaluate_node(c) for c in node.children) if s is not None]
        if not child_shapes:
            return None
        combined = child_shapes[0] if len(child_shapes) == 1 else make_compound_safe(child_shapes)

        if color_value is not None:
            try:
                if isinstance(color_value, str):
                    color_obj = Color(color_value)
                elif isinstance(color_value, (list, tuple)) and len(color_value) >= 3:
                    args = [float(color_value[i]) for i in range(min(4, len(color_value)))]
                    color_obj = Color(*args)
                else:
                    color_obj = None
                if color_obj is not None:
                    for s in flatten_compound(combined):
                        s.color = color_obj
            except Exception as e:
                print(f"[csg_parser] color application failed: {e}")
        return combined

    elif name == 'offset':
        amount = (node.pos_args[0] if node.pos_args else node.attrs.get('r', node.attrs.get('delta', 1.0)))
        amount = float(amount)

        child_shapes = [s for s in (evaluate_node(c) for c in node.children) if s is not None]
        if not child_shapes:
            return None
        combined = child_shapes[0] if len(child_shapes) == 1 else make_compound_safe(child_shapes)

        for method in ('offset_2d', 'offset'):
            try:
                fn = getattr(combined, method)
                return fn(amount)
            except Exception:
                pass
        try:
            from build123d import offset as b123_offset
            return b123_offset(combined, amount)
        except Exception:
            return combined

    elif name == 'projection':
        cut = (bool(node.pos_args[0]) if node.pos_args else bool(node.attrs.get('cut', False)))
        child_shapes = [s for s in (evaluate_node(c) for c in node.children) if s is not None]
        if not child_shapes:
            return None
        combined = child_shapes[0] if len(child_shapes) == 1 else make_compound_safe(child_shapes)
        if cut:
            try:
                return combined.section(Plane.XY)
            except Exception:
                return combined
        else:
            try:
                return combined.project(Plane.XY)
            except Exception:
                return combined

    elif name == 'resize':
        newsize = (node.pos_args[0] if node.pos_args else node.attrs.get('newsize'))
        child_shapes = [s for s in (evaluate_node(c) for c in node.children) if s is not None]
        if not child_shapes:
            return None
        combined = child_shapes[0] if len(child_shapes) == 1 else make_compound_safe(child_shapes)
        if newsize and len(newsize) >= 3:
            try:
                bb = combined.bounding_box()
                dx = bb.max.X - bb.min.X or 1.0
                dy = bb.max.Y - bb.min.Y or 1.0
                dz = bb.max.Z - bb.min.Z or 1.0
                return _non_uniform_scale(combined,
                                          float(newsize[0]) / dx,
                                          float(newsize[1]) / dy,
                                          float(newsize[2]) / dz)
            except Exception:
                return combined
        return combined

    elif name == 'minkowski':
        child_shapes = [s for s in (evaluate_node(c) for c in node.children) if s is not None]
        if not child_shapes:
            return None
        offset_radius = None
        for child in node.children:
            if child.name.lower() in ('circle', 'sphere'):
                r = (child.pos_args[0] if child.pos_args else child.attrs.get('r'))
                if r is None and 'd' in child.attrs:
                    r = float(child.attrs['d']) / 2.0
                if r is not None:
                    offset_radius = float(r)
                    break
        base = child_shapes[0] if len(child_shapes) == 1 else make_compound_safe(child_shapes)
        if offset_radius is not None:
            for method in ('offset_2d', 'offset'):
                try:
                    return getattr(base, method)(offset_radius)
                except Exception:
                    pass
        return base

    elif name in ('render', 'cache'):
        child_shapes = [s for s in (evaluate_node(c) for c in node.children) if s is not None]
        if not child_shapes:
            return None
        return child_shapes[0] if len(child_shapes) == 1 else make_compound_safe(child_shapes)

    elif name == 'surface':
        return Box(10, 10, 1)

    elif name == 'multmatrix':
        matrix = (node.pos_args[0] if node.pos_args else node.attrs.get('m', node.attrs.get('matrix')))
        if matrix and len(matrix) >= 3 and all(len(row) >= 4 for row in matrix[:3]):
            try:
                from OCP.gp import gp_Trsf
                trsf = gp_Trsf()
                trsf.SetValues(
                    float(matrix[0][0]), float(matrix[0][1]), float(matrix[0][2]), float(matrix[0][3]),
                    float(matrix[1][0]), float(matrix[1][1]), float(matrix[1][2]), float(matrix[1][3]),
                    float(matrix[2][0]), float(matrix[2][1]), float(matrix[2][2]), float(matrix[2][3]),
                )
                loc = Location(trsf)
            except Exception:
                try:
                    loc = Location((float(matrix[0][3]), float(matrix[1][3]), float(matrix[2][3])))
                except Exception:
                    loc = Location((0, 0, 0))
        else:
            loc = Location((0, 0, 0))

        child_shapes = [s for s in (evaluate_node(c) for c in node.children) if s is not None]
        if not child_shapes:
            return None
        combined = child_shapes[0] if len(child_shapes) == 1 else make_compound_safe(child_shapes)
        return loc * combined

    elif name == 'intersection_for':
        child_shapes = [s for s in (evaluate_node(c) for c in node.children) if s is not None]
        if not child_shapes:
            return None
        combined_list = flatten_and_clear(child_shapes[0])
        for s in child_shapes[1:]:
            cutters = flatten_and_clear(s)
            new_list: List[Any] = []
            for cutter in cutters:
                for child in combined_list:
                    try:
                        new_list.extend(flatten_and_clear(child & cutter))
                    except Exception:
                        pass
            combined_list = new_list
        if not combined_list:
            return None
        for s in combined_list:
            try:
                s.parent = None
            except Exception:
                pass
        return combined_list[0] if len(combined_list) == 1 else make_compound_safe(combined_list)

    # ── Boolean Operators ───────────────────────────────────────────────────
    elif name in ('union', 'group'):
        child_shapes = [s for s in (evaluate_node(c) for c in node.children) if s is not None]
        if not child_shapes:
            return None
        fused: List[Any] = []
        for s in child_shapes:
            merged = False
            for i, existing in enumerate(fused):
                try:
                    fused[i] = existing.fuse(s)
                    merged = True
                    break
                except Exception:
                    try:
                        fused[i] = existing + s
                        merged = True
                        break
                    except Exception:
                        pass
            if not merged:
                fused.append(s)
        return fused[0] if len(fused) == 1 else make_compound_safe(fused)

    elif name == 'difference':
        child_shapes = [s for s in (evaluate_node(c) for c in node.children) if s is not None]
        if not child_shapes:
            return None
        combined = child_shapes[0]
        for s in child_shapes[1:]:
            try:
                combined = combined - s
            except Exception:
                try:
                    base_parts = flatten_and_clear(combined)
                    cutters    = flatten_and_clear(s)
                    new_parts: List[Any] = []
                    for base in base_parts:
                        cur = base
                        for cutter in cutters:
                            try:
                                cur = cur - cutter
                            except Exception:
                                try:
                                    bb = cutter.bounding_box()
                                    cx, cy, cz = (bb.center().X if hasattr(bb, 'center') else 0,
                                                  bb.center().Y if hasattr(bb, 'center') else 0,
                                                  bb.center().Z if hasattr(bb, 'center') else 0)
                                    exp = Location((-cx, -cy, -cz)) * cutter
                                    exp = exp.scale(1.0001)
                                    exp = Location((cx, cy, cz)) * exp
                                    cur = cur - exp
                                except Exception:
                                    pass
                        new_parts.append(cur)
                    combined = new_parts[0] if len(new_parts) == 1 else make_compound_safe(new_parts)
                except Exception:
                    pass
        return combined

    elif name == 'intersection':
        child_shapes = [s for s in (evaluate_node(c) for c in node.children) if s is not None]
        if not child_shapes:
            return None
        combined = child_shapes[0]
        for s in child_shapes[1:]:
            try:
                combined = combined & s
            except Exception:
                try:
                    base_parts = flatten_and_clear(combined)
                    cutters    = flatten_and_clear(s)
                    new_parts = []
                    for base in base_parts:
                        for cutter in cutters:
                            try:
                                new_parts.extend(flatten_and_clear(base & cutter))
                            except Exception:
                                pass
                    if new_parts:
                        combined = (new_parts[0] if len(new_parts) == 1 else make_compound_safe(new_parts))
                except Exception:
                    pass
        return combined

    elif name == 'hull':
        child_shapes = [s for s in (evaluate_node(c) for c in node.children) if s is not None]
        if not child_shapes:
            return None
        return _hull_from_shapes(child_shapes)

    else:
        child_shapes = [s for s in (evaluate_node(c) for c in node.children) if s is not None]
        if not child_shapes:
            return None
        return child_shapes[0] if len(child_shapes) == 1 else make_compound_safe(child_shapes)

# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

class CSGParser:
    """Parse an OpenSCAD CSG string and return a build123d shape."""
    @staticmethod
    def parse(csg_string: str) -> Any:
        tokens = tokenize(csg_string)
        nodes, _ = parse_statements(tokens, 0)
        shapes = [s for s in (evaluate_node(n) for n in nodes) if s is not None]

        if not shapes:
            raise ValueError("No valid geometry could be evaluated from the CSG tree.")

        for s in shapes:
            try:
                s.parent = None
            except Exception:
                pass

        return shapes[0] if len(shapes) == 1 else make_compound_safe(shapes)

def export_to_step(shape, filename: str) -> None:
    try:
        shape.parent = None
    except Exception:
        pass
    for s in flatten_compound(shape):
        try:
            s.parent = None
        except Exception:
            pass
    export_step(shape, filename)