'use client';

import React from 'react';
import { 
  MousePointer, 
  CircleDot, 
  Layers, 
  Maximize2, 
  Ruler, 
  CornerDownRight, 
  Sparkles,
  Scissors
} from 'lucide-react';
import { cn } from '@/lib/utils';

export type CADToolType = 'select' | 'fillet' | 'chamfer' | 'hole' | 'pocket' | 'pad' | 'measure';

interface ManualCadToolbarProps {
  activeTool: CADToolType;
  setActiveTool: (tool: CADToolType) => void;
  selectedEntity: any | null;
}

export function ManualCadToolbar({
  activeTool,
  setActiveTool,
  selectedEntity
}: ManualCadToolbarProps) {
  const isFace = selectedEntity?.entity_type === 'face';
  const isPlanarFace = isFace && selectedEntity?.surface_type === 'plane';
  const isEdge = selectedEntity?.entity_type === 'edge';

  const tools = [
    {
      id: 'select',
      label: 'Select Sub-Shape',
      icon: MousePointer,
      enabled: true,
      hint: 'Click faces or edges in 3D viewport'
    },
    {
      id: 'fillet',
      label: 'Edge Fillet',
      icon: CornerDownRight,
      enabled: isEdge,
      hint: isEdge ? 'Add tangent radius blend' : 'Requires selected edge'
    },
    {
      id: 'chamfer',
      label: 'Edge Chamfer',
      icon: Scissors,
      enabled: isEdge,
      hint: isEdge ? 'Add beveled edge' : 'Requires selected edge'
    },
    {
      id: 'hole',
      label: 'Hole Wizard',
      icon: CircleDot,
      enabled: isPlanarFace,
      hint: isPlanarFace ? 'Drill bore / tapped hole' : 'Requires planar face'
    },
    {
      id: 'pocket',
      label: 'Pocket Cut',
      icon: Maximize2,
      enabled: isPlanarFace,
      hint: isPlanarFace ? 'Subtractive 2D extrusion' : 'Requires planar face'
    },
    {
      id: 'pad',
      label: 'Pad / Boss',
      icon: Layers,
      enabled: isPlanarFace,
      hint: isPlanarFace ? 'Additive 2D extrusion' : 'Requires planar face'
    },
    {
      id: 'measure',
      label: '3D Measure',
      icon: Ruler,
      enabled: true,
      hint: 'Measure distance, radius, or angles'
    },
  ];

  return (
    <div className="flex flex-col gap-1.5 p-2.5 bg-card/95 backdrop-blur-xl border border-border/80 rounded-2xl shadow-2xl min-w-[200px]">
      <div className="flex items-center justify-between px-2 py-1">
        <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground font-bold">
          CAD Tools
        </span>
        {activeTool !== 'select' && (
          <span className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-primary/20 text-primary font-bold uppercase">
            Active
          </span>
        )}
      </div>
      {tools.map((t) => {
        const Icon = t.icon;
        const isActive = activeTool === t.id;
        const isEnabled = t.enabled;

        return (
          <button
            key={t.id}
            onClick={() => isEnabled && setActiveTool(t.id as CADToolType)}
            disabled={!isEnabled}
            title={t.hint}
            className={cn(
              "flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium transition-all text-left",
              isActive 
                ? "bg-primary text-primary-foreground shadow-md font-bold scale-[1.02]" 
                : isEnabled 
                  ? "hover:bg-muted/80 text-foreground cursor-pointer" 
                  : "opacity-40 text-muted-foreground cursor-not-allowed"
            )}
          >
            <Icon className="size-4 shrink-0" />
            <span className="whitespace-nowrap flex-1">{t.label}</span>
          </button>
        );
      })}
    </div>
  );
}
