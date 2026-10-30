import {
  Shapes,
  SquareDashed,
  Expand,
  SquareSplitVertical,
  Wrench,
} from 'lucide-react';
import { TopologyEntity } from '../../operations/capabilities';
import { num, seg, tog, bodyTool, type FieldOption, type OperationDefinition } from '../types';

const PLANE_OPTS: FieldOption[] = [
  { value: 'xy', label: 'XY' },
  { value: 'yz', label: 'YZ' },
  { value: 'xz', label: 'XZ' },
];

const noFace = (_v: Record<string, unknown>, e: TopologyEntity | null | undefined) => e?.entity_type !== 'face';

export const primitiveDefinition: OperationDefinition = bodyTool('primitive', 'Add / Cut Shape', Shapes, 'N', [
  seg('mode', 'Operation', 'add', [
    { value: 'add', label: 'Add' },
    { value: 'subtract', label: 'Cut' },
    { value: 'intersect', label: 'Intersect' },
  ]),
  seg('shape', 'Shape', 'box', [
    { value: 'box', label: 'Box' },
    { value: 'cylinder', label: 'Cyl' },
    { value: 'sphere', label: 'Sphere' },
    { value: 'cone', label: 'Cone' },
  ]),
  num('length', 'Length', 10, { min: 0.01, visibleWhen: (v) => (v.shape || 'box') === 'box' }),
  num('width', 'Width', 10, { min: 0.01, visibleWhen: (v) => (v.shape || 'box') === 'box' }),
  num('diameter', 'Diameter (⌀)', 10, { min: 0.01, visibleWhen: (v) => (v.shape || 'box') !== 'box' }),
  num('top_diameter', 'Top ⌀', 0, { min: 0, visibleWhen: (v) => v.shape === 'cone' }),
  num('height', 'Height', 10, { min: 0.01, visibleWhen: (v) => (v.shape || 'box') !== 'sphere' }),
  num('x', 'Centre X', 0),
  num('y', 'Centre Y', 0),
  num('z', 'Centre Z', 0),
]);

export const shellDefinition: OperationDefinition = bodyTool('shell', 'Shell', SquareDashed, 'T', [
  num('thickness', 'Wall thickness', 2, { min: 0.1, step: 0.25, quickPresets: [1, 1.5, 2, 3] }),
  seg('direction', 'Direction', 'inside', [{ value: 'inside', label: 'Inside' }, { value: 'outside', label: 'Outside' }]),
]);

export const offsetDefinition: OperationDefinition = bodyTool('offset', 'Offset', Expand, 'O', [
  num('amount', 'Amount (±)', 0.2, { step: 0.05, quickPresets: [-0.2, 0.1, 0.2, 0.5] }),
]);

export const splitDefinition: OperationDefinition = bodyTool('split', 'Split by Plane', SquareSplitVertical, 'L', [
  seg('plane', 'Plane', 'xy', PLANE_OPTS, { visibleWhen: noFace }),
  num('offset', 'Plane offset', 0, { step: 1 }),
  seg('keep', 'Keep', 'top', [
    { value: 'top', label: 'Top' },
    { value: 'bottom', label: 'Bottom' },
    { value: 'both', label: 'Both' },
  ]),
]);

export const healDefinition: OperationDefinition = bodyTool('heal', 'Heal / Clean', Wrench, 'K', [
  tog('fix', 'Fix shape errors', true),
  tog('clean', 'Merge co-planar faces', true),
  tog('keep_largest', 'Remove loose solids', true),
]);

