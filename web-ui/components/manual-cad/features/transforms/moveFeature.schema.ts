import { Move3d } from 'lucide-react';
import { CAPABILITY_MATRIX } from '../../operations/capabilities';
import { num, type OperationDefinition } from '../types';

export const moveFeatureDefinition: OperationDefinition = {
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
};

