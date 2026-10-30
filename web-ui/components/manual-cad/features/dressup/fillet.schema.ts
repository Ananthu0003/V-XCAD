import { CornerDownRight } from 'lucide-react';
import { CAPABILITY_MATRIX } from '../../operations/capabilities';
import type { OperationDefinition } from '../types';

export const filletDefinition: OperationDefinition = {
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
};

