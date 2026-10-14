'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { toast } from 'sonner';
import { ManualCadToolbar, CADToolType } from './ManualCadToolbar';
import { TopologyPropertiesPanel } from './TopologyPropertiesPanel';
import { HistoryTimelineBar, HistoryOperation } from './HistoryTimelineBar';
import { CadViewport } from '@/components/viewport/CadViewport';
import { SubShapeRaycaster, findFaceFromHit } from './SubShapeRaycaster';
import { StlMesh } from '@/components/viewport/StlMesh';
import { ContextMenu } from './operations/ContextMenu';
import { getDefaultParams } from './operations/registry';
import { SelectMoreMenu } from './SelectMoreMenu';
import { useDetectedFeatures, DetectedFeature } from './useDetectedFeatures';
import { StageSwitcher } from '@/components/workspace/StageSwitcher';
import {
  Loader2,
  ArrowUp,
  Maximize2,
  Home,
} from 'lucide-react';

/** Tools that act on the whole model; a selected planar face is optional input for some. */
const BODY_TOOLS = new Set<CADToolType>([
  'move', 'rotate', 'scale', 'mirror', 'align', 'primitive', 'shell', 'offset', 'split',
  'linear_pattern', 'polar_pattern', 'heal',
]);
const FACE_OPTIONAL_BODY_TOOLS = new Set<CADToolType>(['mirror', 'split', 'align', 'shell', 'primitive']);

interface PromptDockProps {
  value: string;
  onChange: (v: string) => void;
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
  isGenerating: boolean;
}

interface ManualCadWorkspaceProps {
  sessionId: string;
  initialStlUrl?: string | null;
  initialStepUrl?: string | null;
  onProceedToCam?: () => void;
  onSwitchStage?: (stage: 'cad' | 'manual_cad' | 'cam') => void;
  promptDock?: PromptDockProps;
}

export function ManualCadWorkspace({
  sessionId,
  initialStlUrl,
  initialStepUrl,
  onProceedToCam,
  onSwitchStage,
  promptDock,
}: ManualCadWorkspaceProps) {
  const [activeRevision, setActiveRevision] = useState<string>('rev_000');
  const [activeTool, setActiveTool] = useState<CADToolType>('select');
  const [selectionMode, setSelectionMode] = useState<'body' | 'face' | 'edge'>('face');
  const [selectedEntity, setSelectedEntity] = useState<any | null>(null);
  const [selectedEntities, setSelectedEntities] = useState<any[]>([]);
  const [highlightedFaceIds, setHighlightedFaceIds] = useState<string[] | null>(null);
  const [params, setParams] = useState<Record<string, any>>({
    radius: 2.0, distance: 1.0, diameter: 6.0, depth: 10.0, width: 20.0, height: 15.0
  });
  const [topology, setTopology] = useState<any | null>(null);
  const [history, setHistory] = useState<HistoryOperation[]>([]);
  const [previewResult, setPreviewResult] = useState<any | null>(null);
  const [isPreviewActive, setIsPreviewActive] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [stlUrl, setStlUrl] = useState<string | null>(initialStlUrl || null);
  const [hoveredEntity, setHoveredEntity] = useState<any | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; entity: any } | null>(null);

  // Sync stlUrl when initialStlUrl prop arrives or updates
  useEffect(() => {
    if (initialStlUrl && !isPreviewActive) {
      setStlUrl(initialStlUrl);
    }
  }, [initialStlUrl, isPreviewActive]);

  // Scoped workspace ref for keyboard shortcuts
  const workspaceRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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

  const handleSetSelectionMode = (mode: 'body' | 'face' | 'edge') => {
    setSelectionMode(mode);
    if (mode === 'body') {
      if (topology) {
        setSelectedEntity(createBodyEntity(topology, activeRevision));
      }
    } else if (mode === 'face') {
      if (selectedEntity?.entity_type === 'body' || selectedEntity?.entity_type === 'edge') {
        setSelectedEntity(null);
        setSelectedEntities([]);
      }
    } else if (mode === 'edge') {
      if (selectedEntity?.entity_type === 'body' || selectedEntity?.entity_type === 'face') {
        setSelectedEntity(null);
        setSelectedEntities([]);
      }
    }
  };

  const handleSetActiveTool = (tool: CADToolType) => {
    setActiveTool(tool);
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
        setSelectedEntity(createBodyEntity(topology, activeRevision));
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
      console.error('Error fetching topology:', err);
    }
  }, [sessionId, isPreviewActive, initialStepUrl, initialStlUrl]);

  // 2. Fetch History
  const fetchHistory = useCallback(async () => {
    if (!sessionId || sessionId === 'default_session') return;
    try {
      const res = await fetch(`/api/cad/modify/history/${sessionId}`);
      if (res.ok) {
        const data = await res.json();
        setHistory(data);
      }
    } catch (err: any) {
      console.error('Error fetching history:', err);
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

    // In face mode (or general mode): find clicked face
    if (topology.faces) {
      const face = findFaceFromHit(point, normal, topology.faces);
      if (face) {
        // If this face belongs to a detected feature, highlight/select that feature for editing
        const matchingFeat = detectedFeatures.find((df: any) =>
          df.face_ids?.includes(face.transient_id)
        );
        if (matchingFeat && activeTool === 'edit_feature') {
          handleSelectTopologyEntity({ entity_type: 'feature', ...matchingFeat });
        } else {
          handleSelectTopologyEntity(face);
        }
      }
    }
  };

  // Build references list for API requests
  const buildRequestReferences = (): any[] => {
    const targets = selectedEntities.length > 1 ? selectedEntities : selectedEntity ? [selectedEntity] : [];
    const refs: any[] = [];

    targets.forEach((ent) => {
      if (!ent || ent.entity_type === 'body') return;
      if (ent.entity_type === 'feature') {
        const firstFid = ent.face_ids?.[0];
        if (firstFid && topology?.faces?.[firstFid]) {
          refs.push(topology.faces[firstFid]);
        } else if (firstFid) {
          refs.push({ entity_type: 'face', transient_id: firstFid });
        }
      } else {
        refs.push(ent);
      }
    });

    return refs;
  };

  // Build parameters dictionary
  const buildRequestParameters = (): Record<string, any> => {
    const isFeat = selectedEntity?.entity_type === 'feature';
    if (isFeat) {
      return {
        feature_id: selectedEntity.feature_id,
        changes: params.changes || params,
        ...params,
      };
    }
    return { ...getDefaultParams(activeTool), ...params };
  };

  // Preview Operation
  const handlePreview = async () => {
    if (!selectedEntity) {
      toast.error('Please select something to edit first.');
      return;
    }

    setIsLoading(true);
    setPreviewResult(null);

    const opType = selectedEntity?.entity_type === 'feature' ? 'edit_feature' : activeTool;

    try {
      const res = await fetch('/api/cad/modify/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: sessionId,
          base_revision: activeRevision,
          operation_type: opType,
          references: buildRequestReferences(),
          parameters: buildRequestParameters(),
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.valid) {
        setPreviewResult(data);
        toast.error(data.validation?.error_message || 'Operation preview failed');
      } else {
        setPreviewResult(data);
        setIsPreviewActive(true);
        if (data.preview_stl_url) {
          setStlUrl(data.preview_stl_url);
        }
        toast.success('Preview generated successfully');
      }
    } catch (err: any) {
      toast.error(err.message || 'Preview generation failed');
    } finally {
      setIsLoading(false);
    }
  };

  // Cancel Preview
  const handleCancelPreview = useCallback(() => {
    setIsPreviewActive(false);
    setPreviewResult(null);
    setStlUrl(`/api/cad/modify/file/${sessionId}/revisions/${activeRevision}.stl`);
    toast.info('Preview discarded');
  }, [sessionId, activeRevision]);

  // Escape key cancels active tool / task panel or closes context menu
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
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
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [contextMenu, activeTool, isPreviewActive, handleCancelPreview]);

  // Commit Operation
  const handleCommit = async () => {
    if (!selectedEntity) return;

    setIsLoading(true);
    const opType = selectedEntity?.entity_type === 'feature' ? 'edit_feature' : activeTool;

    try {
      const res = await fetch('/api/cad/modify/commit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: sessionId,
          base_revision: activeRevision,
          operation_type: opType,
          references: buildRequestReferences(),
          parameters: buildRequestParameters(),
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error?.message || 'Commit failed');
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
    } catch (err: any) {
      toast.error(err.message || 'Failed to commit revision');
    } finally {
      setIsLoading(false);
    }
  };

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

      const data = await res.json();
      if (res.ok && data.success) {
        setActiveRevision(data.active_revision);
        setStlUrl(data.stl_url);
        setIsPreviewActive(false);
        setPreviewResult(null);
        setSelectedEntity(null);
        setSelectedEntities([]);
        toast.success(`Switched to ${data.active_revision}`);
        refetchFeatures();
      }
    } catch (err: any) {
      toast.error('Rollback failed');
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

      const data = await res.json();
      if (res.ok && data.success) {
        setActiveRevision(data.final_revision);
        setStlUrl(data.stl_url);
        toast.success(`Operation removed: recomputed to ${data.final_revision}`);
        await fetchHistory();
        refetchFeatures();
      } else {
        throw new Error(data.error?.message || 'Recompute failed');
      }
    } catch (err: any) {
      toast.error(err.message || 'Failed to delete operation');
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

  // Viewport status text computation
  const getStatusCaption = () => {
    if (isLoading) return 'Computing geometry…';
    if (!selectedEntity) return 'Nothing selected · Click a face or 3D model';
    const e = selectedEntity;
    const parts: string[] = [];
    if (e.entity_type === 'feature') {
      parts.push(e.name || 'Feature');
      if (e.subtype) parts.push(e.subtype);
    } else if (e.entity_type === 'body') {
      parts.push('3D Solid Model');
      if (e.volume_mm3 != null) parts.push(`${e.volume_mm3.toFixed(1)} mm³`);
    } else {
      parts.push(e.transient_id);
      if (e.surface_type) parts.push(e.surface_type);
      if (e.curve_type) parts.push(e.curve_type);
      if (e.area != null) parts.push(`${e.area.toFixed(1)} mm²`);
      if (e.length != null) parts.push(`${e.length.toFixed(1)} mm`);
    }
    return parts.join(' · ');
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
            {stlUrl && <StlMesh url={stlUrl} onDirectClick={handleDirectMeshClick} />}
            <SubShapeRaycaster
              topology={topology}
              selectedEntity={selectedEntity}
              selectedEntities={selectedEntities}
              onSelectEntity={handleSelectTopologyEntity}
              hoveredEntity={hoveredEntity}
              onHoverEntity={setHoveredEntity}
              selectionMode={selectionMode}
              highlightedFaceIds={highlightedFaceIds}
              detectedFeatures={detectedFeatures}
            />
          </CadViewport>
        </div>

        {/* 2. Floating Left Tool Rail */}
        <div
          className="mcad-float"
          style={{
            position: 'absolute',
            left: 12,
            top: 56,
            zIndex: 20,
            overflow: 'visible',
            maxHeight: 'calc(100% - 68px)',
            overflowY: 'auto',
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
            top: 56,
            left: '50%',
            transform: 'translateX(-50%)',
            padding: 6,
            zIndex: 20,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          {/* Segmented control: 3D Model | Face | Edge */}
          <div className="mcad-seg">
            <button
              type="button"
              data-on={selectionMode === 'body'}
              onClick={() => handleSetSelectionMode('body')}
              title="Select 3D solid model"
            >
              3D Model
            </button>
            <button
              type="button"
              data-on={selectionMode === 'face'}
              onClick={() => handleSetSelectionMode('face')}
              title="Select face"
            >
              Face
            </button>
            <button
              type="button"
              data-on={selectionMode === 'edge'}
              onClick={() => handleSetSelectionMode('edge')}
              title="Select edge"
            >
              Edge
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
        </div>

        {/* 4. Floating Right Panel */}
        <div
          className="mcad-float"
          style={{
            position: 'absolute',
            right: 12,
            top: 56,
            bottom: 12,
            width: 324,
            display: 'flex',
            flexDirection: 'column',
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
              setParams={setParams}
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
            />
          </div>
        </div>

        {/* 5. Floating Prompt Dock (bottom centre) */}
        {promptDock && (
          <div
            style={{
              position: 'absolute',
              bottom: 16,
              left: 128,
              right: 360,
              zIndex: 20,
              pointerEvents: 'none',
            }}
          >
            <div
              style={{
                maxWidth: 680,
                margin: '0 auto',
                pointerEvents: 'auto',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 6,
              }}
            >
              {/* Centered muted status caption */}
              <div
                style={{
                  fontSize: 11,
                  fontFamily: 'var(--font-mono)',
                  color: 'var(--mcad-text-muted)',
                  userSelect: 'none',
                }}
              >
                {isLoading && (
                  <Loader2 size={11} className="inline mr-1 animate-spin" style={{ color: 'var(--mcad-accent)' }} />
                )}
                {getStatusCaption()}
              </div>

              {/* Prompt box */}
              <form
                className="mcad-prompt"
                style={{ width: '100%' }}
                onSubmit={(e) => {
                  e.preventDefault();
                  if (promptDock.value.trim() && !promptDock.isGenerating) {
                    promptDock.onSubmit(e);
                  }
                }}
              >
                <textarea
                  ref={textareaRef}
                  value={promptDock.value}
                  onChange={(e) => {
                    promptDock.onChange(e.target.value);
                    if (textareaRef.current) {
                      textareaRef.current.style.height = 'auto';
                      textareaRef.current.style.height = `${Math.min(120, textareaRef.current.scrollHeight)}px`;
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      if (promptDock.value.trim() && !promptDock.isGenerating) {
                        promptDock.onSubmit(e as any);
                      }
                    }
                  }}
                  placeholder="Describe a change to the model…"
                  rows={1}
                />

                <button
                  type="submit"
                  className="mcad-prompt-send"
                  disabled={promptDock.isGenerating || !promptDock.value.trim()}
                  title="Send instruction to AI CAD (Enter)"
                >
                  {promptDock.isGenerating ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <ArrowUp size={16} />
                  )}
                </button>
              </form>
            </div>
          </div>
        )}

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

      {/* ─── Bottom: History timeline (100% untouched) ─── */}
      <HistoryTimelineBar
        history={history}
        activeRevision={activeRevision}
        onRollback={handleRollback}
        onUndo={handleUndo}
        onRedo={handleRedo}
        onDeleteOperation={handleDeleteOperation}
        canUndo={canUndo}
        canRedo={canRedo}
        isRecomputing={isLoading}
        previewLabel={previewPillLabel}
      />
    </div>
  );
}
