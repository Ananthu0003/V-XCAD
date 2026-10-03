'use client';

import React from 'react';
import { 
  RotateCcw, 
  RotateCw, 
  Bot, 
  User, 
  Sparkles, 
  Trash2,
  CheckCircle2,
  AlertCircle
} from 'lucide-react';
import { Button } from '@/components/ui/button';
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
  isRecomputing = false
}: HistoryTimelineBarProps) {

  const formatParamSummary = (op: HistoryOperation) => {
    const p = op.parameters || {};
    if (op.operation_type === 'fillet') return `R${p.radius || 2}mm`;
    if (op.operation_type === 'chamfer') return `${p.distance || 1}mm`;
    if (op.operation_type === 'hole') return `Dia ${p.diameter || 6}mm`;
    if (op.operation_type === 'pocket') return `${p.width || 20}x${p.height || 15}mm`;
    if (op.operation_type === 'pad') return `+${p.height || 5}mm`;
    return '';
  };

  return (
    <div className="flex items-center justify-between px-4 py-2 bg-card/90 backdrop-blur-md border-t border-border/80 text-xs">
      {/* 1. Undo / Redo buttons */}
      <div className="flex items-center gap-1.5 shrink-0 pr-4 border-r border-border/60">
        <Button
          onClick={onUndo}
          disabled={!canUndo || isRecomputing}
          size="sm"
          variant="ghost"
          className="h-7 px-2 gap-1 text-muted-foreground hover:text-foreground cursor-pointer"
          title="Undo (Ctrl+Z)"
        >
          <RotateCcw className="size-3.5" />
          <span className="text-[11px]">Undo</span>
        </Button>
        <Button
          onClick={onRedo}
          disabled={!canRedo || isRecomputing}
          size="sm"
          variant="ghost"
          className="h-7 px-2 gap-1 text-muted-foreground hover:text-foreground cursor-pointer"
          title="Redo (Ctrl+Y)"
        >
          <RotateCw className="size-3.5" />
          <span className="text-[11px]">Redo</span>
        </Button>
      </div>

      {/* 2. Revision History Pills */}
      <div className="flex-1 flex items-center gap-2 overflow-x-auto px-4 scrollbar-thin">
        <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground font-semibold shrink-0">
          History:
        </span>

        {history.map((op, idx) => {
          const revId = op.output_revision || op.input_revision;
          const isActive = revId === activeRevision;
          const isAI = op.source === 'ai_generated';
          const isManual = op.source === 'manual';
          const summary = formatParamSummary(op);

          return (
            <div
              key={op.operation_id || idx}
              className={cn(
                "group flex items-center gap-1.5 pl-2.5 pr-1.5 py-1 rounded-full text-[11px] font-mono transition-all shrink-0 border",
                isActive
                  ? "bg-primary text-primary-foreground border-primary font-bold shadow-sm"
                  : "bg-muted/60 text-muted-foreground hover:bg-muted border-border/60 hover:text-foreground"
              )}
            >
              <button
                onClick={() => onRollback(revId)}
                className="flex items-center gap-1.5 cursor-pointer"
                title={`Switch to revision ${revId}`}
              >
                {isAI ? (
                  <Bot className="size-3 text-blue-400" />
                ) : isManual ? (
                  <User className="size-3 text-amber-400" />
                ) : (
                  <Sparkles className="size-3 text-purple-400" />
                )}
                <span>{op.operation_type.toUpperCase()}</span>
                {summary && <span className="opacity-80 text-[10px]">({summary})</span>}
                <span className="text-[9px] opacity-60">[{revId}]</span>
              </button>

              {/* Delete operation action for manual modifications */}
              {isManual && onDeleteOperation && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (confirm(`Delete operation ${op.operation_id} (${op.operation_type}) and recompute downstream features?`)) {
                      onDeleteOperation(op.operation_id);
                    }
                  }}
                  className={cn(
                    "p-0.5 rounded-full hover:bg-destructive/20 hover:text-destructive transition-colors cursor-pointer ml-1",
                    isActive ? "text-primary-foreground/70 hover:text-white" : "text-muted-foreground"
                  )}
                  title="Delete this operation and recompute downstream geometry"
                >
                  <Trash2 className="size-3" />
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* 3. Status indicator */}
      <div className="flex items-center gap-1.5 shrink-0 pl-4 border-l border-border/60 font-mono text-[11px] text-muted-foreground">
        <CheckCircle2 className="size-3.5 text-primary" />
        <span>Active: <strong className="text-foreground">{activeRevision}</strong></span>
      </div>
    </div>
  );
}

