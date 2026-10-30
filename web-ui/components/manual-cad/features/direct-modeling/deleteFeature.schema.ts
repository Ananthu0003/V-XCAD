import { Trash2 } from 'lucide-react';
import { CAPABILITY_MATRIX } from '../../operations/capabilities';
import type { OperationDefinition } from '../types';

export const deleteFeatureDefinition: OperationDefinition = {
  id: 'delete_feature',
  label: 'Delete Face / Subpart',
  icon: Trash2,
  shortcut: 'Del',
  appliesTo: CAPABILITY_MATRIX.delete_feature,
  requiresSelection: true,
  previewable: false,
  fields: [],
  toRequest: (values, selectedEntity) => ({
    face_ids: selectedEntity?.face_ids || (selectedEntity?.transient_id ? [selectedEntity.transient_id] : []),
    feature_id: selectedEntity?.feature_id,
    ...values,
  }),
};

