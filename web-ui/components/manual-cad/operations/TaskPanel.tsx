import React from 'react';
import {
  X,
  Check,
  Eye,
  Loader2,
  AlertTriangle,
  Activity,
} from 'lucide-react';
import type { OperationDefinition } from './registry';
import type { TopologyEntity } from './capabilities';
import { OperationForm } from './OperationForm';

export interface TaskPanelProps {
  definition: OperationDefinition;
  params: Record<string, unknown>;
  onChangeParam: (key: string, val: unknown) => void;
  selectedEntity: TopologyEntity | null;
  onPreview: () => void;
  onCancelPreview: () => void;
  onCommit: () => void;
  onClose: () => void;
  isPreviewActive: boolean;
  isLoading: boolean;
  livePreview: boolean;
  setLivePreview: (live: boolean) => void;
  validationReport?: { is_valid?: boolean; volume_mm3?: number } | null;
  errorDiagnostic?: { code?: string; message?: string } | null;
}

export function TaskPanel({
  definition,
  params,
  onChangeParam,
  selectedEntity,
  onPreview,
  onCancelPreview,
  onCommit,
  onClose,
  isPreviewActive,
  isLoading,
  livePreview,
  setLivePreview,
  validationReport,
  errorDiagnostic,
}: TaskPanelProps) {
  const Icon = definition.icon;

  // Validation: ensure numeric values are valid (> 0)
  const isFormValid = (): boolean => {
    if (!selectedEntity && definition.requiresSelection) return false;

    const getNum = (key: string, def: number) => {
      const val = params[key];
      return typeof val === 'number' ? val : def;
    };

    if (definition.id === 'hole') {
      if (getNum('diameter', 6) <= 0) return false;
      if (params.hole_type !== 'through') {
        if (getNum('depth', 10) <= 0) return false;
      }
    } else if (definition.id === 'pocket') {
      const profile = params.profile || 'rectangle';
      if (profile === 'rectangle') {
        if (getNum('width', 25) <= 0 || getNum('height', 18) <= 0) return false;
      } else if (profile === 'circle') {
        if (getNum('diameter', 25) <= 0) return false;
      } else if (profile === 'slot') {
        if (getNum('length', 35) <= 0 || getNum('width', 12) <= 0) return false;
      }
      if (getNum('depth', 6) <= 0) return false;
    } else if (definition.id === 'pad') {
      const profile = params.profile || 'rectangle';
      if (profile === 'rectangle') {
        if (getNum('width', 20) <= 0 || getNum('length', 20) <= 0) return false;
      } else if (profile === 'circle') {
        if (getNum('diameter', 20) <= 0) return false;
      }
      if (getNum('height', 6) <= 0) return false;
    } else if (definition.id === 'fillet') {
      if (getNum('radius', 2) <= 0) return false;
    } else if (definition.id === 'chamfer') {
      if (getNum('distance', 1) <= 0) return false;
    }

    return true;
  };

  const okDisabled = isLoading || !isFormValid();

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
        background: 'transparent',
        overflow: 'hidden',
      }}
    >
      {/* ─── 1. Title bar ─── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 0',
          borderBottom: '1px solid var(--mcad-border)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div
            style={{
              width: 24,
              height: 24,
              borderRadius: 6,
              background: 'var(--mcad-accent-tint)',
              color: 'var(--mcad-accent)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Icon size={14} strokeWidth={2} />
          </div>
          <span
            style={{
              fontSize: 12.5,
              fontWeight: 600,
              fontFamily: 'var(--font-sans)',
              color: 'var(--mcad-text-primary)',
            }}
          >
            {definition.label}
          </span>
        </div>

        <button
          type="button"
          onClick={onClose}
          aria-label="Close task panel"
          title="Close (Esc)"
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--mcad-text-muted)',
            cursor: 'pointer',
            padding: 4,
            borderRadius: 4,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <X size={15} />
        </button>
      </div>

      {/* ─── 2. Body: Generated Form ─── */}
      <div
        style={{
          padding: '12px',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}
      >
        <OperationForm
          definition={definition}
          values={params}
          onChange={onChangeParam}
          entity={selectedEntity}
        />
      </div>

      {/* ─── 3. Errors above footer ─── */}
      {errorDiagnostic && (
        <div
          style={{
            margin: '0 12px 10px 12px',
            padding: '8px 10px',
            borderRadius: 8,
            background: 'rgba(240,138,138,0.08)',
            border: '1px solid rgba(240,138,138,0.3)',
            fontSize: 12,
            color: 'var(--mcad-danger)',
            fontFamily: 'var(--font-sans)',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontWeight: 600,
              marginBottom: 2,
            }}
          >
            <AlertTriangle size={13} />
            {errorDiagnostic.code || 'Error'}
          </div>
          <p style={{ fontSize: 12, margin: 0, color: 'var(--mcad-danger)' }}>
            {errorDiagnostic.message}
          </p>
        </div>
      )}

      {/* B-Rep Validation info */}
      {validationReport?.is_valid && (
        <div
          style={{
            margin: '0 12px 10px 12px',
            padding: '6px 10px',
            borderRadius: 8,
            background: 'var(--mcad-accent-tint)',
            border: '1px solid var(--mcad-accent-line)',
            fontSize: 11,
            color: 'var(--mcad-accent)',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <Activity size={12} />
          <span style={{ fontFamily: 'var(--font-mono)' }}>
            B-Rep Valid · {validationReport.volume_mm3?.toFixed(1)} mm³
          </span>
        </div>
      )}

      {/* ─── 4. Footer ─── */}
      <div
        style={{
          padding: '12px 0 0 0',
          background: 'transparent',
          borderTop: '1px solid var(--mcad-border)',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}
      >
        {/* Live preview row (if previewable) */}
        {definition.previewable && (
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                cursor: 'pointer',
                fontSize: 12,
                fontFamily: 'var(--font-sans)',
                color: 'var(--mcad-text-secondary)',
                userSelect: 'none',
              }}
            >
              <input
                type="checkbox"
                checked={livePreview}
                onChange={(e) => setLivePreview(e.target.checked)}
                style={{
                  accentColor: 'var(--mcad-accent)',
                  cursor: 'pointer',
                  width: 14,
                  height: 14,
                }}
              />
              Live preview
            </label>

            {!livePreview && (
              <button
                type="button"
                className="mcad-btn mcad-btn--ghost"
                onClick={onPreview}
                disabled={isLoading || !selectedEntity}
              >
                {isLoading ? <Loader2 size={12} className="animate-spin" /> : <Eye size={12} />}
                Preview
              </button>
            )}
          </div>
        )}

        {/* Buttons: Cancel (secondary) | Apply (primary) */}
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            className="mcad-btn"
            style={{ flex: 1 }}
            onClick={isPreviewActive ? onCancelPreview : onClose}
            disabled={isLoading}
          >
            <X size={14} /> Cancel
          </button>

          <button
            type="button"
            className="mcad-btn mcad-btn--primary"
            style={{ flex: 2 }}
            onClick={onCommit}
            disabled={okDisabled}
          >
            {isLoading ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            Apply {definition.label}
          </button>
        </div>
      </div>
    </div>
  );
}
