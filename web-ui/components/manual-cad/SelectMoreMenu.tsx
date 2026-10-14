'use client';

import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check, MousePointerClick } from 'lucide-react';
import { TopologyEntity, getSelectionHelpers } from './operations/capabilities';

interface SelectMoreMenuProps {
  selectedEntity: TopologyEntity | null;
  sessionId: string;
  activeRevision: string;
  onApplySelection: (faceIds: string[]) => void;
  onClearSelection: () => void;
}

export function SelectMoreMenu({
  selectedEntity,
  sessionId,
  activeRevision,
  onApplySelection,
  onClearSelection,
}: SelectMoreMenuProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener('mousedown', handleClick);
    return () => window.removeEventListener('mousedown', handleClick);
  }, []);

  const helpers = getSelectionHelpers(selectedEntity);

  const handleSelectMore = async (mode: string) => {
    if (!sessionId || !selectedEntity) return;
    setLoading(true);
    try {
      const seedIds = selectedEntity.transient_id
        ? [selectedEntity.transient_id]
        : selectedEntity.face_ids || [];

      const res = await fetch('/api/cad/modify/select-more', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: sessionId,
          revision_id: activeRevision,
          seed_ids: seedIds,
          mode,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.transient_ids && Array.isArray(data.transient_ids)) {
          onApplySelection(data.transient_ids);
        }
      }
    } catch (err) {
      console.warn('Select more error:', err);
    } finally {
      setLoading(false);
      setOpen(false);
    }
  };

  if (!selectedEntity || helpers.length === 0) {
    return null;
  }

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        type="button"
        className="mcad-btn mcad-btn--ghost"
        onClick={() => setOpen((prev) => !prev)}
        style={{ height: 26, padding: '0 8px', fontSize: 11, gap: 4 }}
        title="Select more related geometry"
      >
        <MousePointerClick size={12} />
        <span>Select more</span>
        <ChevronDown size={11} />
      </button>

      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            left: 0,
            minWidth: 160,
            background: 'var(--mcad-panel)',
            border: '1px solid var(--mcad-border)',
            borderRadius: 8,
            boxShadow: 'var(--mcad-shadow-card)',
            padding: 4,
            zIndex: 100,
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
          }}
        >
          {helpers.map((h) => (
            <button
              key={h.id}
              type="button"
              disabled={loading}
              onClick={() => handleSelectMore(h.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '6px 8px',
                borderRadius: 6,
                background: 'transparent',
                border: 'none',
                color: 'var(--mcad-text-primary)',
                fontSize: 11,
                fontFamily: 'var(--font-sans)',
                cursor: 'pointer',
                textAlign: 'left',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'var(--mcad-input)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent';
              }}
            >
              <span>{h.label}</span>
            </button>
          ))}

          <div style={{ height: 1, background: 'var(--mcad-border)', margin: '4px 0' }} />

          <button
            type="button"
            disabled={loading}
            onClick={() => handleSelectMore('invert')}
            style={{
              display: 'flex',
              alignItems: 'center',
              padding: '6px 8px',
              borderRadius: 6,
              background: 'transparent',
              border: 'none',
              color: 'var(--mcad-text-secondary)',
              fontSize: 11,
              fontFamily: 'var(--font-sans)',
              cursor: 'pointer',
              textAlign: 'left',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--mcad-input)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
            }}
          >
            Invert selection
          </button>

          <button
            type="button"
            disabled={loading}
            onClick={() => {
              onClearSelection();
              setOpen(false);
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              padding: '6px 8px',
              borderRadius: 6,
              background: 'transparent',
              border: 'none',
              color: 'var(--mcad-text-muted)',
              fontSize: 11,
              fontFamily: 'var(--font-sans)',
              cursor: 'pointer',
              textAlign: 'left',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--mcad-input)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
            }}
          >
            Clear selection
          </button>
        </div>
      )}
    </div>
  );
}
