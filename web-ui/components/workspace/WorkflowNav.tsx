import { Cuboid, Layers, Circle, CheckCircle2, Wrench, Package } from 'lucide-react';
import Link from 'next/link';
import { cn } from '@/lib/utils';

type WorkflowStage = 'blueprint' | 'extraction' | 'cad' | 'cam' | 'gcode';

interface WorkflowNavProps {
  workflowStage: WorkflowStage;
  setWorkflowStage: (stage: WorkflowStage) => void;
}

const STAGES = [
  { id: 'blueprint', label: 'BLUEPRINT ANALYSIS' },
  { id: 'cad', label: '3D CAD GENERATION' },
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
      <div className="flex h-[72px] shrink-0 items-center px-6 border-b border-white/5">
        <Link href="/" className="flex items-center gap-3 group hover:opacity-80 transition-opacity">
          <div className="relative flex size-10 items-center justify-center rounded-full bg-[#1e293b]/50">
            <Cuboid className="size-5 text-blue-500 relative z-10" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-xl font-bold tracking-[0.2em] text-white uppercase font-sans">
              VEXCAD
            </span>
            <span className="text-[10px] font-mono text-muted-foreground/50">v0.1.0</span>
          </div>
        </Link>
      </div>

      {/* Project Workflow Header */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-white/5">
        <Layers className="size-4 text-blue-400" />
        <h4 className="text-[11px] font-bold uppercase tracking-[0.15em] text-blue-400">
          PROJECT WORKFLOW
        </h4>
      </div>

      {/* Project Workflow Navigation */}
      <div className="flex-1 py-4">
        <div className="space-y-0 relative">
          {/* Vertical connecting line background */}
          <div className="absolute left-[35px] top-[30px] bottom-[30px] w-[2px] bg-[#1e293b] z-0" />
          
          {/* Vertical connecting line active fill */}
          <div 
            className="absolute left-[35px] top-[30px] w-[2px] bg-gradient-primary shadow-[0_0_15px_rgba(59,130,246,0.6)] z-0 transition-all duration-700 ease-in-out" 
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
                  isActive ? "bg-blue-500/5 backdrop-blur-sm" : "hover:bg-white/5 bg-transparent"
                )}
              >
                {/* Active Indicator Line on the left */}
                {isActive && (
                  <div className="absolute left-0 top-0 bottom-0 w-[3px] bg-gradient-primary shadow-[0_0_15px_rgba(59,130,246,0.6)]" />
                )}

                {/* Icon */}
                <div className="relative flex size-6 shrink-0 items-center justify-center z-10 bg-[#121c2e]">
                  {isPast ? (
                    <CheckCircle2 className="size-5 text-blue-500 bg-transparent rounded-full shadow-[0_0_10px_rgba(59,130,246,0.3)]" />
                  ) : isActive ? (
                    <div className="relative flex items-center justify-center size-5">
                      <div className="absolute inset-0 rounded-full border-[2px] border-blue-500/30" />
                      <div className="absolute inset-0 rounded-full border-[2px] border-blue-500 border-t-transparent animate-spin" />
                      <div className="size-1.5 rounded-full bg-blue-500" />
                    </div>
                  ) : (
                    <div className="size-5 rounded-full border-[2px] border-white/10 group-hover:border-white/20 transition-colors bg-[#121c2e]" />
                  )}
                </div>

                {/* Label */}
                <span className={cn(
                  "text-[11px] font-bold uppercase tracking-widest transition-colors",
                  isActive ? "text-white" : isPast ? "text-blue-100/70" : "text-[#64748b] group-hover:text-white/80"
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
