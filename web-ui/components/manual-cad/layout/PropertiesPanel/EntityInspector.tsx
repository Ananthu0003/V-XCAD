'use client';

import React, { useState } from 'react';
import { ChevronDown, ChevronRight, Sliders, Trash2, Box, Move3d, RotateCw, Scaling, Ruler } from 'lucide-react';
import { PropRow } from '../../ui-kit';
import { humanEntityLabel, getSelectionReadout } from '../../operations/capabilities';
import type { CADToolType } from '../../ManualCadToolbar';
import type { DetectedFeature } from '../../useDetectedFeatures';
import type { ModelParametersResponse } from '../../useModelParameters';

interface EntityInspectorProps {
  entity: any | null;
  parentFeature: DetectedFeature | null;
  hasOp: boolean;
  modelParams?: ModelParametersResponse | null;
  isLoadingModelParams?: boolean;
  onSelectTopologyEntity?: (entity: any, multiSelect?: boolean) => void;
  onSelectTool?: (tool: CADToolType) => void;
  onCommit?: (overrideOpType?: CADToolType | 'edit_feature', overrideParams?: Record<string, any>) => void;
}

export function EntityInspector({
  entity: e,
  parentFeature,
  hasOp,
  modelParams,
  isLoadingModelParams = false,
  onSelectTopologyEntity,
  onSelectTool,
  onCommit,
}: EntityInspectorProps) {
  const [moreExpanded, setMoreExpanded] = useState(false);

  if (!e) return null;

  return (
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
        <div style={{ marginBottom: 8, display: 'flex', gap: 6 }}>
          <button
            type="button"
            onClick={() => onSelectTopologyEntity?.({ entity_type: 'feature', ...parentFeature })}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              flex: 1,
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
            <span>Part of {parentFeature.name || (parentFeature as any).part_name || 'Feature'} · Edit</span>
          </button>
          <button
            type="button"
            onClick={() => onCommit?.('delete_feature', { feature_id: parentFeature.feature_id, face_ids: parentFeature.face_ids })}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              padding: '5px 8px',
              borderRadius: 6,
              background: 'rgba(239,68,68,0.1)',
              border: '1px solid rgba(239,68,68,0.3)',
              color: 'var(--mcad-danger, #ef4444)',
              fontSize: 11,
              fontFamily: 'var(--font-sans)',
              cursor: 'pointer',
            }}
            title={`Delete ${parentFeature.name || 'Feature'}`}
          >
            <Trash2 size={12} />
            <span>Delete</span>
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

      {/* Quick Delete for selected Face */}
      {e.entity_type === 'face' && !hasOp && (
        <div style={{ marginTop: 8 }}>
          <button
            type="button"
            className="mcad-btn mcad-btn--ghost"
            onClick={() => {
              if (parentFeature) {
                onCommit?.('delete_feature', { feature_id: parentFeature.feature_id, face_ids: parentFeature.face_ids });
              } else {
                onCommit?.('delete_feature', { face_ids: [e.transient_id] });
              }
            }}
            style={{ width: '100%', fontSize: 11, color: 'var(--mcad-danger, #ef4444)', borderColor: 'rgba(239,68,68,0.3)', gap: 6 }}
            title={parentFeature ? `Delete entire ${parentFeature.name || parentFeature.kind}` : 'Delete this face or respective 3D subpart'}
          >
            <Trash2 size={12} />
            <span>{parentFeature ? `Delete ${parentFeature.name || parentFeature.kind}` : 'Delete Face / Subpart'}</span>
          </button>
        </div>
      )}

      {/* Extracted Base Primitive & Sub-Shape Dimensions */}
      {e.entity_type === 'body' && (
        <div style={{ marginTop: 10 }}>
          <div style={{ marginBottom: 10 }}>
            <button
              type="button"
              className="mcad-btn mcad-btn--ghost"
              onClick={() => onCommit?.('delete_feature', { body: true })}
              style={{ width: '100%', fontSize: 11, color: 'var(--mcad-danger, #ef4444)', borderColor: 'rgba(239,68,68,0.3)', gap: 6 }}
              title="Delete this 3D subpart"
            >
              <Trash2 size={12} />
              <span>Delete 3D Subpart</span>
            </button>
          </div>
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

          {/* 3D Model Quick Action Bar */}
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
  );
}

