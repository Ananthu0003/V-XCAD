import { Layers, CheckCircle2 } from 'lucide-react';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { ProjectLogo } from '@/components/shared/ProjectLogo';

export type WorkflowStage = 'blueprint' | 'extraction' | 'cad' | 'manual_cad' | 'cam' | 'gcode';

interface WorkflowNavProps {
  workflowStage: WorkflowStage;
  setWorkflowStage: (stage: WorkflowStage) => void;
}

const STAGES = [
  { id: 'blueprint', label: 'BLUEPRINT ANALYSIS' },
  { id: 'cad', label: 'AI CAD GENERATION' },
  { id: 'manual_cad', label: 'MANUAL CAD REFINEMENT' },
  { id: 'cam', label: 'CAM TOOLPATHS' },
  { id: 'gcode', label: 'G-CODE OUTPUT' },
];

export function WorkflowNav({ workflowStage, setWorkflowStage }: WorkflowNavProps) {
  // Map internal stages to display stages
  const getActiveDisplayStage = () => {
    if (workflowStage === 'extraction') return 'blueprint';
    return workflowStage;
  };

  const activeDisplayStage = getActiveDisplayStage();
  const activeIndex = STAGES.findIndex(s => s.id === activeDisplayStage);

  return (
    <div className="flex h-full w-full flex-col bg-card/60 backdrop-blur-xl font-sans text-sm relative border-r border-border select-none">
      {/* Header / Logo */}
      <div className="flex h-[64px] shrink-0 items-center px-5 border-b border-border">
        <Link href="/" className="flex items-center gap-3 group transition-opacity hover:opacity-90">
          <ProjectLogo size={32} showGlow />
          <div className="flex items-baseline gap-2">
            <span className="text-lg font-bold tracking-[0.22em] text-foreground uppercase font-sans">
              VEXCAD
            </span>
            <span className="text-[10px] font-mono text-muted-foreground px-1.5 py-0.5 rounded bg-muted/50 border border-border/50">v0.1.0</span>
          </div>
        </Link>
      </div>

      {/* Project Workflow Header */}
      <div className="flex items-center gap-2.5 px-5 py-3.5 border-b border-border/60 bg-muted/20">
        <Layers className="size-3.5 text-primary" />
        <h4 className="text-[10px] font-semibold uppercase tracking-[0.16em] text-primary">
          PROJECT PIPELINE
        </h4>
      </div>

      {/* Project Workflow Navigation */}
      <div className="flex-1 py-3">
        <div className="space-y-0 relative">
          {/* Vertical connecting line background */}
          <div className="absolute left-[31px] top-[26px] bottom-[26px] w-[2px] bg-border/60 z-0" />
          
          {/* Vertical connecting line active fill */}
          <div 
            className="absolute left-[31px] top-[26px] w-[2px] bg-primary shadow-[0_0_12px_rgba(6,182,212,0.6)] z-0 transition-all duration-500 ease-in-out" 
            style={{ 
              height: `${(Math.max(0, activeIndex) / (STAGES.length - 1)) * 100}%` 
            }}
          />

          {STAGES.map((stage, idx) => {
            const isActive = activeDisplayStage === stage.id;
            const isPast = idx < activeIndex;
            
            return (
              <button
                key={stage.id}
                onClick={() => setWorkflowStage(stage.id as WorkflowStage)}
                className={cn(
                  "relative flex w-full items-center gap-4 px-5 py-3.5 transition-all text-left group z-10 cursor-pointer",
                  isActive 
                    ? "bg-primary/[0.08] dark:bg-primary/[0.08] text-foreground" 
                    : "hover:bg-muted/40 text-muted-foreground hover:text-foreground"
                )}
              >
                {/* Active Indicator Line on the left */}
                {isActive && (
                  <div className="absolute left-0 top-0 bottom-0 w-[2.5px] bg-primary shadow-[0_0_10px_rgba(6,182,212,0.8)]" />
                )}

                {/* Node Icon */}
                <div className="relative flex size-6 shrink-0 items-center justify-center z-10 bg-card rounded-full border border-border">
                  {isPast ? (
                    <CheckCircle2 className="size-4.5 text-primary" />
                  ) : isActive ? (
                    <div className="relative flex items-center justify-center size-5">
                      <div className="absolute inset-0 rounded-full border-[2px] border-primary/30" />
                      <div className="absolute inset-0 rounded-full border-[2px] border-primary border-t-transparent animate-spin" />
                      <div className="size-1.5 rounded-full bg-primary shadow-[0_0_6px_rgba(6,182,212,0.8)]" />
                    </div>
                  ) : (
                    <div className="size-2 rounded-full bg-muted-foreground/30 group-hover:bg-primary/50 transition-colors" />
                  )}
                </div>

                {/* Label */}
                <span className={cn(
                  "text-[11px] font-semibold tracking-wider transition-colors truncate",
                  isActive ? "text-primary font-bold" : isPast ? "text-foreground/70" : "text-muted-foreground"
                )}>
                  {stage.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
