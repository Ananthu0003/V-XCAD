'use client';

import { useState } from 'react';
import { Settings, Cpu, PenTool, Sliders, PlaySquare, Code2, Activity } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SetupSection } from './cam/SetupSection';
import { ToolLibrarySection } from './cam/ToolLibrarySection';
import { FeatureOverviewSection } from './cam/FeatureOverviewSection';
import { OperationTreeSection } from './cam/OperationTreeSection';
import { CuttingParametersSection } from './cam/CuttingParametersSection';
import { OperationPropertyPanel } from './cam/OperationPropertyPanel';
import { SimulationControls } from './cam/SimulationControls';
import { GCodeViewer } from './cam/GCodeViewer';
import type { SetupSettings, Tool, CamOperation, SimulationState, CamFeature, PostProcessor, OperationType } from '@/types/cam';

interface EngineeringConsoleProps {
  workflowStage: string;
  setWorkflowStage?: (v: string) => void;
  // CAM Setup
  camSetup: SetupSettings;
  setCamSetup: (v: SetupSettings) => void;
  controller: string;
  setController: (v: string) => void;
  // Tools
  camTools: Tool[];
  setCamTools: (v: Tool[]) => void;
  // Actions
  onGenerateGCode: () => void;
  onGenerateToolpaths: () => void;
  isGeneratingGcode: boolean;
  gcodeContent: string | null;
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
  activeOperationId: string;
  setActiveOperationId: (v: string) => void;
  // Simulation
  camSimulation: SimulationState;
  setCamSimulation: (v: SimulationState) => void;
  // Validation
  toolpathValid?: boolean;
  toolpathsStale?: boolean;
}

type TabType = 'setup' | 'features' | 'tools' | 'params' | 'simulation' | 'gcode';

export function EngineeringConsole(props: EngineeringConsoleProps) {
  const [activeTab, setActiveTab] = useState<TabType>('setup');

  const tabs = [
    { id: 'setup', label: 'SETUP', icon: <Settings /> },
    { id: 'features', label: 'FEATURES & AI', icon: <Cpu /> },
    { id: 'tools', label: 'TOOL LIBRARY', icon: <PenTool /> },
    { id: 'params', label: 'CUTTING PARAMS', icon: <Sliders /> },
    { id: 'simulation', label: 'SIMULATION', icon: <PlaySquare /> },
    { id: 'gcode', label: 'G-CODE', icon: <Code2 /> },
  ];

  // Calculate CAM Readiness
  const calcReadiness = () => {
    let score = 100;
    const warnings: string[] = [];
    const errors: string[] = [];

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
      errors.push("One or more operations have missing tools.");
    }

    if (props.toolpathsStale) {
      score -= 40;
      errors.push("Toolpaths are stale. Please regenerate.");
    } else if (props.toolpathValid === false) {
      score -= 60;
      errors.push("Toolpath validation failed.");
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
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              {/* Left side: Stock & Material (using existing SetupSection) */}
              <SetupSection setup={props.camSetup} onChange={props.setCamSetup} />
              
              {/* Right side: Post Processor & Machining Strategy */}
              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-2">
                  <label className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/80">Post Processor</label>
                  <select
                    value={props.controller}
                    onChange={(e) => props.setController(e.target.value)}
                    className="w-full bg-background border border-border rounded-lg px-3 py-3 text-xs text-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50 outline-none transition-all shadow-inner"
                  >
                    <option value="iso">Standard ISO (RS-274)</option>
                    <option value="fanuc">Fanuc</option>
                    <option value="haas">Haas</option>
                    <option value="siemens">Siemens Sinumerik</option>
                    <option value="heidenhain">Heidenhain</option>
                    <option value="grbl">GRBL</option>
                  </select>
                </div>
                
                <div className="flex flex-col gap-2">
                  <label className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/80">Machining Strategy</label>
                  <select className="w-full bg-background border border-border rounded-lg px-3 py-3 text-xs text-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50 outline-none transition-all shadow-inner">
                    <option value="2d_profile">2D Profile Outline (Contouring)</option>
                    <option value="adaptive_clearing">Adaptive Clearing (Roughing)</option>
                    <option value="3d_parallel">3D Parallel (Finishing)</option>
                  </select>
                </div>
              </div>
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
                />
              </div>
              <div className="flex flex-col gap-4">
                <h3 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Operations</h3>
                <OperationTreeSection
                  operations={props.camOperations}
                  activeOperationId={props.activeOperationId}
                  onSelect={props.setActiveOperationId}
                  onAdd={(type: OperationType) => {
                    const id = 'op' + Date.now();
                    props.setCamOperations([...props.camOperations, {
                      id,
                      name: `New ${type}`,
                      type,
                      toolId: props.camTools[0]?.id || 't1',
                      feature_id: props.activeFeatureId || '',
                      parameters: { feedRate: 800, plungeRate: 200, maxStepdown: 1.0, totalDepth: 5.0, spindleSpeed: 12000, stepoverPercentage: 40, tolerance: 0.01, coolant: 'off' }
                    }]);
                    props.setActiveOperationId(id);
                  }}
                  onDelete={(id: string) => {
                    if (props.camOperations.length <= 1) return;
                    const newOps = props.camOperations.filter(op => op.id !== id);
                    props.setCamOperations(newOps);
                    if (props.activeOperationId === id) props.setActiveOperationId(newOps[0].id);
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

          {activeTab === 'params' && (
            <div>
              {props.camOperations.find(op => op.id === props.activeOperationId) ? (
                <div className="flex flex-col gap-4">
                  <div className="flex flex-col gap-2">
                    <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Assigned Tool</label>
                    <select
                      value={props.camOperations.find(op => op.id === props.activeOperationId)!.toolId}
                      onChange={(e) => {
                        props.setCamOperations(props.camOperations.map(op => 
                          op.id === props.activeOperationId ? { ...op, toolId: e.target.value } : op
                        ));
                      }}
                      className="w-full rounded-2xl border border-border dark:border-white/10 bg-accent dark:bg-black/60 px-4 py-3 text-sm text-foreground focus:border-blue-500 focus:outline-none"
                    >
                      {props.camTools.map(t => (
                        <option key={t.id} value={t.id}>
                          {t.number} - {t.name || t.type.replace('_', ' ')}
                        </option>
                      ))}
                    </select>
                  </div>
                  <OperationPropertyPanel
                    operation={props.camOperations.find(op => op.id === props.activeOperationId)!}
                    onChange={(op) => {
                      props.setCamOperations(props.camOperations.map(o => o.id === op.id ? op : o));
                    }}
                  />
                </div>
              ) : (
                <div className="text-center text-muted-foreground/50 py-12 font-mono text-sm">No operation selected</div>
              )}
            </div>
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
                <div className={cn("p-4 rounded-xl border flex items-center justify-between", readiness.score >= 80 ? "bg-emerald-500/10 border-emerald-500/20" : readiness.score >= 50 ? "bg-amber-500/10 border-amber-500/20" : "bg-rose-500/10 border-rose-500/20")}>
                  <div className="flex items-center gap-4">
                    <div className={cn("size-10 rounded-full flex items-center justify-center font-bold text-lg", readiness.score >= 80 ? "bg-emerald-500/20 text-emerald-500" : readiness.score >= 50 ? "bg-amber-500/20 text-amber-500" : "bg-rose-500/20 text-rose-500")}>
                      {readiness.score}
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-foreground">CAM Readiness Score</h4>
                      <p className="text-[10px] text-muted-foreground uppercase tracking-widest">{readiness.score >= 80 ? "Ready for Post-Processing" : readiness.score >= 50 ? "Review Warnings" : "Action Required"}</p>
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

              {/* Generate G-Code Button — always visible */}
              <button
                onClick={props.onGenerateGCode}
                disabled={props.isGeneratingGcode || readiness.score < 50 || props.toolpathValid === false || props.toolpathsStale}
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
                    <span>Generate G-Code</span>
                  </>
                )}
              </button>

              {/* G-Code Viewer — only shown after explicit generation */}
              {props.gcodeContent && (
                <GCodeViewer
                  content={props.gcodeContent}
                  onDownload={() => {
                    const blob = new Blob([props.gcodeContent!], { type: 'text/plain' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `vexcad_${props.controller}_output.gcode`;
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
