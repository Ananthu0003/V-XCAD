import { Layers } from 'lucide-react';
import { CAPABILITY_MATRIX } from '../../operations/capabilities';
import type { OperationDefinition } from '../types';

export const padDefinition: OperationDefinition = {
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
};

