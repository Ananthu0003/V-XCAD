import { CornerDownRight } from 'lucide-react';
import { CAPABILITY_MATRIX } from '../../operations/capabilities';
import { num, seg, type OperationDefinition } from '../types';

export const roundFaceEdgesDefinition: OperationDefinition = {
  id: 'round_face_edges',
  label: 'Round Face Edges',
  icon: CornerDownRight,
  shortcut: '',
  appliesTo: CAPABILITY_MATRIX.round_face_edges,
  requiresSelection: true,
  previewable: true,
  fields: [
    seg('mode', 'Mode', 'fillet', [
      { value: 'fillet', label: 'Fillet' },
      { value: 'chamfer', label: 'Chamfer' },
    ]),
    num('radius', 'Radius / Distance', 2, { min: 0.1, step: 0.5 }),
  ],
  toRequest: (values) => ({ ...values }),
};

