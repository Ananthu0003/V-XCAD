import { Expand } from 'lucide-react';
import { CAPABILITY_MATRIX } from '../../operations/capabilities';
import { num, type OperationDefinition } from '../types';

export const pushPullDefinition: OperationDefinition = {
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
};

