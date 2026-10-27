'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { toast } from 'sonner';
import { ManualCadToolbar, CADToolType } from './ManualCadToolbar';
import { TopologyPropertiesPanel } from './TopologyPropertiesPanel';
import type { HistoryOperation } from './HistoryTimelineBar';
import { CadViewport } from '@/components/viewport/CadViewport';
import { SubShapeRaycaster, findFaceFromHit } from './SubShapeRaycaster';
import { StlMesh, StlGeometryInfo } from '@/components/viewport/StlMesh';
import { ContextMenu } from './operations/ContextMenu';
import { getDefaultParams, getOperationDefinition } from './operations/registry';
import { isOperationApplicable } from './operations/capabilities';
import { useGeometryContext } from './operations/context';
import { useModelParameters } from './useModelParameters';
import { parseApiError } from './shared';
import { SelectMoreMenu } from './SelectMoreMenu';
import { useDetectedFeatures, DetectedFeature } from './useDetectedFeatures';
import { StageSwitcher } from '@/components/workspace/StageSwitcher';
import {
  Loader2,
  Maximize2,
  Home,
  Undo2,
  Redo2,
  Box,
  Square,
  Slash,
  Sliders,
  Download,
  ChevronDown,
  Layers,
} from 'lucide-react';

/** Tools that act on the whole model; a selected planar face is optional input for some. */
const BODY_TOOLS = new Set<CADToolType>([
  'move', 'rotate', 'scale', 'mirror', 'align', 'primitive', 'shell', 'offset', 'split',
  'linear_pattern', 'polar_pattern', 'heal',
]);
const FACE_OPTIONAL_BODY_TOOLS = new Set<CADToolType>(['mirror', 'split', 'align', 'shell', 'primitive']);

interface ManualCadWorkspaceProps {
  sessionId: string;
  initialStlUrl?: string | null;
  initialStepUrl?: string | null;
  onProceedToCam?: () => void;
  onSwitchStage?: (stage: 'cad' | 'manual_cad' | 'cam') => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Status overlay (bottom-left of viewport)
// ─────────────────────────────────────────────────────────────────────────────
function ViewportStatus({
  selectedEntity,
  isLoading,
  hasModel = true,
}: {
  selectedEntity: any | null;
  isLoading: boolean;
  hasModel?: boolean;
}) {
  let text = 'Nothing selected: click a face or 3D model, or press V';

  if (!hasModel) {
    text = 'No CAD model loaded';
  } else if (isLoading) {
    text = 'Computing geometry…';
  } else if (selectedEntity) {
    const e = selectedEntity;
    const parts: string[] = [];
    parts.push(e.transient_id);
    if (e.entity_type === 'body') {
      parts.push('3D Solid Model');
      if (e.volume_mm3 != null) parts.push(`${e.volume_mm3.toFixed(1)} mm³`);
      const bbox = e.bounding_box;
      if (bbox?.min && bbox?.max) {
        parts.push(`${(bbox.max[0] - bbox.min[0]).toFixed(1)}×${(bbox.max[1] - bbox.min[1]).toFixed(1)}×${(bbox.max[2] - bbox.min[2]).toFixed(1)} mm`);
      }
    } else {
      if (e.surface_type) parts.push(e.surface_type);
      if (e.curve_type) parts.push(e.curve_type);
      if (e.area != null) parts.push(`${e.area.toFixed(1)} mm²`);
      if (e.length != null) parts.push(`${e.length.toFixed(1)} mm`);
      if (e.normal) {
        const n = e.normal as number[];
        const labels = ['+X','-X','+Y','-Y','+Z','-Z'];
        const axes = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
        let best = 0, bestDot = -2;
        axes.forEach(([ax,ay,az],i)=>{
          const dot = ax*n[0]+ay*n[1]+az*n[2];
          if(dot>bestDot){bestDot=dot;best=i;}
        });
        if(bestDot > 0.9) parts.push(`normal ${labels[best]}`);
      }
    }
    text = parts.join(' · ');
  }

  return (
    <div
      style={{
        position: 'absolute', bottom: 12, left: 12, zIndex: 15,
        fontSize: 11, fontFamily: 'var(--font-mono)',
        color: 'var(--mcad-text-muted)',
        pointerEvents: 'none', userSelect: 'none',
        maxWidth: 420, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      }}
    >
      {isLoading && (
        <Loader2 size={11} className="inline mr-1 animate-spin" style={{ color: 'var(--mcad-teal)', verticalAlign: 'middle' }} />
      )}
      {text}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Workspace
// ─────────────────────────────────────────────────────────────────────────────
export function ManualCadWorkspace({
  sessionId,
  initialStlUrl,
  initialStepUrl,
  onProceedToCam,
  onSwitchStage,
}: ManualCadWorkspaceProps) {
  const [activeRevision, setActiveRevision] = useState<string>('rev_000');
  const [activeTool, setActiveTool] = useState<CADToolType>('select');
  const [selectionMode, setSelectionMode] = useState<'body' | 'feature' | 'face' | 'edge'>('face');
  const [selectedEntity, setSelectedEntity] = useState<any | null>(null);
  const [selectedEntities, setSelectedEntities] = useState<any[]>([]);
  const [highlightedFaceIds, setHighlightedFaceIds] = useState<string[] | null>(null);
  const [params, setParams] = useState<Record<string, any>>({
    radius: 2.0, distance: 1.0, diameter: 6.0, depth: 10.0, width: 20.0, height: 15.0
  });
  const [paramsByTool, setParamsByTool] = useState<Record<string, Record<string, any>>>({});
  const [topology, setTopology] = useState<any | null>(null);
  const [history, setHistory] = useState<HistoryOperation[]>([]);
  const [previewResult, setPreviewResult] = useState<any | null>(null);
  const [isPreviewActive, setIsPreviewActive] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [stlUrl, setStlUrl] = useState<string | null>(initialStlUrl || null);
  const [geometryInfo, setGeometryInfo] = useState<StlGeometryInfo | null>(null);
  const [hoveredEntity, setHoveredEntity] = useState<any | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; entity: any } | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const exportRef = useRef<HTMLDivElement>(null);
  const previewAbortRef = useRef<AbortController | null>(null);

  // Hook for geometry context of current selection
  const { ctx: geometryContext } = useGeometryContext(sessionId, activeRevision, selectedEntity);

  // Hook for 3D sub-shape parameters (Part C)
  const {
    data: modelParams,
    isLoading: isLoadingModelParams,
    refetch: refetchModelParams,
  } = useModelParameters(sessionId, activeRevision);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (exportRef.current && !exportRef.current.contains(e.target as Node)) {
        setExportOpen(false);
      }
    };
    window.addEventListener('mousedown', handleClick);
    return () => window.removeEventListener('mousedown', handleClick);
  }, []);

  const handleDownloadStl = () => {
    if (stlUrl) {
      const a = document.createElement('a');
      a.href = stlUrl;
      a.download = `cad_${sessionId}.stl`;
      a.click();
    }
  };

  const handleDownloadStep = () => {
    const target = initialStepUrl || `/api/outputs/cad_${sessionId}.step`;
    const a = document.createElement('a');
    a.href = target;
    a.download = `cad_${sessionId}.step`;
    a.click();
  };

  // Sync stlUrl when initialStlUrl prop arrives or updates
  useEffect(() => {
    if (initialStlUrl && !isPreviewActive) {
      setStlUrl(initialStlUrl);
    }
  }, [initialStlUrl, isPreviewActive]);

  useEffect(() => {
    if (initialStlUrl) {
      setStlUrl(initialStlUrl);
    }
  }, [initialStlUrl]);

  const hasValidSession = Boolean(sessionId && sessionId !== 'default_session');
  const hasModel = Boolean(hasValidSession || initialStepUrl || initialStlUrl || stlUrl || topology);

  // Scoped workspace ref for keyboard shortcuts
  const workspaceRef = useRef<HTMLDivElement>(null);

  // Hook for B-Rep detected features (parameter extraction)
  const {
    features: detectedFeatures,
    isLoading: isLoadingFeatures,
    refetch: refetchFeatures,
  } = useDetectedFeatures(sessionId, activeRevision);

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

  // Compute initial params for a tool from defaults and geometryContext (A9 & A10)
  const computeToolParams = useCallback(
    (tool: CADToolType, ent: any, ctx: any, userEdits?: Record<string, any>) => {
      const def = getOperationDefinition(tool);
      const initial: Record<string, any> = {};
      if (def?.fields) {
        def.fields.forEach((f) => {
          let val = f.default;
          if (typeof f.initial === 'function' && ctx) {
            const initVal = f.initial(ctx, initial);
            if (initVal !== undefined && initVal !== null) {
              val = initVal;
            }
          }
          initial[f.key] = val;
        });
      }
      return { ...initial, ...(userEdits || {}) };
    },
    []
  );

  const handleUpdateParams: React.Dispatch<React.SetStateAction<Record<string, any>>> = useCallback(
    (updater) => {
      setParams((prev) => {
        const next = typeof updater === 'function' ? updater(prev) : updater;
        setParamsByTool((all) => ({
          ...all,
          [activeTool]: next,
        }));
        return next;
      });
    },
    [activeTool]
  );

  const handleSetSelectionMode = (mode: 'body' | 'feature' | 'face' | 'edge') => {
    setSelectionMode(mode);
    if (mode === 'body') {
      if (topology) {
        const b = createBodyEntity(topology, activeRevision);
        setSelectedEntity(b);
        setSelectedEntities([b]);
      }
    } else if (mode === 'feature') {
      if (selectedEntity?.entity_type !== 'feature') {
        setSelectedEntity(null);
        setSelectedEntities([]);
      }
    } else if (mode === 'face') {
      if (selectedEntity?.entity_type !== 'face') {
        setSelectedEntity(null);
        setSelectedEntities([]);
      }
    } else if (mode === 'edge') {
      if (selectedEntity?.entity_type !== 'edge') {
        setSelectedEntity(null);
        setSelectedEntities([]);
      }
    }
  };

  const handleSetActiveTool = (tool: CADToolType) => {
    setActiveTool(tool);
    if (tool !== 'select' && selectedEntity?.entity_type !== 'feature') {
      const toolP = computeToolParams(tool, selectedEntity, geometryContext, paramsByTool[tool]);
      setParams(toolP);
    }
    if (tool === 'fillet' || tool === 'chamfer') {
      setSelectionMode('edge');
    } else if (tool === 'hole' || tool === 'pocket' || tool === 'pad' || tool === 'push_pull' || tool === 'round_face_edges') {
      setSelectionMode('face');
    } else if (BODY_TOOLS.has(tool)) {
      const keepFace =
        FACE_OPTIONAL_BODY_TOOLS.has(tool) &&
        selectedEntity?.entity_type === 'face' &&
        selectedEntity?.surface_type === 'plane';
      if (!keepFace && topology) {
        setSelectionMode('body');
        const b = createBodyEntity(topology, activeRevision);
        setSelectedEntity(b);
        setSelectedEntities([b]);
      }
    }
  };

  // 1. Fetch Topology for active revision
  const fetchTopology = useCallback(async (revId: string) => {
    if (!sessionId || (sessionId === 'default_session' && !initialStepUrl && !initialStlUrl)) {
      return;
    }
    try {
      const stepParam = initialStepUrl ? `&source_step=${encodeURIComponent(initialStepUrl)}` : '';
      const res = await fetch(`/api/cad/modify/topology/${sessionId}?revision_id=${revId}${stepParam}`);
      if (res.status === 404) {
        setTopology(null);
        return;
      }
      if (!res.ok) throw new Error('Failed to load topology');
      const data = await res.json();
      setTopology(data);
      if (!isPreviewActive) {
        if (revId !== 'rev_000' || !initialStlUrl) {
          setStlUrl(`/api/cad/modify/file/${sessionId}/revisions/${revId}.stl`);
        } else if (initialStlUrl) {
          setStlUrl(initialStlUrl);
        }
      }
    } catch (err: any) {
      console.warn('Topology not available for session:', err?.message || err);
    }
  }, [sessionId, isPreviewActive, initialStepUrl, initialStlUrl]);

  // 2. Fetch History
  const fetchHistory = useCallback(async () => {
    if (!sessionId || sessionId === 'default_session') return;
    try {
      const res = await fetch(`/api/cad/modify/history/${sessionId}`);
      if (res.status === 404) {
        setHistory([]);
        return;
      }
      if (res.ok) {
        const data = await res.json();
        setHistory(data);
      }
    } catch (err: any) {
      console.warn('History not available for session:', err?.message || err);
    }
  }, [sessionId]);

  useEffect(() => {
    if (sessionId && (sessionId !== 'default_session' || initialStepUrl || initialStlUrl)) {
      fetchTopology(activeRevision);
      fetchHistory();
    }
  }, [sessionId, activeRevision, fetchTopology, fetchHistory, initialStepUrl, initialStlUrl]);

  // Handle entity selection with multi-select support
  const handleSelectTopologyEntity = (entity: any, multiSelect?: boolean) => {
    if (!entity) {
      setSelectedEntity(null);
      setSelectedEntities([]);
      setIsPreviewActive(false);
      setPreviewResult(null);
      return;
    }

    if (entity.entity_type === 'body') {
      const bodyEnt = topology ? createBodyEntity(topology, activeRevision) : entity;
      setSelectedEntity(bodyEnt);
      setSelectedEntities([bodyEnt]);
      setSelectionMode('body');
      setIsPreviewActive(false);
      setPreviewResult(null);
      return;
    }

    if (multiSelect) {
      setSelectedEntities((prev) => {
        const exists = prev.some((item) => item.transient_id === entity.transient_id);
        if (exists) {
          const next = prev.filter((item) => item.transient_id !== entity.transient_id);
          setSelectedEntity(next.length > 0 ? next[next.length - 1] : null);
          return next;
        } else {
          const next = [...prev, entity];
          setSelectedEntity(entity);
          return next;
        }
      });
    } else {
      setSelectedEntity(entity);
      setSelectedEntities([entity]);
    }

    setIsPreviewActive(false);
    setPreviewResult(null);

    if (entity.entity_type === 'feature') {
      setSelectedEntity(entity);
      setSelectedEntities([entity]);
      setSelectionMode('feature');
      setActiveTool('edit_feature');
      const initialChanges: Record<string, any> = {};
      (entity.params || []).forEach((p: any) => {
        initialChanges[p.key] = p.value;
      });
      setParams({
        feature_id: entity.feature_id,
        changes: initialChanges,
        ...initialChanges,
      });
      setIsPreviewActive(false);
      setPreviewResult(null);
      return;
    }

    if (entity.entity_type === 'edge') {
      setSelectionMode('edge');
    } else if (entity.entity_type === 'face') {
      setSelectionMode('face');
    }

    // Bug A11 fix: only switch tool if current tool is not applicable to new selection
    if (activeTool !== 'select' && activeTool !== 'measure') {
      if (!isOperationApplicable(activeTool, entity, geometryContext)) {
        setActiveTool('select');
      } else {
        const toolP = computeToolParams(activeTool, entity, geometryContext, paramsByTool[activeTool]);
        setParams(toolP);
      }
    }
  };

  // Direct click on 3D solid model surface
  const handleDirectMeshClick = (point: [number, number, number], normal?: [number, number, number]) => {
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
  };

  // Double click directly on 3D solid model surface: promote selection to 3D sub-shape/feature or body
  const handleDirectMeshDoubleClick = (point: [number, number, number], normal?: [number, number, number]) => {
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
  };

  // Build references list for API requests
  const buildRequestReferences = (): any[] => {
    const targets = selectedEntities.length > 1 ? selectedEntities : selectedEntity ? [selectedEntity] : [];
    const refs: any[] = [];

    targets.forEach((ent) => {
      if (!ent || ent.entity_type === 'body') return;
      if (ent.entity_type === 'feature') {
        const fids = ent.face_ids || [];
        fids.forEach((fid: string) => {
          if (fid && topology?.faces?.[fid]) {
            refs.push(topology.faces[fid]);
          } else if (fid) {
            refs.push({
              ref_id: fid,
              transient_id: fid,
              entity_type: 'face',
              centroid: [0, 0, 0],
            });
          }
        });
      } else {
        refs.push(ent);
      }
    });

    return refs;
  };

  // Build parameters dictionary using definition.toRequest (A9)
  const buildRequestParameters = (customParams?: Record<string, any>, opOverride?: string): Record<string, any> => {
    const isFeat = selectedEntity?.entity_type === 'feature';
    const mergedParams = (customParams && typeof customParams === 'object' && !('nativeEvent' in customParams) && !(customParams instanceof Event))
      ? { ...params, ...customParams }
      : params;
    const opType = (typeof opOverride === 'string' && opOverride.trim().length > 0)
      ? opOverride
      : (activeTool !== 'select' ? activeTool : (isFeat ? 'edit_feature' : activeTool));

    if (isFeat && opType === 'edit_feature') {
      return {
        feature_id: selectedEntity.feature_id,
        face_ids: selectedEntity.face_ids,
        changes: mergedParams.changes || mergedParams,
        ...mergedParams,
      };
    }

    const def = getOperationDefinition(opType as CADToolType);
    let baseReq = def && typeof def.toRequest === 'function' ? def.toRequest(mergedParams, selectedEntity) : { ...getDefaultParams(activeTool), ...mergedParams };

    if (opType === 'delete_feature') {
      const fids = (mergedParams.face_ids && Array.isArray(mergedParams.face_ids) && mergedParams.face_ids.length > 0)
        ? mergedParams.face_ids
        : (selectedEntities.length > 1
            ? selectedEntities.map(e => e.transient_id).filter(Boolean)
            : (selectedEntity?.transient_id ? [selectedEntity.transient_id] : (selectedEntity?.face_ids || [])));
      baseReq = {
        ...baseReq,
        face_ids: fids,
        feature_id: mergedParams.feature_id || selectedEntity?.feature_id,
      };
    }

    return baseReq;
  };

  // Preview Operation with AbortController and parseApiError (A8 & A13)
  const handlePreview = async (
    overrideOpType?: CADToolType | 'edit_feature',
    overrideParams?: Record<string, any>
  ) => {
    if (!selectedEntity) {
      toast.error('Please select something to edit first.');
      return;
    }

    if (previewAbortRef.current) {
      previewAbortRef.current.abort();
    }
    const abortController = new AbortController();
    previewAbortRef.current = abortController;

    setIsLoading(true);
    setPreviewResult(null);

    const safeOpType: CADToolType | 'edit_feature' = (typeof overrideOpType === 'string' && overrideOpType.trim().length > 0)
      ? overrideOpType
      : (activeTool !== 'select' ? activeTool : (selectedEntity?.entity_type === 'feature' ? 'edit_feature' : activeTool));
    const safeParams = (overrideParams && typeof overrideParams === 'object' && !('nativeEvent' in overrideParams) && !(overrideParams instanceof Event))
      ? overrideParams
      : undefined;
    const effectiveParams = buildRequestParameters(safeParams, safeOpType);

    try {
      const res = await fetch('/api/cad/modify/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: abortController.signal,
        body: JSON.stringify({
          session_id: sessionId,
          base_revision: activeRevision,
          operation_type: safeOpType,
          references: buildRequestReferences(),
          parameters: effectiveParams,
        }),
      });

      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.valid) {
        const errorDiag = parseApiError(res, data);
        setPreviewResult({
          validation: data?.validation || { is_valid: false },
          error_diagnostic: {
            code: data?.error_diagnostic?.code || errorDiag.code,
            message: errorDiag.message,
          },
        });
        toast.error(errorDiag.message);
      } else {
        setPreviewResult(data);
        setIsPreviewActive(true);
        if (data.preview_stl_url) {
          setStlUrl(data.preview_stl_url);
        }
        toast.success('Preview generated successfully');
      }
    } catch (err: any) {
      if (err.name === 'AbortError') return;
      const msg = err.message || 'Preview generation failed';
      setPreviewResult({
        validation: { is_valid: false },
        error_diagnostic: { code: 'Network Error', message: msg },
      });
      toast.error(msg);
    } finally {
      setIsLoading(false);
    }
  };

  // Cancel Preview
  const handleCancelPreview = useCallback(() => {
    if (previewAbortRef.current) {
      previewAbortRef.current.abort();
    }
    setIsPreviewActive(false);
    setPreviewResult(null);
    setStlUrl(`/api/cad/modify/file/${sessionId}/revisions/${activeRevision}.stl`);
    toast.info('Preview discarded');
  }, [sessionId, activeRevision]);

  // Rollback
  const handleRollback = async (targetRev: string) => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/cad/modify/rollback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: sessionId,
          target_revision: targetRev,
        }),
      });

      const data = await res.json().catch(() => null);
      if (res.ok && data?.success) {
        setActiveRevision(data.active_revision);
        setStlUrl(data.stl_url);
        setIsPreviewActive(false);
        setPreviewResult(null);
        setSelectedEntity(null);
        setSelectedEntities([]);
        toast.success(`Switched to ${data.active_revision}`);
        refetchFeatures();
        refetchModelParams();
      } else {
        toast.error(parseApiError(res, data).message);
      }
    } catch (err: any) {
      toast.error(err.message || 'Rollback failed');
    } finally {
      setIsLoading(false);
    }
  };

  // Undo / Redo
  const activeIdx = history.findIndex((h) => h.output_revision === activeRevision);
  const canUndo = activeIdx > 0;
  const canRedo = activeIdx >= 0 && activeIdx < history.length - 1;

  const handleUndo = () => {
    if (canUndo) {
      const prevRev = history[activeIdx - 1].output_revision || 'rev_000';
      handleRollback(prevRev);
    }
  };

  const handleRedo = () => {
    if (canRedo) {
      const nextRev = history[activeIdx + 1].output_revision;
      if (nextRev) handleRollback(nextRev);
    }
  };

  // Keyboard shortcuts (Escape to cancel/close, Ctrl+Z / Ctrl+Y for Undo / Redo)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
        return;
      }

      if (e.key === 'Escape') {
        if (contextMenu) {
          setContextMenu(null);
          return;
        }

        if (activeTool !== 'select') {
          if (isPreviewActive) {
            handleCancelPreview();
          }
          setActiveTool('select');
        }
        return;
      }

      // Delete key shortcut for deleting selected face or feature
      if (e.key === 'Delete' || e.key === 'Del' || (e.key === 'Backspace' && !e.ctrlKey && !e.metaKey)) {
        if (selectedEntity && (selectedEntity.entity_type === 'face' || selectedEntity.entity_type === 'feature')) {
          e.preventDefault();
          if (selectedEntity.entity_type === 'feature') {
            handleCommit('delete_feature', { feature_id: selectedEntity.feature_id, face_ids: selectedEntity.face_ids });
          } else {
            const parentFeat = detectedFeatures?.find(df => df.face_ids?.includes(selectedEntity.transient_id));
            if (parentFeat) {
              handleCommit('delete_feature', { feature_id: parentFeat.feature_id, face_ids: parentFeat.face_ids });
            } else {
              const fids = selectedEntities.length > 1
                ? selectedEntities.map(ent => ent.transient_id).filter(Boolean)
                : [selectedEntity.transient_id];
              handleCommit('delete_feature', { face_ids: fids });
            }
          }
          return;
        }
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          handleRedo();
        } else {
          handleUndo();
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        handleRedo();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [contextMenu, activeTool, isPreviewActive, handleCancelPreview, canUndo, canRedo, activeIdx, history, selectedEntity, selectedEntities, detectedFeatures]);

  // Commit Operation
  const handleCommit = async (
    overrideOpType?: CADToolType | 'edit_feature',
    overrideParams?: Record<string, any>
  ) => {
    if (!selectedEntity) return;

    setIsLoading(true);
    const safeOpType: CADToolType | 'edit_feature' = (typeof overrideOpType === 'string' && overrideOpType.trim().length > 0)
      ? overrideOpType
      : (activeTool !== 'select' ? activeTool : (selectedEntity?.entity_type === 'feature' ? 'edit_feature' : activeTool));
    const safeParams = (overrideParams && typeof overrideParams === 'object' && !('nativeEvent' in overrideParams) && !(overrideParams instanceof Event))
      ? overrideParams
      : undefined;
    const effectiveParams = buildRequestParameters(safeParams, safeOpType);

    try {
      const res = await fetch('/api/cad/modify/commit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: sessionId,
          base_revision: activeRevision,
          operation_type: safeOpType,
          references: buildRequestReferences(),
          parameters: effectiveParams,
        }),
      });

      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        const errorDiag = parseApiError(res, data);
        setPreviewResult({
          error_diagnostic: { code: errorDiag.code, message: errorDiag.message },
        });
        toast.error(errorDiag.message);
        return;
      }

      setActiveRevision(data.new_revision);
      setStlUrl(data.stl_url);
      setIsPreviewActive(false);
      setPreviewResult(null);
      setSelectedEntity(null);
      setSelectedEntities([]);
      setActiveTool('select');
      toast.success(`Committed revision ${data.new_revision}`);
      await fetchHistory();
      refetchFeatures();
      refetchModelParams();
    } catch (err: any) {
      toast.error(err.message || 'Failed to commit revision');
    } finally {
      setIsLoading(false);
    }
  };

  // Delete Operation and Recompute
  const handleDeleteOperation = async (opId: string) => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/cad/modify/recompute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: sessionId,
          target_op_id: opId,
        }),
      });

      const data = await res.json().catch(() => null);
      if (res.ok && data?.success) {
        setActiveRevision(data.final_revision);
        setStlUrl(data.stl_url);
        toast.success(`Operation removed: recomputed to ${data.final_revision}`);
        await fetchHistory();
        refetchFeatures();
        refetchModelParams();
      } else {
        throw new Error(parseApiError(res, data).message);
      }
    } catch (err: any) {
      toast.error(err.message || 'Failed to delete operation');
    } finally {
      setIsLoading(false);
    }
  };



  const previewPillLabel = isPreviewActive && activeTool !== 'select'
    ? activeTool.charAt(0).toUpperCase() + activeTool.slice(1)
    : undefined;

  return (
    <div
      ref={workspaceRef}
      className="mcad-workspace"
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height: '100%',
        background: 'var(--mcad-bg)',
        overflow: 'hidden',
        fontFamily: 'var(--font-sans)',
      }}
      tabIndex={-1}
    >
      {/* ─── Main 3D Viewport Area with Floating Cards ─── */}
      <div style={{ flex: 1, minHeight: 0, position: 'relative', overflow: 'hidden' }}>

        {/* 1. Full-Bleed 3D Viewport (fills entire container) */}
        <div
          style={{ position: 'absolute', inset: 0, background: 'var(--mcad-viewport)' }}
          onContextMenu={(e) => {
            const targetEntity = hoveredEntity || selectedEntity;
            if (targetEntity) {
              e.preventDefault();
              setContextMenu({
                x: e.clientX,
                y: e.clientY,
                entity: targetEntity,
              });
            }
          }}
        >
          <CadViewport
            stlUrl={stlUrl}
            geometryInfo={geometryInfo}
            statusText={isLoading ? 'Computing geometry...' : 'Ready'}
            isRecompiling={isLoading}
            hasStl={!!stlUrl}
            hasStep={true}
            hasDxf={false}
            hasGcode={false}
            isDownloadingStl={false}
            isDownloadingStep={false}
            isDownloadingDxf={false}
            onDownloadStl={() => {
              if (stlUrl) {
                const a = document.createElement('a');
                a.href = stlUrl;
                a.download = `cad_${sessionId}.stl`;
                a.click();
              }
            }}
            onDownloadStep={() => {
              const target = initialStepUrl || `/api/outputs/cad_${sessionId}.step`;
              const a = document.createElement('a');
              a.href = target;
              a.download = `cad_${sessionId}.step`;
              a.click();
            }}
            onDownloadDxf={() => {}}
            workflowStage="manual_cad"
            onClearSelection={() => {
              if (selectionMode !== 'body') {
                setSelectedEntity(null);
                setSelectedEntities([]);
                setIsPreviewActive(false);
                setPreviewResult(null);
              }
            }}
          >
            {stlUrl && (
              <StlMesh
                url={stlUrl}
                onGeometryReady={setGeometryInfo}
                onDirectClick={handleDirectMeshClick}
                onDirectDoubleClick={handleDirectMeshDoubleClick}
              />
            )}
            <SubShapeRaycaster
              topology={topology}
              selectedEntity={selectedEntity}
              selectedEntities={selectedEntities}
              onSelectEntity={handleSelectTopologyEntity}
              hoveredEntity={hoveredEntity}
              onHoverEntity={setHoveredEntity}
              selectionMode={selectionMode}
              highlightedFaceIds={highlightedFaceIds}
              onHighlightFaces={setHighlightedFaceIds}
              detectedFeatures={detectedFeatures}
              geometryScale={geometryInfo?.scale}
            />
          </CadViewport>

          {/* Empty model prompt overlay */}
          {!hasModel && (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 10,
                background: 'rgba(10, 14, 20, 0.78)',
                backdropFilter: 'blur(6px)',
                padding: 24,
                textAlign: 'center',
              }}
            >
              <div
                style={{
                  maxWidth: 420,
                  padding: '28px 32px',
                  borderRadius: 12,
                  background: 'var(--mcad-panel, #121820)',
                  border: '1px solid var(--mcad-border, #1f2937)',
                  boxShadow: '0 12px 40px rgba(0,0,0,0.5)',
                }}
              >
                <div style={{ fontSize: 16, fontWeight: 600, color: '#f3f4f6', marginBottom: 8 }}>
                  No CAD Model Loaded
                </div>
                <p style={{ fontSize: 13, color: '#9ca3af', lineHeight: 1.5, marginBottom: 20 }}>
                  Direct parametric editing requires an active 3D model. Generate a design from a prompt or import a STEP model to begin editing.
                </p>
                {onSwitchStage && (
                  <button
                    type="button"
                    onClick={() => onSwitchStage('cad')}
                    style={{
                      padding: '9px 20px',
                      background: 'var(--mcad-accent, #3b82f6)',
                      color: '#fff',
                      borderRadius: 6,
                      border: 'none',
                      fontSize: 13,
                      fontWeight: 500,
                      cursor: 'pointer',
                      transition: 'opacity 0.2s',
                    }}
                    onMouseOver={(e) => (e.currentTarget.style.opacity = '0.9')}
                    onMouseOut={(e) => (e.currentTarget.style.opacity = '1')}
                  >
                    Return to CAD Design
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Bottom-left status line */}
          <ViewportStatus selectedEntity={selectedEntity} isLoading={isLoading} hasModel={hasModel} />
        </div>

        {/* 2. Floating Left Tool Rail */}
        <div
          className="mcad-float"
          style={{
            position: 'absolute',
            left: 12,
            top: 12,
            bottom: 12,
            zIndex: 40,
            maxHeight: 'calc(100% - 24px)',
            overflowY: 'auto',
            overflowX: 'visible',
            scrollbarWidth: 'none',
          }}
        >
          <ManualCadToolbar
            activeTool={activeTool}
            setActiveTool={handleSetActiveTool}
            selectedEntity={selectedEntity}
            selectionMode={selectionMode}
            setSelectionMode={handleSetSelectionMode}
            workspaceRef={workspaceRef}
          />
        </div>

        {/* 3. Floating Top Selection Bar (centred pill) */}
        <div
          className="mcad-float"
          style={{
            position: 'absolute',
            top: 12,
            left: '50%',
            transform: 'translateX(-50%)',
            padding: 6,
            zIndex: 30,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            overflow: 'visible',
          }}
        >
          {/* Undo / Redo */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
            <button
              type="button"
              className="mcad-btn mcad-btn--ghost"
              onClick={handleUndo}
              disabled={!canUndo || isLoading}
              title="Undo (Ctrl+Z)"
              aria-label="Undo"
              style={{
                height: 26,
                width: 26,
                padding: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                opacity: (!canUndo || isLoading) ? 0.35 : 1,
                cursor: (!canUndo || isLoading) ? 'not-allowed' : 'pointer',
              }}
            >
              <Undo2 size={13} />
            </button>
            <button
              type="button"
              className="mcad-btn mcad-btn--ghost"
              onClick={handleRedo}
              disabled={!canRedo || isLoading}
              title="Redo (Ctrl+Y)"
              aria-label="Redo"
              style={{
                height: 26,
                width: 26,
                padding: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                opacity: (!canRedo || isLoading) ? 0.35 : 1,
                cursor: (!canRedo || isLoading) ? 'not-allowed' : 'pointer',
              }}
            >
              <Redo2 size={13} />
            </button>
          </div>

          <div style={{ width: 1, height: 18, background: 'var(--mcad-border)' }} />

          {/* Segmented control: Model | Feature | Face | Edge (with symbols) */}
          <div className="mcad-seg">
            <button
              type="button"
              data-on={selectionMode === 'body'}
              onClick={() => handleSetSelectionMode('body')}
              title="Select 3D solid model"
              aria-label="Select 3D solid model"
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minWidth: 32, padding: '0 8px' }}
            >
              <Box size={13} strokeWidth={2} />
            </button>
            <button
              type="button"
              data-on={selectionMode === 'feature'}
              onClick={() => handleSetSelectionMode('feature')}
              title="Select feature"
              aria-label="Select feature"
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minWidth: 32, padding: '0 8px' }}
            >
              <Sliders size={13} strokeWidth={2} />
            </button>
            <button
              type="button"
              data-on={selectionMode === 'face'}
              onClick={() => handleSetSelectionMode('face')}
              title="Select face"
              aria-label="Select face"
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minWidth: 32, padding: '0 8px' }}
            >
              <Square size={12} strokeWidth={2} />
            </button>
            <button
              type="button"
              data-on={selectionMode === 'edge'}
              onClick={() => handleSetSelectionMode('edge')}
              title="Select edge"
              aria-label="Select edge"
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minWidth: 32, padding: '0 8px' }}
            >
              <Slash size={13} strokeWidth={2.5} />
            </button>
          </div>

          <div style={{ width: 1, height: 18, background: 'var(--mcad-border)' }} />

          {/* Hint */}
          <span style={{ fontSize: 11, color: 'var(--mcad-text-muted)' }}>
            Shift: multi-select
          </span>

          <div style={{ width: 1, height: 18, background: 'var(--mcad-border)' }} />

          {/* Fit camera view */}
          <button
            type="button"
            className="mcad-btn mcad-btn--ghost"
            onClick={() => window.dispatchEvent(new CustomEvent('viewport-action', { detail: 'fit' }))}
            title="Fit model to view"
            style={{ height: 26, padding: '0 8px', fontSize: 11 }}
          >
            <Maximize2 size={12} />
            Fit
          </button>

          {/* Isometric home view */}
          <button
            type="button"
            className="mcad-btn mcad-btn--ghost"
            onClick={() => window.dispatchEvent(new CustomEvent('viewport-action', { detail: 'iso' }))}
            title="Isometric home view"
            style={{ height: 26, width: 26, padding: 0 }}
          >
            <Home size={12} />
          </button>

          {/* Select more dropdown menu */}
          <SelectMoreMenu
            selectedEntity={selectedEntity}
            sessionId={sessionId}
            activeRevision={activeRevision}
            onApplySelection={(ids) => {
              if (ids.length > 0 && topology?.faces) {
                const matched = ids.map((id) => topology.faces[id]).filter(Boolean);
                if (matched.length > 0) {
                  setSelectedEntities(matched);
                  setSelectedEntity(matched[0]);
                }
              }
            }}
            onClearSelection={() => {
              setSelectedEntity(null);
              setSelectedEntities([]);
            }}
          />

          <div style={{ width: 1, height: 18, background: 'var(--mcad-border)' }} />

          {/* Export Dropdown */}
          <div className="relative" ref={exportRef}>
            <button
              type="button"
              className="mcad-btn mcad-btn--ghost"
              onClick={() => setExportOpen((prev) => !prev)}
              style={{
                height: 26,
                padding: '0 8px',
                fontSize: 11,
                gap: 4,
                color: 'var(--mcad-accent)',
                fontWeight: 600,
              }}
              title="Export 3D Model"
            >
              <Download size={12} />
              <span>Export</span>
              <ChevronDown size={11} className={`transition-transform ${exportOpen ? 'rotate-180' : ''}`} />
            </button>

            {exportOpen && (
              <div
                style={{
                  position: 'absolute',
                  top: 'calc(100% + 6px)',
                  right: 0,
                  minWidth: 160,
                  background: 'var(--mcad-raised, #181c24)',
                  border: '1px solid var(--mcad-border-ctrl, #2d3545)',
                  borderRadius: 8,
                  boxShadow: '0 8px 24px rgba(0, 0, 0, 0.45)',
                  padding: 4,
                  zIndex: 1000,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 2,
                }}
              >
                <button
                  type="button"
                  onClick={() => {
                    setExportOpen(false);
                    handleDownloadStep();
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '6px 8px',
                    borderRadius: 6,
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--mcad-text-primary)',
                    fontSize: 11,
                    fontFamily: 'var(--font-sans)',
                    cursor: 'pointer',
                    textAlign: 'left',
                    width: '100%',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--mcad-input)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                >
                  <Box size={14} className="text-blue-400" />
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <span style={{ fontWeight: 600 }}>STEP Format</span>
                    <span style={{ fontSize: 9.5, color: 'var(--mcad-text-muted)' }}>Solid CAD model</span>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setExportOpen(false);
                    handleDownloadStl();
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '6px 8px',
                    borderRadius: 6,
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--mcad-text-primary)',
                    fontSize: 11,
                    fontFamily: 'var(--font-sans)',
                    cursor: 'pointer',
                    textAlign: 'left',
                    width: '100%',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--mcad-input)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                >
                  <Layers size={14} className="text-emerald-400" />
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <span style={{ fontWeight: 600 }}>STL Format</span>
                    <span style={{ fontSize: 9.5, color: 'var(--mcad-text-muted)' }}>3D printing mesh</span>
                  </div>
                </button>
              </div>
            )}
          </div>
        </div>

        {/* 4. Floating Right Panel */}
        <div
          className="mcad-float"
          style={{
            position: 'absolute',
            right: 12,
            top: 12,
            bottom: 12,
            maxHeight: 'calc(100% - 24px)',
            width: 324,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            zIndex: 20,
          }}
        >
          {/* Header: Stage switcher */}
          <div
            style={{
              padding: 14,
              borderBottom: '1px solid var(--mcad-border)',
              display: 'flex',
              alignItems: 'center',
            }}
          >
            {onSwitchStage && (
              <StageSwitcher value="manual_cad" onChange={onSwitchStage} />
            )}
          </div>

          {/* Properties body */}
          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
            <TopologyPropertiesPanel
              selectedEntity={selectedEntity}
              activeTool={activeTool}
              params={params}
              setParams={handleUpdateParams}
              onPreview={handlePreview}
              onCancelPreview={handleCancelPreview}
              onCommit={handleCommit}
              isPreviewActive={isPreviewActive}
              isLoading={isLoading}
              validationReport={previewResult?.validation || null}
              errorDiagnostic={previewResult?.error_diagnostic || null}
              topology={topology}
              onSelectTopologyEntity={handleSelectTopologyEntity}
              onSelectTool={handleSetActiveTool}
              detectedFeatures={detectedFeatures}
              isLoadingFeatures={isLoadingFeatures}
              onRefetchFeatures={refetchFeatures}
              onHighlightFaces={setHighlightedFaceIds}
              selectionMode={selectionMode}
              ctx={geometryContext}
              modelParams={modelParams}
              isLoadingModelParams={isLoadingModelParams}
              onRefetchModelParams={refetchModelParams}
            />
          </div>
        </div>



        {/* Right-click Context Menu */}
        {contextMenu && (
          <ContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            entity={contextMenu.entity}
            onSelectOperation={(opId) => {
              if (selectedEntity?.transient_id !== contextMenu.entity?.transient_id) {
                handleSelectTopologyEntity(contextMenu.entity);
              }
              handleSetActiveTool(opId);
              setContextMenu(null);
            }}
            onClose={() => setContextMenu(null)}
          />
        )}
      </div>


    </div>
  );
}
