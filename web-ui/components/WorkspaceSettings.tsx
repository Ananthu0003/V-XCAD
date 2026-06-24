import { Settings2 } from 'lucide-react';
import { ParameterInput } from './ParameterInput';
import type { SetupSettings } from '@/types/cam';

interface WorkspaceSettingsProps {
  workflowStage: string;
  parameters: Record<string, unknown>;
  onParameterChange: (key: string, val: unknown) => void;
  parameterMetadata: Record<string, any>;
  camSetup: SetupSettings;
  setCamSetup: React.Dispatch<React.SetStateAction<SetupSettings>>;
  controller: string;
  setController: React.Dispatch<React.SetStateAction<string>>;
  pythonScript: string;
  camSummaryElement?: React.ReactNode;
}

export function WorkspaceSettings({
  workflowStage,
  parameters,
  onParameterChange,
  parameterMetadata,
  camSetup,
  setCamSetup,
  controller,
  setController,
  pythonScript,
  camSummaryElement,
}: WorkspaceSettingsProps) {
  
  return (
    <aside className="h-full w-full bg-popover flex flex-col font-sans relative border-l border-border">
      {/* Header */}
      <div className="flex h-[72px] shrink-0 items-center px-6">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Settings2 className="size-4 text-blue-500" />
          <h3 className="text-[11px] font-bold uppercase tracking-[0.15em] text-white/90">
            WORKSPACE SETTINGS
          </h3>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-5 custom-scrollbar">
        {/* Render CAM Summary Panel if provided */}
        {camSummaryElement && (
          <div className="mb-8 animate-in fade-in duration-300">
            {camSummaryElement}
          </div>
        )}
        
        <div className="space-y-8">
        
        {/* Extracted Parameters */}
        <div className="space-y-4 animate-in fade-in duration-300">
          <div className="flex items-center gap-2">
            <h4 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/80 mb-1">
              EXTRACTED PARAMETERS
            </h4>
            <div className="flex-1 h-px bg-white/5" />
          </div>
          {Object.keys(parameters).length === 0 ? (
            <div className="rounded-xl border border-dashed border-white/10 bg-white/5 p-6 text-center text-xs text-muted-foreground font-mono">
              NO PARAMETERS EXTRACTED
            </div>
          ) : (
            <div className="space-y-4">
              {Object.keys(parameters).map((key) => (
                <ParameterInput
                  key={key}
                  label={key}
                  value={parameters[key]}
                  description={parameterMetadata?.[key]?.description}
                  onChange={(val) => onParameterChange(key, val)}
                />
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
            <div className="flex-1 h-px bg-white/5" />
          </div>
          {!pythonScript ? (
            <div className="rounded-xl border border-dashed border-white/10 bg-white/5 p-6 text-center text-xs text-muted-foreground font-mono">
              NO SCRIPT GENERATED
            </div>
          ) : (
            <div className="rounded-xl border border-border bg-background overflow-hidden">
              <pre className="p-4 text-[10px] font-mono text-primary overflow-x-auto whitespace-pre-wrap max-h-[300px] custom-scrollbar">
                {pythonScript}
              </pre>
            </div>
          )}
        </div>

        {/* CAM & GCode Stage Settings (Always visible now) */}
        <div className="space-y-8 animate-in fade-in duration-300">
            {/* Machine Context */}
            <div className="space-y-5">
              <div className="flex items-center gap-2">
                <h4 className="text-[9px] font-bold uppercase tracking-[0.2em] text-muted-foreground/60">
                  MACHINE CONTEXT
                </h4>
                <div className="flex-1 h-px bg-white/5" />
              </div>
              
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-[9px] font-bold tracking-widest text-muted-foreground/80 uppercase">Units</label>
                  <select
                    className="w-full bg-background border border-border rounded-lg px-3 py-2.5 text-xs text-foreground focus:border-primary focus:ring-1 focus:ring-primary/50 outline-none transition-all shadow-inner"
                    value={camSetup.units}
                    onChange={(e) => setCamSetup({ ...camSetup, units: e.target.value as 'mm' | 'in' })}
                  >
                    <option value="mm">Millimeters (mm)</option>
                    <option value="in">Inches (in)</option>
                  </select>
                </div>
                
                <div className="space-y-1.5">
                  <label className="text-[9px] font-bold tracking-widest text-muted-foreground/80 uppercase">Machine</label>
                  <select
                    className="w-full bg-background border border-border rounded-lg px-3 py-2.5 text-xs text-foreground focus:border-primary focus:ring-1 focus:ring-primary/50 outline-none transition-all shadow-inner"
                    value={camSetup.machine}
                    onChange={(e) => setCamSetup({ ...camSetup, machine: e.target.value })}
                  >
                    <option value="Haas VF-2 (3-Axis)">Haas VF-2 (3-Axis)</option>
                    <option value="PocketNC V2-50 (5-Axis)">PocketNC V2-50 (5-Axis)</option>
                    <option value="Tormach 1100M">Tormach 1100M</option>
                  </select>
                </div>
                
                <div className="space-y-1.5">
                  <label className="text-[9px] font-bold tracking-widest text-muted-foreground/80 uppercase">Controller</label>
                  <select
                    className="w-full bg-background border border-border rounded-lg px-3 py-2.5 text-xs text-foreground focus:border-primary focus:ring-1 focus:ring-primary/50 outline-none transition-all shadow-inner"
                    value={controller}
                    onChange={(e) => setController(e.target.value)}
                  >
                    <option value="Fanuc">Fanuc</option>
                    <option value="GRBL">GRBL</option>
                    <option value="LinuxCNC">LinuxCNC</option>
                    <option value="Mach3">Mach3</option>
                  </select>
                </div>
              </div>
            </div>

            {/* CAM Defaults */}
            <div className="space-y-5">
              <div className="flex items-center gap-2">
                <h4 className="text-[9px] font-bold uppercase tracking-[0.2em] text-muted-foreground/60">
                  CAM DEFAULTS
                </h4>
                <div className="flex-1 h-px bg-white/5" />
              </div>
              
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-[9px] font-bold tracking-widest text-muted-foreground/80 uppercase">Tolerance</label>
                  <input
                    type="number"
                    step="0.001"
                    className="w-full bg-background border border-border rounded-lg px-3 py-2.5 text-xs text-foreground focus:border-primary focus:ring-1 focus:ring-primary/50 outline-none transition-all shadow-inner font-mono"
                    value={camSetup.tolerance}
                    onChange={(e) => setCamSetup({ ...camSetup, tolerance: parseFloat(e.target.value) })}
                  />
                </div>
                
                <div className="space-y-1.5">
                  <label className="text-[9px] font-bold tracking-widest text-muted-foreground/80 uppercase">Stock Offset</label>
                  <input
                    type="number"
                    step="0.1"
                    className="w-full bg-background border border-border rounded-lg px-3 py-2.5 text-xs text-foreground focus:border-primary focus:ring-1 focus:ring-primary/50 outline-none transition-all shadow-inner font-mono"
                    value={camSetup.stockOffset}
                    onChange={(e) => setCamSetup({ ...camSetup, stockOffset: parseFloat(e.target.value) })}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}
