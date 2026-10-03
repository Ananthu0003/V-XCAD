import { Settings2, Copy, Check, SlidersHorizontal, Code2 } from 'lucide-react';
import { useState } from 'react';
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
  const [copied, setCopied] = useState(false);
  const [copiedScript, setCopiedScript] = useState(false);

  const handleCopyParameters = () => {
    const textToCopy = Object.entries(parameters)
      .map(([k, v]) => `${k}: ${v}`)
      .join('\n');
    navigator.clipboard.writeText(textToCopy);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleCopyScript = () => {
    if (pythonScript) {
      navigator.clipboard.writeText(pythonScript);
      setCopiedScript(true);
      setTimeout(() => setCopiedScript(false), 2000);
    }
  };
  
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
            {Object.keys(parameters).length > 0 && (
              <button
                onClick={handleCopyParameters}
                className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-muted/30 hover:bg-muted/50 border border-border/50 text-muted-foreground hover:text-foreground transition-all text-[9px] font-bold uppercase tracking-wider"
                title="Copy all parameters"
              >
                {copied ? <Check className="size-3 text-green-500" /> : <Copy className="size-3" />}
                {copied ? 'Copied' : 'Copy All'}
              </button>
            )}
          </div>
          {Object.keys(parameters).length === 0 ? (
            <div className="rounded-xl border border-dashed border-border bg-card/60 p-6 text-center space-y-2">
              <div className="size-8 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center mx-auto text-primary">
                <SlidersHorizontal className="size-4" />
              </div>
              <div className="text-[10.5px] font-bold text-foreground font-mono uppercase tracking-wider">
                No Parameters Extracted
              </div>
              <p className="text-[10px] text-muted-foreground max-w-[200px] mx-auto leading-relaxed">
                Upload a blueprint or prompt the copilot to extract geometric dimensions.
              </p>
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
            {pythonScript && (
              <button
                onClick={handleCopyScript}
                className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-muted/30 hover:bg-muted/50 border border-border/50 text-muted-foreground hover:text-foreground transition-all text-[9px] font-bold uppercase tracking-wider"
                title="Copy script"
              >
                {copiedScript ? <Check className="size-3 text-green-500" /> : <Copy className="size-3" />}
                {copiedScript ? 'Copied' : 'Copy'}
              </button>
            )}
          </div>
          {!pythonScript ? (
            <div className="rounded-xl border border-dashed border-border bg-card/60 p-6 text-center space-y-2">
              <div className="size-8 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center mx-auto text-primary">
                <Code2 className="size-4" />
              </div>
              <div className="text-[10.5px] font-bold text-foreground font-mono uppercase tracking-wider">
                No Script Generated
              </div>
              <p className="text-[10px] text-muted-foreground max-w-[200px] mx-auto leading-relaxed">
                Python CAD build script will be generated dynamically upon synthesis.
              </p>
            </div>
          ) : (
            <div className="rounded-xl border border-border bg-slate-900 text-slate-100 dark:bg-black/60 dark:text-cyan-200 overflow-hidden shadow-sm">
              {/* Fake Mac Header */}
              <div className="flex items-center gap-1.5 px-4 py-2 border-b border-white/10 bg-slate-800/80 dark:bg-white/[0.03]">
                <div className="w-2.5 h-2.5 rounded-full bg-red-500/80" />
                <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/80" />
                <div className="w-2.5 h-2.5 rounded-full bg-green-500/80" />
                <span className="ml-2 text-[10px] text-slate-400 font-mono">model.py</span>
              </div>
              <pre className="p-4 text-[11px] leading-relaxed font-mono overflow-x-auto whitespace-pre-wrap max-h-[400px] custom-scrollbar selection:bg-blue-500/30">
                {pythonScript}
              </pre>
            </div>
          )}
        </div>


        </div>
    </div>
  );
}
