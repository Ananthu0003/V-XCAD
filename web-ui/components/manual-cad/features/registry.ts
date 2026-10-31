import type { CADToolType } from '../ManualCadToolbar';
import type { OperationDefinition } from './types';
import { selectDefinition, measureDefinition } from './inspect';
import { holeDefinition, HOLE_PRESETS } from './hole';
import { pocketDefinition } from './pocket';
import { padDefinition } from './pad';
import { filletDefinition, chamferDefinition, roundFaceEdgesDefinition } from './dressup';
import { pushPullDefinition, deleteFeatureDefinition } from './direct-modeling';
import {
  transformDefinition,
  moveDefinition,
  rotateDefinition,
  scaleDefinition,
  mirrorDefinition,
  alignDefinition,
  moveFeatureDefinition,
} from './transforms';
import { linearPatternDefinition, polarPatternDefinition, patternFeatureDefinition } from './patterns';
import {
  primitiveDefinition,
  shellDefinition,
  offsetDefinition,
  splitDefinition,
  healDefinition,
} from './body-boolean';
import { editFeatureDefinition } from './parametric-edit';

export { HOLE_PRESETS };

export const OPERATION_REGISTRY: Record<CADToolType, OperationDefinition> = {
  select: selectDefinition,
  hole: holeDefinition,
  pocket: pocketDefinition,
  pad: padDefinition,
  fillet: filletDefinition,
  chamfer: chamferDefinition,
  edit_feature: editFeatureDefinition,
  measure: measureDefinition,
  push_pull: pushPullDefinition,
  round_face_edges: roundFaceEdgesDefinition,
  delete_feature: deleteFeatureDefinition,
  move_feature: moveFeatureDefinition,
  pattern_feature: patternFeatureDefinition,
  transform: transformDefinition,
  move: moveDefinition,
  rotate: rotateDefinition,
  scale: scaleDefinition,
  mirror: mirrorDefinition,
  align: alignDefinition,
  primitive: primitiveDefinition,
  shell: shellDefinition,
  offset: offsetDefinition,
  split: splitDefinition,
  linear_pattern: linearPatternDefinition,
  polar_pattern: polarPatternDefinition,
  heal: healDefinition,
};

/** Defaults for every field of a tool, so the request always matches what the form shows. */
export function getDefaultParams(tool: CADToolType): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of OPERATION_REGISTRY[tool]?.fields ?? []) {
    if (f.type !== 'position') out[f.key] = f.default;
  }
  return out;
}

export function getOperationDefinition(tool: CADToolType | 'edit_feature'): OperationDefinition {
  return OPERATION_REGISTRY[tool] || OPERATION_REGISTRY.select;
}

