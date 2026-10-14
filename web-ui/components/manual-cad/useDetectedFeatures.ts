'use client';

import { useState, useEffect, useCallback } from 'react';

export interface FeatureParam {
  key: string;
  label: string;
  unit?: string | null;
  value: number | string | boolean;
  type: 'number' | 'select' | 'toggle';
  min?: number | null;
  max?: number | null;
  step?: number | null;
  options?: string[] | null;
}

export interface DetectedFeature {
  feature_id: string;
  kind: 'hole' | 'boss' | 'pocket' | 'slot' | 'fillet' | 'chamfer';
  subtype: string;
  name: string;
  face_ids: string[];
  edge_ids: string[];
  center: number[];
  axis?: number[] | null;
  bounding_box: { min?: number[]; max?: number[] };
  params: FeatureParam[];
  editable: boolean;
  not_editable_reason?: string | null;
  confidence: number;
}

export function useDetectedFeatures(sessionId: string | null, revision: string | null) {
  const [features, setFeatures] = useState<DetectedFeature[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchFeatures = useCallback(async () => {
    if (!sessionId) return;
    setIsLoading(true);
    setError(null);
    try {
      const revQuery = revision ? `?revision_id=${encodeURIComponent(revision)}` : '';
      const res = await fetch(`/api/cad/modify/features/${sessionId}${revQuery}`);
      if (!res.ok) {
        throw new Error(`Failed to fetch features: ${res.statusText}`);
      }
      const data = await res.json();
      setFeatures(Array.isArray(data) ? data : []);
    } catch (err: any) {
      console.warn('Failed to detect CAD features:', err);
      setError(err.message || 'Error detecting features');
    } finally {
      setIsLoading(false);
    }
  }, [sessionId, revision]);

  useEffect(() => {
    fetchFeatures();
  }, [fetchFeatures]);

  return { features, isLoading, error, refetch: fetchFeatures };
}
