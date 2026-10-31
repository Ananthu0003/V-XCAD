import {
  Move3d,
  RotateCw,
  Scaling,
  FlipHorizontal2,
  ArrowDownToLine,
} from 'lucide-react';
import type { CADToolType } from '../../ManualCadToolbar';
import { TopologyEntity } from '../../operations/capabilities';
import { num, seg, tog, bodyTool, type FieldOption, type OperationDefinition } from '../types';

const AXIS_OPTS: FieldOption[] = [
  { value: 'x', label: 'X' },
  { value: 'y', label: 'Y' },
  { value: 'z', label: 'Z' },
];

const PLANE_OPTS: FieldOption[] = [
  { value: 'xy', label: 'XY' },
  { value: 'yz', label: 'YZ' },
  { value: 'xz', label: 'XZ' },
];

const PIVOT_OPTS: FieldOption[] = [
  { value: 'center', label: 'Centre' },
  { value: 'origin', label: 'Origin' },
];

const noFace = (_v: Record<string, unknown>, e: TopologyEntity | null | undefined) => e?.entity_type !== 'face';

export const transformDefinition: OperationDefinition = bodyTool('transform', 'Transform', Move3d, 'T', [
  seg('mode', 'Mode', 'move', [
    { value: 'move', label: 'Move' },
    { value: 'rotate', label: 'Rotate' },
    { value: 'scale', label: 'Scale' },
  ]),
  // Move controls
  seg('direction', 'Direction', 'xyz', [
    { value: 'xyz', label: 'XYZ' },
    { value: 'normal', label: 'Normal' },
    { value: 'edge', label: 'Edge' },
  ], {
    visibleWhen: (v) => (v.mode || 'move') === 'move',
  }),
  num('dx', 'X', 10, { step: 1, visibleWhen: (v) => (v.mode || 'move') === 'move' && (v.direction || 'xyz') === 'xyz' }),
  num('dy', 'Y', 0, { step: 1, visibleWhen: (v) => (v.mode || 'move') === 'move' && (v.direction || 'xyz') === 'xyz' }),
  num('dz', 'Z', 0, { step: 1, visibleWhen: (v) => (v.mode || 'move') === 'move' && (v.direction || 'xyz') === 'xyz' }),
  num('distance', 'Distance', 10, { step: 1, visibleWhen: (v) => (v.mode || 'move') === 'move' && (v.direction || 'xyz') !== 'xyz' }),
  // Rotate controls
  seg('axis', 'Axis', 'z', [
    { value: 'x', label: 'X' },
    { value: 'y', label: 'Y' },
    { value: 'z', label: 'Z' },
    { value: 'face_normal', label: 'Normal' },
    { value: 'cylinder_axis', label: 'Cyl Axis' },
    { value: 'edge', label: 'Edge' },
  ], { visibleWhen: (v) => v.mode === 'rotate' }),
  num('angle', 'Angle', 90, { unit: '°', step: 5, quickPresets: [45, 90, 180], visibleWhen: (v) => v.mode === 'rotate' }),
  // Scale controls
  seg('scale_type', 'Scale Type', 'uniform', [
    { value: 'uniform', label: 'Uniform' },
    { value: 'axis', label: 'Per axis' },
  ], {
    visibleWhen: (v) => v.mode === 'scale',
  }),
  num('factor', 'Factor', 1.5, {
    unit: '×', min: 0.001, max: 1000, step: 0.1, quickPresets: [0.5, 1.5, 2],
    visibleWhen: (v) => v.mode === 'scale' && (v.scale_type || 'uniform') === 'uniform',
  }),
  tog('lock_proportions', 'Lock proportions', true, { visibleWhen: (v) => v.mode === 'scale' && v.scale_type === 'axis' }),
  num('sx', 'X scale', 1, { unit: '×', min: 0.001, max: 1000, step: 0.1, visibleWhen: (v) => v.mode === 'scale' && v.scale_type === 'axis' }),
  num('sy', 'Y scale', 1, { unit: '×', min: 0.001, max: 1000, step: 0.1, visibleWhen: (v) => v.mode === 'scale' && v.scale_type === 'axis' }),
  num('sz', 'Z scale', 1, { unit: '×', min: 0.001, max: 1000, step: 0.1, visibleWhen: (v) => v.mode === 'scale' && v.scale_type === 'axis' }),
  // Pivot
  seg('pivot', 'Pivot', 'center', PIVOT_OPTS, { visibleWhen: (v) => v.mode === 'rotate' || v.mode === 'scale' }),
]);

export const moveDefinition: OperationDefinition = bodyTool('move', 'Move', Move3d, 'G', [
  seg('direction', 'Direction', 'xyz', [{ value: 'xyz', label: 'XYZ' }, { value: 'normal', label: 'Normal' }, { value: 'edge', label: 'Edge' }]),
  num('dx', 'X', 10, { step: 1, visibleWhen: (v) => (v.direction || 'xyz') === 'xyz' }),
  num('dy', 'Y', 0, { step: 1, visibleWhen: (v) => (v.direction || 'xyz') === 'xyz' }),
  num('dz', 'Z', 0, { step: 1, visibleWhen: (v) => (v.direction || 'xyz') === 'xyz' }),
  num('distance', 'Distance', 10, { step: 1, visibleWhen: (v) => (v.direction || 'xyz') !== 'xyz' }),
]);

export const rotateDefinition: OperationDefinition = bodyTool('rotate', 'Rotate', RotateCw, 'R', [
  seg('axis', 'Axis', 'z', [
    { value: 'x', label: 'X' },
    { value: 'y', label: 'Y' },
    { value: 'z', label: 'Z' },
    { value: 'face_normal', label: 'Normal' },
    { value: 'cylinder_axis', label: 'Cyl Axis' },
    { value: 'edge', label: 'Edge' },
  ]),
  num('angle', 'Angle', 90, { unit: '°', step: 5, quickPresets: [45, 90, 180] }),
  seg('pivot', 'Pivot', 'center', PIVOT_OPTS),
]);

export const scaleDefinition: OperationDefinition = bodyTool('scale', 'Scale', Scaling, 'S', [
  seg('mode', 'Mode', 'uniform', [{ value: 'uniform', label: 'Uniform' }, { value: 'axis', label: 'Per axis' }]),
  num('factor', 'Factor', 1.5, {
    unit: '×', min: 0.001, max: 1000, step: 0.1, quickPresets: [0.5, 1.5, 2],
    visibleWhen: (v) => (v.mode || 'uniform') === 'uniform',
  }),
  tog('lock_proportions', 'Lock proportions', true, { visibleWhen: (v) => v.mode === 'axis' }),
  num('sx', 'X scale', 1, { unit: '×', min: 0.001, max: 1000, step: 0.1, visibleWhen: (v) => v.mode === 'axis' }),
  num('sy', 'Y scale', 1, { unit: '×', min: 0.001, max: 1000, step: 0.1, visibleWhen: (v) => v.mode === 'axis' }),
  num('sz', 'Z scale', 1, { unit: '×', min: 0.001, max: 1000, step: 0.1, visibleWhen: (v) => v.mode === 'axis' }),
  seg('pivot', 'Pivot', 'center', PIVOT_OPTS),
]);

export const mirrorDefinition: OperationDefinition = bodyTool('mirror', 'Mirror', FlipHorizontal2, 'M', [
  seg('plane', 'Plane', 'yz', PLANE_OPTS, { visibleWhen: noFace }),
  num('offset', 'Plane offset', 0, { step: 1 }),
  tog('keep_original', 'Keep original (symmetric body)', true),
]);

export const alignDefinition: OperationDefinition = bodyTool('align', 'Align to Bed', ArrowDownToLine, 'A', [
  seg('mode', 'Mode', 'drop_to_bed', [
    { value: 'drop_to_bed', label: 'Drop' },
    { value: 'face_down', label: 'Face down' },
    { value: 'center_xy', label: 'Centre XY' },
    { value: 'center_origin', label: 'Origin' },
  ]),
]);

