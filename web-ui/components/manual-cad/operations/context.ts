import { useState, useEffect, useRef, useCallback } from 'react';
import { TopologyEntity } from './capabilities';

export interface FeatureOnFace {
  kind: string | null;
  diameter: number | null;
  depth: number | null;
  uv: number[] | null;
  face_id: string | null;
}

export interface PlanarFaceContext {
  origin: number[] | null;
  normal: number[] | null;
  u_axis: number[] | null;
  v_axis: number[] | null;
  extents_u: number | null;
  extents_v: number | null;
  is_rectangular: boolean | null;
  is_circular: boolean | null;
  circle_diameter: number | null;
  center_uv: number[] | null;
  max_diameter: number | null;
  material_depth: number | null;
  is_through_clear: boolean | null;
  existing_features: FeatureOnFace[];
}

export interface CylFaceContext {
  radius: number | null;
  diameter: number | null;
  length: number | null;
  axis_origin: number[] | null;
  axis_dir: number[] | null;
  kind: "hole" | "boss" | null;
  is_through: boolean | null;
  bottom_depth: number | null;
  parent_face_id: string | null;
  stacked: boolean | null;
}

export interface EdgeContext {
  length: number | null;
  radius: number | null;
  dihedral_deg: number | null;
  max_radius_hint: number | null;
  edge_type: "line" | "circle" | "other" | null;
  adjacent_face_ids: string[];
}

export interface BodyContext {
  extents: number[] | null;
  volume: number | null;
  solid_count: number | null;
  is_valid: boolean | null;
}

export interface GeometryContext {
  status: "ok" | "partial" | "unsupported" | "error";
  class: "face.planar" | "face.cylindrical" | "face.conical" | "face.other" | "edge.linear" | "edge.circular" | "edge.other" | "body";
  ref: string;
  revision: string;
  warnings: string[];
  message: string | null;
  area: number | null;
  planar: PlanarFaceContext | null;
  cylindrical: CylFaceContext | null;
  edge: EdgeContext | null;
  body: BodyContext | null;
}

export function useGeometryContext(
  sessionId: string,
  revision: string,
  selection: TopologyEntity | null | undefined,
  position?: { u?: number; v?: number }
) {
  const [ctx, setCtx] = useState<GeometryContext | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  const cacheRef = useRef<Record<string, GeometryContext>>({});
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (!selection || !sessionId || !revision) {
      setCtx(null);
      return;
    }

    const fetchContext = async () => {
      const u = position?.u;
      const v = position?.v;
      
      const key = `${revision}_${selection.id}_${u}_${v}`;
      if (cacheRef.current[key]) {
        setCtx(cacheRef.current[key]);
        setError(null);
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);
      try {
        let url = `/api/v1/cad/modify/context/${sessionId}?revision=${revision}&ref=${selection.id}`;
        if (u !== undefined && v !== undefined) {
          url += `&u=${u}&v=${v}`;
        }
        
        const res = await fetch(url);
        if (!res.ok) {
          throw new Error(`Failed to fetch context: ${res.statusText}`);
        }
        const data = await res.json() as GeometryContext;
        cacheRef.current[key] = data;
        setCtx(data);
      } catch (err: any) {
        setError(err);
      } finally {
        setLoading(false);
      }
    };

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(fetchContext, 250);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [sessionId, revision, selection, position?.u, position?.v, retryCount]);

  const retry = useCallback(() => {
    setRetryCount((c) => c + 1);
  }, []);

  return { ctx, loading, error, retry };
}
