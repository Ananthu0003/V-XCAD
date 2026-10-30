'use client';

import { useState, useCallback, useEffect } from 'react';
import { findFaceFromHit } from '../SubShapeRaycaster';
import type { DetectedFeature } from '../useDetectedFeatures';

export interface UseManualCadSelectionOptions {
  topology: any | null;
  activeRevision: string;
  detectedFeatures?: DetectedFeature[];
  onSelectCallback?: (entity: any) => void;
}

export function useManualCadSelection({
  topology,
  activeRevision,
  detectedFeatures = [],
  onSelectCallback,
}: UseManualCadSelectionOptions) {
  const [selectionMode, setSelectionMode] = useState<'body' | 'feature' | 'face' | 'edge'>('face');
  const [selectedEntity, setSelectedEntity] = useState<any | null>(null);
  const [selectedEntities, setSelectedEntities] = useState<any[]>([]);
  const [highlightedFaceIds, setHighlightedFaceIds] = useState<string[] | null>(null);
  const [hoveredEntity, setHoveredEntity] = useState<any | null>(null);

  // Reset selection and hover states whenever topology or activeRevision changes
  useEffect(() => {
    setSelectedEntity(null);
    setSelectedEntities([]);
    setHighlightedFaceIds(null);
    setHoveredEntity(null);
  }, [topology, activeRevision]);

  // Helper to build 3D Model / Sub-shape entity
  const createBodyEntity = useCallback((topo: any, rev: string) => {
    if (!topo) return null;
    return {
      entity_type: 'body',
      transient_id: `solid_${rev}`,
      name: '3D Solid Model',
      volume_mm3: topo.volume_mm3 ?? 0,
      bounding_box: topo.bounding_box ?? {},
      face_count: Object.keys(topo.faces || {}).length,
      edge_count: Object.keys(topo.edges || {}).length,
      is_valid: topo.is_valid ?? true,
      revision: rev,
      centroid: [
        ((topo.bounding_box?.min?.[0] ?? 0) + (topo.bounding_box?.max?.[0] ?? 0)) / 2,
        ((topo.bounding_box?.min?.[1] ?? 0) + (topo.bounding_box?.max?.[1] ?? 0)) / 2,
        ((topo.bounding_box?.min?.[2] ?? 0) + (topo.bounding_box?.max?.[2] ?? 0)) / 2,
      ],
    };
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedEntity(null);
    setSelectedEntities([]);
  }, []);

  const handleSetSelectionMode = useCallback(
    (mode: 'body' | 'feature' | 'face' | 'edge') => {
      setSelectionMode(mode);
      if (mode === 'body') {
        if (topology) {
          const b = createBodyEntity(topology, activeRevision);
          setSelectedEntity(b);
          setSelectedEntities([b]);
        }
      } else if (mode === 'feature') {
        if (selectedEntity?.entity_type !== 'feature') {
          clearSelection();
        }
      } else if (mode === 'face') {
        if (selectedEntity?.entity_type !== 'face') {
          clearSelection();
        }
      } else if (mode === 'edge') {
        if (selectedEntity?.entity_type !== 'edge') {
          clearSelection();
        }
      }
    },
    [topology, activeRevision, createBodyEntity, selectedEntity, clearSelection]
  );

  const handleSelectTopologyEntity = useCallback(
    (entity: any, multiSelect?: boolean) => {
      if (!entity) {
        clearSelection();
        onSelectCallback?.(null);
        return;
      }

      if (entity.entity_type === 'body') {
        const bodyEnt = topology ? createBodyEntity(topology, activeRevision) : entity;
        setSelectedEntity(bodyEnt);
        setSelectedEntities([bodyEnt]);
        setSelectionMode('body');
        onSelectCallback?.(bodyEnt);
        return;
      }

      if (multiSelect) {
        setSelectedEntities((prev) => {
          const exists = prev.some((item) => item.transient_id === entity.transient_id);
          if (exists) {
            const next = prev.filter((item) => item.transient_id !== entity.transient_id);
            const active = next.length > 0 ? next[next.length - 1] : null;
            setSelectedEntity(active);
            onSelectCallback?.(active);
            return next;
          } else {
            const next = [...prev, entity];
            setSelectedEntity(entity);
            onSelectCallback?.(entity);
            return next;
          }
        });
      } else {
        setSelectedEntity(entity);
        setSelectedEntities([entity]);
        onSelectCallback?.(entity);
      }

      if (entity.entity_type === 'feature') {
        setSelectionMode('feature');
      } else if (entity.entity_type === 'edge') {
        setSelectionMode('edge');
      } else if (entity.entity_type === 'face') {
        setSelectionMode('face');
      }
    },
    [topology, activeRevision, createBodyEntity, clearSelection, onSelectCallback]
  );

  const handleDirectMeshClick = useCallback(
    (point: [number, number, number], normal?: [number, number, number], activeTool?: string) => {
      if (!topology) return;

      if (selectionMode === 'body') {
        const bodyEnt = createBodyEntity(topology, activeRevision);
        setSelectedEntity(bodyEnt);
        setSelectedEntities([bodyEnt]);
        return;
      }

      // Edge mode direct click: find closest edge by sampled points (A15)
      if (selectionMode === 'edge') {
        if (topology.edges) {
          let closestEdge: any = null;
          let minDistanceSq = Infinity;
          Object.values(topology.edges).forEach((ed: any) => {
            if (Array.isArray(ed.points) && ed.points.length > 0) {
              for (const pt of ed.points) {
                const dx = pt[0] - point[0];
                const dy = pt[1] - point[1];
                const dz = pt[2] - point[2];
                const distSq = dx * dx + dy * dy + dz * dz;
                if (distSq < minDistanceSq) {
                  minDistanceSq = distSq;
                  closestEdge = ed;
                }
              }
            }
          });
          if (closestEdge && minDistanceSq < 400) {
            handleSelectTopologyEntity(closestEdge);
            return;
          }
        }
      }

      // In face or feature mode: find clicked face
      if (topology.faces) {
        const face = findFaceFromHit(point, normal, topology.faces);
        if (face) {
          const matchingFeat = detectedFeatures.find((df: any) =>
            df.face_ids?.includes(face.transient_id)
          );
          if (selectionMode === 'feature' && matchingFeat) {
            handleSelectTopologyEntity({ entity_type: 'feature', ...matchingFeat });
          } else if (matchingFeat && activeTool === 'edit_feature') {
            handleSelectTopologyEntity({ entity_type: 'feature', ...matchingFeat });
          } else {
            handleSelectTopologyEntity(face);
          }
        }
      }
    },
    [topology, selectionMode, activeRevision, createBodyEntity, detectedFeatures, handleSelectTopologyEntity]
  );

  const handleDirectMeshDoubleClick = useCallback(
    (point: [number, number, number], normal?: [number, number, number]) => {
      if (!topology) return;

      if (topology.faces) {
        const face = findFaceFromHit(point, normal, topology.faces);
        if (face && detectedFeatures && detectedFeatures.length > 0) {
          const feat = detectedFeatures.find((df: any) =>
            df.face_ids?.includes(face.transient_id)
          );
          if (feat) {
            handleSelectTopologyEntity({ entity_type: 'feature', ...feat });
            return;
          }
        }
      }

      const bodyEnt = createBodyEntity(topology, activeRevision);
      setSelectedEntity(bodyEnt);
      setSelectedEntities([bodyEnt]);
      setSelectionMode('body');
    },
    [topology, detectedFeatures, handleSelectTopologyEntity, createBodyEntity, activeRevision]
  );

  return {
    selectionMode,
    setSelectionMode,
    selectedEntity,
    setSelectedEntity,
    selectedEntities,
    setSelectedEntities,
    highlightedFaceIds,
    setHighlightedFaceIds,
    hoveredEntity,
    setHoveredEntity,
    createBodyEntity,
    clearSelection,
    handleSetSelectionMode,
    handleSelectTopologyEntity,
    handleDirectMeshClick,
    handleDirectMeshDoubleClick,
  };
}

