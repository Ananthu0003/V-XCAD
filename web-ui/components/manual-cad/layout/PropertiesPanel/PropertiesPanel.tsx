'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { ChevronDown, ChevronRight, Search, Box } from 'lucide-react';
import { CADToolType } from '../../ManualCadToolbar';
import { PropRow } from '../../ui-kit';
import { getApplicableOperations } from '../../operations/capabilities';
import { getOperationDefinition } from '../../operations/registry';
import { TaskPanel } from '../../operations/TaskPanel';
import type { DetectedFeature } from '../../useDetectedFeatures';
import type { GeometryContext } from '../../operations/context';
import type { ModelParametersResponse } from '../../useModelParameters';
import { EntityInspector } from './EntityInspector';
import { DetectedFeaturesList } from './DetectedFeaturesList';
import { SubpartParamEditor } from './SubpartParamEditor';

export interface PropertiesPanelProps {
  selectedEntity: any | null;
  activeTool: CADToolType;
  params: Record<string, any>;
  setParams: React.Dispatch<React.SetStateAction<Record<string, any>>>;
  onPreview: () => void;
  onCancelPreview: () => void;
  onCommit: (overrideOpType?: CADToolType | 'edit_feature', overrideParams?: Record<string, any>) => void;
  isPreviewActive: boolean;
  isLoading: boolean;
  validationReport: any | null;
  errorDiagnostic: any | null;
  topology?: any | null;
  onSelectTopologyEntity?: (entity: any, multiSelect?: boolean) => void;
  onSelectTool?: (tool: CADToolType) => void;
  detectedFeatures?: DetectedFeature[];
  isLoadingFeatures?: boolean;
  onRefetchFeatures?: () => void;
  onHighlightFaces?: (faceIds: string[] | null) => void;
  selectionMode?: 'body' | 'feature' | 'face' | 'edge';
  ctx?: GeometryContext | null;
  modelParams?: ModelParametersResponse | null;
  isLoadingModelParams?: boolean;
  onRefetchModelParams?: () => void;
}

export function PropertiesPanel({
  selectedEntity,
  activeTool,
  params,
  setParams,
  onPreview,
  onCancelPreview,
  onCommit,
  isPreviewActive,
  isLoading,
  validationReport,
  errorDiagnostic,
  topology,
  onSelectTopologyEntity,
  onSelectTool,
  detectedFeatures = [],
  isLoadingFeatures = false,
  onRefetchFeatures,
  onHighlightFaces,
  selectionMode = 'body',
  ctx,
  modelParams,
  isLoadingModelParams = false,
  onRefetchModelParams,
}: PropertiesPanelProps) {
  const [topologyExpanded, setTopologyExpanded] = useState(false);
  const [topoSearch, setTopoSearch] = useState('');
  const [livePreview, setLivePreview] = useState(false);
  const lastPreviewHashRef = React.useRef<string>('');

  const handleParamChange = (key: string, val: any) => {
    setParams((prev) => ({ ...prev, [key]: val }));
  };

  const e = selectedEntity;
  const isFeature = e?.entity_type === 'feature';
  const hasOp = activeTool !== 'select' && activeTool !== 'measure';

  // Debounced live preview
  const paramsHash = useMemo(() => JSON.stringify(params), [params]);
  useEffect(() => {
    if (!livePreview || !e || !hasOp || isLoading) return;
    if (paramsHash === lastPreviewHashRef.current) return;
    const timer = setTimeout(() => {
      lastPreviewHashRef.current = paramsHash;
      onPreview();
    }, 600);
    return () => clearTimeout(timer);
  }, [livePreview, paramsHash, e?.transient_id, activeTool, hasOp, isLoading, onPreview]);

  // Topology lists
  const allFaces = useMemo(() => (topology ? Object.values(topology.faces || {}) as any[] : []), [topology]);
  const allEdges = useMemo(() => (topology ? Object.values(topology.edges || {}) as any[] : []), [topology]);
  const filteredFaces = topoSearch
    ? allFaces.filter(
        (f: any) =>
          f.transient_id?.toLowerCase().includes(topoSearch.toLowerCase()) ||
          f.surface_type?.toLowerCase().includes(topoSearch.toLowerCase())
      )
    : allFaces;

  const applicableOps = e ? getApplicableOperations(e).filter((opId) => opId !== activeTool) : [];

  const parentFeature = useMemo(() => {
    if (!e || e.entity_type !== 'face' || !e.transient_id) return null;
    return (detectedFeatures || []).find((df) => df?.face_ids?.includes(e.transient_id)) || null;
  }, [e, detectedFeatures]);

  const sameSizeCount = useMemo(() => {
    if (!isFeature || !e) return 0;
    const eParams = Array.isArray(e.params) ? e.params : [];
    const dia = eParams.find((p: any) => p?.key === 'diameter')?.value;
    const rad = eParams.find((p: any) => p?.key === 'radius')?.value;
    const dist = eParams.find((p: any) => p?.key === 'distance')?.value;
    return (detectedFeatures || []).filter((df) => {
      if (!df || df.kind !== e.kind) return false;
      const dfParams = Array.isArray(df.params) ? df.params : [];
      const dfDia = dfParams.find((p: any) => p?.key === 'diameter')?.value;
      const dfRad = dfParams.find((p: any) => p?.key === 'radius')?.value;
      const dfDist = dfParams.find((p: any) => p?.key === 'distance')?.value;
      return dfDia === dia && dfRad === rad && dfDist === dist;
    }).length;
  }, [isFeature, e, detectedFeatures]);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: 'var(--mcad-panel)',
        overflowY: 'auto',
        overflowX: 'hidden',
        fontFamily: 'var(--font-sans)',
      }}
    >
      {/* ─── Model specs block under header when nothing is selected ─── */}
      {!e && topology && (
        <div className="mcad-section">
          <div className="mcad-section-title">Model Specs</div>
          <div
            style={{
              background: 'var(--mcad-input)',
              border: '1px solid var(--mcad-border-ctrl)',
              borderRadius: 8,
              padding: '8px 10px',
            }}
          >
            {topology.volume_mm3 != null && (
              <PropRow label="Volume" value={`${topology.volume_mm3.toFixed(1)} mm³`} />
            )}
            {topology.bounding_box?.min && topology.bounding_box?.max && (
              <PropRow
                label="Bounding Box"
                value={`${Math.abs(topology.bounding_box.max[0] - topology.bounding_box.min[0]).toFixed(1)} × ${Math.abs(
                  topology.bounding_box.max[1] - topology.bounding_box.min[1]
                ).toFixed(1)} × ${Math.abs(topology.bounding_box.max[2] - topology.bounding_box.min[2]).toFixed(1)} mm`}
              />
            )}
            <PropRow label="Topology" value={`${allFaces.length} faces · ${allEdges.length} edges`} />
            <PropRow label="Status" value={topology.is_valid !== false ? 'Valid B-Rep Solid' : 'Check Geometry'} />
            <button
              type="button"
              className="mcad-btn mcad-btn--ghost"
              onClick={() => onSelectTopologyEntity?.({ entity_type: 'body' })}
              style={{
                marginTop: 8,
                width: '100%',
                fontSize: 11,
                gap: 6,
                padding: '4px 8px',
              }}
            >
              <Box size={12} />
              <span>Select 3D Solid Model</span>
            </button>
          </div>

          <div
            style={{
              marginTop: 10,
              padding: '12px 10px',
              textAlign: 'center',
              border: '1px dashed var(--mcad-border-ctrl)',
              borderRadius: 8,
              fontSize: 11,
              color: 'var(--mcad-text-muted)',
            }}
          >
            Nothing selected: click a face, edge, or feature in 3D.
          </div>
        </div>
      )}

      {/* ─── 1. SELECTION & ENTITY INSPECTOR ─── */}
      <EntityInspector
        entity={e}
        parentFeature={parentFeature}
        hasOp={hasOp}
        modelParams={modelParams}
        isLoadingModelParams={isLoadingModelParams}
        onSelectTopologyEntity={onSelectTopologyEntity}
        onSelectTool={onSelectTool}
        onCommit={onCommit}
      />

      {/* ─── 2. ACTIVE TOOL FORM (TaskPanel) ─── */}
      {hasOp && (
        <div className="mcad-section">
          <TaskPanel
            definition={getOperationDefinition(activeTool)}
            params={params}
            onChangeParam={handleParamChange}
            selectedEntity={selectedEntity}
            onPreview={onPreview}
            onCancelPreview={onCancelPreview}
            onCommit={onCommit}
            onClose={() => onSelectTool?.('select')}
            isPreviewActive={isPreviewActive}
            isLoading={isLoading}
            livePreview={livePreview}
            setLivePreview={setLivePreview}
            validationReport={validationReport}
            errorDiagnostic={errorDiagnostic}
            ctx={ctx}
          />
        </div>
      )}

      {/* ─── 3. DETECTED FEATURE PARAMETER FORM ─── */}
      {isFeature && e && !hasOp && (
        <SubpartParamEditor
          entity={e}
          params={params}
          setParams={setParams}
          livePreview={livePreview}
          setLivePreview={setLivePreview}
          isLoading={isLoading}
          sameSizeCount={sameSizeCount}
          detectedFeatures={detectedFeatures}
          onSelectTool={onSelectTool}
          onPreview={onPreview}
          onCancelPreview={onCancelPreview}
          onCommit={onCommit}
        />
      )}

      {/* ─── 4. DETECTED FEATURES SECTION ─── */}
      <DetectedFeaturesList
        detectedFeatures={detectedFeatures}
        isLoadingFeatures={isLoadingFeatures}
        selectedEntityId={e?.feature_id}
        onSelectTopologyEntity={onSelectTopologyEntity}
        onRefetchFeatures={onRefetchFeatures}
        onHighlightFaces={onHighlightFaces}
      />

      {/* ─── 5. RELEVANT ACTIONS SECTION ─── */}
      {applicableOps.length > 0 && !hasOp && !isFeature && (
        <div className="mcad-section">
          <div className="mcad-section-title">Actions</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            {applicableOps.map((opId) => {
              const def = getOperationDefinition(opId);
              const Icon = def.icon;
              return (
                <button
                  key={opId}
                  type="button"
                  onClick={() => onSelectTool?.(opId)}
                  className="mcad-btn"
                  style={{ height: 32, fontSize: 11, padding: '0 8px', justifyContent: 'flex-start' }}
                  title={def.label}
                >
                  <Icon size={13} style={{ color: 'var(--mcad-accent)', flexShrink: 0 }} />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {def.label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ─── 6. TOPOLOGY (Collapsed by default) ─── */}
      {topology && (allFaces.length > 0 || allEdges.length > 0) && (
        <div className="mcad-section">
          <button
            type="button"
            onClick={() => setTopologyExpanded((p) => !p)}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--mcad-text-secondary)',
              width: '100%',
              padding: 0,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div className="mcad-section-title" style={{ margin: 0 }}>
                Topology
              </div>
              <span style={{ fontSize: 11, color: 'var(--mcad-text-muted)' }}>
                {allFaces.length} faces · {allEdges.length} edges
              </span>
            </div>
            {topologyExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          </button>

          {topologyExpanded && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
              <div style={{ position: 'relative' }}>
                <Search
                  size={12}
                  style={{
                    position: 'absolute',
                    left: 8,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    color: 'var(--mcad-text-muted)',
                  }}
                />
                <input
                  type="text"
                  placeholder="Search faces, edges…"
                  value={topoSearch}
                  onChange={(e2) => setTopoSearch(e2.target.value)}
                  style={{
                    width: '100%',
                    height: 26,
                    paddingLeft: 24,
                    paddingRight: 8,
                    background: 'var(--mcad-input)',
                    border: '1px solid var(--mcad-border-ctrl)',
                    borderRadius: 6,
                    fontSize: 11,
                    color: 'var(--mcad-text-primary)',
                    outline: 'none',
                  }}
                />
              </div>

              <div style={{ maxHeight: 200, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
                {filteredFaces.map((f: any) => {
                  const isSelected = selectedEntity?.transient_id === f.transient_id;
                  return (
                    <button
                      key={f.transient_id}
                      type="button"
                      onClick={() => onSelectTopologyEntity?.(f)}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        padding: '4px 6px',
                        borderRadius: 5,
                        background: isSelected ? 'var(--mcad-accent-tint)' : 'transparent',
                        color: isSelected ? 'var(--mcad-accent)' : 'var(--mcad-text-secondary)',
                        border: 'none',
                        cursor: 'pointer',
                        fontSize: 11,
                      }}
                    >
                      <span style={{ fontFamily: 'var(--font-mono)' }}>{f.transient_id}</span>
                      <span style={{ color: 'var(--mcad-text-muted)' }}>{f.surface_type}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

