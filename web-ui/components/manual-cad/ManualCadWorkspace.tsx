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
import { Loader2 } from 'lucide-react';

interface ManualCadWorkspaceProps {
  sessionId: string;
  initialStlUrl?: string | null;
  initialStepUrl?: string | null;
  onProceedToCam?: () => void;
  onSwitchStage?: (stage: 'cad' | 'manual_cad' | 'cam') => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Filter segmented control
// ─────────────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
// Filter segmented control
// ─────────────────────────────────────────────────────────────────────────────
function FilterControl({
  selectionMode,
  setSelectionMode,
}: {
  selectionMode: 'body' | 'face' | 'edge';
  setSelectionMode: (m: 'body' | 'face' | 'edge') => void;
}) {
  const segments: Array<{ value: 'body' | 'face' | 'edge'; label: string }> = [
    { value: 'body', label: '3D Model' },
    { value: 'face', label: 'Face' },
    { value: 'edge', label: 'Edge' },
  ];

  return (
    <div style={{
      display: 'flex', borderRadius: 8, overflow: 'hidden',
      border: '1px solid var(--mcad-border-ctrl)',
      background: 'var(--mcad-input)',
      height: 30,
    }}>
      {segments.map((s, i) => {
        const isCurrent = selectionMode === s.value;
        return (
          <button
            key={s.value}
            type="button"
            title={`Select ${s.label}`}
            onClick={() => setSelectionMode(s.value)}
            style={{
              padding: '0 10px',
              borderRight: i < segments.length - 1 ? '1px solid var(--mcad-border-ctrl)' : 'none',
              background: isCurrent ? 'var(--mcad-segment-active)' : 'transparent',
              color: isCurrent
                ? '#fff'
                : 'var(--mcad-text-secondary)',
              border: 'none',
              fontSize: 11,
              fontFamily: 'var(--font-sans)',
              cursor: 'pointer',
              fontWeight: isCurrent ? 600 : 400,
              transition: 'background 0.15s, color 0.15s',
              whiteSpace: 'nowrap',
            }}
          >
            {s.label}
          </button>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Status overlay (bottom-left of viewport)
// ─────────────────────────────────────────────────────────────────────────────
function ViewportStatus({
  selectedEntity,
  isLoading,
}: {
  selectedEntity: any | null;
  isLoading: boolean;
}) {
  let text = 'Nothing selected: click a face or 3D model, or press V';

  if (isLoading) {
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
  onSwitchStage
}: ManualCadWorkspaceProps) {
  const [activeRevision, setActiveRevision] = useState<string>('rev_000');
  const [activeTool, setActiveTool] = useState<CADToolType>('select');
  const [selectionMode, setSelectionMode] = useState<'body' | 'face' | 'edge'>('face');
  const [selectedEntity, setSelectedEntity] = useState<any | null>(null);
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

  // Scoped workspace ref for keyboard shortcuts
  const workspaceRef = useRef<HTMLDivElement>(null);

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
    } else if (mode === 'face' && selectedEntity?.entity_type === 'body') {
      setSelectedEntity(null);
    } else if (mode === 'edge' && selectedEntity?.entity_type === 'body') {
      setSelectedEntity(null);
    }
  };

  const handleSetActiveTool = (tool: CADToolType) => {
    setActiveTool(tool);
    if (tool === 'fillet' || tool === 'chamfer') {
      setSelectionMode('edge');
    } else if (tool === 'hole' || tool === 'pocket' || tool === 'pad' || tool === 'select') {
      setSelectionMode('face');
    }
  };

  // 1. Fetch Topology for active revision
  const fetchTopology = useCallback(async (revId: string) => {
    try {
      const stepParam = initialStepUrl ? `&source_step=${encodeURIComponent(initialStepUrl)}` : '';
      const res = await fetch(`/api/cad/modify/topology/${sessionId}?revision_id=${revId}${stepParam}`);
      if (!res.ok) throw new Error('Failed to load topology');
      const data = await res.json();
      setTopology(data);
      if (!isPreviewActive) {
        setStlUrl(`/api/cad/modify/file/${sessionId}/revisions/${revId}.stl`);
      }
    } catch (err: any) {
      console.error('Error fetching topology:', err);
    }
  }, [sessionId, isPreviewActive, initialStepUrl]);

  // 2. Fetch History
  const fetchHistory = useCallback(async () => {
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
    if (sessionId) {
      fetchTopology(activeRevision);
      fetchHistory();
    }
  }, [sessionId, activeRevision, fetchTopology, fetchHistory]);

  // Handle entity selection
  const handleSelectTopologyEntity = (entity: any) => {
    setSelectedEntity(entity);
    setIsPreviewActive(false);
    setPreviewResult(null);
    if (entity.entity_type === 'edge') {
      setSelectionMode('edge');
      setActiveTool('fillet');
    } else if (entity.entity_type === 'face') {
      setSelectionMode('face');
      if (entity.surface_type === 'plane') {
        setActiveTool('hole');
      }
    }
  };

  // Direct click on 3D solid model surface
  const handleDirectMeshClick = (point: [number, number, number], normal?: [number, number, number]) => {
    if (!topology) return;
    if (selectionMode === 'body') {
      setSelectedEntity(createBodyEntity(topology, activeRevision));
    } else if (selectionMode === 'face' && topology.faces) {
      const face = findFaceFromHit(point, normal, topology.faces);
      if (face) {
        handleSelectTopologyEntity(face);
      }
    }
  };

  // Preview Operation
  const handlePreview = async () => {
    if (!selectedEntity) {
      toast.error('Please select a face or edge first.');
      return;
    }

    setIsLoading(true);
    setPreviewResult(null);

    try {
      const res = await fetch('/api/cad/modify/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: sessionId,
          base_revision: activeRevision,
          operation_type: activeTool,
          references: [selectedEntity],
          parameters: params,
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
    try {
      const res = await fetch('/api/cad/modify/commit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: sessionId,
          base_revision: activeRevision,
          operation_type: activeTool,
          references: [selectedEntity],
          parameters: params,
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
      setActiveTool('select');
      toast.success(`Committed revision ${data.new_revision}`);
      await fetchHistory();
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
        toast.success(`Switched to ${data.active_revision}`);
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
          action: 'delete_op',
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        if (data.broken_references && data.broken_references.length > 0) {
          toast.warning(`Recompute warning: ${data.broken_references[0]}`);
        } else {
          throw new Error(data.error?.message || 'Recompute failed');
        }
      }

      setActiveRevision(data.active_revision);
      setStlUrl(data.stl_url);
      setHistory(data.history || []);
      setIsPreviewActive(false);
      setPreviewResult(null);
      setSelectedEntity(null);
      toast.success(`Operation removed. Recomputed to ${data.active_revision}`);
      await fetchTopology(data.active_revision);
    } catch (err: any) {
      toast.error(err.message || 'Failed to recompute geometry');
    } finally {
      setIsLoading(false);
    }
  };

  // Undo / Redo helpers
  const currentIdx = history.findIndex(h => (h.output_revision || h.input_revision) === activeRevision);
  const canUndo = currentIdx > 0;
  const canRedo = currentIdx >= 0 && currentIdx < history.length - 1;

  const handleUndo = () => {
    if (canUndo) {
      const prevRev = history[currentIdx - 1].output_revision || history[currentIdx - 1].input_revision;
      handleRollback(prevRev);
    }
  };

  const handleRedo = () => {
    if (canRedo) {
      const nextRev = history[currentIdx + 1].output_revision || history[currentIdx + 1].input_revision;
      handleRollback(nextRev);
    }
  };

  // Preview pill label for timeline
  const previewPillLabel = isPreviewActive && activeTool !== 'select'
    ? activeTool.charAt(0).toUpperCase() + activeTool.slice(1)
    : undefined;

  return (
    <div
      ref={workspaceRef}
      className="mcad-workspace"
      style={{
        display: 'flex', flexDirection: 'column',
        width: '100%', height: '100%',
        background: 'var(--mcad-bg)',
        overflow: 'hidden',
        fontFamily: 'var(--font-sans)',
      }}
      // Prevent shortcuts from triggering while workspace is not focused
      tabIndex={-1}
    >
      {/* ─── Main row: toolbar | viewport | inspector ─── */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>

        {/* Left toolbar rail */}
        <ManualCadToolbar
          activeTool={activeTool}
          setActiveTool={handleSetActiveTool}
          selectedEntity={selectedEntity}
          selectionMode={selectionMode}
          setSelectionMode={handleSetSelectionMode}
          workspaceRef={workspaceRef}
        />

        {/* ─── Viewport column ─── */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, position: 'relative' }}>

          {/* Viewport header bar */}
          <div style={{
            height: 44,
            background: 'var(--mcad-panel)',
            borderBottom: '1px solid var(--mcad-border)',
            display: 'flex', alignItems: 'center',
            paddingLeft: 12, paddingRight: 12, gap: 10,
            flexShrink: 0, zIndex: 10,
          }}>
            {/* Filter segmented control */}
            <FilterControl selectionMode={selectionMode} setSelectionMode={handleSetSelectionMode} />

            <div style={{ flex: 1 }} />

            {/* Hint text */}
            <span style={{ fontSize: 11, color: 'var(--mcad-text-muted)', fontFamily: 'var(--font-sans)' }}>
              Shift: multi-select
            </span>

            {/* Fit hint button */}
            <button
              type="button"
              style={{
                height: 26, padding: '0 10px', borderRadius: 8,
                background: 'var(--mcad-input)', border: '1px solid var(--mcad-border-ctrl)',
                color: 'var(--mcad-text-secondary)', fontSize: 11,
                fontFamily: 'var(--font-sans)', cursor: 'pointer',
              }}
              onClick={() => {/* CadViewport exposes no direct fit API; this is a hint */}}
              title="Fit model to view (F key in viewport)"
            >
              Fit
            </button>
          </div>

          {/* 3D viewport */}
          <div
            style={{ flex: 1, position: 'relative', background: 'var(--mcad-viewport)', minHeight: 0 }}
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
            {/* Dot-grid background */}
            <div
              aria-hidden
              style={{
                position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 0,
                backgroundImage: 'radial-gradient(circle, #1b212a 1px, transparent 1px)',
                backgroundSize: '24px 24px',
              }}
            />

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
            >
              {stlUrl && <StlMesh url={stlUrl} onDirectClick={handleDirectMeshClick} />}
              <SubShapeRaycaster
                topology={topology}
                selectedEntity={selectedEntity}
                onSelectEntity={handleSelectTopologyEntity}
                hoveredEntity={hoveredEntity}
                onHoverEntity={setHoveredEntity}
                selectionMode={selectionMode}
              />
            </CadViewport>

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

            {/* Bottom-left status line */}
            <ViewportStatus selectedEntity={selectedEntity} isLoading={isLoading} />
          </div>
        </div>

        {/* ─── Right inspector panel ─── */}
        <div style={{
          width: 320, minWidth: 280, maxWidth: 360,
          display: 'flex', flexDirection: 'column',
          background: 'var(--mcad-panel)',
          borderLeft: '1px solid var(--mcad-border)',
          flexShrink: 0, height: '100%', overflow: 'hidden',
        }}>
          {/* Stage switcher header — kept identical to other stages */}
          <div style={{
            height: 56, display: 'flex', alignItems: 'center',
            justifyContent: 'center', paddingLeft: 12, paddingRight: 12,
            borderBottom: '1px solid var(--mcad-border)',
            flexShrink: 0,
          }}>
            {onSwitchStage && (
              <div className="flex bg-black/5 dark:bg-black/40 p-1 rounded-lg border border-black/5 dark:border-white/5 w-full max-w-[360px] gap-1">
                <button
                  onClick={() => onSwitchStage('cad')}
                  className="flex-1 py-1.5 px-1.5 text-[9.5px] font-bold tracking-tight uppercase rounded-md text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5 border border-transparent transition-all duration-200 whitespace-nowrap text-center cursor-pointer"
                >
                  📐 AI CAD
                </button>
                <button
                  className="flex-1 py-1.5 px-1.5 text-[9.5px] font-bold tracking-tight uppercase rounded-md bg-purple-100/50 dark:bg-purple-500/20 text-purple-600 dark:text-purple-400 border border-purple-200 dark:border-purple-500/30 shadow-sm dark:shadow-[0_0_15px_rgba(168,85,247,0.15)] transition-all duration-200 whitespace-nowrap text-center cursor-default"
                >
                  🛠️ Manual CAD
                </button>
                <button
                  onClick={() => onSwitchStage('cam')}
                  className="flex-1 py-1.5 px-1.5 text-[9.5px] font-bold tracking-tight uppercase rounded-md text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5 border border-transparent transition-all duration-200 whitespace-nowrap text-center cursor-pointer"
                >
                  ⚙️ CAM Setup
                </button>
              </div>
            )}
          </div>

          {/* Properties panel — scrolls internally if needed */}
          <div style={{ flex: 1, overflow: 'hidden' }}>
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
            />
          </div>
        </div>
      </div>

      {/* ─── Bottom: History timeline ─── */}
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
