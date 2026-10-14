import React, { useEffect, useRef } from 'react';
import type { CADToolType } from '../ManualCadToolbar';
import { getOperationDefinition } from './registry';
import { getApplicableOperations, humanEntityLabel, TopologyEntity } from './capabilities';

export interface ContextMenuProps {
  x: number;
  y: number;
  entity: TopologyEntity;
  onSelectOperation: (op: CADToolType) => void;
  onClose: () => void;
}

export function ContextMenu({
  x,
  y,
  entity,
  onSelectOperation,
  onClose,
}: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on outside click or Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('mousedown', handleClickOutside);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('mousedown', handleClickOutside);
    };
  }, [onClose]);

  const applicableOps = getApplicableOperations(entity);
  if (applicableOps.length === 0) return null;

  // Keep menu within viewport boundaries
  const adjustedX = Math.min(x, window.innerWidth - 180);
  const adjustedY = Math.min(y, window.innerHeight - 200);

  return (
    <div
      ref={menuRef}
      style={{
        position: 'fixed',
        left: adjustedX,
        top: adjustedY,
        zIndex: 100,
        minWidth: 160,
        background: 'var(--mcad-panel)',
        border: '1px solid var(--mcad-border)',
        borderRadius: 8,
        boxShadow: '0 8px 24px rgba(0,0,0,0.45)',
        padding: '4px',
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        fontFamily: 'var(--font-sans)',
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* Header */}
      <div
        style={{
          padding: '4px 8px 6px 8px',
          borderBottom: '1px solid var(--mcad-border)',
          marginBottom: 2,
        }}
      >
        <span
          style={{
            fontSize: 10,
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            color: 'var(--mcad-text-muted)',
            fontWeight: 600,
            display: 'block',
          }}
        >
          {humanEntityLabel(entity)}
        </span>
        <span
          style={{
            fontSize: 11,
            fontFamily: 'var(--font-mono)',
            color: 'var(--mcad-teal)',
          }}
        >
          {entity.transient_id}
        </span>
      </div>

      {/* Operations List */}
      {applicableOps.map((opId) => {
        const opDef = getOperationDefinition(opId);
        const Icon = opDef.icon;
        return (
          <button
            key={opId}
            type="button"
            onClick={() => {
              onSelectOperation(opId);
              onClose();
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '6px 8px',
              borderRadius: 6,
              background: 'transparent',
              border: 'none',
              color: 'var(--mcad-text-primary)',
              fontSize: 12,
              fontFamily: 'var(--font-sans)',
              cursor: 'pointer',
              textAlign: 'left',
              transition: 'background 0.12s, color 0.12s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--mcad-input)';
              e.currentTarget.style.color = 'var(--mcad-teal)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
              e.currentTarget.style.color = 'var(--mcad-text-primary)';
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Icon size={14} />
              <span>{opDef.label}</span>
            </div>
            {opDef.shortcut && (
              <span
                style={{
                  fontSize: 10,
                  fontFamily: 'var(--font-mono)',
                  color: 'var(--mcad-text-muted)',
                }}
              >
                {opDef.shortcut}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
