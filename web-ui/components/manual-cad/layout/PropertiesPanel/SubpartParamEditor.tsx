'use client';

import React from 'react';
import { Eye, Check, X, Loader2, Copy, Trash2 } from 'lucide-react';
import type { FeatureParam } from '../../useDetectedFeatures';
import type { CADToolType } from '../../ManualCadToolbar';

interface SubpartParamEditorProps {
  entity: any;
  params: Record<string, any>;
  setParams: React.Dispatch<React.SetStateAction<Record<string, any>>>;
  livePreview: boolean;
  setLivePreview: (v: boolean) => void;
  isLoading: boolean;
  sameSizeCount: number;
  detectedFeatures?: any[];
  onSelectTool?: (tool: CADToolType) => void;
  onPreview: () => void;
  onCancelPreview: () => void;
  onCommit: (overrideOpType?: CADToolType | 'edit_feature', overrideParams?: Record<string, any>) => void;
}

export function SubpartParamEditor({
  entity: e,
  params,
  setParams,
  livePreview,
  setLivePreview,
  isLoading,
  sameSizeCount,
  detectedFeatures = [],
  onSelectTool,
  onPreview,
  onCancelPreview,
  onCommit,
}: SubpartParamEditorProps) {
  if (!e || e.entity_type !== 'feature') return null;

  return (
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
            onCommit?.('delete_feature', { feature_id: e.feature_id, face_ids: e.face_ids });
          }}
          style={{ width: '100%', color: 'var(--mcad-danger, #ef4444)', borderColor: 'rgba(239,68,68,0.3)', gap: 6 }}
        >
          <Trash2 size={12} /> Delete feature
        </button>
      </div>
    </div>
  );
}

