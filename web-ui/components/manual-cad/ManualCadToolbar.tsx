'use client';

import React, { useEffect, useRef } from 'react';
import {
  MousePointer2,
  CircleDot,
  Square,
  Box,
  Layers,
  CornerDownRight,
  Scissors,
  Ruler,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';

export type CADToolType = 'select' | 'fillet' | 'chamfer' | 'hole' | 'pocket' | 'pad' | 'measure' | 'edit_feature';

interface ManualCadToolbarProps {
  activeTool: CADToolType;
  setActiveTool: (tool: CADToolType) => void;
  selectedEntity: any | null;
  selectionMode?: 'body' | 'face' | 'edge';
  setSelectionMode?: (mode: 'body' | 'face' | 'edge') => void;
  /** Ref of the workspace container, so shortcuts are scoped to it */
  workspaceRef?: React.RefObject<HTMLElement | null>;
}

/** Groups: [Select] | [Hole, Pocket, Pad, Edit] | [Fillet, Chamfer] | [Measure] */
const TOOL_GROUPS: Array<{
  tools: Array<{
    id: CADToolType;
    label: string;
    shortcut: string;
    icon: LucideIcon;
    needsEdge?: boolean;   // true = only available in edge mode
    needsFace?: boolean;   // true = only available in face (planar) mode
  }>;
}> = [
  {
    tools: [
      { id: 'select',  label: 'Select',    shortcut: 'V', icon: MousePointer2 },
    ],
  },
  {
    tools: [
      { id: 'hole',    label: 'Hole Wizard', shortcut: 'H', icon: CircleDot,         needsFace: true },
      { id: 'pocket',  label: 'Pocket Cut',  shortcut: 'P', icon: Square,            needsFace: true },
      { id: 'pad',     label: 'Pad / Boss',  shortcut: 'E', icon: Layers,            needsFace: true },
      { id: 'edit_feature', label: 'Edit Feature', shortcut: 'X', icon: CircleDot, },
    ],
  },
  {
    tools: [
      { id: 'fillet',  label: 'Edge Fillet',  shortcut: 'F', icon: CornerDownRight,  needsEdge: true },
      { id: 'chamfer', label: 'Edge Chamfer', shortcut: 'C', icon: Scissors,         needsEdge: true },
    ],
  },
  {
    tools: [
      { id: 'measure', label: 'Measure',    shortcut: 'M', icon: Ruler },
    ],
  },
];

import {
  isOperationApplicable,
  OPERATION_REQUIREMENTS,
} from './operations/capabilities';
import { getOperationDefinition } from './operations/registry';

export function ManualCadToolbar({
  activeTool,
  setActiveTool,
  selectedEntity,
  selectionMode = 'face',
  setSelectionMode,
  workspaceRef,
}: ManualCadToolbarProps) {
  // Determine per-tool enabled state using the capability matrix
  const isToolEnabled = (t: typeof TOOL_GROUPS[0]['tools'][0]) => {
    return isOperationApplicable(t.id, selectedEntity);
  };

  const getTooltip = (t: typeof TOOL_GROUPS[0]['tools'][0]) => {
    const enabled = isOperationApplicable(t.id, selectedEntity);
    if (!enabled) {
      return OPERATION_REQUIREMENTS[t.id] || t.label;
    }
    return `${t.label}  (${t.shortcut})`;
  };

  // Clicking a tool: if enabled, activate; if dimmed, assist user by mode
  const handleToolClick = (t: typeof TOOL_GROUPS[0]['tools'][0]) => {
    const enabled = isOperationApplicable(t.id, selectedEntity);
    if (enabled) {
      setActiveTool(t.id);
      return;
    }

    if (t.needsEdge && selectedEntity?.entity_type !== 'edge') {
      setSelectionMode?.('edge');
      return;
    }
    if (t.needsFace && !(selectedEntity?.entity_type === 'face' && selectedEntity?.surface_type === 'plane')) {
      setSelectionMode?.('face');
      return;
    }
    setActiveTool(t.id);
  };

  // Keyboard shortcuts – scoped to workspace container, adhering to capability matrix
  const shortcutMap = useRef<Record<string, CADToolType>>({});
  useEffect(() => {
    const map: Record<string, CADToolType> = {};
    TOOL_GROUPS.forEach(g => g.tools.forEach(t => { map[t.shortcut.toLowerCase()] = t.id; }));
    shortcutMap.current = map;
  }, []);

  useEffect(() => {
    const el = workspaceRef?.current ?? document;
    const handler = (e: Event) => {
      const ke = e as KeyboardEvent;
      const tag = (ke.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const tool = shortcutMap.current[ke.key.toLowerCase()];
      if (tool) {
        const group = TOOL_GROUPS.flatMap(g => g.tools).find(t => t.id === tool);
        if (group) handleToolClick(group);
      }
    };
    el.addEventListener('keydown', handler);
    return () => el.removeEventListener('keydown', handler);
  }, [selectedEntity, workspaceRef]);

  return (
    <nav
      aria-label="CAD Tools"
      style={{ width: 56, minHeight: '100%', background: 'var(--mcad-panel)', borderRight: '1px solid var(--mcad-border)' }}
      className="flex flex-col items-center py-3 gap-0 shrink-0 select-none z-20"
    >
      {/* ─── Selection Scope: 3D Model vs Face ─── */}
      <div className="flex flex-col items-center w-full px-2 mb-2">
        <span
          style={{
            fontSize: 9,
            fontFamily: 'var(--font-sans)',
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            color: 'var(--mcad-text-muted)',
            fontWeight: 600,
            marginBottom: 4,
          }}
        >
          Select
        </span>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
            background: 'var(--mcad-input)',
            padding: 2,
            borderRadius: 8,
            border: '1px solid var(--mcad-border-ctrl)',
            width: 40,
          }}
        >
          {/* 3D Model / Sub-shape */}
          <div className="relative group">
            <button
              type="button"
              aria-label="Select 3D Model / Sub-shape"
              title="3D Model (Sub-shape)"
              onClick={() => setSelectionMode?.('body')}
              style={{
                width: 34,
                height: 28,
                borderRadius: 6,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: selectionMode === 'body' ? 'var(--mcad-segment-active)' : 'transparent',
                color: selectionMode === 'body' ? 'var(--mcad-teal)' : 'var(--mcad-text-muted)',
                border: 'none',
                cursor: 'pointer',
                transition: 'all 0.15s',
              }}
            >
              <Box size={16} strokeWidth={1.7} />
            </button>
            <div
              role="tooltip"
              style={{
                position: 'absolute',
                left: 44,
                top: '50%',
                transform: 'translateY(-50%)',
                background: 'var(--mcad-panel)',
                border: '1px solid var(--mcad-border)',
                borderRadius: 6,
                padding: '4px 8px',
                fontSize: 11,
                fontFamily: 'var(--font-sans)',
                color: 'var(--mcad-text-primary)',
                whiteSpace: 'nowrap',
                pointerEvents: 'none',
                zIndex: 50,
                boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
              }}
              className="hidden group-hover:block"
            >
              3D Model (Sub-shape)
            </div>
          </div>

          {/* Face */}
          <div className="relative group">
            <button
              type="button"
              aria-label="Select Face"
              title="Face (Surface)"
              onClick={() => setSelectionMode?.('face')}
              style={{
                width: 34,
                height: 28,
                borderRadius: 6,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: selectionMode === 'face' ? 'var(--mcad-segment-active)' : 'transparent',
                color: selectionMode === 'face' ? 'var(--mcad-teal)' : 'var(--mcad-text-muted)',
                border: 'none',
                cursor: 'pointer',
                transition: 'all 0.15s',
              }}
            >
              <Square size={16} strokeWidth={1.7} />
            </button>
            <div
              role="tooltip"
              style={{
                position: 'absolute',
                left: 44,
                top: '50%',
                transform: 'translateY(-50%)',
                background: 'var(--mcad-panel)',
                border: '1px solid var(--mcad-border)',
                borderRadius: 6,
                padding: '4px 8px',
                fontSize: 11,
                fontFamily: 'var(--font-sans)',
                color: 'var(--mcad-text-primary)',
                whiteSpace: 'nowrap',
                pointerEvents: 'none',
                zIndex: 50,
                boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
              }}
              className="hidden group-hover:block"
            >
              Face (Surface)
            </div>
          </div>
        </div>
      </div>

      <div
        style={{ width: 32, height: 1, background: 'var(--mcad-border)', margin: '4px 0 6px 0' }}
        aria-hidden
      />

      {TOOL_GROUPS.map((group, gi) => (
        <React.Fragment key={gi}>
          {gi > 0 && (
            <div
              style={{ width: 28, height: 1, background: 'var(--mcad-border)', margin: '6px 0' }}
              aria-hidden
            />
          )}
          {group.tools.map((t) => {
            const Icon = t.icon;
            const isActive = activeTool === t.id;
            const enabled = isToolEnabled(t);
            const tooltip = getTooltip(t);

            return (
              <div key={t.id} className="relative group">
                <button
                  type="button"
                  aria-label={tooltip}
                  title={tooltip}
                  onClick={() => handleToolClick(t)}
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 8,
                    margin: '2px 0',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    position: 'relative',
                    cursor: 'pointer',
                    border: 'none',
                    transition: 'background 0.15s, opacity 0.15s',
                    background: isActive
                      ? 'var(--mcad-teal-tint)'
                      : 'transparent',
                    opacity: enabled ? 1 : 0.38,
                  }}
                  onMouseEnter={e => {
                    if (!isActive) (e.currentTarget as HTMLElement).style.background = 'rgba(45,212,191,0.08)';
                  }}
                  onMouseLeave={e => {
                    if (!isActive) (e.currentTarget as HTMLElement).style.background = 'transparent';
                  }}
                >
                  <Icon
                    size={20}
                    strokeWidth={1.6}
                    style={{ color: isActive ? 'var(--mcad-teal)' : 'var(--mcad-text-secondary)' }}
                  />
                  {/* Shortcut badge */}
                  <span
                    style={{
                      position: 'absolute',
                      bottom: 3,
                      right: 3,
                      fontSize: 8,
                      fontFamily: 'var(--font-mono)',
                      color: isActive ? 'var(--mcad-teal)' : 'var(--mcad-text-muted)',
                      lineHeight: 1,
                      pointerEvents: 'none',
                    }}
                  >
                    {t.shortcut}
                  </span>
                </button>

                {/* Tooltip */}
                <div
                  role="tooltip"
                  style={{
                    position: 'absolute',
                    left: 48,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'var(--mcad-panel)',
                    border: '1px solid var(--mcad-border)',
                    borderRadius: 8,
                    padding: '4px 10px',
                    whiteSpace: 'nowrap',
                    fontSize: 12,
                    fontFamily: 'var(--font-sans)',
                    color: 'var(--mcad-text-primary)',
                    pointerEvents: 'none',
                    opacity: 0,
                    zIndex: 50,
                    boxShadow: '0 4px 12px rgba(0,0,0,0.35)',
                  }}
                  className="group-hover:opacity-100 transition-opacity duration-150"
                >
                  {tooltip}
                </div>
              </div>
            );
          })}
        </React.Fragment>
      ))}
    </nav>
  );
}
