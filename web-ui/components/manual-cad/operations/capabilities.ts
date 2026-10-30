import type { CADToolType } from '../ManualCadToolbar';
import { GeometryContext } from './context';

export type EntityClassification =
  | 'body'
  | 'face.planar'
  | 'face.cylindrical'
  | 'face.conical'
  | 'face.other'
  | 'edge.linear'
  | 'edge.circular'
  | 'edge.other'
  | 'feature.hole'
  | 'feature.boss'
  | 'feature.pocket'
  | 'feature.slot'
  | 'feature.fillet'
  | 'feature.chamfer'
  | 'feature.other';

export interface TopologyEntity {
  entity_type?: 'body' | 'face' | 'edge' | 'vertex' | 'feature' | string;
  surface_type?: string;
  curve_type?: string;
  transient_id?: string;
  volume_mm3?: number;
  bounding_box?: {
    min?: number[];
    max?: number[];
  };
  face_count?: number;
  edge_count?: number;
  is_valid?: boolean;
  area?: number;
  length?: number;
  radius?: number;
  height?: number;
  width?: number;
  diameter?: number;
  normal?: number[];
  centroid?: number[];
  // Feature fields
  feature_id?: string;
  kind?: string;
  subtype?: string;
  params?: any[];
  face_ids?: string[];
  edge_ids?: string[];
  center?: number[];
  axis?: number[] | null;
  editable?: boolean;
  not_editable_reason?: string | null;
  [key: string]: unknown;
}

/**
 * Classifies an entity based on the backend GeometryContext or falls back to topology metadata.
 */
export function classifyEntity(
  entity: TopologyEntity | null | undefined,
  ctx?: GeometryContext | null
): EntityClassification | null {
  if (ctx?.class) {
    return ctx.class as EntityClassification;
  }

  if (!entity) return null;

  if (entity.entity_type === 'feature') {
    const k = (entity.kind || '').toLowerCase();
    if (k === 'hole') return 'feature.hole';
    if (k === 'boss') return 'feature.boss';
    if (k === 'pocket') return 'feature.pocket';
    if (k === 'slot') return 'feature.slot';
    if (k === 'fillet') return 'feature.fillet';
    if (k === 'chamfer') return 'feature.chamfer';
    return 'feature.other';
  }

  if (entity.entity_type === 'body') {
    return 'body';
  }

  if (entity.entity_type === 'face') {
    const st = (entity.surface_type || '').toLowerCase();
    if (st === 'plane') return 'face.planar';
    if (st === 'cylinder') return 'face.cylindrical';
    if (st === 'cone') return 'face.conical';
    return 'face.other';
  }

  if (entity.entity_type === 'edge') {
    const ct = (entity.curve_type || '').toLowerCase();
    if (ct === 'line' || ct === 'linear') return 'edge.linear';
    if (ct === 'circle' || ct === 'circular') return 'edge.circular';
    return 'edge.other';
  }

  return null;
}

export const CAPABILITY_MATRIX: Record<CADToolType | 'edit_feature', EntityClassification[]> = {
  select: [
    'body',
    'face.planar',
    'face.cylindrical',
    'face.conical',
    'face.other',
    'edge.linear',
    'edge.circular',
    'edge.other',
    'feature.hole',
    'feature.boss',
    'feature.pocket',
    'feature.slot',
    'feature.fillet',
    'feature.chamfer',
    'feature.other',
  ],
  hole: ['face.planar'],
  pocket: ['face.planar'],
  pad: ['face.planar'],
  fillet: ['edge.linear', 'edge.circular', 'edge.other'],
  chamfer: ['edge.linear', 'edge.circular', 'edge.other'],
  edit_feature: [
    'body',
    'face.planar',
    'face.cylindrical',
    'edge.circular',
    'feature.hole',
    'feature.boss',
    'feature.pocket',
    'feature.slot',
    'feature.fillet',
    'feature.chamfer',
    'feature.other',
  ],
  transform: [
    'body',
    'face.planar',
    'face.cylindrical',
    'edge.linear',
    'edge.circular',
    'edge.other',
    'feature.hole',
    'feature.boss',
    'feature.pocket',
    'feature.slot',
    'feature.fillet',
    'feature.chamfer',
    'feature.other',
  ],
  // Whole-body tools (no face/edge needed)
  move: ['body'],
  rotate: ['body'],
  scale: ['body'],
  offset: ['body', 'face.other'],
  heal: ['body'],
  linear_pattern: ['body'],
  polar_pattern: ['body'],
  // Whole-body tools that can optionally use a selected planar face as the plane / target
  mirror: ['body', 'face.planar'],
  split: ['body', 'face.planar'],
  align: ['body', 'face.planar'],
  shell: ['body', 'face.planar'],
  primitive: ['body', 'face.planar'],
  push_pull: ['face.planar'],
  round_face_edges: ['face.planar'],
  delete_feature: [
    'body',
    'face.planar',
    'face.cylindrical',
    'face.conical',
    'face.other',
    'feature.hole',
    'feature.boss',
    'feature.pocket',
    'feature.slot',
    'feature.fillet',
    'feature.chamfer',
    'feature.other',
  ],
  move_feature: [
    'face.cylindrical',
    'feature.hole',
    'feature.boss',
    'feature.pocket',
    'feature.slot',
  ],
  pattern_feature: [
    'face.cylindrical',
    'feature.hole',
    'feature.boss',
    'feature.pocket',
    'feature.slot',
  ],
  measure: [
    'body',
    'face.planar',
    'face.cylindrical',
    'face.conical',
    'face.other',
    'edge.linear',
    'edge.circular',
    'edge.other',
    'feature.hole',
    'feature.boss',
    'feature.pocket',
    'feature.slot',
    'feature.fillet',
    'feature.chamfer',
    'feature.other',
  ],
};

export const OPERATION_REQUIREMENTS: Record<CADToolType | 'edit_feature', string> = {
  select: 'Select',
  hole: 'Select a planar face',
  pocket: 'Select a planar face',
  pad: 'Select a planar face',
  fillet: 'Select an edge',
  chamfer: 'Select an edge',
  edit_feature: 'Select a face, feature, or the 3D model to edit dimensions',
  transform: 'Select the 3D model, face, or feature to transform',
  push_pull: 'Select a planar face',
  round_face_edges: 'Select a planar face',
  delete_feature: 'Select a face, subpart, or feature to delete',
  move_feature: 'Select a feature or cylindrical face',
  pattern_feature: 'Select a feature or cylindrical face',
  move: 'Select the 3D model',
  rotate: 'Select the 3D model',
  scale: 'Select the 3D model',
  offset: 'Select the 3D model',
  heal: 'Select the 3D model',
  linear_pattern: 'Select the 3D model',
  polar_pattern: 'Select the 3D model',
  mirror: 'Select the model, or a planar face as the mirror plane',
  split: 'Select the model, or a planar face as the cut plane',
  align: 'Select the model, or a planar face to lay face-down',
  shell: 'Select the model, or a planar face to leave open',
  primitive: 'Select the model, or a planar face to place on',
  measure: 'Select a face or edge',
};

export function isOperationApplicable(
  opId: CADToolType | 'edit_feature',
  entity: TopologyEntity | null | undefined,
  ctx?: GeometryContext | null
): boolean {
  if (opId === 'select') return true;
  const classification = classifyEntity(entity, ctx);
  if (!classification) return false;
  const allowed = CAPABILITY_MATRIX[opId];
  if (!allowed) return false;
  return allowed.includes(classification);
}

export function getApplicableOperations(
  entity: TopologyEntity | null | undefined,
  ctx?: GeometryContext | null
): (CADToolType | 'edit_feature')[] {
  const classification = classifyEntity(entity, ctx);
  if (!classification) return [];
  if (classification === 'face.planar') {
    return ['hole', 'pocket', 'pad', 'edit_feature', 'push_pull', 'round_face_edges', 'shell', 'split', 'mirror', 'align', 'primitive', 'delete_feature', 'measure'];
  }
  if (classification === 'face.cylindrical') {
    return ['edit_feature', 'delete_feature', 'measure'];
  }
  if (classification === 'face.conical') {
    return ['edit_feature', 'delete_feature', 'measure'];
  }
  if (classification.startsWith('edge.')) {
    return ['fillet', 'chamfer', 'measure'];
  }
  if (classification.startsWith('feature.')) {
    return ['edit_feature', 'delete_feature', 'move_feature', 'pattern_feature', 'measure'];
  }
  if (classification.startsWith('face.')) {
    return ['offset', 'delete_feature', 'measure'];
  }
  if (classification === 'body') {
    return [
      'move', 'rotate', 'scale', 'transform', 'edit_feature', 'mirror', 'align', 'primitive',
      'shell', 'offset', 'split', 'linear_pattern', 'polar_pattern', 'heal', 'delete_feature', 'measure',
    ];
  }
  return [];
}

export interface SelectionHelper {
  id: string;
  label: string;
  description?: string;
}

export function getSelectionHelpers(
  entity: TopologyEntity | null | undefined,
  ctx?: GeometryContext | null
): SelectionHelper[] {
  const classification = classifyEntity(entity, ctx);
  if (!classification) return [];

  if (classification === 'face.planar') {
    return [
      { id: 'adjacent', label: 'Adjacent faces' },
      { id: 'coplanar', label: 'Coplanar faces' },
      { id: 'same_area', label: 'Faces of same area' },
    ];
  }
  if (classification === 'face.cylindrical') {
    return [
      { id: 'same_diameter', label: 'Same-diameter features' },
      { id: 'coaxial', label: 'Coaxial faces' },
    ];
  }
  if (classification === 'face.conical') {
    return [
      { id: 'coaxial', label: 'Coaxial faces' },
    ];
  }
  if (classification.startsWith('face.')) {
    return [
      { id: 'adjacent', label: 'Adjacent faces' },
    ];
  }
  if (classification === 'edge.linear') {
    return [
      { id: 'tangent_chain', label: 'Tangent chain' },
      { id: 'edge_loop', label: 'Edge loop of face' },
      { id: 'parallel', label: 'Parallel edges' },
    ];
  }
  if (classification === 'edge.circular') {
    return [
      { id: 'edge_loop', label: 'Edge loop' },
      { id: 'same_radius', label: 'Same-radius edges' },
    ];
  }
  if (classification.startsWith('feature.')) {
    return [
      { id: 'same_kind', label: 'Same kind' },
      { id: 'same_size', label: 'Same size' },
    ];
  }
  return [];
}

/**
 * Human-readable label for the entity type
 */
export function humanEntityLabel(entity: TopologyEntity | null | undefined): string {
  const classification = classifyEntity(entity);
  if (!classification) return 'Nothing selected';

  switch (classification) {
    case 'body':
      return '3D Solid Model (Sub-shape)';
    case 'face.planar':
      return 'Planar face';
    case 'face.cylindrical':
      return 'Cylindrical face';
    case 'face.conical':
      return 'Conical face';
    case 'face.other': {
      const st = entity?.surface_type;
      return st ? `${st.charAt(0).toUpperCase() + st.slice(1)} face` : 'Face';
    }
    case 'edge.linear':
      return 'Linear edge';
    case 'edge.circular':
      return 'Circular edge';
    case 'edge.other': {
      const ct = entity?.curve_type;
      return ct ? `${ct.charAt(0).toUpperCase() + ct.slice(1)} edge` : 'Edge';
    }
    case 'feature.hole':
      return (entity?.name as string) || 'Hole feature';
    case 'feature.boss':
      return (entity?.name as string) || 'Boss feature';
    case 'feature.pocket':
      return (entity?.name as string) || 'Pocket feature';
    case 'feature.slot':
      return (entity?.name as string) || 'Slot feature';
    case 'feature.fillet':
      return (entity?.name as string) || 'Fillet blend';
    case 'feature.chamfer':
      return (entity?.name as string) || 'Chamfer bevel';
    default:
      return 'Entity';
  }
}

export interface ReadoutProp {
  label: string;
  value: string;
}

function computeNormalString(n: number[] | undefined | null): string | null {
  if (!n || n.length < 3) return null;
  const labels = ['+X', '-X', '+Y', '-Y', '+Z', '-Z'];
  const axes = [
    [1, 0, 0],
    [-1, 0, 0],
    [0, 1, 0],
    [0, -1, 0],
    [0, 0, 1],
    [0, 0, -1],
  ];
  let best = 0;
  let bestDot = -2;
  axes.forEach(([ax, ay, az], i) => {
    const dot = ax * n[0] + ay * n[1] + az * n[2];
    if (dot > bestDot) {
      bestDot = dot;
      best = i;
    }
  });
  return bestDot > 0.9 ? labels[best] : `[${n.map((v) => v.toFixed(2)).join(', ')}]`;
}

/**
 * Returns adapted selection readout properties based on the entity class.
 * Never shows fields that do not exist for that geometry.
 */
export function getSelectionReadout(entity: TopologyEntity | null | undefined): ReadoutProp[] {
  const classification = classifyEntity(entity);
  if (!classification || !entity) return [];

  const props: ReadoutProp[] = [];

  if (classification.startsWith('feature.')) {
    if (entity.kind) {
      props.push({ label: 'Kind', value: String(entity.kind).charAt(0).toUpperCase() + String(entity.kind).slice(1) });
    }
    if (entity.subtype) {
      props.push({ label: 'Subtype', value: String(entity.subtype) });
    }
    if (Array.isArray(entity.params)) {
      for (const p of entity.params) {
        props.push({ label: p.label || p.key, value: `${p.value}${p.unit ? ` ${p.unit}` : ''}` });
      }
    }
    return props;
  }

  switch (classification) {
    case 'body': {
      if (entity.volume_mm3 != null) {
        props.push({ label: 'Volume', value: `${entity.volume_mm3.toFixed(1)} mm³` });
      }
      const bbox = entity.bounding_box;
      if (bbox?.min && bbox?.max) {
        const dx = Math.abs(bbox.max[0] - bbox.min[0]);
        const dy = Math.abs(bbox.max[1] - bbox.min[1]);
        const dz = Math.abs(bbox.max[2] - bbox.min[2]);
        props.push({
          label: 'Bounding Box',
          value: `${dx.toFixed(1)} × ${dy.toFixed(1)} × ${dz.toFixed(1)} mm`,
        });
      }
      props.push({
        label: 'Topology',
        value: `${entity.face_count || 0} faces · ${entity.edge_count || 0} edges`,
      });
      props.push({
        label: 'Status',
        value: entity.is_valid ? 'Valid B-Rep Solid' : 'Check Geometry',
      });
      break;
    }

    case 'face.planar': {
      if (entity.area != null) {
        props.push({ label: 'Area', value: `${entity.area.toFixed(1)} mm²` });
      }
      const norm = computeNormalString(entity.normal);
      if (norm) {
        props.push({ label: 'Normal', value: norm });
      }

      // Check if bounding box exists
      const bbox = entity.bounding_box;
      const dx = bbox?.min && bbox?.max ? Math.abs(bbox.max[0] - bbox.min[0]) : null;
      const dy = bbox?.min && bbox?.max ? Math.abs(bbox.max[1] - bbox.min[1]) : null;
      const dz = bbox?.min && bbox?.max ? Math.abs(bbox.max[2] - bbox.min[2]) : null;
      const nonZeroDims = [dx, dy, dz].filter((d): d is number => d != null && d > 0.05).sort((a, b) => b - a);

      // Only show diameter if face is genuinely circular (e.g. circle wire or explicit circular flag)
      // When width and height or bounding box are available for square/rectangle/polygon, show Width x Length
      const isExplicitCircular = entity.is_circular === true || (entity.radius != null && entity.radius > 0 && entity.is_circular !== false && (!nonZeroDims.length || Math.abs((entity.radius * 2) - nonZeroDims[0]) < 0.2 && Math.abs(nonZeroDims[0] - nonZeroDims[1]) < 0.2));

      if (isExplicitCircular && entity.radius != null && entity.radius > 0) {
        props.push({
          label: 'Diameter',
          value: `⌀${(entity.radius * 2).toFixed(1)} mm`,
        });
        props.push({
          label: 'Circumference',
          value: `${(2 * Math.PI * entity.radius).toFixed(1)} mm`,
        });
      } else {
        // Square, rectangular or planar boundary face: show Length, Width or Size
        if (entity.width != null && entity.height != null) {
          props.push({ label: 'Size', value: `${entity.width.toFixed(1)} × ${entity.height.toFixed(1)} mm` });
        } else if (nonZeroDims.length >= 2) {
          props.push({ label: 'Length', value: `${nonZeroDims[0].toFixed(1)} mm` });
          props.push({ label: 'Width', value: `${nonZeroDims[1].toFixed(1)} mm` });
          if (nonZeroDims.length >= 3 && nonZeroDims[2] > 0.1) {
            props.push({ label: 'Height', value: `${nonZeroDims[2].toFixed(1)} mm` });
          }
        } else if (nonZeroDims.length === 1) {
          props.push({ label: 'Span', value: `${nonZeroDims[0].toFixed(1)} mm` });
        } else if (entity.radius != null && entity.radius > 0) {
          props.push({
            label: 'Span',
            value: `${(entity.radius * 2).toFixed(1)} mm`,
          });
        }
      }
      break;
    }

    case 'face.cylindrical': {
      // Cylindrical face shows Diameter and Length
      const radius = entity.radius;
      if (radius != null) {
        props.push({
          label: 'Diameter',
          value: `⌀${(radius * 2).toFixed(2)} mm`,
        });
        props.push({
          label: 'Circumference',
          value: `${(2 * Math.PI * radius).toFixed(2)} mm`,
        });
      }
      // Length of cylinder
      if (entity.length != null) {
        props.push({ label: 'Length', value: `${entity.length.toFixed(1)} mm` });
      } else if (entity.height != null) {
        props.push({ label: 'Length', value: `${entity.height.toFixed(1)} mm` });
      } else if (entity.bounding_box?.min && entity.bounding_box?.max) {
        const bbox = entity.bounding_box;
        const dx = Math.abs(bbox.max![0] - bbox.min![0]);
        const dy = Math.abs(bbox.max![1] - bbox.min![1]);
        const dz = Math.abs(bbox.max![2] - bbox.min![2]);
        // The largest bbox dimension is the length of cylinder
        const len = Math.max(dx, dy, dz);
        if (len > 0.05) {
          props.push({ label: 'Length', value: `${len.toFixed(1)} mm` });
        }
      }
      if (entity.area != null) {
        props.push({ label: 'Area', value: `${entity.area.toFixed(1)} mm²` });
      }
      break;
    }

    case 'face.conical': {
      if (entity.radius != null) {
        props.push({ label: 'Radius', value: `R${entity.radius.toFixed(2)} mm` });
      }
      if (entity.area != null) {
        props.push({ label: 'Area', value: `${entity.area.toFixed(1)} mm²` });
      }
      break;
    }

    case 'face.other': {
      if (entity.area != null) {
        props.push({ label: 'Area', value: `${entity.area.toFixed(1)} mm²` });
      }
      props.push({ label: 'Type', value: entity.surface_type || 'Custom' });
      break;
    }

    case 'edge.linear': {
      // Linear edge: Length only, never Radius
      if (entity.length != null) {
        props.push({ label: 'Length', value: `${entity.length.toFixed(1)} mm` });
      }
      props.push({ label: 'Type', value: 'Linear' });
      break;
    }

    case 'edge.circular': {
      // Circular edge: Radius and Length
      if (entity.radius != null) {
        props.push({ label: 'Radius', value: `R${entity.radius.toFixed(2)} mm` });
      }
      if (entity.length != null) {
        props.push({ label: 'Length', value: `${entity.length.toFixed(1)} mm` });
      }
      props.push({ label: 'Type', value: 'Circular' });
      break;
    }

    case 'edge.other': {
      if (entity.length != null) {
        props.push({ label: 'Length', value: `${entity.length.toFixed(1)} mm` });
      }
      if (entity.radius != null) {
        props.push({ label: 'Radius', value: `R${entity.radius.toFixed(2)} mm` });
      }
      props.push({
        label: 'Type',
        value: entity.curve_type
          ? entity.curve_type.charAt(0).toUpperCase() + entity.curve_type.slice(1)
          : 'Curved',
      });
      break;
    }
  }

  return props;
}
