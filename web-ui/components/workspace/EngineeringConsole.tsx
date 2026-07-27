'use client';

import { useState } from 'react';
import { Settings, Cpu, PenTool, Sliders, PlaySquare, Code2, Activity, Database } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SetupSection } from '../cam/SetupSection';
import { ToolLibrarySection } from '../cam/ToolLibrarySection';
import { FeatureOverviewSection } from '../cam/FeatureOverviewSection';
import { OperationTreeSection } from '../cam/OperationTreeSection';
import { CuttingParametersSection } from '../cam/CuttingParametersSection';
import { OperationPropertyPanel } from '../cam/OperationPropertyPanel';
import { SimulationControls } from '../cam/SimulationControls';
import { GCodeViewer } from '../cam/GCodeViewer';
import { OperationPlanningTable } from '../cam/OperationPlanningTable';
import { ManageHoldersTab } from '../cam/ManageHoldersTab';
import type { SetupSettings, Tool, CamOperation, SimulationState, CamFeature, PostProcessor, OperationType } from '@/types/cam';

interface EngineeringConsoleProps {
  sourceFilename?: string | null;
  workflowStage: string;
  setWorkflowStage?: (v: string) => void;
  // CAM Setup
  camSetup: SetupSettings;
  setCamSetup: (v: SetupSettings) => void;
  camSetups?: any[];
  activeSetupId?: string | null;
  // Tools
  camTools: Tool[];
  setCamTools: (v: Tool[]) => void;
  // Actions
  onGenerateGCode: () => void;
  onGenerateToolpaths: () => void;
  isGeneratingGcode: boolean;
  gcodeContent: string | null;
  klartextContent?: string | null;
  gcodeErrors?: any[];
  // Features
  camFeatures: CamFeature[];
  setCamFeatures: (v: CamFeature[]) => void;
  activeFeatureId: string | null;
  setActiveFeatureId: (v: string | null) => void;
  onAutoGenerateOperations: () => void;
  onRunFeatureRecognition: () => void;
  // Operations
  camOperations: CamOperation[];
  setCamOperations: (v: CamOperation[]) => void;
  activeOperationId: string | null;
  setActiveOperationId: (v: string | null) => void;
  selectedOperationIds?: Set<string>;
  setSelectedOperationIds?: (v: Set<string>) => void;
  // Simulation
  camSimulation: SimulationState;
  setCamSimulation: (v: SimulationState) => void;
  // Validation
  toolpathValid?: boolean;
  toolpathsStale?: boolean;
  coordValidation?: any;
  camValidation?: any;
  camReadinessScore?: number | null;
  camStatus?: string | null;
  canGenerateGcode?: boolean;
  parameters?: Record<string, any>;
  setupMetadata?: any;
}

type TabType = 'setup' | 'features' | 'tools' | 'holders' | 'params' | 'simulation' | 'gcode';

export function EngineeringConsole(props: EngineeringConsoleProps) {
  const [activeTab, setActiveTab] = useState<TabType>('setup');
  const [gcodeViewMode, setGcodeViewMode] = useState<'iso' | 'klartext'>('klartext');

  const tabs = [
    { id: 'setup', label: 'SETUP', icon: <Settings /> },
    { id: 'features', label: 'FEATURES & AI', icon: <Cpu /> },
    { id: 'tools', label: 'JOB TOOLS', icon: <PenTool /> },
    { id: 'holders', label: 'JOB HOLDERS', icon: <Database /> },
    { id: 'simulation', label: 'SIMULATION', icon: <PlaySquare /> },
    { id: 'gcode', label: 'G-CODE', icon: <Code2 /> },
  ];

  // Calculate CAM Readiness
  const calcReadiness = () => {
    if (!props.camFeatures?.length && !props.camOperations?.length && props.camReadinessScore == null) {
      return { score: null as number | null, warnings: [] as string[], errors: [] as string[] };
    }

    let score = props.camReadinessScore !== undefined && props.camReadinessScore !== null ? props.camReadinessScore : 100;
    const warnings: string[] = [];
    const errors: string[] = [];

    // Always check specific operation errors to show detailed reasons instead of generic ones
    if (props.camOperations) {
      props.camOperations.forEach(op => {
        if (op.status === 'error' || op.status === 'blocked' || op.status === 'missing_tool') {
          const reason = (op.parameters && op.parameters.error) || op.errorReason || op.reason || "Operation blocked or mapping failed";
          errors.push(`Operation ${op.id} blocked: ${reason}`);
        } else if (op.status === 'unsupported') {
          const reason = (op.parameters && op.parameters.error) || op.errorReason || op.reason || "Unsupported feature or mapping failed";
          warnings.push(`Operation ${op.id} unsupported: ${reason}`);
        }
      });
    }

    if (props.camReadinessScore === undefined || props.camReadinessScore === null) {
      // Fallback local heuristic when backend hasn't generated toolpaths yet
      if (!props.camFeatures || props.camFeatures.length === 0) {
        score -= 50;
        warnings.push("No machining features detected.");
      }

      if (!props.camOperations || props.camOperations.length === 0) {
        score -= 50;
        errors.push("No CAM operations defined.");
      }

      const hasUnmachinable = props.camFeatures && props.camFeatures.some(f => f.status === 'not_machinable');
      if (hasUnmachinable) {
        score -= 20;
        errors.push("Some features are marked as not machinable.");
      }

      const hasMissingTools = props.camOperations && props.camOperations.some(op => !props.camTools.find(t => t.id === op.toolId));
      if (hasMissingTools) {
        score -= 30;
        if (errors.length === 0) errors.push("One or more operations have missing tools.");
      }

      if (props.toolpathsStale) {
        score -= 40;
        errors.push("Toolpaths are stale. Please regenerate.");
      } else if (props.toolpathValid === false) {
        score -= 60;
        errors.push("Toolpaths validation failed. Check parameters and re-generate.");
      }

      if (props.camValidation && !props.camValidation.featureCoveragePassed) {
        score -= 60;
        errors.push(`Feature coverage failed: ${props.camValidation.missingDecisionFeatures?.length || 0} features have no manufacturing decision.`);
      }
    } else {
      // Using backend readiness state
      if (props.camStatus === 'toolpaths_outdated') {
        errors.push("Toolpaths are outdated. Please regenerate.");
      }
    }

    return { score: Math.max(0, score), warnings, errors };
  };

  const readiness = calcReadiness();

  return (
    <div className="flex h-full w-full flex-col bg-transparent font-sans relative">
      {/* Tabs Header */}
      <div className="flex h-14 shrink-0 items-center px-4 bg-transparent border-b border-white/5 overflow-x-auto custom-scrollbar gap-2">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as TabType)}
            className={cn(
              "flex items-center gap-2 px-4 py-2 rounded-lg transition-all duration-200 group whitespace-nowrap",
              activeTab === tab.id
                ? "bg-gradient-primary text-white shadow-[0_0_15px_rgba(59,130,246,0.4)]"
                : "text-muted-foreground/60 hover:text-white hover:bg-white/5"
            )}
          >
            <div className={cn(
              "[&>svg]:size-3.5 transition-colors",
              activeTab === tab.id ? "text-white" : "text-muted-foreground/60 group-hover:text-white"
            )}>
              {tab.icon}
            </div>
            <span className="text-[10px] font-bold uppercase tracking-[0.1em]">
              {tab.label}
            </span>
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-y-auto bg-transparent custom-scrollbar p-6">
        <div className="max-w-7xl mx-auto grid gap-6 animate-in fade-in duration-300">
          {activeTab === 'setup' && (
            <div className="w-full">
              <SetupSection 
                setup={props.camSetup} 
                onChange={props.setCamSetup} 
                parameters={props.parameters}
                setupMetadata={props.setupMetadata}
              />
            </div>
          )}

          {activeTab === 'features' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              <div className="flex flex-col gap-4">
                <div className="flex justify-between items-center">
                  <h3 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Features</h3>
                </div>
                <FeatureOverviewSection
                  features={props.camFeatures}
                  activeFeatureId={props.activeFeatureId}
                  onFeatureSelect={props.setActiveFeatureId}
                  onAutoGenerate={props.onAutoGenerateOperations}
                  workflowStage={props.workflowStage}
                  setWorkflowStage={props.setWorkflowStage}
                  onRunFeatureRecognition={props.onRunFeatureRecognition}
                  isAutoGenerateDisabled={props.camFeatures.length === 0}
                />
              </div>
              <div className="flex flex-col gap-4">
                <h3 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Operations Plan</h3>
                <OperationPlanningTable 
                  operations={props.camOperations} 
                  camValidation={props.camValidation} 
                  camSetups={props.camSetups} 
                  tools={props.camTools}
                  selectedOperationIds={props.selectedOperationIds}
                  features={props.camFeatures}
                  onToggleOperation={(opId) => {
                    if (props.selectedOperationIds && props.setSelectedOperationIds) {
                      const newSet = new Set(props.selectedOperationIds);
                      if (newSet.has(opId)) newSet.delete(opId);
                      else newSet.add(opId);
                      props.setSelectedOperationIds(newSet);
                    }
                  }}
                  onToggleAll={(selectAll) => {
                    if (props.setSelectedOperationIds) {
                      if (selectAll) {
                        props.setSelectedOperationIds(new Set(props.camOperations.map(o => o.id)));
                      } else {
                        props.setSelectedOperationIds(new Set());
                      }
                    }
                  }}
                  onChange={(opId, updates) => {
                    const newOps = [...props.camOperations];
                    const idx = newOps.findIndex(o => o.id === opId);
                    if (idx >= 0) {
                      newOps[idx] = { ...newOps[idx], ...updates };
                      props.setCamOperations(newOps);
                    }
                  }}
                />
              </div>
            </div>
          )}

          {activeTab === 'tools' && (
            <ToolLibrarySection
              tools={props.camTools}
              onChange={props.setCamTools}
              workpieceMaterial={props.camSetup.material}
            />
          )}

          {activeTab === 'holders' && (
            <ManageHoldersTab />
          )}

          {activeTab === 'simulation' && (
            <div className="flex flex-col gap-4">
              {props.toolpathsStale && (
                <div className="flex items-center gap-3 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-500">
                  <Activity className="size-5" />
                  <div className="flex flex-col">
                    <span className="text-sm font-bold">STALE TOOLPATHS DETECTED</span>
                    <span className="text-xs text-amber-500/80">The 3D model has changed. You must regenerate toolpaths before simulating.</span>
                  </div>
                </div>
              )}
              <SimulationControls
                state={props.camSimulation}
                onChange={(changes) => props.setCamSimulation({ ...props.camSimulation, ...changes })}
                onGenerateToolpath={props.onGenerateToolpaths}
                isGenerating={props.isGeneratingGcode}
                toolpathValid={props.toolpathValid}
                toolpathsStale={props.toolpathsStale}
              />
            </div>
          )}

          {activeTab === 'gcode' && (
            <div className="flex flex-col gap-4">
              {/* Readiness Score Banner */}
              <div className="flex flex-col gap-4">
                <div className={cn("p-4 rounded-xl border flex items-center justify-between", readiness.score === null ? "bg-muted/10 border-border/20" : readiness.score >= 80 ? "bg-emerald-500/10 border-emerald-500/20" : readiness.score >= 50 ? "bg-amber-500/10 border-amber-500/20" : "bg-rose-500/10 border-rose-500/20")}>
                  <div className="flex items-center gap-4">
                    <div className={cn("size-10 rounded-full flex items-center justify-center font-bold text-lg", readiness.score === null ? "bg-muted/20 text-muted-foreground/50" : readiness.score >= 80 ? "bg-emerald-500/20 text-emerald-500" : readiness.score >= 50 ? "bg-amber-500/20 text-amber-500" : "bg-rose-500/20 text-rose-500")}>
                      {readiness.score === null ? "-" : readiness.score}
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-foreground">CAM Readiness Score</h4>
                      <p className="text-[10px] text-muted-foreground uppercase tracking-widest">{readiness.score === null ? "Waiting for 3D Model" : readiness.score >= 80 ? "Ready for Post-Processing" : readiness.score >= 50 ? "Review Warnings" : "Action Required"}</p>
                    </div>
                  </div>
                </div>

                {readiness.errors.length > 0 && (
                  <div className="flex flex-col gap-2 p-4 rounded-lg bg-rose-500/5 border border-rose-500/20">
                    <h5 className="text-[10px] font-bold uppercase tracking-widest text-rose-500">Critical Errors</h5>
                    <ul className="list-disc list-inside text-xs text-rose-400/80">
                      {readiness.errors.map((err, i) => <li key={i}>{err}</li>)}
                    </ul>
                  </div>
                )}

                {readiness.warnings.length > 0 && (
                  <div className="flex flex-col gap-2 p-4 rounded-lg bg-amber-500/5 border border-amber-500/20">
                    <h5 className="text-[10px] font-bold uppercase tracking-widest text-amber-500">Warnings</h5>
                    <ul className="list-disc list-inside text-xs text-amber-400/80">
                      {readiness.warnings.map((warn, i) => <li key={i}>{warn}</li>)}
                    </ul>
                  </div>
                )}
              </div>

              {/* Generate Toolpaths Shortcut */}
              {(props.toolpathsStale || !props.toolpathValid) && (
                <button
                  onClick={props.onGenerateToolpaths}
                  disabled={props.isGeneratingGcode}
                  className="flex w-full items-center justify-center gap-3 rounded-2xl bg-amber-500/20 py-4 text-[11px] font-black uppercase tracking-widest text-amber-500 border border-amber-500/50 hover:bg-amber-500/30 transition-all active:scale-[0.98] disabled:opacity-50"
                >
                  <Activity className="size-4" />
                  <span>{props.toolpathsStale ? 'Regenerate Toolpaths' : 'Generate Toolpaths First'}</span>
                </button>
              )}

              {/* Generate G-Code Button — always visible */}
              <button
                onClick={props.onGenerateGCode}
                disabled={props.isGeneratingGcode || (props.canGenerateGcode === false && props.camReadinessScore !== null) || (props.camReadinessScore === null && ((readiness.score ?? 0) < 50 || props.toolpathValid === false || props.toolpathsStale || (props.camValidation && !props.camValidation.featureCoveragePassed)))}
                className="flex w-full items-center justify-center gap-3 rounded-2xl bg-gradient-primary py-4 text-[11px] font-black uppercase tracking-widest text-white shadow-[0_0_20px_rgba(59,130,246,0.3)] hover:shadow-[0_0_30px_rgba(59,130,246,0.5)] transition-all active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed disabled:saturate-0"
              >
                {props.isGeneratingGcode ? (
                  <>
                    <svg className="size-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                      <circle cx="12" cy="12" r="10" className="opacity-25" />
                      <path d="M4 12a8 8 0 018-8" className="opacity-100" />
                    </svg>
                    <span>Generating G-Code...</span>
                  </>
                ) : (
                  <>
                    <Code2 className="size-4" />
                    <span>{props.canGenerateGcode === false ? 'Resolve Errors First' : 'Generate G-Code'}</span>
                  </>
                )}
              </button>

              {/* G-Code Errors */}
              {props.gcodeErrors && props.gcodeErrors.length > 0 && (
                <div className="mt-4 flex flex-col gap-2 p-4 rounded-lg bg-red-500/10 border border-red-500/30">
                  <h5 className="text-[10px] font-bold uppercase tracking-widest text-red-500 flex items-center gap-2">
                    <Activity className="size-3" />
                    G-Code Generation Failed
                  </h5>
                  <ul className="list-disc list-inside text-xs text-red-400/90 space-y-1">
                    {props.gcodeErrors.map((err, i) => (
                      <li key={i}>{err.message} {err.operation_id ? `(Op: ${err.operation_id})` : ''}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* G-Code Viewer — only shown after explicit generation */}
              {(props.gcodeContent || props.klartextContent) && (
                <div className="flex flex-col gap-4 mt-2">
                  {props.klartextContent && props.gcodeContent && (
                    <div className="flex items-center gap-2 border-b border-white/10 pb-2">
                      <button
                        onClick={() => setGcodeViewMode('klartext')}
                        className={cn("px-4 py-1.5 rounded-md text-xs font-bold uppercase tracking-widest transition-colors", gcodeViewMode === 'klartext' ? "bg-blue-600 text-white" : "text-muted-foreground hover:bg-white/5")}
                      >
                        Heidenhain Klartext
                      </button>
                      <button
                        onClick={() => setGcodeViewMode('iso')}
                        className={cn("px-4 py-1.5 rounded-md text-xs font-bold uppercase tracking-widest transition-colors", gcodeViewMode === 'iso' ? "bg-blue-600 text-white" : "text-muted-foreground hover:bg-white/5")}
                      >
                        ISO G-Code
                      </button>
                    </div>
                  )}
                  {(!props.klartextContent || gcodeViewMode === 'iso') && props.gcodeContent && (() => {
                    const currentSetup = props.camSetups?.find(s => s.setupId === props.activeSetupId) || props.camSetups?.[0];
                    const displaySetupName = currentSetup?.setupName || `SETUP_${(currentSetup?.setupId || 'UNKNOWN').slice(0, 8).toUpperCase()}`;
                    return (
                      <GCodeViewer
                        content={props.gcodeContent}
                        setupName={displaySetupName}
                        onDownload={() => {
                        const blob = new Blob([props.gcodeContent!], { type: 'text/plain' });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        if (props.sourceFilename) {
                          const baseName = props.sourceFilename.substring(0, props.sourceFilename.lastIndexOf('.')) || props.sourceFilename;
                          const safeSetup = displaySetupName.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
                          a.download = `${baseName}-${safeSetup}.nc`;
                        } else {
                          const safeSetup = displaySetupName.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
                          a.download = `vexcad-${safeSetup}-${props.camSetup.postProcessor || 'iso'}.nc`;
                        }
                        a.click();
                        URL.revokeObjectURL(url);
                      }}
                    />
                  );
                  })()}
                  {props.klartextContent && gcodeViewMode === 'klartext' && (() => {
                    const currentSetup = props.camSetups?.find(s => s.setupId === props.activeSetupId) || props.camSetups?.[0];
                    const displaySetupName = currentSetup?.setupName || `SETUP_${(currentSetup?.setupId || 'UNKNOWN').slice(0, 8).toUpperCase()}`;
                    return (
                      <GCodeViewer
                        content={props.klartextContent}
                        setupName={displaySetupName}
                        onDownload={() => {
                        const blob = new Blob([props.klartextContent!], { type: 'text/plain' });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        if (props.sourceFilename) {
                          const baseName = props.sourceFilename.substring(0, props.sourceFilename.lastIndexOf('.')) || props.sourceFilename;
                          const safeSetup = displaySetupName.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
                          a.download = `${baseName}-${safeSetup}.h`;
                        } else {
                          const safeSetup = displaySetupName.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
                          a.download = `vexcad-${safeSetup}-heidenhain.h`;
                        }
                        a.click();
                        URL.revokeObjectURL(url);
                      }}
                    />
                  );
                  })()}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
