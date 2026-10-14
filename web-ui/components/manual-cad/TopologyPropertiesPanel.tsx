'use client';

import React, { useState, useEffect, useMemo } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Search,
  RotateCw,
  CircleDot,
  Package,
  Square,
  RectangleHorizontal,
  CornerDownRight,
  Scissors,
  Sliders,
  Trash2,
  Copy,
  Eye,
  Check,
  X,
  Loader2,
  Box,
  Move3d,
  Scaling,
  Ruler,
} from 'lucide-react';
import { CADToolType } from './ManualCadToolbar';
import { PropRow } from './shared';
import {
  humanEntityLabel,
  getSelectionReadout,
  getApplicableOperations,
  TopologyEntity,
} from './operations/capabilities';
import { getOperationDefinition } from './operations/registry';
import { TaskPanel } from './operations/TaskPanel';
import type { DetectedFeature, FeatureParam } from './useDetectedFeatures';
import type { GeometryContext } from './operations/context';
import type { ModelParametersResponse } from './useModelParameters';

export interface TopologyPropertiesPanelProps {
  selectedEntity: any | null;
  activeTool: CADToolType;
  params: Record<string, any>;
  setParams: React.Dispatch<React.SetStateAction<Record<string, any>>>;
  onPreview: () => void;
  onCancelPreview: () => void;
  onCommit: () => void;
  isPreviewActive: boolean;
  isLoading: boolean;
  validationReport: any | null;
  errorDiagnostic: any | null;
  topology?: any | null;
  onSelectTopologyEntity?: (entity: any, multiSelect?: boolean) => void;
  onSelectTool?: (tool: CADToolType) => void;
  // Detected features
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

function getFeatureIcon(kind: string) {
  switch (kind) {
    case 'hole':
      return CircleDot;
    case 'boss':
      return Package;
    case 'pocket':
      return Square;
    case 'slot':
      return RectangleHorizontal;
    case 'fillet':
      return CornerDownRight;
    case 'chamfer':
      return Scissors;
    default:
      return Box;
  }
}

export function TopologyPropertiesPanel({
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
}: TopologyPropertiesPanelProps) {
  const [moreExpanded, setMoreExpanded] = useState(false);
  const [topologyExpanded, setTopologyExpanded] = useState(false);
  const [topoSearch, setTopoSearch] = useState('');
  const [featureSearch, setFeatureSearch] = useState('');
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({
    hole: true,
    boss: true,
    pocket: true,
    slot: true,
    fillet: true,
    chamfer: true,
  });
  const [livePreview, setLivePreview] = useState(false);
  const lastPreviewHashRef = React.useRef<string>('');

  const handleParamChange = (key: string, val: any) => {
    setParams((prev) => ({ ...prev, [key]: val }));
  };

  const e = selectedEntity;
  const isFeature = e?.entity_type === 'feature';
  const hasOp = activeTool !== 'select' && activeTool !== 'measure';

  // Debounced live preview when enabled - stable hash prevents infinite loop (A13)
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
  const filteredEdges = topoSearch
    ? allEdges.filter(
        (ed: any) =>
          ed.transient_id?.toLowerCase().includes(topoSearch.toLowerCase()) ||
          ed.curve_type?.toLowerCase().includes(topoSearch.toLowerCase())
      )
    : allEdges;

  // Applicable operations from matrix
  const applicableOps = e ? getApplicableOperations(e).filter((opId) => opId !== activeTool) : [];

  // Group detected features by kind
  const featureGroups = useMemo(() => {
    const groups: Record<string, DetectedFeature[]> = {
      hole: [],
      boss: [],
      pocket: [],
      slot: [],
      fillet: [],
      chamfer: [],
    };
    (detectedFeatures || []).forEach((df) => {
      if (!df) return;
      const featName = df.name || (df as any).part_name || (df as any).feature_id || 'Feature';
      const featKind = (df.kind || (df as any).feature_type || 'other').toLowerCase();
      if (featureSearch) {
        const q = featureSearch.toLowerCase();
        if (!featName.toLowerCase().includes(q) && !featKind.includes(q)) {
          return;
        }
      }
      if (!groups[featKind]) {
        groups[featKind] = [];
      }
      groups[featKind].push(df);
    });
    return groups;
  }, [detectedFeatures, featureSearch]);

  // If selected entity is a face, see if it is part of a detected feature
  const parentFeature = useMemo(() => {
    if (!e || e.entity_type !== 'face' || !e.transient_id) return null;
    return (detectedFeatures || []).find((df) => df?.face_ids?.includes(e.transient_id)) || null;
  }, [e, detectedFeatures]);

  // Batch count for same size features
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

      {/* ─── 1. SELECTION SECTION ─── */}
      {e && (
        <div className="mcad-section">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--mcad-text-primary)' }}>
              {humanEntityLabel(e)}
            </span>
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
                padding: '2px 8px',
                borderRadius: 999,
                background: 'var(--mcad-accent-tint)',
                color: 'var(--mcad-accent)',
                border: '1px solid var(--mcad-accent-line)',
              }}
            >
              {e.transient_id || e.feature_id}
            </span>
          </div>

          {/* Feature membership chip for a face */}
          {parentFeature && (
            <div style={{ marginBottom: 8 }}>
              <button
                type="button"
                onClick={() => onSelectTopologyEntity?.({ entity_type: 'feature', ...parentFeature })}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  width: '100%',
                  padding: '5px 8px',
                  borderRadius: 6,
                  background: 'rgba(76,123,244,0.12)',
                  border: '1px solid rgba(76,123,244,0.3)',
                  color: 'var(--mcad-accent)',
                  fontSize: 11,
                  fontFamily: 'var(--font-sans)',
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
                <Sliders size={12} />
                <span>Part of {parentFeature.name || (parentFeature as any).part_name || 'Feature'} · Click to edit feature</span>
              </button>
            </div>
          )}

          {/* Selection readout */}
          <div
            style={{
              background: 'var(--mcad-input)',
              border: '1px solid var(--mcad-border-ctrl)',
              borderRadius: 8,
              padding: '6px 10px',
            }}
          >
            {getSelectionReadout(e).map((prop) => (
              <PropRow key={prop.label} label={prop.label} value={prop.value} />
            ))}

            {e.centroid && (
              <>
                <button
                  type="button"
                  onClick={() => setMoreExpanded((p) => !p)}
                  style={{
                    marginTop: 4,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    fontSize: 11,
                    color: 'var(--mcad-text-muted)',
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    padding: 0,
                  }}
                >
                  {moreExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                  Coordinates
                </button>
                {moreExpanded && (
                  <PropRow label="Centroid" value={`[${e.centroid.map((c: number) => c.toFixed(1)).join(', ')}]`} />
                )}
              </>
            )}
          </div>

          {/* Extracted Base Primitive & Sub-Shape Dimensions (Part C) */}
          {e.entity_type === 'body' && (
            <div style={{ marginTop: 10 }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: 6,
                }}
              >
                <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', color: 'var(--mcad-text-muted)' }}>
                  Base Primitive Classification
                </span>
                {isLoadingModelParams ? (
                  <Loader2 size={11} className="animate-spin text-blue-400" />
                ) : (
                  <span
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 10,
                      padding: '1px 6px',
                      borderRadius: 4,
                      background: 'rgba(59,130,246,0.15)',
                      color: 'var(--mcad-accent)',
                      border: '1px solid rgba(59,130,246,0.3)',
                      textTransform: 'uppercase',
                    }}
                  >
                    {modelParams?.base_solid?.primitive_type || 'Solid'}
                  </span>
                )}
              </div>

              <div
                style={{
                  background: 'var(--mcad-input)',
                  border: '1px solid var(--mcad-border-ctrl)',
                  borderRadius: 8,
                  padding: '6px 10px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 3,
                }}
              >
                {modelParams?.base_solid?.description && (
                  <div style={{ fontSize: 11, color: 'var(--mcad-text-secondary)', marginBottom: 4 }}>
                    {modelParams.base_solid.description}
                  </div>
                )}

                {/* Dimensions readout for Box / Cylinder / etc. */}
                {modelParams?.base_solid?.dimensions && Object.entries(modelParams.base_solid.dimensions).length > 0 ? (
                  Object.entries(modelParams.base_solid.dimensions).map(([dimKey, dimVal]) => (
                    <PropRow
                      key={dimKey}
                      label={dimKey.charAt(0).toUpperCase() + dimKey.slice(1).replace('_', ' ')}
                      value={`${Number(dimVal).toFixed(1)} mm`}
                    />
                  ))
                ) : (
                  <>
                    {e.bounding_box?.min && e.bounding_box?.max && (
                      <>
                        <PropRow
                          label="Length (X)"
                          value={`${Math.abs(e.bounding_box.max[0] - e.bounding_box.min[0]).toFixed(1)} mm`}
                        />
                        <PropRow
                          label="Width (Y)"
                          value={`${Math.abs(e.bounding_box.max[1] - e.bounding_box.min[1]).toFixed(1)} mm`}
                        />
                        <PropRow
                          label="Height (Z)"
                          value={`${Math.abs(e.bounding_box.max[2] - e.bounding_box.min[2]).toFixed(1)} mm`}
                        />
                      </>
                    )}
                  </>
                )}

                {modelParams?.features && (
                  <PropRow label="Extracted Features" value={`${modelParams.features.length} detected`} />
                )}
              </div>

              {/* 3D Model Quick Action Bar: Move / Rotate / Scale / Edit Dimensions / Measure */}
              <div style={{ marginTop: 10 }}>
                <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', color: 'var(--mcad-text-muted)', display: 'block', marginBottom: 6 }}>
                  Quick Operations
                </span>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
                  <button
                    type="button"
                    onClick={() => onSelectTool?.('move')}
                    className="mcad-btn"
                    style={{ height: 30, fontSize: 11, padding: '0 6px', justifyContent: 'center', gap: 5 }}
                    title="Move solid model"
                  >
                    <Move3d size={12} style={{ color: 'var(--mcad-accent)' }} />
                    <span>Move</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onSelectTool?.('rotate')}
                    className="mcad-btn"
                    style={{ height: 30, fontSize: 11, padding: '0 6px', justifyContent: 'center', gap: 5 }}
                    title="Rotate solid model"
                  >
                    <RotateCw size={12} style={{ color: 'var(--mcad-accent)' }} />
                    <span>Rotate</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onSelectTool?.('scale')}
                    className="mcad-btn"
                    style={{ height: 30, fontSize: 11, padding: '0 6px', justifyContent: 'center', gap: 5 }}
                    title="Scale solid model"
                  >
                    <Scaling size={12} style={{ color: 'var(--mcad-accent)' }} />
                    <span>Scale</span>
                  </button>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginTop: 6 }}>
                  <button
                    type="button"
                    onClick={() => onSelectTool?.('edit_feature')}
                    className="mcad-btn mcad-btn--primary"
                    style={{ height: 30, fontSize: 11, padding: '0 8px', justifyContent: 'center', gap: 5 }}
                    title="Edit Dimensions (Length, Width, Height, Area)"
                  >
                    <Sliders size={12} />
                    <span>Edit Dimensions</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onSelectTool?.('measure')}
                    className="mcad-btn"
                    style={{ height: 30, fontSize: 11, padding: '0 8px', justifyContent: 'center', gap: 5 }}
                    title="Measure solid geometry"
                  >
                    <Ruler size={12} style={{ color: 'var(--mcad-accent)' }} />
                    <span>Measure</span>
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ─── 2. ACTIVE TOOL FORM (Flat TaskPanel) ─── */}
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

      {/* ─── 3. DETECTED FEATURE PARAMETER FORM (when a feature is selected) ─── */}
      {isFeature && e && !hasOp && (
        <div className="mcad-section">
          <div className="mcad-section-title">Edit Parameters</div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {Array.isArray(e.params) &&
              e.params.map((p: FeatureParam) => {
                const currentVal = params.changes?.[p.key] ?? p.value;
                const isModified = params.changes?.[p.key] !== undefined && params.changes[p.key] !== p.value;

                return (
                  <div
                    key={p.key}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 8,
                      minHeight: 28,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      {isModified && (
                        <div
                          style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--mcad-accent)' }}
                        />
                      )}
                      <span style={{ fontSize: 12, color: 'var(--mcad-text-secondary)' }}>{p.label}</span>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      {p.type === 'select' ? (
                        <select
                          disabled={!e.editable}
                          value={String(currentVal)}
                          onChange={(ev) => {
                            setParams((prev) => ({
                              ...prev,
                              feature_id: e.feature_id,
                              changes: { ...(prev.changes || {}), [p.key]: ev.target.value },
                            }));
                          }}
                          style={{
                            height: 26,
                            borderRadius: 6,
                            background: 'var(--mcad-input)',
                            border: '1px solid var(--mcad-border-ctrl)',
                            color: 'var(--mcad-text-primary)',
                            padding: '0 6px',
                            fontSize: 11,
                            outline: 'none',
                          }}
                        >
                          {(p.options || []).map((opt) => (
                            <option key={opt} value={opt}>
                              {opt}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <input
                            type="number"
                            disabled={!e.editable}
                            step={p.step ?? 0.5}
                            min={p.min ?? 0.1}
                            max={p.max ?? 500}
                            value={Number(currentVal)}
                            onChange={(ev) => {
                              const v = parseFloat(ev.target.value);
                              setParams((prev) => ({
                                ...prev,
                                feature_id: e.feature_id,
                                changes: { ...(prev.changes || {}), [p.key]: isNaN(v) ? p.value : v },
                              }));
                            }}
                            style={{
                              width: 72,
                              height: 26,
                              borderRadius: 6,
                              background: 'var(--mcad-input)',
                              border: '1px solid var(--mcad-border-ctrl)',
                              color: 'var(--mcad-text-primary)',
                              padding: '0 6px',
                              fontSize: 11,
                              fontFamily: 'var(--font-mono)',
                              textAlign: 'right',
                              outline: 'none',
                            }}
                          />
                          {p.unit && (
                            <span style={{ fontSize: 11, color: 'var(--mcad-text-muted)', width: 22 }}>
                              {p.unit}
                            </span>
                          )}
                        </div>
                      )}

                      {isModified && (
                        <button
                          type="button"
                          title="Reset to original"
                          onClick={() => {
                            setParams((prev) => {
                              const nextChanges = { ...(prev.changes || {}) };
                              delete nextChanges[p.key];
                              return { ...prev, changes: nextChanges };
                            });
                          }}
                          style={{
                            background: 'transparent',
                            border: 'none',
                            color: 'var(--mcad-text-muted)',
                            fontSize: 10,
                            cursor: 'pointer',
                            padding: '0 2px',
                          }}
                        >
                          Reset
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}

            {!e.editable && e.not_editable_reason && (
              <div
                style={{
                  fontSize: 11,
                  color: 'var(--mcad-warning, #f5a524)',
                  background: 'rgba(245,165,36,0.1)',
                  padding: '6px 8px',
                  borderRadius: 6,
                }}
              >
                {e.not_editable_reason}
              </div>
            )}
          </div>

          {/* Action buttons for feature edit */}
          <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  cursor: 'pointer',
                  fontSize: 11,
                  color: 'var(--mcad-text-secondary)',
                }}
              >
                <input
                  type="checkbox"
                  checked={livePreview}
                  onChange={(ev) => setLivePreview(ev.target.checked)}
                  style={{ accentColor: 'var(--mcad-accent)' }}
                />
                Live preview
              </label>

              {!livePreview && (
                <button
                  type="button"
                  className="mcad-btn mcad-btn--ghost"
                  onClick={() => {
                    onSelectTool?.('edit_feature');
                    onPreview();
                  }}
                  disabled={isLoading}
                >
                  <Eye size={12} /> Preview
                </button>
              )}
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                className="mcad-btn"
                style={{ flex: 1 }}
                onClick={() => {
                  setParams({});
                  onCancelPreview();
                }}
                disabled={isLoading}
              >
                <X size={13} /> Cancel
              </button>

              <button
                type="button"
                className="mcad-btn mcad-btn--primary"
                style={{ flex: 1 }}
                onClick={() => {
                  onSelectTool?.('edit_feature');
                  onCommit();
                }}
                disabled={isLoading}
              >
                {isLoading ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                Apply
              </button>
            </div>

            {/* Batch apply to all same size */}
            {sameSizeCount > 1 && (
              <button
                type="button"
                className="mcad-btn mcad-btn--ghost"
                onClick={() => {
                  const sameSizeIds = (detectedFeatures || [])
                    .filter((df) => df && df.kind === e.kind)
                    .map((df) => df.feature_id);
                  setParams((prev) => ({
                    ...prev,
                    batch_feature_ids: sameSizeIds,
                  }));
                  onSelectTool?.('edit_feature');
                  onCommit();
                }}
                style={{ width: '100%', gap: 6 }}
                title={`Apply modifications to all ${sameSizeCount} identical ${e.kind || 'feature'}s`}
              >
                <Copy size={12} /> Apply to all {sameSizeCount} {e.kind || 'feature'}s
              </button>
            )}

            {/* Delete feature */}
            <button
              type="button"
              className="mcad-btn mcad-btn--ghost"
              onClick={() => {
                setParams({ face_ids: e.face_ids });
                onSelectTool?.('delete_feature');
                onCommit();
              }}
              style={{ width: '100%', color: 'var(--mcad-danger, #ef4444)', borderColor: 'rgba(239,68,68,0.3)', gap: 6 }}
            >
              <Trash2 size={12} /> Delete feature
            </button>
          </div>
        </div>
      )}

      {/* ─── 4. DETECTED FEATURES SECTION (when 3D Model selected or in Model mode) ─── */}
      {(selectionMode === 'body' || isFeature || !e) && (
        <div className="mcad-section">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <div className="mcad-section-title" style={{ margin: 0 }}>
              Detected Features
            </div>
            {onRefetchFeatures && (
              <button
                type="button"
                onClick={onRefetchFeatures}
                disabled={isLoadingFeatures}
                title="Re-scan model for parametric features"
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--mcad-text-muted)',
                  cursor: 'pointer',
                  padding: 2,
                }}
              >
                <RotateCw size={12} className={isLoadingFeatures ? 'animate-spin' : ''} />
              </button>
            )}
          </div>

          {detectedFeatures.length > 12 && (
            <div style={{ position: 'relative', marginBottom: 8 }}>
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
                placeholder="Search features…"
                value={featureSearch}
                onChange={(ev) => setFeatureSearch(ev.target.value)}
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
          )}

          {isLoadingFeatures && detectedFeatures.length === 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  style={{
                    height: 28,
                    borderRadius: 6,
                    background: 'var(--mcad-input)',
                    opacity: 0.5,
                  }}
                />
              ))}
            </div>
          ) : detectedFeatures.length === 0 ? (
            <div style={{ fontSize: 11, color: 'var(--mcad-text-muted)', textAlign: 'center', padding: '12px 0' }}>
              No features detected on this revision.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {Object.entries(featureGroups).map(([kind, list]) => {
                if (list.length === 0) return null;
                const isOpen = openGroups[kind] ?? true;
                const KindIcon = getFeatureIcon(kind);

                return (
                  <div key={kind} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <button
                      type="button"
                      onClick={() =>
                        setOpenGroups((prev) => ({
                          ...prev,
                          [kind]: !isOpen,
                        }))
                      }
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '3px 4px',
                        background: 'transparent',
                        border: 'none',
                        color: 'var(--mcad-text-secondary)',
                        fontSize: 11,
                        fontWeight: 600,
                        textTransform: 'capitalize',
                        cursor: 'pointer',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <KindIcon size={12} style={{ color: 'var(--mcad-text-muted)' }} />
                        <span>
                          {kind}s ({list.length})
                        </span>
                      </div>
                      {isOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                    </button>

                    {isOpen && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, paddingLeft: 6 }}>
                        {list.map((df) => {
                          const isSelected = e?.feature_id === df.feature_id;

                          return (
                            <button
                              key={df.feature_id}
                              type="button"
                              onClick={() =>
                                onSelectTopologyEntity?.({
                                  entity_type: 'feature',
                                  ...df,
                                })
                              }
                              onMouseEnter={() => onHighlightFaces?.(df.face_ids)}
                              onMouseLeave={() => onHighlightFaces?.(null)}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                padding: '5px 8px',
                                borderRadius: 6,
                                background: isSelected ? 'var(--mcad-accent-tint)' : 'transparent',
                                border: `1px solid ${isSelected ? 'var(--mcad-accent-line)' : 'transparent'}`,
                                color: isSelected ? 'var(--mcad-accent)' : 'var(--mcad-text-primary)',
                                fontSize: 11,
                                textAlign: 'left',
                                cursor: 'pointer',
                                transition: 'background 0.1s',
                              }}
                            >
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6, overflow: 'hidden' }}>
                                <div
                                  style={{
                                    width: 4,
                                    height: 4,
                                    borderRadius: '50%',
                                    background: df.editable ? 'var(--mcad-accent)' : 'var(--mcad-text-muted)',
                                    flexShrink: 0,
                                  }}
                                />
                                <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                  {df.name || (df as any).part_name || (df as any).feature_id || 'Feature'}
                                </span>
                              </div>

                              <span
                                style={{
                                  fontSize: 10,
                                  color: 'var(--mcad-text-muted)',
                                  textTransform: 'lowercase',
                                  flexShrink: 0,
                                }}
                              >
                                {df.subtype}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

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
