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
    <div className="flex flex-col font-sans h-full min-h-0 w-full bg-transparent overflow-hidden">
      <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar pb-6">
        {/* Extracted Parameters */}
        <div className="ui-section">
          <div className="ui-section-title">
            <span>Extracted Parameters</span>
            {Object.keys(parameters).length > 0 && (
              <button
                onClick={handleCopyParameters}
                className="ui-btn ui-btn--ghost !h-6 !px-2 text-[10px]"
                title="Copy all parameters"
              >
                {copied ? <Check className="size-3 text-emerald-400" /> : <Copy className="size-3" />}
                <span>{copied ? 'Copied' : 'Copy All'}</span>
              </button>
            )}
          </div>
          {Object.keys(parameters).length === 0 ? (
            <div className="rounded-xl border border-[var(--ui-border)] bg-[var(--ui-input)] p-6 text-center space-y-2">
              <div className="size-8 rounded-lg bg-[var(--ui-panel)] border border-[var(--ui-border-ctrl)] flex items-center justify-center mx-auto text-[var(--ui-accent)]">
                <SlidersHorizontal className="size-4" />
              </div>
              <div className="text-[10.5px] font-bold text-[var(--ui-text-primary)] font-mono uppercase tracking-wider">
                No Parameters Extracted
              </div>
              <p className="text-[10.5px] text-[var(--ui-text-muted)] max-w-[220px] mx-auto leading-relaxed">
                Upload a blueprint or prompt the copilot to extract geometric dimensions.
              </p>
            </div>
          ) : (
            <div className="space-y-1">
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
        <div className="ui-section">
          <div className="ui-section-title">
            <span>CAD Script (Build123d)</span>
            {pythonScript && (
              <button
                onClick={handleCopyScript}
                className="ui-btn ui-btn--ghost !h-6 !px-2 text-[10px]"
                title="Copy script"
              >
                {copiedScript ? <Check className="size-3 text-emerald-400" /> : <Copy className="size-3" />}
                <span>{copiedScript ? 'Copied' : 'Copy'}</span>
              </button>
            )}
          </div>
          {!pythonScript ? (
            <div className="rounded-xl border border-[var(--ui-border)] bg-[var(--ui-input)] p-6 text-center space-y-2">
              <div className="size-8 rounded-lg bg-[var(--ui-panel)] border border-[var(--ui-border-ctrl)] flex items-center justify-center mx-auto text-[var(--ui-accent)]">
                <Code2 className="size-4" />
              </div>
              <div className="text-[10.5px] font-bold text-[var(--ui-text-primary)] font-mono uppercase tracking-wider">
                No Script Generated
              </div>
              <p className="text-[10.5px] text-[var(--ui-text-muted)] max-w-[220px] mx-auto leading-relaxed">
                Python CAD build script will be generated dynamically upon synthesis.
              </p>
            </div>
          ) : (
            <div className="rounded-xl border border-[var(--ui-border)] bg-[var(--ui-bg)] overflow-hidden shadow-sm">
              <div className="flex items-center justify-between px-3.5 py-2 border-b border-[var(--ui-border)] bg-[var(--ui-panel)]">
                <div className="flex items-center gap-2">
                  <span className="text-[10.5px] text-[var(--ui-text-secondary)] font-mono font-medium">model.py</span>
                </div>
                <span className="text-[9.5px] font-mono text-[var(--ui-text-muted)] uppercase tracking-wider">Build123d</span>
              </div>
              <pre className="p-3.5 text-[11px] leading-relaxed font-mono overflow-x-auto whitespace-pre-wrap max-h-[360px] custom-scrollbar text-[var(--ui-text-primary)]">
                {pythonScript}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
