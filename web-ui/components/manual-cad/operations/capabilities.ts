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
  | 'edge.other';

export interface TopologyEntity {
  entity_type?: 'body' | 'face' | 'edge' | 'vertex' | string;
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
  ],
  hole: ['face.planar'],
  pocket: ['face.planar'],
  pad: ['face.planar'],
  fillet: ['edge.linear', 'edge.circular', 'edge.other'],
  chamfer: ['edge.linear', 'edge.circular', 'edge.other'],
  edit_feature: ['face.cylindrical'],
  measure: [
    'body',
    'face.planar',
    'face.cylindrical',
    'face.conical',
    'face.other',
    'edge.linear',
    'edge.circular',
    'edge.other',
  ],
};

export const OPERATION_REQUIREMENTS: Record<CADToolType | 'edit_feature', string> = {
  select: 'Select',
  hole: 'Select a planar face',
  pocket: 'Select a planar face',
  pad: 'Select a planar face',
  fillet: 'Select an edge',
  chamfer: 'Select an edge',
  edit_feature: 'Select a cylindrical face',
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
    return ['hole', 'pocket', 'pad', 'measure'];
  }
  if (classification === 'face.cylindrical') {
    return ['edit_feature', 'measure'];
  }
  if (classification.startsWith('edge.')) {
    return ['fillet', 'chamfer', 'measure'];
  }
  if (classification.startsWith('face.')) {
    return ['measure'];
  }
  if (classification === 'body') {
    return ['measure'];
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

      // If circular planar face (has radius)
      if (entity.radius != null && entity.radius > 0) {
        props.push({
          label: 'Diameter',
          value: `⌀${(entity.radius * 2).toFixed(1)} mm`,
        });
      } else {
        // Rectangular or general planar face: show Width x Height
        if (entity.width != null && entity.height != null) {
          props.push({
            label: 'Size',
            value: `${entity.width.toFixed(1)} × ${entity.height.toFixed(1)} mm`,
          });
        } else if (entity.bounding_box?.min && entity.bounding_box?.max) {
          const bbox = entity.bounding_box;
          const dx = Math.abs(bbox.max![0] - bbox.min![0]);
          const dy = Math.abs(bbox.max![1] - bbox.min![1]);
          const dz = Math.abs(bbox.max![2] - bbox.min![2]);
          // In a plane, take the two non-zero / dominant dimensions
          const dims = [dx, dy, dz].filter((d) => d > 0.05).sort((a, b) => b - a);
          if (dims.length >= 2) {
            props.push({
              label: 'Width × Height',
              value: `${dims[0].toFixed(1)} × ${dims[1].toFixed(1)} mm`,
            });
          } else if (dims.length === 1) {
            props.push({ label: 'Span', value: `${dims[0].toFixed(1)} mm` });
          }
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
