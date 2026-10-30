import { CircleDot } from 'lucide-react';
import { CAPABILITY_MATRIX } from '../../operations/capabilities';
import type { OperationDefinition } from '../types';
import { HOLE_PRESETS } from './presets';

export const holeDefinition: OperationDefinition = {
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
};

