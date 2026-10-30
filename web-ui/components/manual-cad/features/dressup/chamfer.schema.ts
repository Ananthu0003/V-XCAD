import { Scissors } from 'lucide-react';
import { CAPABILITY_MATRIX } from '../../operations/capabilities';
import type { OperationDefinition } from '../types';

export const chamferDefinition: OperationDefinition = {
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
};

