'use client';

import React, { useState, useRef, useEffect } from 'react';
import {
  Undo2,
  Redo2,
  Box,
  Sliders,
  Square,
  Slash,
  Maximize2,
  Home,
  Download,
  ChevronDown,
  Layers,
} from 'lucide-react';
import { SelectMoreMenu } from '../SelectMoreMenu';

export interface SelectionBarProps {
  canUndo: boolean;
  canRedo: boolean;
  isLoading: boolean;
  onUndo: () => void;
  onRedo: () => void;
  selectionMode: 'body' | 'feature' | 'face' | 'edge';
  onSetSelectionMode: (mode: 'body' | 'feature' | 'face' | 'edge') => void;
  selectedEntity: any | null;
  sessionId: string;
  activeRevision: string;
  onApplySelection: (ids: string[]) => void;
  onClearSelection: () => void;
  onDownloadStep: () => void;
  onDownloadStl: () => void;
}

export function SelectionBar({
  canUndo,
  canRedo,
  isLoading,
  onUndo,
  onRedo,
  selectionMode,
  onSetSelectionMode,
  selectedEntity,
  sessionId,
  activeRevision,
  onApplySelection,
  onClearSelection,
  onDownloadStep,
  onDownloadStl,
}: SelectionBarProps) {
  const [exportOpen, setExportOpen] = useState(false);
  const exportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (exportRef.current && !exportRef.current.contains(e.target as Node)) {
        setExportOpen(false);
      }
    };
    window.addEventListener('mousedown', handleClick);
    return () => window.removeEventListener('mousedown', handleClick);
  }, []);

  return (
    <div
      className="mcad-float"
      style={{
        position: 'absolute',
        top: 12,
        left: '50%',
        transform: 'translateX(-50%)',
        padding: 6,
        zIndex: 30,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        overflow: 'visible',
      }}
    >
      {/* Undo / Redo */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
        <button
          type="button"
          className="mcad-btn mcad-btn--ghost"
          onClick={onUndo}
          disabled={!canUndo || isLoading}
          title="Undo (Ctrl+Z)"
          aria-label="Undo"
          style={{
            height: 26,
            width: 26,
            padding: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            opacity: !canUndo || isLoading ? 0.35 : 1,
            cursor: !canUndo || isLoading ? 'not-allowed' : 'pointer',
          }}
        >
          <Undo2 size={13} />
        </button>
        <button
          type="button"
          className="mcad-btn mcad-btn--ghost"
          onClick={onRedo}
          disabled={!canRedo || isLoading}
          title="Redo (Ctrl+Y)"
          aria-label="Redo"
          style={{
            height: 26,
            width: 26,
            padding: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            opacity: !canRedo || isLoading ? 0.35 : 1,
            cursor: !canRedo || isLoading ? 'not-allowed' : 'pointer',
          }}
        >
          <Redo2 size={13} />
        </button>
      </div>

      <div style={{ width: 1, height: 18, background: 'var(--mcad-border)' }} />

      {/* Segmented control: Model | Feature | Face | Edge */}
      <div className="mcad-seg">
        <button
          type="button"
          data-on={selectionMode === 'body'}
          onClick={() => onSetSelectionMode('body')}
          title="Select 3D solid model"
          aria-label="Select 3D solid model"
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minWidth: 32, padding: '0 8px' }}
        >
          <Box size={13} strokeWidth={2} />
        </button>
        <button
          type="button"
          data-on={selectionMode === 'feature'}
          onClick={() => onSetSelectionMode('feature')}
          title="Select feature"
          aria-label="Select feature"
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minWidth: 32, padding: '0 8px' }}
        >
          <Sliders size={13} strokeWidth={2} />
        </button>
        <button
          type="button"
          data-on={selectionMode === 'face'}
          onClick={() => onSetSelectionMode('face')}
          title="Select face"
          aria-label="Select face"
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minWidth: 32, padding: '0 8px' }}
        >
          <Square size={12} strokeWidth={2} />
        </button>
        <button
          type="button"
          data-on={selectionMode === 'edge'}
          onClick={() => onSetSelectionMode('edge')}
          title="Select edge"
          aria-label="Select edge"
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minWidth: 32, padding: '0 8px' }}
        >
          <Slash size={13} strokeWidth={2.5} />
        </button>
      </div>

      <div style={{ width: 1, height: 18, background: 'var(--mcad-border)' }} />

      {/* Hint */}
      <span style={{ fontSize: 11, color: 'var(--mcad-text-muted)' }}>
        Shift: multi-select
      </span>

      <div style={{ width: 1, height: 18, background: 'var(--mcad-border)' }} />

      {/* Fit camera view */}
      <button
        type="button"
        className="mcad-btn mcad-btn--ghost"
        onClick={() => window.dispatchEvent(new CustomEvent('viewport-action', { detail: 'fit' }))}
        title="Fit model to view"
        style={{ height: 26, padding: '0 8px', fontSize: 11 }}
      >
        <Maximize2 size={12} />
        Fit
      </button>

      {/* Isometric home view */}
      <button
        type="button"
        className="mcad-btn mcad-btn--ghost"
        onClick={() => window.dispatchEvent(new CustomEvent('viewport-action', { detail: 'iso' }))}
        title="Isometric home view"
        style={{ height: 26, width: 26, padding: 0 }}
      >
        <Home size={12} />
      </button>

      {/* Select more dropdown menu */}
      <SelectMoreMenu
        selectedEntity={selectedEntity}
        sessionId={sessionId}
        activeRevision={activeRevision}
        onApplySelection={onApplySelection}
        onClearSelection={onClearSelection}
      />

      <div style={{ width: 1, height: 18, background: 'var(--mcad-border)' }} />

      {/* Export Dropdown */}
      <div className="relative" ref={exportRef}>
        <button
          type="button"
          className="mcad-btn mcad-btn--ghost"
          onClick={() => setExportOpen((prev) => !prev)}
          style={{
            height: 26,
            padding: '0 8px',
            fontSize: 11,
            gap: 4,
            color: 'var(--mcad-accent)',
            fontWeight: 600,
          }}
          title="Export 3D Model"
        >
          <Download size={12} />
          <span>Export</span>
          <ChevronDown size={11} className={`transition-transform ${exportOpen ? 'rotate-180' : ''}`} />
        </button>

        {exportOpen && (
          <div
            style={{
              position: 'absolute',
              top: 'calc(100% + 6px)',
              right: 0,
              minWidth: 160,
              background: 'var(--mcad-raised, #181c24)',
              border: '1px solid var(--mcad-border-ctrl, #2d3545)',
              borderRadius: 8,
              boxShadow: '0 8px 24px rgba(0, 0, 0, 0.45)',
              padding: 4,
              zIndex: 1000,
              display: 'flex',
              flexDirection: 'column',
              gap: 2,
            }}
          >
            <button
              type="button"
              onClick={() => {
                setExportOpen(false);
                onDownloadStep();
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '6px 8px',
                borderRadius: 6,
                background: 'transparent',
                border: 'none',
                color: 'var(--mcad-text-primary)',
                fontSize: 11,
                fontFamily: 'var(--font-sans)',
                cursor: 'pointer',
                textAlign: 'left',
                width: '100%',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'var(--mcad-input)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent';
              }}
            >
              <Box size={14} className="text-blue-400" />
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <span style={{ fontWeight: 600 }}>STEP Format</span>
                <span style={{ fontSize: 9.5, color: 'var(--mcad-text-muted)' }}>Solid CAD model</span>
              </div>
            </button>

            <button
              type="button"
              onClick={() => {
                setExportOpen(false);
                onDownloadStl();
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '6px 8px',
                borderRadius: 6,
                background: 'transparent',
                border: 'none',
                color: 'var(--mcad-text-primary)',
                fontSize: 11,
                fontFamily: 'var(--font-sans)',
                cursor: 'pointer',
                textAlign: 'left',
                width: '100%',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'var(--mcad-input)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent';
              }}
            >
              <Layers size={14} className="text-emerald-400" />
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <span style={{ fontWeight: 600 }}>STL Format</span>
                <span style={{ fontSize: 9.5, color: 'var(--mcad-text-muted)' }}>3D printing mesh</span>
              </div>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

