'use client';

import React, { useState, useRef, useCallback } from 'react';
import { ManualCadToolbar, CADToolType } from './ManualCadToolbar';
import { TopologyPropertiesPanel } from './TopologyPropertiesPanel';
import { CadViewport } from '@/components/viewport/CadViewport';
import { SubShapeRaycaster } from './SubShapeRaycaster';
import { StlMesh, StlGeometryInfo } from '@/components/viewport/StlMesh';
import { ContextMenu } from './operations/ContextMenu';
import { isOperationApplicable } from './operations/capabilities';
import { useGeometryContext } from './operations/context';
import { useModelParameters } from './useModelParameters';
import { useDetectedFeatures } from './useDetectedFeatures';
import { StageSwitcher } from '@/components/workspace/StageSwitcher';
import {
  useManualCadSession,
  useManualCadSelection,
  useManualCadOperations,
  useManualCadKeyboard,
} from './core';
import { ViewportStatus, SelectionBar, EmptyModelPrompt } from './layout';

export interface ManualCadWorkspaceProps {
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
  onSwitchStage,
}: ManualCadWorkspaceProps) {
  const [geometryInfo, setGeometryInfo] = useState<StlGeometryInfo | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; entity: any } | null>(null);
  const workspaceRef = useRef<HTMLDivElement>(null);

  // 1. Session hook
  const {
    activeRevision,
    setActiveRevision,
    stlUrl,
    setStlUrl,
    topology,
    history,
    isLoading,
    setIsLoading,
    hasModel,
    fetchHistory,
    handleRollback,
    handleUndo,
    handleRedo,
    canUndo,
    canRedo,
  } = useManualCadSession({
    sessionId,
    initialStlUrl,
    initialStepUrl,
  });

  // 2. Detected features & Model parameters
  const {
    features: detectedFeatures,
    isLoading: isLoadingFeatures,
    refetch: refetchFeatures,
  } = useDetectedFeatures(sessionId, activeRevision);

  const {
    data: modelParams,
    isLoading: isLoadingModelParams,
    refetch: refetchModelParams,
  } = useModelParameters(sessionId, activeRevision);

  // 3. Selection hook
  const {
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
    handleSelectTopologyEntity: rawSelectEntity,
    handleDirectMeshClick: rawDirectMeshClick,
    handleDirectMeshDoubleClick,
  } = useManualCadSelection({
    topology,
    activeRevision,
    detectedFeatures,
  });

  // 4. Geometry context hook
  const { ctx: geometryContext } = useGeometryContext(sessionId, activeRevision, selectedEntity);

  // 5. Operations hook
  const {
    activeTool,
    setActiveTool,
    params,
    setParams,
    paramsByTool,
    previewResult,
    setPreviewResult,
    isPreviewActive,
    setIsPreviewActive,
    computeToolParams,
    handleUpdateParams,
    handleSetActiveTool,
    handlePreview,
    handleCancelPreview,
    handleCommit,
    handleDeleteOperation,
  } = useManualCadOperations({
    sessionId,
    activeRevision,
    selectedEntity,
    selectedEntities,
    topology,
    geometryContext,
    detectedFeatures,
    setActiveRevision,
    setStlUrl,
    setIsLoading,
    clearSelection,
    fetchHistory,
    refetchFeatures,
    refetchModelParams,
    setSelectionMode,
    createBodyEntity,
    setSelectedEntity,
    setSelectedEntities,
  });

  // Selection entity wrapper to coordinate tool params & features
  const handleSelectTopologyEntity = useCallback(
    (entity: any, multiSelect?: boolean) => {
      setIsPreviewActive(false);
      setPreviewResult(null);

      if (!entity) {
        rawSelectEntity(null);
        return;
      }

      if (entity.entity_type === 'feature') {
        rawSelectEntity(entity, false);
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
        return;
      }

      rawSelectEntity(entity, multiSelect);

      if (activeTool !== 'select' && activeTool !== 'measure') {
        if (!isOperationApplicable(activeTool, entity, geometryContext)) {
          setActiveTool('select');
        } else {
          const toolP = computeToolParams(activeTool, entity, geometryContext, paramsByTool[activeTool]);
          setParams(toolP);
        }
      }
    },
    [
      rawSelectEntity,
      activeTool,
      geometryContext,
      computeToolParams,
      paramsByTool,
      setActiveTool,
      setParams,
      setIsPreviewActive,
      setPreviewResult,
    ]
  );

  const handleDirectMeshClick = useCallback(
    (point: [number, number, number], normal?: [number, number, number]) => {
      rawDirectMeshClick(point, normal, activeTool);
    },
    [rawDirectMeshClick, activeTool]
  );

  // 6. Keyboard hook
  useManualCadKeyboard({
    contextMenu,
    setContextMenu,
    activeTool,
    setActiveTool,
    isPreviewActive,
    handleCancelPreview,
    selectedEntity,
    selectedEntities,
    detectedFeatures,
    handleCommit,
    canUndo,
    canRedo,
    handleUndo,
    handleRedo,
  });

  // File downloads
  const handleDownloadStl = useCallback(() => {
    if (stlUrl) {
      const a = document.createElement('a');
      a.href = stlUrl;
      a.download = `cad_${sessionId}.stl`;
      a.click();
    }
  }, [stlUrl, sessionId]);

  const handleDownloadStep = useCallback(() => {
    const target = initialStepUrl || `/api/outputs/cad_${sessionId}.step`;
    const a = document.createElement('a');
    a.href = target;
    a.download = `cad_${sessionId}.step`;
    a.click();
  }, [initialStepUrl, sessionId]);

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
            onDownloadStl={handleDownloadStl}
            onDownloadStep={handleDownloadStep}
            onDownloadDxf={() => {}}
            workflowStage="manual_cad"
            onClearSelection={() => {
              if (selectionMode !== 'body') {
                clearSelection();
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
              activeSessionId={sessionId}
              activeRevisionId={activeRevision}
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
          {!hasModel && <EmptyModelPrompt onSwitchStage={onSwitchStage} />}

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

        {/* 3. Floating Top Selection Bar */}
        <SelectionBar
          canUndo={canUndo}
          canRedo={canRedo}
          isLoading={isLoading}
          onUndo={handleUndo}
          onRedo={handleRedo}
          selectionMode={selectionMode}
          onSetSelectionMode={handleSetSelectionMode}
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
          onClearSelection={clearSelection}
          onDownloadStep={handleDownloadStep}
          onDownloadStl={handleDownloadStl}
        />

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
            {onSwitchStage && <StageSwitcher value="manual_cad" onChange={onSwitchStage} />}
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
              if (opId === 'delete_feature') {
                const ent = contextMenu.entity;
                if (ent?.entity_type === 'feature') {
                  handleCommit('delete_feature', { feature_id: ent.feature_id, face_ids: ent.face_ids });
                } else if (ent?.entity_type === 'body') {
                  handleCommit('delete_feature', { body: true });
                } else {
                  const parentFeat = detectedFeatures?.find((df) => df.face_ids?.includes(ent?.transient_id));
                  if (parentFeat && selectedEntities.length <= 1) {
                    handleCommit('delete_feature', {
                      feature_id: parentFeat.feature_id,
                      face_ids: parentFeat.face_ids,
                    });
                  } else {
                    const fids =
                      selectedEntities.length > 1
                        ? selectedEntities.map((e) => e.transient_id).filter(Boolean)
                        : ent?.transient_id
                        ? [ent.transient_id]
                        : [];
                    handleCommit('delete_feature', { face_ids: fids });
                  }
                }
              } else {
                handleSetActiveTool(opId);
              }
              setContextMenu(null);
            }}
            onClose={() => setContextMenu(null)}
          />
        )}
      </div>
    </div>
  );
}

export default ManualCadWorkspace;
