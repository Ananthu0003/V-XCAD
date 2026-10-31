import { Grid3x3 } from 'lucide-react';
import { CAPABILITY_MATRIX } from '../../operations/capabilities';
import { num, seg, type OperationDefinition } from '../types';

export const patternFeatureDefinition: OperationDefinition = {
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
};

