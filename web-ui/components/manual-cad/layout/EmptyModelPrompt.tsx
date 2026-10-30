'use client';

import React from 'react';

export interface EmptyModelPromptProps {
  onSwitchStage?: (stage: 'cad' | 'manual_cad' | 'cam') => void;
}

export function EmptyModelPrompt({ onSwitchStage }: EmptyModelPromptProps) {
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10,
        background: 'rgba(10, 14, 20, 0.78)',
        backdropFilter: 'blur(6px)',
        padding: 24,
        textAlign: 'center',
      }}
    >
      <div
        style={{
          maxWidth: 420,
          padding: '28px 32px',
          borderRadius: 12,
          background: 'var(--mcad-panel, #121820)',
          border: '1px solid var(--mcad-border, #1f2937)',
          boxShadow: '0 12px 40px rgba(0,0,0,0.5)',
        }}
      >
        <div style={{ fontSize: 16, fontWeight: 600, color: '#f3f4f6', marginBottom: 8 }}>
          No CAD Model Loaded
        </div>
        <p style={{ fontSize: 13, color: '#9ca3af', lineHeight: 1.5, marginBottom: 20 }}>
          Direct parametric editing requires an active 3D model. Generate a design from a prompt or import a
          STEP model to begin editing.
        </p>
        {onSwitchStage && (
          <button
            type="button"
            onClick={() => onSwitchStage('cad')}
            style={{
              padding: '9px 20px',
              background: 'var(--mcad-accent, #3b82f6)',
              color: '#fff',
              borderRadius: 6,
              border: 'none',
              fontSize: 13,
              fontWeight: 500,
              cursor: 'pointer',
              transition: 'opacity 0.2s',
            }}
            onMouseOver={(e) => (e.currentTarget.style.opacity = '0.9')}
            onMouseOut={(e) => (e.currentTarget.style.opacity = '1')}
          >
            Return to CAD Design
          </button>
        )}
      </div>
    </div>
  );
}

