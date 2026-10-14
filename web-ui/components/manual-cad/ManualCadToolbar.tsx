'use client';

import React, { useEffect, useRef, useMemo } from 'react';
import {
  MousePointer2,
  CircleDot,
  Square,
  Layers,
  CornerDownRight,
  Scissors,
  Ruler,
  Move3d,
  RotateCw,
  Scaling,
  FlipHorizontal2,
  ArrowDownToLine,
  Shapes,
  SquareDashed,
  Expand,
  SquareSplitVertical,
  Grid3x3,
  Orbit,
  Wrench,
  Settings2,
  Trash2,
  type LucideIcon,
} from 'lucide-react';
import {
  isOperationApplicable,
  OPERATION_REQUIREMENTS,
} from './operations/capabilities';

export type CADToolType =
  | 'select' | 'fillet' | 'chamfer' | 'hole' | 'pocket' | 'pad' | 'measure' | 'edit_feature'
  // Body-level editing
  | 'move' | 'rotate' | 'scale' | 'mirror' | 'align'
  | 'primitive' | 'shell' | 'offset' | 'split'
  | 'linear_pattern' | 'polar_pattern' | 'heal'
  // New feature operations
  | 'delete_feature' | 'push_pull' | 'round_face_edges' | 'move_feature' | 'pattern_feature';

interface ManualCadToolbarProps {
  activeTool: CADToolType;
  setActiveTool: (tool: CADToolType) => void;
  selectedEntity: any | null;
  selectionMode?: 'body' | 'face' | 'edge';
  setSelectionMode?: (mode: 'body' | 'face' | 'edge') => void;
  /** Ref of the workspace container, so shortcuts are scoped to it */
  workspaceRef?: React.RefObject<HTMLElement | null>;
}

interface ToolDef {
  id: CADToolType;
  label: string;
  shortcut: string;
  icon: LucideIcon;
  needsEdge?: boolean;
  needsFace?: boolean;
  needsBody?: boolean;
}

/** Dynamic toolgroups per selection mode: 3D Model | Face | Edge | Feature */
function getToolGroupsForMode(mode: 'body' | 'face' | 'edge' | 'feature'): Array<{ label: string; tools: ToolDef[] }> {
  if (mode === 'body') {
    return [
      {
        label: 'Select',
        tools: [{ id: 'select', label: 'Select', shortcut: 'V', icon: MousePointer2 }],
      },
      {
        label: 'Transform',
        tools: [
          { id: 'move',   label: 'Move',         shortcut: 'G', icon: Move3d,          needsBody: true },
          { id: 'rotate', label: 'Rotate',       shortcut: 'R', icon: RotateCw,        needsBody: true },
          { id: 'scale',  label: 'Scale',        shortcut: 'S', icon: Scaling,         needsBody: true },
          { id: 'mirror', label: 'Mirror',       shortcut: 'M', icon: FlipHorizontal2, needsBody: true },
          { id: 'align',  label: 'Align to Bed', shortcut: 'A', icon: ArrowDownToLine, needsBody: true },
        ],
      },
      {
        label: 'Modify',
        tools: [
          { id: 'primitive', label: 'Add / Cut Shape',  shortcut: 'N', icon: Shapes,              needsBody: true },
          { id: 'shell',     label: 'Shell',           shortcut: 'T', icon: SquareDashed,         needsBody: true },
          { id: 'split',     label: 'Split by Plane',  shortcut: 'L', icon: SquareSplitVertical,  needsBody: true },
          { id: 'offset',    label: 'Offset',          shortcut: 'O', icon: Expand,               needsBody: true },
        ],
      },
      {
        label: 'Pattern & Clean',
        tools: [
          { id: 'linear_pattern', label: 'Linear Pattern', shortcut: 'Y', icon: Grid3x3, needsBody: true },
          { id: 'polar_pattern',  label: 'Polar Pattern',  shortcut: 'U', icon: Orbit,   needsBody: true },
          { id: 'heal',           label: 'Heal / Clean',   shortcut: 'K', icon: Wrench,  needsBody: true },
        ],
      },
      {
        label: 'Measure',
        tools: [{ id: 'measure', label: 'Measure', shortcut: 'D', icon: Ruler }],
      },
    ];
  }

  if (mode === 'face') {
    return [
      {
        label: 'Select',
        tools: [{ id: 'select', label: 'Select', shortcut: 'V', icon: MousePointer2 }],
      },
      {
        label: 'Features',
        tools: [
          { id: 'hole',      label: 'Hole Wizard',     shortcut: 'H', icon: CircleDot,       needsFace: true },
          { id: 'pocket',    label: 'Pocket Cut',      shortcut: 'P', icon: Square,          needsFace: true },
          { id: 'pad',       label: 'Pad / Boss',      shortcut: 'E', icon: Layers,          needsFace: true },
          { id: 'push_pull', label: 'Push / Pull Face', shortcut: 'Q', icon: ArrowDownToLine, needsFace: true },
        ],
      },
      {
        label: 'Face Edit',
        tools: [
          { id: 'round_face_edges', label: 'Round Face Edges', shortcut: 'F', icon: CornerDownRight,     needsFace: true },
          { id: 'shell',            label: 'Shell (Open Face)', shortcut: 'T', icon: SquareDashed,        needsFace: true },
          { id: 'split',            label: 'Split by Plane',   shortcut: 'L', icon: SquareSplitVertical, needsFace: true },
          { id: 'primitive',        label: 'Shape on Face',    shortcut: 'N', icon: Shapes,              needsFace: true },
          { id: 'align',            label: 'Align Face Down',  shortcut: 'A', icon: FlipHorizontal2,     needsFace: true },
        ],
      },
      {
        label: 'Feature Tool',
        tools: [
          { id: 'edit_feature',   label: 'Edit Feature',   shortcut: 'X', icon: Settings2 },
          { id: 'delete_feature', label: 'Delete Feature', shortcut: 'Del', icon: Trash2 },
        ],
      },
      {
        label: 'Measure',
        tools: [{ id: 'measure', label: 'Measure', shortcut: 'D', icon: Ruler }],
      },
    ];
  }

  if (mode === 'edge') {
    return [
      {
        label: 'Select',
        tools: [{ id: 'select', label: 'Select', shortcut: 'V', icon: MousePointer2 }],
      },
      {
        label: 'Edge Tools',
        tools: [
          { id: 'fillet',  label: 'Fillet Edge',  shortcut: 'F', icon: CornerDownRight, needsEdge: true },
          { id: 'chamfer', label: 'Chamfer Edge', shortcut: 'C', icon: Scissors,        needsEdge: true },
        ],
      },
      {
        label: 'Measure',
        tools: [{ id: 'measure', label: 'Measure', shortcut: 'D', icon: Ruler }],
      },
    ];
  }

  // Feature selection mode
  return [
    {
      label: 'Select',
      tools: [{ id: 'select', label: 'Select', shortcut: 'V', icon: MousePointer2 }],
    },
    {
      label: 'Feature Actions',
      tools: [
        { id: 'edit_feature',    label: 'Edit Parameters', shortcut: 'X',   icon: Settings2 },
        { id: 'delete_feature',  label: 'Delete Feature',  shortcut: 'Del', icon: Trash2 },
        { id: 'move_feature',    label: 'Move Feature',    shortcut: 'W',   icon: Move3d },
        { id: 'pattern_feature', label: 'Pattern Feature', shortcut: 'Y',   icon: Grid3x3 },
      ],
    },
    {
      label: 'Measure',
      tools: [{ id: 'measure', label: 'Measure', shortcut: 'D', icon: Ruler }],
    },
  ];
}

export function ManualCadToolbar({
  activeTool,
  setActiveTool,
  selectedEntity,
  selectionMode = 'face',
  setSelectionMode,
  workspaceRef,
}: ManualCadToolbarProps) {
  // Determine effective mode based on selected entity or selectionMode
  const effectiveMode: 'body' | 'face' | 'edge' | 'feature' = useMemo(() => {
    if (selectedEntity?.entity_type === 'feature') return 'feature';
    if (selectedEntity?.entity_type === 'body') return 'body';
    if (selectedEntity?.entity_type === 'edge') return 'edge';
    if (selectedEntity?.entity_type === 'face') return 'face';
    return selectionMode || 'face';
  }, [selectedEntity, selectionMode]);

  const toolGroups = useMemo(() => getToolGroupsForMode(effectiveMode), [effectiveMode]);

  // Determine per-tool enabled state: all tools relevant to current mode are enabled
  const isToolEnabled = (t: ToolDef) => {
    if (t.id === 'select' || t.id === 'measure') return true;
    if (effectiveMode === 'body') return true;
    if (effectiveMode === 'edge') return true;
    if (effectiveMode === 'feature') return true;
    if (!selectedEntity || selectedEntity.entity_type === 'face') return true;
    return isOperationApplicable(t.id, selectedEntity);
  };

  const getTooltip = (t: ToolDef) => {
    return `${t.label}  (${t.shortcut})`;
  };

  // Clicking a tool: activate
  const handleToolClick = (t: ToolDef) => {
    setActiveTool(t.id);
  };

  // Keyboard shortcuts – mapped to currently visible tools
  const shortcutMap = useRef<Record<string, ToolDef>>({});
  useEffect(() => {
    const map: Record<string, ToolDef> = {};
    toolGroups.forEach((g) => g.tools.forEach((t) => { map[t.shortcut.toLowerCase()] = t; }));
    shortcutMap.current = map;
  }, [toolGroups]);

  useEffect(() => {
    const el = workspaceRef?.current ?? document;
    const handler = (e: Event) => {
      const ke = e as KeyboardEvent;
      const tag = (ke.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (ke.ctrlKey || ke.altKey || ke.metaKey) return;
      const toolDef = shortcutMap.current[ke.key.toLowerCase()];
      if (toolDef) {
        handleToolClick(toolDef);
      }
    };
    el.addEventListener('keydown', handler);
    return () => el.removeEventListener('keydown', handler);
  }, [selectedEntity, workspaceRef, selectionMode, toolGroups]);

  const modeBadgeText = effectiveMode === 'body'
    ? '3D Model Tools'
    : effectiveMode === 'face'
    ? 'Face Tools'
    : effectiveMode === 'edge'
    ? 'Edge Tools'
    : 'Feature Tools';

  return (
    <nav
      aria-label="CAD Tools"
      className="mcad-rail flex flex-col items-stretch select-none"
      style={{ width: 112, padding: '10px 8px 14px 8px', gap: 0, overflow: 'visible' }}
    >
      {/* Top Mode Filter Switcher: 3D Model | Face | Edge */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 2,
          padding: 2.5,
          background: 'var(--mcad-input)',
          borderRadius: 8,
          marginBottom: 10,
          border: '1px solid var(--mcad-border-ctrl)',
        }}
      >
        <button
          type="button"
          onClick={() => setSelectionMode?.('body')}
          title="Filter to 3D Model tools"
          style={{
            fontSize: 10,
            fontWeight: 600,
            padding: '5px 0',
            borderRadius: 5,
            border: 'none',
            cursor: 'pointer',
            textAlign: 'center',
            background: effectiveMode === 'body' ? 'var(--mcad-accent)' : 'transparent',
            color: effectiveMode === 'body' ? '#fff' : 'var(--mcad-text-secondary)',
            transition: 'background 0.15s, color 0.15s',
            whiteSpace: 'nowrap',
          }}
        >
          Model
        </button>
        <button
          type="button"
          onClick={() => setSelectionMode?.('face')}
          title="Filter to Face tools"
          style={{
            fontSize: 10,
            fontWeight: 600,
            padding: '5px 0',
            borderRadius: 5,
            border: 'none',
            cursor: 'pointer',
            textAlign: 'center',
            background: effectiveMode === 'face' ? 'var(--mcad-accent)' : 'transparent',
            color: effectiveMode === 'face' ? '#fff' : 'var(--mcad-text-secondary)',
            transition: 'background 0.15s, color 0.15s',
            whiteSpace: 'nowrap',
          }}
        >
          Face
        </button>
        <button
          type="button"
          onClick={() => setSelectionMode?.('edge')}
          title="Filter to Edge tools"
          style={{
            fontSize: 10,
            fontWeight: 600,
            padding: '5px 0',
            borderRadius: 5,
            border: 'none',
            cursor: 'pointer',
            textAlign: 'center',
            background: effectiveMode === 'edge' ? 'var(--mcad-accent)' : 'transparent',
            color: effectiveMode === 'edge' ? '#fff' : 'var(--mcad-text-secondary)',
            transition: 'background 0.15s, color 0.15s',
            whiteSpace: 'nowrap',
          }}
        >
          Edge
        </button>
      </div>

      {/* Dynamic Mode Header */}
      <div
        style={{
          padding: '2px 0 8px 0',
          textAlign: 'center',
          borderBottom: '1px solid var(--mcad-border)',
          marginBottom: 10,
          userSelect: 'none',
        }}
      >
        <span
          style={{
            fontSize: 10.5,
            fontWeight: 700,
            letterSpacing: '0.07em',
            textTransform: 'uppercase',
            color: 'var(--mcad-accent)',
            display: 'block',
            lineHeight: 1.2,
          }}
        >
          {modeBadgeText}
        </span>
      </div>

      {toolGroups.map((group, gi) => (
        <React.Fragment key={group.label}>
          {gi > 0 && <div className="mcad-rail-sep" style={{ alignSelf: 'center', width: '80%', margin: '6px 0' }} aria-hidden />}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 40px)', gap: 6, justifyContent: 'center' }}>
            {group.tools.map((t) => {
              const Icon = t.icon;
              const isActive = activeTool === t.id;
              const enabled = isToolEnabled(t);
              const tooltip = getTooltip(t);
              return (
                <div key={t.id} className="relative group flex items-center justify-center">
                  <button
                    type="button"
                    className="mcad-tool"
                    style={{ margin: 0, width: 40, height: 40 }}
                    data-active={isActive}
                    data-enabled={enabled}
                    aria-label={tooltip}
                    aria-pressed={isActive}
                    onClick={() => handleToolClick(t)}
                  >
                    <Icon size={19} strokeWidth={1.75} />
                  </button>
                  <div role="tooltip" className="mcad-tip" style={{ zIndex: 100, fontSize: 11.5, padding: '6px 10px' }}>
                    <span>{enabled ? t.label : tooltip}</span>
                    {enabled && <span className="mcad-kbd" style={{ fontSize: 10 }}>{t.shortcut}</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </React.Fragment>
      ))}
    </nav>
  );
}
