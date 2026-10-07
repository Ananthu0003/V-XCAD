'use client';

import React, { useState, useEffect } from 'react';
import {
  Eye,
  Check,
  X,
  AlertTriangle,
  Loader2,
  Activity,
  ChevronDown,
  ChevronRight,
  Search,
  CircleDot,
  Square,
  Layers,
  CornerDownRight,
  Scissors,
  Ruler,
  type LucideIcon,
} from 'lucide-react';
import { CADToolType } from './ManualCadToolbar';
import { SectionLabel, Divider, PropRow } from './shared';
import { FilletForm } from './forms/FilletForm';
import { ChamferForm } from './forms/ChamferForm';
import { HoleForm } from './forms/HoleForm';
import { PocketForm } from './forms/PocketForm';
import { PadForm } from './forms/PadForm';

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
  onSelectTopologyEntity?: (entity: any) => void;
  onSelectTool?: (tool: CADToolType) => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function humanFaceType(entity: any): string {
  if (!entity) return '';
  if (entity.entity_type === 'body') {
    return '3D Solid Model (Sub-shape)';
  }
  if (entity.entity_type === 'edge') {
    const t = entity.curve_type || 'edge';
    return t.charAt(0).toUpperCase() + t.slice(1) + ' edge';
  }
  const st = entity.surface_type || '';
  const map: Record<string, string> = {
    plane: 'Planar face',
    cylinder: 'Cylindrical face',
    cone: 'Conical face',
    sphere: 'Spherical face',
    torus: 'Toroidal face',
    bspline: 'B-spline face',
  };
  return map[st] || (st ? st.charAt(0).toUpperCase() + st.slice(1) + ' face' : 'Face');
}

function normalLabel(n: number[]): string {
  if (!n) return '';
  const labels = ['+X', '-X', '+Y', '-Y', '+Z', '-Z'];
  const axes = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
  let best = 0, bestDot = -2;
  axes.forEach(([ax, ay, az], i) => {
    const dot = ax*n[0] + ay*n[1] + az*n[2];
    if (dot > bestDot) { bestDot = dot; best = i; }
  });
  return bestDot > 0.9 ? labels[best] : `[${n.map(v => v.toFixed(2)).join(', ')}]`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Other actions catalog
// ─────────────────────────────────────────────────────────────────────────────

const FACE_ACTIONS: Array<{ id: CADToolType; label: string; icon: LucideIcon }> = [
  { id: 'hole', label: 'Hole', icon: CircleDot },
  { id: 'pocket', label: 'Pocket', icon: Square },
  { id: 'pad', label: 'Pad', icon: Layers },
  { id: 'measure', label: 'Measure', icon: Ruler },
];

const EDGE_ACTIONS: Array<{ id: CADToolType; label: string; icon: LucideIcon }> = [
  { id: 'fillet', label: 'Fillet', icon: CornerDownRight },
  { id: 'chamfer', label: 'Chamfer', icon: Scissors },
  { id: 'measure', label: 'Measure', icon: Ruler },
];

// ─────────────────────────────────────────────────────────────────────────────
// Main panel
// ─────────────────────────────────────────────────────────────────────────────

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
}: TopologyPropertiesPanelProps) {
  const [activeTab, setActiveTab] = useState<'selection' | 'base'>('selection');
  const [moreExpanded, setMoreExpanded] = useState(false);
  const [topologyExpanded, setTopologyExpanded] = useState(false);
  const [topoSearch, setTopoSearch] = useState('');
  const [livePreview, setLivePreview] = useState(false);

  const handleParamChange = (key: string, val: any) => {
    setParams(prev => ({ ...prev, [key]: val }));
  };

  const e = selectedEntity;
  const isBody = e?.entity_type === 'body';
  const isFace = e?.entity_type === 'face';
  const isEdge = e?.entity_type === 'edge';
  const isPlanar = isFace && e?.surface_type === 'plane';
  const isCylinder = isFace && e?.surface_type === 'cylinder';
  const hasOp = activeTool !== 'select' && activeTool !== 'measure';

  // Debounced live preview when enabled
  useEffect(() => {
    if (!livePreview || !e || !hasOp || isLoading) return;
    const timer = setTimeout(() => {
      onPreview();
    }, 600);
    return () => clearTimeout(timer);
  }, [livePreview, params, e, activeTool]);

  // Topology entities
  const allFaces = topology ? Object.values(topology.faces || {}) as any[] : [];
  const allEdges = topology ? Object.values(topology.edges || {}) as any[] : [];
  const filteredFaces = topoSearch
    ? allFaces.filter((f: any) => f.transient_id?.toLowerCase().includes(topoSearch.toLowerCase()) || f.surface_type?.toLowerCase().includes(topoSearch.toLowerCase()))
    : allFaces;
  const filteredEdges = topoSearch
    ? allEdges.filter((ed: any) => ed.transient_id?.toLowerCase().includes(topoSearch.toLowerCase()) || ed.curve_type?.toLowerCase().includes(topoSearch.toLowerCase()))
    : allEdges;

  const applyLabel = activeTool === 'select' || activeTool === 'measure'
    ? 'Apply'
    : `Apply ${activeTool}`;

  const normalStr = e?.normal ? normalLabel(e.normal) : null;

  // Secondary actions grid: 2x2
  const candidateActions = isFace ? FACE_ACTIONS : isEdge ? EDGE_ACTIONS : FACE_ACTIONS;
  const otherOps = candidateActions.filter(a => a.id !== activeTool);

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100%',
      background: 'var(--mcad-panel)', overflow: 'hidden',
      fontFamily: 'var(--font-sans)',
    }}>
      {/* ─── Two Tabs ─── */}
      <div style={{
        display: 'flex', borderBottom: '1px solid var(--mcad-border)',
        paddingLeft: 12, paddingRight: 12, paddingTop: 4, flexShrink: 0,
      }}>
        {(['selection', 'base'] as const).map(tab => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            style={{
              padding: '8px 12px',
              borderBottom: activeTab === tab ? '2px solid var(--mcad-teal)' : '2px solid transparent',
              color: activeTab === tab ? 'var(--mcad-text-primary)' : 'var(--mcad-text-muted)',
              background: 'transparent', border: 'none', cursor: 'pointer',
              fontSize: 12, fontFamily: 'var(--font-sans)',
              fontWeight: activeTab === tab ? 600 : 400,
              transition: 'color 0.15s, border-color 0.15s',
            }}
          >
            {tab === 'selection' ? 'Selection' : 'Base parameters'}
          </button>
        ))}
      </div>

      {/* Tab: Base parameters */}
      {activeTab === 'base' && (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ textAlign: 'center', color: 'var(--mcad-text-muted)', fontSize: 13, fontFamily: 'var(--font-sans)' }}>
            <p style={{ marginBottom: 4, fontWeight: 500, color: 'var(--mcad-text-secondary)' }}>Base parameters</p>
            <p style={{ fontSize: 11, color: 'var(--mcad-text-muted)' }}>Coming soon</p>
          </div>
        </div>
      )}

      {/* Tab: Selection */}
      {activeTab === 'selection' && (
        <div style={{
          flex: 1, overflowY: 'auto', padding: '12px 14px',
          display: 'flex', flexDirection: 'column', gap: 0,
        }}>

          {/* ─── A. Header ─── */}
          {e ? (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--mcad-text-primary)', fontFamily: 'var(--font-sans)' }}>
                  {humanFaceType(e)}
                </span>
                <span style={{
                  fontFamily: 'var(--font-mono)', fontSize: 11,
                  padding: '2px 8px', borderRadius: 999,
                  background: 'var(--mcad-teal-tint)', color: 'var(--mcad-teal)',
                  border: '1px solid rgba(45,212,191,0.3)',
                }}>
                  {e.transient_id}
                </span>
              </div>

              {/* Three compact rows */}
              <div style={{
                background: 'var(--mcad-input)', border: '1px solid var(--mcad-border-ctrl)',
                borderRadius: 8, padding: '6px 10px', marginBottom: 4,
              }}>
                {isBody && (
                  <>
                    <PropRow label="Volume" value={`${e.volume_mm3 != null ? e.volume_mm3.toFixed(1) : '—'} mm³`} />
                    {(() => {
                      const bbox = e.bounding_box;
                      if (bbox?.min && bbox?.max) {
                        const dx = bbox.max[0] - bbox.min[0];
                        const dy = bbox.max[1] - bbox.min[1];
                        const dz = bbox.max[2] - bbox.min[2];
                        return (
                          <PropRow
                            label="Bounding Box"
                            value={`${dx.toFixed(1)} × ${dy.toFixed(1)} × ${dz.toFixed(1)} mm`}
                          />
                        );
                      }
                      return null;
                    })()}
                    <PropRow label="Topology" value={`${e.face_count || 0} faces · ${e.edge_count || 0} edges`} />
                    <PropRow label="Status" value={e.is_valid ? 'Valid B-Rep Solid' : 'Check Geometry'} />
                  </>
                )}

                {isFace && (
                  <>
                    <PropRow label="Area" value={`${e.area != null ? e.area.toFixed(1) : '—'} mm²`} />
                    <PropRow label="Normal" value={normalStr || '—'} />
                    {isPlanar && (
                      <PropRow
                        label="Height"
                        value={e.height != null ? `${e.height.toFixed(1)} mm` : e.centroid?.[2] != null ? `Z ${e.centroid[2].toFixed(1)} mm` : '—'}
                      />
                    )}
                    {isCylinder && (
                      <PropRow label="Radius" value={`R${e.radius != null ? e.radius.toFixed(2) : '—'} mm`} />
                    )}
                    {!isPlanar && !isCylinder && (
                      <PropRow label="Type" value={e.surface_type || 'Custom'} />
                    )}
                  </>
                )}

                {isEdge && (
                  <>
                    <PropRow label="Length" value={`${e.length != null ? e.length.toFixed(1) : '—'} mm`} />
                    <PropRow label="Type" value={e.curve_type ? e.curve_type.charAt(0).toUpperCase() + e.curve_type.slice(1) : 'Line'} />
                    <PropRow label="Radius" value={e.radius != null ? `R${e.radius.toFixed(2)} mm` : '—'} />
                  </>
                )}

                {/* Collapsed "More" disclosure for centroid */}
                <button
                  type="button"
                  onClick={() => setMoreExpanded(p => !p)}
                  style={{
                    marginTop: 4, display: 'flex', alignItems: 'center', gap: 4,
                    fontSize: 11, color: 'var(--mcad-text-muted)', background: 'transparent',
                    border: 'none', cursor: 'pointer', padding: 0,
                    fontFamily: 'var(--font-sans)',
                  }}
                >
                  {moreExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                  More
                </button>
                {moreExpanded && e.centroid && (
                  <PropRow label="Centroid" value={`[${e.centroid.map((c: number) => c.toFixed(1)).join(', ')}]`} />
                )}
              </div>
            </>
          ) : (
            <div style={{
              padding: '16px 12px', textAlign: 'center',
              border: '1px dashed var(--mcad-border)', borderRadius: 8,
              marginBottom: 4,
            }}>
              <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--mcad-text-secondary)', marginBottom: 2, fontFamily: 'var(--font-sans)' }}>
                Nothing selected
              </div>
              <div style={{ fontSize: 12, color: 'var(--mcad-text-muted)', fontFamily: 'var(--font-sans)' }}>
                Click a face, edge, or 3D model.
              </div>
            </div>
          )}

          {/* ─── Body actions guidance ─── */}
          {isBody && (
            <>
              <Divider />
              <SectionLabel>3D MODEL SUB-SHAPE</SectionLabel>
              <div style={{
                background: 'var(--mcad-input)', border: '1px solid var(--mcad-border-ctrl)',
                borderRadius: 8, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8,
              }}>
                <p style={{ fontSize: 11, color: 'var(--mcad-text-secondary)', margin: 0, lineHeight: 1.4 }}>
                  Solid sub-shape selected. Switch to <strong style={{ color: 'var(--mcad-text-primary)' }}>Face</strong> selection on the left to add Holes, Pockets, or Pads, or <strong style={{ color: 'var(--mcad-text-primary)' }}>Edge</strong> for Fillets and Chamfers.
                </p>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                  <button
                    type="button"
                    onClick={() => onSelectTool?.('select')}
                    style={{
                      ...actionBtnBase,
                      height: 28,
                      fontSize: 11,
                      background: 'var(--mcad-panel)',
                      border: '1px solid var(--mcad-teal)',
                      color: 'var(--mcad-teal)',
                    }}
                  >
                    Select Face
                  </button>
                  <button
                    type="button"
                    onClick={() => onSelectTool?.('measure')}
                    style={{
                      ...actionBtnBase,
                      height: 28,
                      fontSize: 11,
                      background: 'var(--mcad-panel)',
                      border: '1px solid var(--mcad-border-ctrl)',
                      color: 'var(--mcad-text-secondary)',
                    }}
                  >
                    Measure
                  </button>
                </div>
              </div>
            </>
          )}

          {/* ─── B. Active operation form ─── */}
          {hasOp && (
            <>
              <Divider />
              <SectionLabel>{activeTool.toUpperCase()}</SectionLabel>
              {activeTool === 'fillet'  && <FilletForm  params={params} onChange={handleParamChange} />}
              {activeTool === 'chamfer' && <ChamferForm params={params} onChange={handleParamChange} />}
              {activeTool === 'hole'    && <HoleForm    params={params} onChange={handleParamChange} />}
              {activeTool === 'pocket'  && <PocketForm  params={params} onChange={handleParamChange} />}
              {activeTool === 'pad'     && <PadForm     params={params} onChange={handleParamChange} />}
            </>
          )}

          {/* Measure tool info */}
          {activeTool === 'measure' && (
            <>
              <Divider />
              <SectionLabel>MEASURE</SectionLabel>
              <p style={{ fontSize: 12, color: 'var(--mcad-text-muted)', fontFamily: 'var(--font-sans)', margin: 0 }}>
                Select any face or edge to inspect dimensions in the panel.
              </p>
            </>
          )}

          {/* ─── C. Footer of the form ─── */}
          {hasOp && (
            <>
              <Divider />
              {/* Live preview checkbox row */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <label style={{
                  display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer',
                  fontSize: 12, fontFamily: 'var(--font-sans)', color: 'var(--mcad-text-secondary)',
                  userSelect: 'none',
                }}>
                  <input
                    type="checkbox"
                    checked={livePreview}
                    onChange={e2 => setLivePreview(e2.target.checked)}
                    style={{ accentColor: 'var(--mcad-teal)', cursor: 'pointer', width: 14, height: 14 }}
                  />
                  Live preview
                </label>
                {!livePreview && (
                  <button
                    type="button"
                    onClick={onPreview}
                    disabled={isLoading || !e}
                    style={{
                      height: 26, padding: '0 10px', borderRadius: 8,
                      background: 'var(--mcad-input)', border: '1px solid var(--mcad-teal)',
                      color: 'var(--mcad-teal)', fontSize: 11, fontFamily: 'var(--font-sans)',
                      cursor: (isLoading || !e) ? 'not-allowed' : 'pointer',
                      display: 'flex', alignItems: 'center', gap: 4,
                      opacity: (isLoading || !e) ? 0.45 : 1,
                    }}
                  >
                    {isLoading ? <Loader2 size={12} className="animate-spin" /> : <Eye size={12} />}
                    Preview
                  </button>
                )}
              </div>

              {/* Action buttons row: Cancel (flex 1) | Apply (flex 2) */}
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  onClick={isPreviewActive ? onCancelPreview : () => onSelectTool?.('select')}
                  disabled={isLoading}
                  style={{
                    ...actionBtnBase,
                    flex: 1,
                    background: 'var(--mcad-input)',
                    border: '1px solid var(--mcad-border-ctrl)',
                    color: 'var(--mcad-text-secondary)',
                  }}
                >
                  <X size={14} /> Cancel
                </button>
                <button
                  type="button"
                  onClick={onCommit}
                  disabled={isLoading || !e}
                  style={{
                    ...actionBtnBase,
                    flex: 2,
                    background: 'var(--mcad-teal)',
                    border: 'none',
                    color: '#04201c',
                    fontWeight: 600,
                    opacity: (isLoading || !e) ? 0.45 : 1,
                    cursor: (isLoading || !e) ? 'not-allowed' : 'pointer',
                  }}
                >
                  {isLoading ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                  {applyLabel}
                </button>
              </div>

              {/* Backend errors appear directly under this row in #f08a8a, 12px */}
              {errorDiagnostic && (
                <div style={{
                  marginTop: 8, padding: '8px 10px', borderRadius: 8,
                  background: 'rgba(240,138,138,0.08)', border: '1px solid rgba(240,138,138,0.3)',
                  fontSize: 12, color: 'var(--mcad-danger)', fontFamily: 'var(--font-sans)',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600, marginBottom: 2 }}>
                    <AlertTriangle size={13} />
                    {errorDiagnostic.code || 'Error'}
                  </div>
                  <p style={{ fontSize: 12, margin: 0, color: 'var(--mcad-danger)' }}>{errorDiagnostic.message}</p>
                </div>
              )}

              {/* B-Rep Validation info */}
              {validationReport?.is_valid && (
                <div style={{
                  marginTop: 8, padding: '6px 10px', borderRadius: 8,
                  background: 'var(--mcad-teal-tint)', border: '1px solid rgba(45,212,191,0.3)',
                  fontSize: 11, color: 'var(--mcad-teal)', display: 'flex', alignItems: 'center', gap: 6,
                }}>
                  <Activity size={12} />
                  <span style={{ fontFamily: 'var(--font-mono)' }}>
                    B-Rep Valid · {validationReport.volume_mm3?.toFixed(1)} mm³
                  </span>
                </div>
              )}
            </>
          )}

          {/* ─── D. Other actions on this face/edge ─── */}
          {e && otherOps.length > 0 && (
            <>
              <Divider />
              <SectionLabel>
                {isFace ? 'Other actions on this face' : isEdge ? 'Other actions on this edge' : 'Other actions'}
              </SectionLabel>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                {otherOps.slice(0, 4).map(op => {
                  const Icon = op.icon;
                  return (
                    <button
                      key={op.id}
                      type="button"
                      onClick={() => onSelectTool?.(op.id)}
                      style={{
                        ...actionBtnBase,
                        background: 'var(--mcad-input)', border: '1px solid var(--mcad-border-ctrl)',
                        color: 'var(--mcad-text-secondary)', fontSize: 11,
                        padding: '0 8px',
                      }}
                      title={`Switch to ${op.label}`}
                    >
                      <Icon size={13} /> {op.label}
                    </button>
                  );
                })}
              </div>
            </>
          )}

          {/* ─── E. Topology (collapsed by default) ─── */}
          {topology && (allFaces.length > 0 || allEdges.length > 0) && (
            <>
              <Divider />
              <button
                type="button"
                onClick={() => setTopologyExpanded(p => !p)}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  background: 'transparent', border: 'none', cursor: 'pointer',
                  color: 'var(--mcad-text-secondary)', width: '100%', padding: '2px 0',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <SectionLabel>Topology</SectionLabel>
                  <span style={{
                    fontSize: 11, fontFamily: 'var(--font-sans)', color: 'var(--mcad-text-muted)',
                    marginBottom: 6,
                  }}>
                    {allFaces.length} faces · {allEdges.length} edges
                  </span>
                </div>
                <div style={{ marginBottom: 6, color: 'var(--mcad-text-muted)' }}>
                  {topologyExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                </div>
              </button>

              {topologyExpanded && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
                  <div style={{ position: 'relative' }}>
                    <Search size={12} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--mcad-text-muted)', pointerEvents: 'none' }} />
                    <input
                      type="text"
                      placeholder="Search faces, edges…"
                      value={topoSearch}
                      onChange={e2 => setTopoSearch(e2.target.value)}
                      style={{
                        width: '100%', height: 28, paddingLeft: 26, paddingRight: 8,
                        background: 'var(--mcad-input)', border: '1px solid var(--mcad-border-ctrl)',
                        borderRadius: 8, fontSize: 11, fontFamily: 'var(--font-sans)',
                        color: 'var(--mcad-text-primary)', outline: 'none',
                      }}
                    />
                  </div>
                  <div style={{ maxHeight: 240, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
                    {filteredFaces.map((f: any) => {
                      const isSelected = selectedEntity?.transient_id === f.transient_id;
                      return (
                        <button
                          key={f.transient_id}
                          type="button"
                          onClick={() => onSelectTopologyEntity?.(f)}
                          style={{
                            ...topoRowStyle,
                            background: isSelected ? 'var(--mcad-teal-tint)' : 'transparent',
                            color: isSelected ? 'var(--mcad-teal)' : 'var(--mcad-text-secondary)',
                            border: `1px solid ${isSelected ? 'rgba(45,212,191,0.3)' : 'transparent'}`,
                          }}
                        >
                          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{f.transient_id}</span>
                          <span style={{ fontSize: 11, fontFamily: 'var(--font-sans)', color: 'var(--mcad-text-muted)' }}>{f.surface_type}</span>
                        </button>
                      );
                    })}
                    {filteredEdges.map((ed: any) => {
                      const isSelected = selectedEntity?.transient_id === ed.transient_id;
                      return (
                        <button
                          key={ed.transient_id}
                          type="button"
                          onClick={() => onSelectTopologyEntity?.(ed)}
                          style={{
                            ...topoRowStyle,
                            background: isSelected ? 'var(--mcad-teal-tint)' : 'transparent',
                            color: isSelected ? 'var(--mcad-teal)' : 'var(--mcad-text-secondary)',
                            border: `1px solid ${isSelected ? 'rgba(45,212,191,0.3)' : 'transparent'}`,
                          }}
                        >
                          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{ed.transient_id}</span>
                          <span style={{ fontSize: 11, fontFamily: 'var(--font-sans)', color: 'var(--mcad-text-muted)' }}>{ed.curve_type}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          )}

          {/* Bottom spacing for comfortable scrolling */}
          <div style={{ height: 12 }} />
        </div>
      )}
    </div>
  );
}

const actionBtnBase: React.CSSProperties = {
  height: 34, borderRadius: 8, display: 'flex', alignItems: 'center',
  justifyContent: 'center', gap: 6, fontSize: 12,
  fontFamily: 'var(--font-sans)', cursor: 'pointer', transition: 'opacity 0.15s',
};

const topoRowStyle: React.CSSProperties = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  padding: '4px 8px', borderRadius: 6, cursor: 'pointer',
  transition: 'background 0.12s', textAlign: 'left', width: '100%',
};
