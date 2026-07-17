import { Settings2 } from 'lucide-react';
import { ParameterInput } from '@/components/workspace/ParameterInput';
import type { SetupSettings } from '@/types/cam';

interface WorkspaceSettingsProps {
  workflowStage: string;
  parameters: Record<string, unknown>;
  activeParameter?: string | null;
  onParameterSelect?: (key: string | null) => void;
  onParameterChange: (key: string, val: unknown) => void;
  parameterMetadata: Record<string, any>;
  camSetup: SetupSettings;
  setCamSetup: React.Dispatch<React.SetStateAction<SetupSettings>>;
  pythonScript: string;
}

export function WorkspaceSettings({
  workflowStage,
  parameters,
  activeParameter,
  onParameterSelect,
  onParameterChange,
  parameterMetadata,
  camSetup,
  setCamSetup,
  pythonScript,
}: WorkspaceSettingsProps) {
  
  return (
    <div className="flex flex-col font-sans h-full w-full bg-transparent">
      <div className="flex-1 overflow-y-auto p-5 custom-scrollbar space-y-8">
        
        {/* Extracted Parameters */}
        <div className="space-y-4 animate-in fade-in duration-300">
          <div className="flex items-center gap-2">
            <h4 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/80 mb-1">
              EXTRACTED PARAMETERS
            </h4>
            <div className="flex-1 h-px bg-muted/50" />
          </div>
          {Object.keys(parameters).length === 0 ? (
            <div className="rounded-xl border border-dashed border-border bg-muted/50 p-6 text-center text-xs text-muted-foreground font-mono">
              NO PARAMETERS EXTRACTED
            </div>
          ) : (
            <div className="space-y-4">
              {Object.keys(parameters).map((key) => (
                <div key={key} onClick={() => onParameterSelect?.(activeParameter === key ? null : key)} className="cursor-pointer">
                  <ParameterInput
                    label={key}
                    value={parameters[key]}
                    description={parameterMetadata?.[key]?.description}
                    onChange={(val) => onParameterChange(key, val)}
                    isActive={activeParameter === key}
                  />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* CAD Script */}
        <div className="space-y-4 animate-in fade-in duration-300">
          <div className="flex items-center gap-2">
            <h4 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/80 mb-1">
              CAD SCRIPT (BUILD123D)
            </h4>
            <div className="flex-1 h-px bg-muted/50" />
          </div>
          {!pythonScript ? (
            <div className="rounded-xl border border-dashed border-border bg-muted/50 p-6 text-center text-xs text-muted-foreground font-mono">
              NO SCRIPT GENERATED
            </div>
          ) : (
            <div className="rounded-xl border border-black/5 dark:border-white/5 bg-slate-100 dark:bg-black/40 overflow-hidden shadow-inner backdrop-blur-sm">
              {/* Fake Mac Header */}
              <div className="flex items-center gap-1.5 px-4 py-2 border-b border-black/5 dark:border-white/5 bg-slate-200 dark:bg-black/20">
                <div className="w-2.5 h-2.5 rounded-full bg-red-500/70" />
                <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/70" />
                <div className="w-2.5 h-2.5 rounded-full bg-green-500/70" />
                <span className="ml-2 text-[10px] text-zinc-500 font-mono">model.py</span>
              </div>
              <pre className="p-4 text-[11px] leading-relaxed font-mono text-blue-800 dark:text-blue-300 overflow-x-auto whitespace-pre-wrap max-h-[400px] custom-scrollbar selection:bg-blue-500/30">
                {pythonScript}
              </pre>
            </div>
          )}
        </div>


        </div>
    </div>
  );
}
