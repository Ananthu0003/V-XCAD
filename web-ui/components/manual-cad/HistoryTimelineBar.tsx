'use client';

import React from 'react';
import { RotateCcw, RotateCw, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface HistoryOperation {
  operation_id: string;
  operation_type: string;
  source: 'ai_generated' | 'manual' | 'ai_assisted';
  input_revision: string;
  output_revision?: string;
  parameters: Record<string, any>;
  status: string;
}

interface HistoryTimelineBarProps {
  history: HistoryOperation[];
  activeRevision: string;
  onRollback: (revId: string) => void;
  onUndo: () => void;
  onRedo: () => void;
  onDeleteOperation?: (opId: string) => void;
  canUndo: boolean;
  canRedo: boolean;
  isRecomputing?: boolean;
  /** Optional preview pill data */
  previewLabel?: string;
}

/** Build the human-readable label for a timeline pill */
function buildPillLabel(op: HistoryOperation): string {
  const p = op.parameters || {};
  const base = op.input_revision === 'rev_000' && !op.output_revision;

  if (base || op.operation_type === 'boolean' || op.operation_type === 'base') {
    return 'Base';
  }

  switch (op.operation_type) {
    case 'fillet':  return `Fillet R${p.radius ?? 2}`;
    case 'chamfer': return `Chamfer ${p.distance ?? 1}mm`;
    case 'hole': {
      const ht = p.hole_type ? ` (${p.hole_type})` : '';
      return `Hole ⌀${p.diameter ?? 6} d${p.depth ?? '—'}${ht}`;
    }
    case 'pocket': {
      const w = p.width ?? p.diameter ?? '?';
      const h = p.height ?? p.length ?? '?';
      return `Pocket ${w}×${h} d${p.depth ?? '?'}`;
    }
    case 'pad': return `Pad +${p.height ?? p.length ?? '?'}mm`;
    default: return op.operation_type.charAt(0).toUpperCase() + op.operation_type.slice(1);
  }
}

export function HistoryTimelineBar({
  history,
  activeRevision,
  onRollback,
  onUndo,
  onRedo,
  onDeleteOperation,
  canUndo,
  canRedo,
  isRecomputing = false,
  previewLabel,
}: HistoryTimelineBarProps) {
  return (
    <div style={{
      height: 64,
      background: 'var(--mcad-timeline)',
      borderTop: '1px solid var(--mcad-border)',
      display: 'flex', alignItems: 'center',
      paddingLeft: 12, paddingRight: 12, gap: 0, flexShrink: 0,
      overflow: 'hidden',
    }}>
      {/* Undo / Redo */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 2, paddingRight: 12, borderRight: '1px solid var(--mcad-border)', flexShrink: 0 }}>
        <button
          type="button"
          onClick={onUndo}
          disabled={!canUndo || isRecomputing}
          title="Undo (Ctrl+Z)"
          style={undoRedoStyle(!canUndo || isRecomputing)}
        >
          <RotateCcw size={14} />
          <span style={{ fontSize: 11, fontFamily: 'var(--font-sans)' }}>Undo</span>
        </button>
        <button
          type="button"
          onClick={onRedo}
          disabled={!canRedo || isRecomputing}
          title="Redo (Ctrl+Y)"
          style={undoRedoStyle(!canRedo || isRecomputing)}
        >
          <RotateCw size={14} />
          <span style={{ fontSize: 11, fontFamily: 'var(--font-sans)' }}>Redo</span>
        </button>
      </div>

      {/* History pills */}
      <div style={{
        flex: 1, display: 'flex', alignItems: 'center', gap: 6,
        overflowX: 'auto', paddingLeft: 12, paddingRight: 4,
        scrollbarWidth: 'none',
      }}>
        {history.map((op, idx) => {
          const revId = op.output_revision || op.input_revision;
          const isActive = revId === activeRevision;
          const label = buildPillLabel(op);
          const isManual = op.source === 'manual';
          const hasFail = op.status === 'failed' || op.status === 'unresolved';

          return (
            <div
              key={op.operation_id || idx}
              style={{
                display: 'flex', alignItems: 'center', gap: 0,
                borderRadius: 999, flexShrink: 0,
                border: isActive
                  ? '1.5px solid var(--mcad-teal)'
                  : hasFail
                    ? '1.5px solid var(--mcad-amber)'
                    : '1px solid var(--mcad-border-ctrl)',
                background: isActive
                  ? 'var(--mcad-teal-tint)'
                  : hasFail
                    ? 'rgba(245,165,36,0.08)'
                    : 'var(--mcad-input)',
                transition: 'all 0.15s',
              }}
            >
              <button
                type="button"
                onClick={() => onRollback(revId)}
                title={`Switch to ${revId}`}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '4px 10px', background: 'transparent', border: 'none',
                  cursor: 'pointer', borderRadius: 999,
                }}
              >
                <span style={{
                  fontSize: 11,
                  fontFamily: 'var(--font-sans)',
                  fontWeight: isActive ? 600 : 400,
                  color: isActive
                    ? 'var(--mcad-teal)'
                    : hasFail
                      ? 'var(--mcad-amber)'
                      : 'var(--mcad-text-secondary)',
                  whiteSpace: 'nowrap',
                }}>
                  {label}
                </span>
                <span style={{
                  fontSize: 9, fontFamily: 'var(--font-mono)',
                  color: isActive ? 'rgba(45,212,191,0.6)' : 'var(--mcad-text-muted)',
                }}>
                  {revId}
                </span>
                {hasFail && (
                  <span style={{ fontSize: 9, color: 'var(--mcad-amber)', fontFamily: 'var(--font-sans)' }}>
                    · needs attention
                  </span>
                )}
              </button>

              {isManual && onDeleteOperation && (
                <button
                  type="button"
                  onClick={e => {
                    e.stopPropagation();
                    if (confirm(`Delete ${op.operation_type} (${op.operation_id}) and recompute?`)) {
                      onDeleteOperation(op.operation_id);
                    }
                  }}
                  style={{
                    background: 'transparent', border: 'none', cursor: 'pointer',
                    paddingRight: 8, paddingLeft: 0, display: 'flex', alignItems: 'center',
                    color: 'var(--mcad-text-muted)',
                  }}
                  title="Delete this operation"
                >
                  <Trash2 size={11} />
                </button>
              )}
            </div>
          );
        })}

        {/* Preview pill */}
        {previewLabel && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px',
            borderRadius: 999, flexShrink: 0,
            border: '1.5px dashed var(--mcad-teal)',
            background: 'var(--mcad-teal-tint)',
          }}>
            <span style={{ fontSize: 11, fontFamily: 'var(--font-sans)', color: 'var(--mcad-teal)', whiteSpace: 'nowrap' }}>
              {previewLabel} · preview
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function undoRedoStyle(disabled: boolean): React.CSSProperties {
  return {
    display: 'flex', alignItems: 'center', gap: 4,
    height: 30, padding: '0 10px', borderRadius: 8,
    background: 'transparent', border: 'none', cursor: disabled ? 'default' : 'pointer',
    color: disabled ? 'var(--mcad-text-muted)' : 'var(--mcad-text-secondary)',
    opacity: disabled ? 0.4 : 1,
    transition: 'color 0.15s, opacity 0.15s',
  };
}
