'use client';

import { useState, useEffect, useCallback } from 'react';

export interface BaseSolidClassification {
  primitive_type: 'box' | 'cylinder' | 'sphere' | 'cone' | 'torus' | 'prism' | 'revolve' | 'freeform';
  confidence: number;
  dimensions: Record<string, number>;
  description: string;
}

export interface ExtractedFeature {
  feature_id: string;
  kind: 'hole' | 'boss' | 'pocket' | 'pad' | 'fillet' | 'chamfer' | 'slot';
  subtype: string;
  name: string;
  parameters: Record<string, any>;
  parent_face_id?: string | null;
  face_ids: string[];
  edge_ids: string[];
  confidence: number;
  editable: boolean;
  not_editable_reason?: string | null;
}

export interface MassProperties {
  volume_mm3: number;
  surface_area_mm2: number;
  center_of_mass: [number, number, number];
  bounding_box: { min?: [number, number, number]; max?: [number, number, number] };
  is_valid: boolean;
  face_count: number;
  edge_count: number;
  solid_count: number;
}

export interface ModelParametersResponse {
  session_id: string;
  revision: string;
  base_solid: BaseSolidClassification;
  features: ExtractedFeature[];
  mass_properties: MassProperties;
}

export function useModelParameters(sessionId: string | null, revision: string | null) {
  const [data, setData] = useState<ModelParametersResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchParameters = useCallback(async () => {
    if (!sessionId || sessionId === 'default_session') return;
    setIsLoading(true);
    setError(null);
    try {
      const revQuery = revision ? `?revision=${encodeURIComponent(revision)}` : '';
      const res = await fetch(`/api/cad/modify/parameters/${sessionId}${revQuery}`);
      if (!res.ok) {
        throw new Error(`Failed to load model parameters: ${res.statusText}`);
      }
      const json = await res.json();
      setData(json);
    } catch (err: any) {
      console.warn('Failed to fetch model parameters:', err);
      setError(err.message || 'Error fetching model parameters');
    } finally {
      setIsLoading(false);
    }
  }, [sessionId, revision]);

  useEffect(() => {
    fetchParameters();
  }, [fetchParameters]);

  return { data, isLoading, error, refetch: fetchParameters };
}
