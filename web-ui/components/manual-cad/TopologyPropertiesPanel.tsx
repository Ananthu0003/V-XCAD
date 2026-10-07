'use client';

import React, { useState, useEffect } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Search,
} from 'lucide-react';
import { CADToolType } from './ManualCadToolbar';
import { SectionLabel, Divider, PropRow } from './shared';
import {
  humanEntityLabel,
  getSelectionReadout,
  getApplicableOperations,
} from './operations/capabilities';
import { getOperationDefinition } from './operations/registry';
import { TaskPanel } from './operations/TaskPanel';

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
// (Helpers now provided by capabilities.ts and registry.ts)

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
  const hasOp = activeTool !== 'select' && activeTool !== 'measure';

  // Debounced live preview when enabled
  useEffect(() => {
    if (!livePreview || !e || !hasOp || isLoading) return;
    const timer = setTimeout(() => {
      onPreview();
    }, 600);
    return () => clearTimeout(timer);
  }, [livePreview, params, e, activeTool, hasOp, isLoading, onPreview]);

  // Topology entities
  const allFaces = topology ? Object.values(topology.faces || {}) as any[] : [];
  const allEdges = topology ? Object.values(topology.edges || {}) as any[] : [];
  const filteredFaces = topoSearch
    ? allFaces.filter((f: any) => f.transient_id?.toLowerCase().includes(topoSearch.toLowerCase()) || f.surface_type?.toLowerCase().includes(topoSearch.toLowerCase()))
    : allFaces;
  const filteredEdges = topoSearch
    ? allEdges.filter((ed: any) => ed.transient_id?.toLowerCase().includes(topoSearch.toLowerCase()) || ed.curve_type?.toLowerCase().includes(topoSearch.toLowerCase()))
    : allEdges;

  // Secondary actions: only applicable operations from capabilities matrix
  const applicableOps = e ? getApplicableOperations(e).filter(opId => opId !== activeTool) : [];

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
                  {humanEntityLabel(e)}
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

              {/* Selection readout adapted to class */}
              <div style={{
                background: 'var(--mcad-input)', border: '1px solid var(--mcad-border-ctrl)',
                borderRadius: 8, padding: '6px 10px', marginBottom: 4,
              }}>
                {getSelectionReadout(e).map((prop) => (
                  <PropRow key={prop.label} label={prop.label} value={prop.value} />
                ))}

                {/* Collapsed "More" disclosure for centroid */}
                {e.centroid && (
                  <>
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
                    {moreExpanded && (
                      <PropRow label="Centroid" value={`[${e.centroid.map((c: number) => c.toFixed(1)).join(', ')}]`} />
                    )}
                  </>
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

          {/* ─── B. Active operation task panel ─── */}
          {hasOp && (
            <>
              <Divider />
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
              />
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

          {/* ─── C. Other actions on this face/edge ─── */}
          {e && applicableOps.length > 0 && (
            <>
              <Divider />
              <SectionLabel>
                {isFace ? 'Other actions on this face' : isEdge ? 'Other actions on this edge' : 'Other actions'}
              </SectionLabel>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                {applicableOps.slice(0, 4).map((opId) => {
                  const def = getOperationDefinition(opId);
                  const Icon = def.icon;
                  return (
                    <button
                      key={opId}
                      type="button"
                      onClick={() => onSelectTool?.(opId)}
                      style={{
                        ...actionBtnBase,
                        background: 'var(--mcad-input)',
                        border: '1px solid var(--mcad-border-ctrl)',
                        color: 'var(--mcad-text-secondary)',
                        fontSize: 11,
                        padding: '0 8px',
                      }}
                      title={`Switch to ${def.label}`}
                    >
                      <Icon size={13} /> {def.label}
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
