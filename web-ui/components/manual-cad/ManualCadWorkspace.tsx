'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import { ManualCadToolbar, CADToolType } from './ManualCadToolbar';
import { TopologyPropertiesPanel } from './TopologyPropertiesPanel';
import { HistoryTimelineBar, HistoryOperation } from './HistoryTimelineBar';
import { CadViewport } from '@/components/viewport/CadViewport';
import { SubShapeRaycaster } from './SubShapeRaycaster';
import { StlMesh } from '@/components/viewport/StlMesh';
import { Loader2, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface ManualCadWorkspaceProps {
  sessionId: string;
  initialStlUrl?: string | null;
  initialStepUrl?: string | null;
  onProceedToCam?: () => void;
  onSwitchStage?: (stage: 'cad' | 'manual_cad' | 'cam') => void;
}

export function ManualCadWorkspace({
  sessionId,
  initialStlUrl,
  initialStepUrl,
  onProceedToCam,
  onSwitchStage
}: ManualCadWorkspaceProps) {
  const [activeRevision, setActiveRevision] = useState<string>('rev_000');
  const [activeTool, setActiveTool] = useState<CADToolType>('select');
  const [selectedEntity, setSelectedEntity] = useState<any | null>(null);
  const [params, setParams] = useState<Record<string, any>>({ radius: 2.0, distance: 1.0, diameter: 6.0, depth: 10.0, width: 20.0, height: 15.0 });
  const [topology, setTopology] = useState<any | null>(null);
  const [history, setHistory] = useState<HistoryOperation[]>([]);
  const [previewResult, setPreviewResult] = useState<any | null>(null);
  const [isPreviewActive, setIsPreviewActive] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [stlUrl, setStlUrl] = useState<string | null>(initialStlUrl || null);

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

  // Handle entity selection (simulate or pick from face/edge map)
  const handleSelectTopologyEntity = (entity: any) => {
    setSelectedEntity(entity);
    setIsPreviewActive(false);
    setPreviewResult(null);
    if (entity.entity_type === 'edge') {
      setActiveTool('fillet');
    } else if (entity.entity_type === 'face' && entity.surface_type === 'plane') {
      setActiveTool('hole');
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
  const handleCancelPreview = () => {
    setIsPreviewActive(false);
    setPreviewResult(null);
    setStlUrl(`/api/cad/modify/file/${sessionId}/revisions/${activeRevision}.stl`);
    toast.info('Preview discarded');
  };

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

  return (
    <div className="flex h-full w-full relative bg-background text-foreground select-none overflow-hidden">
      {/* Center + Left Viewport Column */}
      <div className="flex-1 flex flex-col h-full relative overflow-hidden">
        {/* Top Viewport Header */}
        <div className="h-14 px-4 flex items-center justify-between border-b border-border/50 bg-background/50 dark:bg-background/20 backdrop-blur-md z-10 shrink-0">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 font-mono text-xs">
              <span className="text-muted-foreground font-semibold">STAGE:</span>
              <span className="font-bold text-primary px-2 py-0.5 rounded-md bg-primary/10 border border-primary/20">
                MANUAL CAD REFINEMENT
              </span>
            </div>
          </div>
        </div>

        {/* 3D Viewport Center */}
        <div className="flex-1 h-full w-full relative">
          {/* Left Floating Toolbar */}
          <div className="absolute left-4 top-4 z-20 w-52">
            <ManualCadToolbar
              activeTool={activeTool}
              setActiveTool={setActiveTool}
              selectedEntity={selectedEntity}
            />
          </div>

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
            onDownloadStl={() => {}}
            onDownloadStep={() => {}}
            onDownloadDxf={() => {}}
            workflowStage="manual_cad"
          >
            {stlUrl && <StlMesh url={stlUrl} />}
            <SubShapeRaycaster
              topology={topology}
              selectedEntity={selectedEntity}
              onSelectEntity={handleSelectTopologyEntity}
            />
          </CadViewport>

          {/* Quick Sub-shape Selection List Overlay */}
          {topology && topology.faces && Object.keys(topology.faces).length > 0 && (
            <div className="absolute left-4 bottom-4 z-30 flex items-center gap-2 bg-[#09090b]/90 px-3.5 py-2 rounded-xl border border-white/10 backdrop-blur-xl shadow-2xl max-w-xl overflow-x-auto custom-scrollbar">
              <div className="flex items-center gap-1.5 shrink-0 pr-1 border-r border-white/10">
                <span className="text-[10px] font-mono text-muted-foreground font-bold uppercase tracking-wider">Topology</span>
                <span className="text-[9px] font-bold px-1.5 py-0.2 rounded bg-blue-500/20 text-blue-400">
                  {Object.keys(topology.faces).length}F
                </span>
                <span className="text-[9px] font-bold px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-400">
                  {Object.keys(topology.edges || {}).length}E
                </span>
              </div>
              <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar scroll-smooth py-0.5">
                {Object.keys(topology.faces).map((fKey) => (
                  <button
                    key={fKey}
                    onClick={() => handleSelectTopologyEntity(topology.faces[fKey])}
                    className={`text-[10px] font-mono px-2.5 py-1 rounded-md transition-all cursor-pointer shrink-0 ${
                      selectedEntity?.transient_id === fKey
                        ? 'bg-blue-600 text-white font-bold shadow-md shadow-blue-600/30 ring-1 ring-blue-400'
                        : 'bg-white/5 hover:bg-white/10 text-muted-foreground hover:text-foreground border border-white/5'
                    }`}
                  >
                    {fKey}
                  </button>
                ))}
                {Object.keys(topology.edges || {}).map((eKey) => (
                  <button
                    key={eKey}
                    onClick={() => handleSelectTopologyEntity(topology.edges[eKey])}
                    className={`text-[10px] font-mono px-2.5 py-1 rounded-md transition-all cursor-pointer shrink-0 ${
                      selectedEntity?.transient_id === eKey
                        ? 'bg-amber-500 text-white font-bold shadow-md shadow-amber-500/30 ring-1 ring-amber-300'
                        : 'bg-white/5 hover:bg-white/10 text-muted-foreground hover:text-foreground border border-white/5'
                    }`}
                  >
                    {eKey}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Bottom Timeline Bar */}
        <div className="shrink-0 z-10 border-t border-border/50">
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
          />
        </div>
      </div>

      {/* Right Properties Panel with Stable Stage Switcher Header */}
      <div className="w-[30%] min-w-[320px] max-w-[420px] h-full shrink-0 z-20 flex flex-col border-l border-border/50 bg-card/40 backdrop-blur-md">
        {/* Segmented Control Header - 100% Identical to AI CAD & CAM SETUP */}
        <div className="flex h-14 shrink-0 items-center justify-center px-4 border-b border-border/50 bg-background/50 dark:bg-background/20 backdrop-blur-md">
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

        {/* Scrollable Topology Properties */}
        <div className="flex-1 overflow-y-auto">
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
          />
        </div>
      </div>
    </div>
  );
}
