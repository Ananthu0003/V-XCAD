import { Cuboid, Layers, Circle, CheckCircle2, Wrench, Package } from 'lucide-react';
import Link from 'next/link';
import { cn } from '@/lib/utils';

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
    <div className="flex h-full w-full flex-col bg-transparent font-sans text-sm relative">
      {/* Header / Logo */}
      <div className="flex h-[72px] shrink-0 items-center px-6 border-b border-border">
        <Link href="/" className="flex items-center gap-3 group hover:opacity-80 transition-opacity">
          <div className="relative flex size-10 items-center justify-center rounded-xl bg-primary/10 border border-primary/20">
            <Cuboid className="size-5 text-primary relative z-10" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-xl font-bold tracking-[0.2em] text-foreground uppercase font-sans">
              VEXCAD
            </span>
            <span className="text-[10px] font-mono text-muted-foreground">v0.1.0</span>
          </div>
        </Link>
      </div>

      {/* Project Workflow Header */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-border">
        <Layers className="size-4 text-primary" />
        <h4 className="text-[11px] font-bold uppercase tracking-[0.15em] text-primary">
          PROJECT WORKFLOW
        </h4>
      </div>

      {/* Project Workflow Navigation */}
      <div className="flex-1 py-4">
        <div className="space-y-0 relative">
          {/* Vertical connecting line background */}
          <div className="absolute left-[35px] top-[30px] bottom-[30px] w-[2px] bg-border z-0" />
          
          {/* Vertical connecting line active fill */}
          <div 
            className="absolute left-[35px] top-[30px] w-[2px] bg-primary shadow-[0_0_15px_rgba(59,130,246,0.6)] z-0 transition-all duration-700 ease-in-out" 
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
                  "relative flex w-full items-center gap-5 px-6 py-4 transition-all text-left group z-10",
                  isActive ? "bg-primary/10 backdrop-blur-sm" : "hover:bg-muted/50 bg-transparent"
                )}
              >
                {/* Active Indicator Line on the left */}
                {isActive && (
                  <div className="absolute left-0 top-0 bottom-0 w-[3px] bg-primary shadow-[0_0_15px_rgba(59,130,246,0.6)]" />
                )}

                {/* Icon */}
                <div className="relative flex size-6 shrink-0 items-center justify-center z-10 bg-card dark:bg-[#121c2e] rounded-full">
                  {isPast ? (
                    <CheckCircle2 className="size-5 text-primary bg-transparent rounded-full shadow-[0_0_10px_rgba(59,130,246,0.3)]" />
                  ) : isActive ? (
                    <div className="relative flex items-center justify-center size-5">
                      <div className="absolute inset-0 rounded-full border-[2px] border-primary/30" />
                      <div className="absolute inset-0 rounded-full border-[2px] border-primary border-t-transparent animate-spin" />
                      <div className="size-1.5 rounded-full bg-primary" />
                    </div>
                  ) : (
                    <div className="size-5 rounded-full border-[2px] border-border group-hover:border-primary/40 transition-colors bg-card dark:bg-[#121c2e]" />
                  )}
                </div>

                {/* Label */}
                <span className={cn(
                  "text-[11px] font-bold uppercase tracking-widest transition-colors",
                  isActive ? "text-primary dark:text-white font-extrabold" : isPast ? "text-muted-foreground" : "text-muted-foreground/80 group-hover:text-foreground"
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
