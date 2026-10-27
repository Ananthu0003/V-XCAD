import React from 'react';
import {
  CircleDot,
  Square,
  Layers,
  CornerDownRight,
  Scissors,
  Ruler,
  MousePointer2,
  Pencil,
  Move3d,
  RotateCw,
  Scaling,
  FlipHorizontal2,
  ArrowDownToLine,
  Shapes,
  SquareDashed,
  Expand,
  SquareSplitVertical,
  Grid3x3,
  Orbit,
  Wrench,
  Settings2,
  Trash2,
  type LucideIcon,
} from 'lucide-react';
import type { CADToolType } from '../ManualCadToolbar';
import {
  EntityClassification,
  CAPABILITY_MATRIX,
  TopologyEntity,
} from './capabilities';
import { GeometryContext } from './context';

export type FieldType = 'number' | 'select' | 'segment' | 'toggle' | 'position';

export interface FieldOption {
  value: string;
  label: string;
  meta?: Record<string, unknown>;
}

export interface OperationField {
  key: string;
  label: string;
  type: FieldType;
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
  default: unknown;
  options?: FieldOption[];
  advanced?: boolean;
  visibleWhen?: (values: Record<string, unknown>, entity: TopologyEntity | null | undefined) => boolean;
  quickPresets?: number[];
  placeholder?: string;
  initial?: (ctx: GeometryContext, values: Record<string, unknown>) => unknown;
  bounds?: (ctx: GeometryContext, values: Record<string, unknown>) => { min?: number; max?: number; step?: number };
}

export interface OperationDefinition {
  id: CADToolType;
  label: string;
  icon: LucideIcon;
  shortcut: string;
  appliesTo: EntityClassification[];
  requiresSelection: boolean;
  fields: OperationField[];
  previewable: boolean;
  toRequest: (values: Record<string, unknown>, selection: TopologyEntity | null | undefined) => Record<string, unknown>;
  customForm?: React.ComponentType<{
    params: Record<string, unknown>;
    onChange: (k: string, v: unknown) => void;
    entity?: TopologyEntity | null;
  }>;
}

export const HOLE_PRESETS = [
  { label: 'M3', dia: 3.4, cbDia: 6.0, cbDepth: 3.5 },
  { label: 'M4', dia: 4.5, cbDia: 8.0, cbDepth: 4.5 },
  { label: 'M5', dia: 5.5, cbDia: 10.0, cbDepth: 5.5 },
  { label: 'M6', dia: 6.6, cbDia: 11.5, cbDepth: 6.5 },
  { label: 'M8', dia: 9.0, cbDia: 15.0, cbDepth: 8.5 },
  { label: '1/4"', dia: 6.7, cbDia: 11.0, cbDepth: 6.5 },
];


// ─────────────────────────────────────────────────────────────
// Body-level editing tools (post-generation 3D editing)
// ─────────────────────────────────────────────────────────────
const num = (
  key: string, label: string, def: number,
  opts: Partial<OperationField> = {},
): OperationField => ({
  key, label, type: 'number', unit: 'mm', step: 1, default: def, advanced: false, ...opts,
});
const seg = (
  key: string, label: string, def: string, options: FieldOption[],
  opts: Partial<OperationField> = {},
): OperationField => ({ key, label, type: 'segment', options, default: def, advanced: false, ...opts });
const tog = (
  key: string, label: string, def: boolean,
  opts: Partial<OperationField> = {},
): OperationField => ({
  key, label, type: 'toggle', default: def, advanced: false, ...opts,
});
const AXIS_OPTS: FieldOption[] = [
  { value: 'x', label: 'X' }, { value: 'y', label: 'Y' }, { value: 'z', label: 'Z' },
];
const PLANE_OPTS: FieldOption[] = [
  { value: 'xy', label: 'XY' }, { value: 'yz', label: 'YZ' }, { value: 'xz', label: 'XZ' },
];
const PIVOT_OPTS: FieldOption[] = [
  { value: 'center', label: 'Centre' }, { value: 'origin', label: 'Origin' },
];
/** Hide plane controls when a planar face is selected: the face defines the plane. */
const noFace = (_v: Record<string, unknown>, e: TopologyEntity | null | undefined) => e?.entity_type !== 'face';

function bodyTool(
  id: CADToolType, label: string, icon: LucideIcon, shortcut: string,
  fields: OperationField[], previewable = true,
): OperationDefinition {
  return {
    id, label, icon, shortcut,
    appliesTo: CAPABILITY_MATRIX[id],
    requiresSelection: true,
    previewable,
    fields,
    toRequest: (values) => ({ ...values }),
  };
}

const BODY_TOOLS: Partial<Record<CADToolType, OperationDefinition>> = {
  transform: bodyTool('transform', 'Transform', Move3d, 'T', [
    seg('mode', 'Mode', 'move', [
      { value: 'move', label: 'Move' },
      { value: 'rotate', label: 'Rotate' },
      { value: 'scale', label: 'Scale' },
    ]),
    // Move controls
    seg('direction', 'Direction', 'xyz', [{ value: 'xyz', label: 'XYZ' }, { value: 'normal', label: 'Normal' }, { value: 'edge', label: 'Edge' }], {
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
    seg('scale_type', 'Scale Type', 'uniform', [{ value: 'uniform', label: 'Uniform' }, { value: 'axis', label: 'Per axis' }], {
      visibleWhen: (v) => v.mode === 'scale',
    }),
    num('factor', 'Factor', 1.5, { unit: '×', min: 0.001, max: 1000, step: 0.1, quickPresets: [0.5, 1.5, 2],
      visibleWhen: (v) => v.mode === 'scale' && (v.scale_type || 'uniform') === 'uniform' }),
    tog('lock_proportions', 'Lock proportions', true, { visibleWhen: (v) => v.mode === 'scale' && v.scale_type === 'axis' }),
    num('sx', 'X scale', 1, { unit: '×', min: 0.001, max: 1000, step: 0.1, visibleWhen: (v) => v.mode === 'scale' && v.scale_type === 'axis' }),
    num('sy', 'Y scale', 1, { unit: '×', min: 0.001, max: 1000, step: 0.1, visibleWhen: (v) => v.mode === 'scale' && v.scale_type === 'axis' }),
    num('sz', 'Z scale', 1, { unit: '×', min: 0.001, max: 1000, step: 0.1, visibleWhen: (v) => v.mode === 'scale' && v.scale_type === 'axis' }),
    // Pivot
    seg('pivot', 'Pivot', 'center', PIVOT_OPTS, { visibleWhen: (v) => v.mode === 'rotate' || v.mode === 'scale' }),
  ]),
  move: bodyTool('move', 'Move', Move3d, 'G', [
    seg('direction', 'Direction', 'xyz', [{ value: 'xyz', label: 'XYZ' }, { value: 'normal', label: 'Normal' }, { value: 'edge', label: 'Edge' }]),
    num('dx', 'X', 10, { step: 1, visibleWhen: (v) => (v.direction || 'xyz') === 'xyz' }),
    num('dy', 'Y', 0, { step: 1, visibleWhen: (v) => (v.direction || 'xyz') === 'xyz' }),
    num('dz', 'Z', 0, { step: 1, visibleWhen: (v) => (v.direction || 'xyz') === 'xyz' }),
    num('distance', 'Distance', 10, { step: 1, visibleWhen: (v) => (v.direction || 'xyz') !== 'xyz' }),
  ]),
  rotate: bodyTool('rotate', 'Rotate', RotateCw, 'R', [
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
  ]),
  scale: bodyTool('scale', 'Scale', Scaling, 'S', [
    seg('mode', 'Mode', 'uniform', [{ value: 'uniform', label: 'Uniform' }, { value: 'axis', label: 'Per axis' }]),
    num('factor', 'Factor', 1.5, { unit: '×', min: 0.001, max: 1000, step: 0.1, quickPresets: [0.5, 1.5, 2],
      visibleWhen: (v) => (v.mode || 'uniform') === 'uniform' }),
    tog('lock_proportions', 'Lock proportions', true, { visibleWhen: (v) => v.mode === 'axis' }),
    num('sx', 'X scale', 1, { unit: '×', min: 0.001, max: 1000, step: 0.1, visibleWhen: (v) => v.mode === 'axis' }),
    num('sy', 'Y scale', 1, { unit: '×', min: 0.001, max: 1000, step: 0.1, visibleWhen: (v) => v.mode === 'axis' }),
    num('sz', 'Z scale', 1, { unit: '×', min: 0.001, max: 1000, step: 0.1, visibleWhen: (v) => v.mode === 'axis' }),
    seg('pivot', 'Pivot', 'center', PIVOT_OPTS),
  ]),
  mirror: bodyTool('mirror', 'Mirror', FlipHorizontal2, 'M', [
    seg('plane', 'Plane', 'yz', PLANE_OPTS, { visibleWhen: noFace }),
    num('offset', 'Plane offset', 0, { step: 1 }),
    tog('keep_original', 'Keep original (symmetric body)', true),
  ]),
  align: bodyTool('align', 'Align to Bed', ArrowDownToLine, 'A', [
    seg('mode', 'Mode', 'drop_to_bed', [
      { value: 'drop_to_bed', label: 'Drop' },
      { value: 'face_down', label: 'Face down' },
      { value: 'center_xy', label: 'Centre XY' },
      { value: 'center_origin', label: 'Origin' },
    ]),
  ]),
  primitive: bodyTool('primitive', 'Add / Cut Shape', Shapes, 'N', [
    seg('mode', 'Operation', 'add', [
      { value: 'add', label: 'Add' }, { value: 'subtract', label: 'Cut' }, { value: 'intersect', label: 'Intersect' },
    ]),
    seg('shape', 'Shape', 'box', [
      { value: 'box', label: 'Box' }, { value: 'cylinder', label: 'Cyl' },
      { value: 'sphere', label: 'Sphere' }, { value: 'cone', label: 'Cone' },
    ]),
    num('length', 'Length', 10, { min: 0.01, visibleWhen: (v) => (v.shape || 'box') === 'box' }),
    num('width', 'Width', 10, { min: 0.01, visibleWhen: (v) => (v.shape || 'box') === 'box' }),
    num('diameter', 'Diameter (⌀)', 10, { min: 0.01, visibleWhen: (v) => (v.shape || 'box') !== 'box' }),
    num('top_diameter', 'Top ⌀', 0, { min: 0, visibleWhen: (v) => v.shape === 'cone' }),
    num('height', 'Height', 10, { min: 0.01, visibleWhen: (v) => (v.shape || 'box') !== 'sphere' }),
    num('x', 'Centre X', 0), num('y', 'Centre Y', 0), num('z', 'Centre Z', 0),
  ]),
  shell: bodyTool('shell', 'Shell', SquareDashed, 'T', [
    num('thickness', 'Wall thickness', 2, { min: 0.1, step: 0.25, quickPresets: [1, 1.5, 2, 3] }),
    seg('direction', 'Direction', 'inside', [{ value: 'inside', label: 'Inside' }, { value: 'outside', label: 'Outside' }]),
  ]),
  offset: bodyTool('offset', 'Offset', Expand, 'O', [
    num('amount', 'Amount (±)', 0.2, { step: 0.05, quickPresets: [-0.2, 0.1, 0.2, 0.5] }),
  ]),
  split: bodyTool('split', 'Split by Plane', SquareSplitVertical, 'L', [
    seg('plane', 'Plane', 'xy', PLANE_OPTS, { visibleWhen: noFace }),
    num('offset', 'Plane offset', 0, { step: 1 }),
    seg('keep', 'Keep', 'top', [
      { value: 'top', label: 'Top' }, { value: 'bottom', label: 'Bottom' }, { value: 'both', label: 'Both' },
    ]),
  ]),
  linear_pattern: bodyTool('linear_pattern', 'Linear Pattern', Grid3x3, 'Y', [
    num('count', 'Count', 3, { unit: '×', min: 2, max: 100, step: 1 }),
    num('dx', 'Spacing X', 20), num('dy', 'Spacing Y', 0), num('dz', 'Spacing Z', 0),
  ]),
  polar_pattern: bodyTool('polar_pattern', 'Polar Pattern', Orbit, 'U', [
    num('count', 'Count', 4, { unit: '×', min: 2, max: 100, step: 1 }),
    num('angle', 'Total angle', 360, { unit: '°', step: 15 }),
    seg('axis', 'Axis', 'z', AXIS_OPTS),
    num('cx', 'Centre X', 0), num('cy', 'Centre Y', 0), num('cz', 'Centre Z', 0),
  ]),
  heal: bodyTool('heal', 'Heal / Clean', Wrench, 'K', [
    tog('fix', 'Fix shape errors', true),
    tog('clean', 'Merge co-planar faces', true),
    tog('keep_largest', 'Remove loose solids', true),
  ]),
};

export const OPERATION_REGISTRY: Record<CADToolType, OperationDefinition> = {
  select: {
    id: 'select',
    label: 'Select',
    icon: MousePointer2,
    shortcut: 'V',
    appliesTo: CAPABILITY_MATRIX.select,
    requiresSelection: false,
    previewable: false,
    fields: [],
    toRequest: (values) => ({ ...values }),
  },

  hole: {
    id: 'hole',
    label: 'Hole Wizard',
    icon: CircleDot,
    shortcut: 'H',
    appliesTo: CAPABILITY_MATRIX.hole,
    requiresSelection: true,
    previewable: true,
    fields: [
      // Basic 1: Hole Type
      {
        key: 'hole_type',
        label: 'Hole Type',
        type: 'segment',
        options: [
          { value: 'blind', label: 'Blind' },
          { value: 'through', label: 'Through' },
          { value: 'counterbore', label: 'Counterbore' },
          { value: 'countersink', label: 'Countersink' },
        ],
        default: 'blind',
        initial: (ctx) => (ctx.planar?.is_through_clear ? 'through' : 'blind'),
        advanced: false,
      },
      // Basic 2: Diameter
      {
        key: 'diameter',
        label: 'Diameter (⌀)',
        type: 'number',
        unit: 'mm',
        min: 0.1,
        step: 0.1,
        default: 6,
        initial: (ctx) => Math.max(0.1, Math.min(6, (ctx.planar?.max_diameter || 12) * 0.5)),
        bounds: (ctx) => ({ max: ctx.planar?.max_diameter ?? undefined }),
        advanced: false,
      },
      // Basic 3: Depth (hidden for through)
      {
        key: 'depth',
        label: 'Depth',
        type: 'number',
        unit: 'mm',
        min: 0.5,
        step: 0.5,
        default: 10,
        initial: (ctx) => Math.max(0.5, Math.min(10, ctx.planar?.material_depth || 10)),
        bounds: (ctx) => ({ max: ctx.planar?.material_depth ?? undefined }),
        advanced: false,
        visibleWhen: (v) => v.hole_type !== 'through',
      },
      // Basic: Counterbore Diameter (visible for counterbore)
      {
        key: 'cbore_diameter',
        label: 'C-Bore ⌀',
        type: 'number',
        unit: 'mm',
        min: 0.1,
        step: 0.5,
        default: 11,
        advanced: false,
        visibleWhen: (v) => v.hole_type === 'counterbore',
      },
      // Basic: Counterbore Depth (visible for counterbore)
      {
        key: 'cbore_depth',
        label: 'C-Bore Depth',
        type: 'number',
        unit: 'mm',
        min: 0.1,
        step: 0.5,
        default: 4,
        advanced: false,
        visibleWhen: (v) => v.hole_type === 'counterbore',
      },
      // Basic: Countersink Diameter (visible for countersink)
      {
        key: 'csink_diameter',
        label: 'C-Sink ⌀',
        type: 'number',
        unit: 'mm',
        min: 0.1,
        step: 0.5,
        default: 11,
        advanced: false,
        visibleWhen: (v) => v.hole_type === 'countersink',
      },
      // Basic: Countersink Angle (visible for countersink)
      {
        key: 'csink_angle',
        label: 'Angle',
        type: 'number',
        unit: '°',
        min: 30,
        step: 1,
        default: 90,
        advanced: false,
        visibleWhen: (v) => v.hole_type === 'countersink',
      },
      // Advanced: Standard Preset
      {
        key: 'preset',
        label: 'Preset',
        type: 'select',
        options: HOLE_PRESETS.map((p) => ({
          value: p.label,
          label: `${p.label} (⌀${p.dia} mm)`,
          meta: p,
        })),
        default: '',
        placeholder: 'Standard preset…',
        advanced: true,
      },
      // Advanced: Position
      {
        key: 'position',
        label: 'Position',
        type: 'position',
        default: { pos_x: 0, pos_y: 0 },
        initial: (ctx) => {
          if (ctx.planar?.center_uv) return { pos_x: ctx.planar.center_uv[0], pos_y: ctx.planar.center_uv[1] };
          return { pos_x: 0, pos_y: 0 };
        },
        advanced: true,
        visibleWhen: (_v, e) => !e?.radius || e.radius > 8,
      },
    ],
    toRequest: (values) => {
      const pos = (typeof values.position === 'object' && values.position !== null)
        ? values.position as { pos_x?: number; pos_y?: number }
        : {};
      return {
        ...values,
        pos_x: values.pos_x ?? pos.pos_x ?? 0,
        pos_y: values.pos_y ?? pos.pos_y ?? 0,
        diameter: Number(values.diameter ?? 6),
        depth: values.hole_type === 'through' ? 100 : Number(values.depth ?? 10),
        through: values.hole_type === 'through',
        cbore_diameter: values.hole_type === 'counterbore' ? Number(values.cbore_diameter ?? 11) : undefined,
        cbore_depth: values.hole_type === 'counterbore' ? Number(values.cbore_depth ?? 4) : undefined,
        csink_diameter: values.hole_type === 'countersink' ? Number(values.csink_diameter ?? 11) : undefined,
        csink_angle: values.hole_type === 'countersink' ? Number(values.csink_angle ?? 90) : undefined,
      };
    },
  },

  pocket: {
    id: 'pocket',
    label: 'Pocket Cut',
    icon: Square,
    shortcut: 'P',
    appliesTo: CAPABILITY_MATRIX.pocket,
    requiresSelection: true,
    previewable: true,
    fields: [
      // Basic 1: Profile shape
      {
        key: 'profile',
        label: 'Shape',
        type: 'segment',
        options: [
          { value: 'rectangle', label: 'Rect' },
          { value: 'circle', label: 'Circle' },
          { value: 'slot', label: 'Slot' },
        ],
        default: 'rectangle',
        initial: (ctx) => (ctx.planar?.is_circular ? 'circle' : 'rectangle'),
        advanced: false,
      },
      // Basic: Rectangle size
      {
        key: 'width',
        label: 'Width',
        type: 'number',
        unit: 'mm',
        min: 0.1,
        step: 1,
        default: 25,
        initial: (ctx) => Math.max(0.1, (ctx.planar?.extents_u || 50) * 0.5),
        advanced: false,
        visibleWhen: (v) => (v.profile || 'rectangle') === 'rectangle',
      },
      {
        key: 'height',
        label: 'Length',
        type: 'number',
        unit: 'mm',
        min: 0.1,
        step: 1,
        default: 18,
        initial: (ctx) => Math.max(0.1, (ctx.planar?.extents_v || 36) * 0.5),
        advanced: false,
        visibleWhen: (v) => (v.profile || 'rectangle') === 'rectangle',
      },
      // Basic: Circle size
      {
        key: 'diameter',
        label: 'Diameter (⌀)',
        type: 'number',
        unit: 'mm',
        min: 0.1,
        step: 1,
        default: 25,
        initial: (ctx) => Math.max(0.1, (ctx.planar?.max_diameter || 50) * 0.5),
        bounds: (ctx) => ({ max: ctx.planar?.max_diameter ?? undefined }),
        advanced: false,
        visibleWhen: (v) => v.profile === 'circle',
      },
      // Basic: Slot size
      {
        key: 'length',
        label: 'Length',
        type: 'number',
        unit: 'mm',
        min: 0.1,
        step: 1,
        default: 35,
        advanced: false,
        visibleWhen: (v) => v.profile === 'slot',
      },
      {
        key: 'width',
        label: 'Width',
        type: 'number',
        unit: 'mm',
        min: 0.1,
        step: 1,
        default: 12,
        advanced: false,
        visibleWhen: (v) => v.profile === 'slot',
      },
      // Basic: Depth
      {
        key: 'depth',
        label: 'Depth',
        type: 'number',
        unit: 'mm',
        min: 0.1,
        step: 0.5,
        default: 6,
        initial: (ctx) => Math.max(0.5, Math.min(6, ctx.planar?.material_depth || 10)),
        bounds: (ctx) => ({ max: ctx.planar?.material_depth ?? undefined }),
        advanced: false,
      },
      // Advanced: Corner Radius
      {
        key: 'corner_radius',
        label: 'Corner R',
        type: 'number',
        unit: 'mm',
        min: 0,
        step: 0.5,
        default: 2,
        advanced: true,
        visibleWhen: (v) => (v.profile || 'rectangle') === 'rectangle',
      },
      // Advanced: Position
      {
        key: 'position',
        label: 'Position',
        type: 'position',
        default: { pos_x: 0, pos_y: 0 },
        initial: (ctx) => {
          if (ctx.planar?.center_uv) return { pos_x: ctx.planar.center_uv[0], pos_y: ctx.planar.center_uv[1] };
          return { pos_x: 0, pos_y: 0 };
        },
        advanced: true,
      },
      // Advanced: Rotation (only for rectangle/slot)
      {
        key: 'rotation_deg',
        label: 'Rotation',
        type: 'number',
        unit: '°',
        min: 0,
        step: 15,
        default: 0,
        advanced: true,
        visibleWhen: (v) => (v.profile || 'rectangle') !== 'circle',
      },
    ],
    toRequest: (values) => {
      const pos = (typeof values.position === 'object' && values.position !== null)
        ? values.position as { pos_x?: number; pos_y?: number }
        : {};
      return {
        ...values,
        profile: values.profile || 'rectangle',
        pos_x: values.pos_x ?? pos.pos_x ?? 0,
        pos_y: values.pos_y ?? pos.pos_y ?? 0,
        width: Number(values.width ?? 25),
        height: Number(values.height ?? 18),
        length: Number(values.length ?? 35),
        diameter: Number(values.diameter ?? 25),
        depth: Number(values.depth ?? 6),
        corner_radius: Number(values.corner_radius ?? 0),
        rotation_deg: Number(values.rotation_deg ?? 0),
      };
    },
  },

  pad: {
    id: 'pad',
    label: 'Pad / Boss',
    icon: Layers,
    shortcut: 'E',
    appliesTo: CAPABILITY_MATRIX.pad,
    requiresSelection: true,
    previewable: true,
    fields: [
      // Basic 1: Profile shape
      {
        key: 'profile',
        label: 'Shape',
        type: 'segment',
        options: [
          { value: 'rectangle', label: 'Rect' },
          { value: 'circle', label: 'Circle' },
        ],
        default: 'rectangle',
        initial: (ctx) => (ctx.planar?.is_circular ? 'circle' : 'rectangle'),
        advanced: false,
      },
      // Basic: Rectangle size
      {
        key: 'width',
        label: 'Width',
        type: 'number',
        unit: 'mm',
        min: 0.1,
        step: 1,
        default: 20,
        initial: (ctx) => Math.max(0.1, (ctx.planar?.extents_u || 40) * 0.5),
        advanced: false,
        visibleWhen: (v) => (v.profile || 'rectangle') === 'rectangle',
      },
      {
        key: 'length',
        label: 'Length',
        type: 'number',
        unit: 'mm',
        min: 0.1,
        step: 1,
        default: 20,
        initial: (ctx) => Math.max(0.1, (ctx.planar?.extents_v || 40) * 0.5),
        advanced: false,
        visibleWhen: (v) => (v.profile || 'rectangle') === 'rectangle',
      },
      // Basic: Circle size
      {
        key: 'diameter',
        label: 'Diameter (⌀)',
        type: 'number',
        unit: 'mm',
        min: 0.1,
        step: 1,
        default: 20,
        initial: (ctx) => Math.max(0.1, (ctx.planar?.max_diameter || 40) * 0.5),
        bounds: (ctx) => ({ max: ctx.planar?.max_diameter ?? undefined }),
        advanced: false,
        visibleWhen: (v) => v.profile === 'circle',
      },
      // Basic: Height
      {
        key: 'height',
        label: 'Height',
        type: 'number',
        unit: 'mm',
        min: 0.1,
        step: 0.5,
        default: 6,
        advanced: false,
      },
      // Advanced: Corner Radius
      {
        key: 'corner_radius',
        label: 'Corner R',
        type: 'number',
        unit: 'mm',
        min: 0,
        step: 0.5,
        default: 1.5,
        advanced: true,
        visibleWhen: (v) => (v.profile || 'rectangle') === 'rectangle',
      },
      // Advanced: Position
      {
        key: 'position',
        label: 'Position',
        type: 'position',
        default: { pos_x: 0, pos_y: 0 },
        initial: (ctx) => {
          if (ctx.planar?.center_uv) return { pos_x: ctx.planar.center_uv[0], pos_y: ctx.planar.center_uv[1] };
          return { pos_x: 0, pos_y: 0 };
        },
        advanced: true,
      },
      // Advanced: Rotation
      {
        key: 'rotation_deg',
        label: 'Rotation',
        type: 'number',
        unit: '°',
        min: 0,
        step: 15,
        default: 0,
        advanced: true,
      },
    ],
    toRequest: (values) => {
      const pos = (typeof values.position === 'object' && values.position !== null)
        ? values.position as { pos_x?: number; pos_y?: number }
        : {};
      return {
        ...values,
        profile: values.profile || 'rectangle',
        pos_x: values.pos_x ?? pos.pos_x ?? 0,
        pos_y: values.pos_y ?? pos.pos_y ?? 0,
        width: Number(values.width ?? 20),
        length: Number(values.length ?? 20),
        diameter: Number(values.diameter ?? 20),
        height: Number(values.height ?? 6),
        corner_radius: Number(values.corner_radius ?? 0),
        rotation_deg: Number(values.rotation_deg ?? 0),
      };
    },
  },

  fillet: {
    id: 'fillet',
    label: 'Edge Fillet',
    icon: CornerDownRight,
    shortcut: 'F',
    appliesTo: CAPABILITY_MATRIX.fillet,
    requiresSelection: true,
    previewable: true,
    fields: [
      {
        key: 'radius',
        label: 'Radius',
        type: 'number',
        unit: 'mm',
        min: 0.1,
        step: 0.25,
        default: 2,
        initial: (ctx) => Math.max(0.1, Math.min(2, (ctx.edge?.max_radius_hint || 4) * 0.5)),
        bounds: (ctx) => ({ max: ctx.edge?.max_radius_hint ?? undefined }),
        quickPresets: [1, 2, 3, 5, 8],
        advanced: false,
      },
    ],
    toRequest: (values) => ({
      ...values,
      radius: Number(values.radius ?? 2),
    }),
  },

  chamfer: {
    id: 'chamfer',
    label: 'Edge Chamfer',
    icon: Scissors,
    shortcut: 'C',
    appliesTo: CAPABILITY_MATRIX.chamfer,
    requiresSelection: true,
    previewable: true,
    fields: [
      {
        key: 'mode',
        label: 'Chamfer Type',
        type: 'segment',
        options: [
          { value: 'equal', label: 'Equal (d)' },
          { value: 'two_distances', label: 'Two Dist (d1, d2)' },
          { value: 'distance_angle', label: 'Dist × Angle' },
        ],
        default: 'equal',
        advanced: false,
      },
      {
        key: 'distance',
        label: 'Distance (d1)',
        type: 'number',
        unit: 'mm',
        min: 0.1,
        step: 0.25,
        default: 1,
        initial: (ctx) => Math.max(0.1, Math.min(1, (ctx.edge?.max_radius_hint || 2) * 0.5)),
        bounds: (ctx) => ({ max: ctx.edge?.max_radius_hint ?? undefined }),
        quickPresets: [0.5, 1, 1.5, 2, 3],
        advanced: false,
      },
      {
        key: 'distance2',
        label: 'Distance 2 (d2)',
        type: 'number',
        unit: 'mm',
        min: 0.1,
        step: 0.25,
        default: 1.5,
        advanced: false,
        visibleWhen: (v) => v.mode === 'two_distances',
      },
      {
        key: 'angle',
        label: 'Angle',
        type: 'number',
        unit: '°',
        min: 15,
        max: 75,
        step: 5,
        default: 45,
        advanced: false,
        visibleWhen: (v) => v.mode === 'distance_angle',
      },
    ],
    toRequest: (values) => ({
      distance: Number(values.distance ?? 1),
      distance2: values.mode === 'two_distances' ? Number(values.distance2 ?? values.distance ?? 1) : undefined,
      angle: values.mode === 'distance_angle' ? Number(values.angle ?? 45) : undefined,
      ...values,
    }),
  },

  edit_feature: {
    id: 'edit_feature',
    label: 'Edit Dimensions',
    icon: Pencil,
    shortcut: 'X',
    appliesTo: CAPABILITY_MATRIX.edit_feature,
    requiresSelection: true,
    previewable: true,
    fields: [
      {
        key: 'kind',
        label: 'Feature Type',
        type: 'segment',
        options: [
          { value: 'auto', label: 'Auto' },
          { value: 'cylinder', label: 'Cylinder' },
          { value: 'rect', label: 'Rect / Box' },
          { value: 'slot', label: 'Slot' },
        ],
        default: 'auto',
        initial: (ctx) => {
          if (ctx.cylindrical) return 'cylinder';
          if (ctx.planar?.rect_length || ctx.planar?.feature_kind === 'rect') return 'rect';
          return 'rect';
        },
        advanced: false,
      },
      // Cylindrical dimensions
      {
        key: 'diameter',
        label: 'Diameter (⌀)',
        type: 'number',
        unit: 'mm',
        min: 0.1,
        step: 0.5,
        default: 10,
        initial: (ctx) => ctx.cylindrical?.diameter ?? 10,
        advanced: false,
        visibleWhen: (v, e) => (v.kind === 'cylinder' || (v.kind === 'auto' && e?.surface_type === 'cylinder')),
      },
      {
        key: 'depth',
        label: 'Depth / Height',
        type: 'number',
        unit: 'mm',
        min: 0.1,
        step: 0.5,
        default: 10,
        initial: (ctx) => ctx.cylindrical?.length ?? ctx.planar?.material_depth ?? 10,
        advanced: false,
        visibleWhen: (v, e) => (v.kind === 'cylinder' || (v.kind === 'auto' && e?.surface_type === 'cylinder')),
      },
      // Planar / Box dimensions
      {
        key: 'length',
        label: 'Length',
        type: 'number',
        unit: 'mm',
        min: 0.1,
        step: 1,
        default: 20,
        initial: (ctx) => ctx.planar?.rect_length ?? ctx.planar?.extents_u ?? 20,
        advanced: false,
        visibleWhen: (v, e) => (v.kind === 'rect' || v.kind === 'slot' || (v.kind === 'auto' && e?.surface_type !== 'cylinder')),
      },
      {
        key: 'width',
        label: 'Width',
        type: 'number',
        unit: 'mm',
        min: 0.1,
        step: 1,
        default: 20,
        initial: (ctx) => ctx.planar?.rect_width ?? ctx.planar?.extents_v ?? 20,
        advanced: false,
        visibleWhen: (v, e) => (v.kind === 'rect' || v.kind === 'slot' || (v.kind === 'auto' && e?.surface_type !== 'cylinder')),
      },
      {
        key: 'height',
        label: 'Height / Depth',
        type: 'number',
        unit: 'mm',
        min: 0.1,
        step: 1,
        default: 10,
        initial: (ctx) => ctx.planar?.material_depth ?? 10,
        advanced: false,
        visibleWhen: (v, e) => (v.kind === 'rect' || v.kind === 'slot' || (v.kind === 'auto' && e?.surface_type !== 'cylinder')),
      },
      {
        key: 'area',
        label: 'Area',
        type: 'number',
        unit: 'mm²',
        min: 0.01,
        step: 5,
        default: 400,
        initial: (ctx) => {
          if (ctx.area) return ctx.area;
          const l = ctx.planar?.rect_length ?? ctx.planar?.extents_u ?? 20;
          const w = ctx.planar?.rect_width ?? ctx.planar?.extents_v ?? 20;
          return l * w;
        },
        advanced: false,
        visibleWhen: (v, e) => (v.kind === 'rect' || (v.kind === 'auto' && e?.surface_type !== 'cylinder')),
      },
      {
        key: 'lock_aspect_ratio',
        label: 'Lock aspect ratio',
        type: 'toggle',
        default: true,
        advanced: false,
        visibleWhen: (v, e) => (v.kind === 'rect' || (v.kind === 'auto' && e?.surface_type !== 'cylinder')),
      },
      {
        key: 'anchor',
        label: 'Anchor',
        type: 'segment',
        options: [
          { value: 'center', label: 'Center' },
          { value: 'corner', label: 'Corner' },
          { value: 'edge', label: 'Edge' },
        ],
        default: 'center',
        advanced: false,
        visibleWhen: (v, e) => (v.kind === 'rect' || (v.kind === 'auto' && e?.surface_type !== 'cylinder')),
      },
      {
        key: 'corner_radius',
        label: 'Corner R',
        type: 'number',
        unit: 'mm',
        min: 0,
        step: 0.5,
        default: 0,
        initial: (ctx) => ctx.planar?.corner_radius ?? 0,
        advanced: true,
        visibleWhen: (v, e) => (v.kind === 'rect' || (v.kind === 'auto' && e?.surface_type !== 'cylinder')),
      },
    ],
    toRequest: (values, selection) => {
      const isCyl = selection?.surface_type === 'cylinder' || values.kind === 'cylinder' || values.kind === 'hole' || values.kind === 'boss';
      if (isCyl) {
        return {
          feature_type: 'cylinder',
          kind: values.cyl_kind || (selection as any)?.kind || 'hole',
          diameter: Number(values.diameter ?? 10),
          depth: Number(values.depth ?? 10),
        };
      }
      return {
        feature_type: 'planar',
        kind: values.kind || 'rect',
        length: Number(values.length ?? 20),
        width: Number(values.width ?? 20),
        height: Number(values.height ?? 10),
        area: Number(values.area ?? (Number(values.length ?? 20) * Number(values.width ?? 20))),
        anchor: values.anchor || 'center',
        corner_radius: Number(values.corner_radius ?? 0),
        lock_aspect_ratio: values.lock_aspect_ratio !== false,
      };
    },
  },


  measure: {
    id: 'measure',
    label: 'Measure',
    icon: Ruler,
    shortcut: 'M',
    appliesTo: CAPABILITY_MATRIX.measure,
    requiresSelection: true,
    previewable: false,
    fields: [],
    toRequest: (values) => ({ ...values }),
  },

  push_pull: {
    id: 'push_pull',
    label: 'Push / Pull Face',
    icon: Expand,
    shortcut: 'P',
    appliesTo: CAPABILITY_MATRIX.push_pull,
    requiresSelection: true,
    previewable: true,
    fields: [
      num('distance', 'Distance', 5, { min: -500, max: 500, step: 1 }),
    ],
    toRequest: (values) => ({ ...values }),
  },

  round_face_edges: {
    id: 'round_face_edges',
    label: 'Round Face Edges',
    icon: CornerDownRight,
    shortcut: '',
    appliesTo: CAPABILITY_MATRIX.round_face_edges,
    requiresSelection: true,
    previewable: true,
    fields: [
      seg('mode', 'Mode', 'fillet', [
        { value: 'fillet', label: 'Fillet' },
        { value: 'chamfer', label: 'Chamfer' },
      ]),
      num('radius', 'Radius / Distance', 2, { min: 0.1, step: 0.5 }),
    ],
    toRequest: (values) => ({ ...values }),
  },

  delete_feature: {
    id: 'delete_feature',
    label: 'Delete Feature',
    icon: Trash2,
    shortcut: 'Del',
    appliesTo: CAPABILITY_MATRIX.delete_feature,
    requiresSelection: true,
    previewable: false,
    fields: [],
    toRequest: (values, selectedEntity) => ({
      face_ids: selectedEntity?.face_ids || (selectedEntity?.transient_id ? [selectedEntity.transient_id] : []),
      feature_id: selectedEntity?.feature_id,
      ...values,
    }),
  },

  move_feature: {
    id: 'move_feature',
    label: 'Move Feature',
    icon: Move3d,
    shortcut: '',
    appliesTo: CAPABILITY_MATRIX.move_feature,
    requiresSelection: true,
    previewable: true,
    fields: [
      num('du', 'ΔU', 0, { min: -200, max: 200, step: 1 }),
      num('dv', 'ΔV', 0, { min: -200, max: 200, step: 1 }),
    ],
    toRequest: (values) => ({ ...values }),
  },

  pattern_feature: {
    id: 'pattern_feature',
    label: 'Pattern Feature',
    icon: Grid3x3,
    shortcut: '',
    appliesTo: CAPABILITY_MATRIX.pattern_feature,
    requiresSelection: true,
    previewable: true,
    fields: [
      seg('pattern_type', 'Pattern Type', 'linear', [
        { value: 'linear', label: 'Linear' },
        { value: 'polar', label: 'Polar' },
      ]),
      num('count', 'Count', 3, { min: 2, max: 50, step: 1, unit: undefined }),
      num('spacing', 'Spacing / Angle', 15, { min: 0.1, max: 500, step: 1 }),
    ],
    toRequest: (values) => ({ ...values }),
  },

  ...(BODY_TOOLS as Record<
    'move' | 'rotate' | 'scale' | 'transform' | 'mirror' | 'align' | 'primitive' | 'shell' | 'offset' | 'split' | 'linear_pattern' | 'polar_pattern' | 'heal',
    OperationDefinition
  >),
};

/** Defaults for every field of a tool, so the request always matches what the form shows. */
export function getDefaultParams(tool: CADToolType): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of (OPERATION_REGISTRY[tool]?.fields ?? [])) {
    if (f.type !== 'position') out[f.key] = f.default;
  }
  return out;
}

export function getOperationDefinition(tool: CADToolType | 'edit_feature'): OperationDefinition {
  return OPERATION_REGISTRY[tool] || OPERATION_REGISTRY.select;
}
