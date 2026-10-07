import React from 'react';
import {
  CircleDot,
  Square,
  Layers,
  CornerDownRight,
  Scissors,
  Ruler,
  MousePointer2,
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
      // Advanced: Counterbore Diameter
      {
        key: 'cbore_diameter',
        label: 'C-Bore ⌀',
        type: 'number',
        unit: 'mm',
        min: 0.1,
        step: 0.5,
        default: 11,
        advanced: true,
        visibleWhen: (v) => v.hole_type === 'counterbore',
      },
      // Advanced: Counterbore Depth
      {
        key: 'cbore_depth',
        label: 'C-Bore Depth',
        type: 'number',
        unit: 'mm',
        min: 0.1,
        step: 0.5,
        default: 4,
        advanced: true,
        visibleWhen: (v) => v.hole_type === 'counterbore',
      },
      // Advanced: Countersink Diameter
      {
        key: 'csink_diameter',
        label: 'C-Sink ⌀',
        type: 'number',
        unit: 'mm',
        min: 0.1,
        step: 0.5,
        default: 11,
        advanced: true,
        visibleWhen: (v) => v.hole_type === 'countersink',
      },
      // Advanced: Countersink Angle
      {
        key: 'csink_angle',
        label: 'Angle',
        type: 'number',
        unit: '°',
        min: 30,
        step: 1,
        default: 90,
        advanced: true,
        visibleWhen: (v) => v.hole_type === 'countersink',
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
    ],
    toRequest: (values) => ({ ...values }),
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
    toRequest: (values) => ({ ...values }),
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
    toRequest: (values) => ({ ...values }),
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
    toRequest: (values) => ({ ...values }),
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
        key: 'distance',
        label: 'Distance',
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
    ],
    toRequest: (values) => ({ ...values }),
  },

  edit_feature: {
    id: 'edit_feature',
    label: 'Edit Feature',
    icon: CircleDot,
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
          { value: 'hole', label: 'Hole' },
          { value: 'boss', label: 'Boss' }
        ],
        default: 'hole',
        initial: (ctx) => ctx.cylindrical?.kind || 'hole',
        advanced: false,
        // Make it readonly or hidden? It's just displaying what we are editing.
      },
      {
        key: 'diameter',
        label: 'Diameter (⌀)',
        type: 'number',
        unit: 'mm',
        min: 0.1,
        step: 0.1,
        default: 10,
        initial: (ctx) => ctx.cylindrical?.diameter || 10,
        advanced: false,
      },
      {
        key: 'depth',
        label: 'Depth/Height',
        type: 'number',
        unit: 'mm',
        min: 0.1,
        step: 0.5,
        default: 10,
        initial: (ctx) => ctx.cylindrical?.length || 10,
        advanced: false,
        visibleWhen: (v, entity) => {
           // We'll hide this if it's a through-hole (which we can check if we had access to ctx in visibleWhen)
           // But since visibleWhen doesn't have ctx directly, we'll keep it visible unless we add ctx to visibleWhen.
           return true;
        }
      },
    ],
    toRequest: (values) => ({ ...values }),
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
};

export function getOperationDefinition(tool: CADToolType | 'edit_feature'): OperationDefinition {
  return OPERATION_REGISTRY[tool] || OPERATION_REGISTRY.select;
}
