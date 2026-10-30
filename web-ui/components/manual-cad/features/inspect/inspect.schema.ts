import { MousePointer2, Ruler } from 'lucide-react';
import { CAPABILITY_MATRIX } from '../../operations/capabilities';
import type { OperationDefinition } from '../types';

export const selectDefinition: OperationDefinition = {
  id: 'select',
  label: 'Select',
  icon: MousePointer2,
  shortcut: 'V',
  appliesTo: CAPABILITY_MATRIX.select,
  requiresSelection: false,
  previewable: false,
  fields: [],
  toRequest: (values) => ({ ...values }),
};

export const measureDefinition: OperationDefinition = {
  id: 'measure',
  label: 'Measure',
  icon: Ruler,
  shortcut: 'M',
  appliesTo: CAPABILITY_MATRIX.measure,
  requiresSelection: true,
  previewable: false,
  fields: [],
  toRequest: (values) => ({ ...values }),
};

