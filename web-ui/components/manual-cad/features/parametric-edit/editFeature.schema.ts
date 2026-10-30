import { Pencil } from 'lucide-react';
import { CAPABILITY_MATRIX } from '../../operations/capabilities';
import type { OperationDefinition } from '../types';

export const editFeatureDefinition: OperationDefinition = {
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
};

