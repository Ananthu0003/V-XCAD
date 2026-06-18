'use client';

import { useState } from 'react';
import { Settings, Cpu, PenTool, Sliders, PlaySquare, Code2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SetupSection } from './cam/SetupSection';
import { ToolLibrarySection } from './cam/ToolLibrarySection';
import { FeatureOverviewSection } from './cam/FeatureOverviewSection';
import { OperationTreeSection } from './cam/OperationTreeSection';
import { CuttingParametersSection } from './cam/CuttingParametersSection';
import { SimulationControls } from './cam/SimulationControls';
import { GCodeViewer } from './cam/GCodeViewer';
import type { SetupSettings, Tool, CamOperation, SimulationState, CamFeature, PostProcessor, OperationType } from '@/types/cam';

interface EngineeringConsoleProps {
  workflowStage: string;
  // CAM Setup
  camSetup: SetupSettings;
  setCamSetup: (v: SetupSettings) => void;
  controller: string;
  setController: (v: string) => void;
  // Tools
  camTools: Tool[];
  setCamTools: (v: Tool[]) => void;
  // G-Code generation
  onGenerateGCode: () => void;
  isGeneratingGcode: boolean;
  gcodeContent: string | null;
  // Features
  camFeatures: CamFeature[];
  setCamFeatures: (v: CamFeature[]) => void;
  activeFeatureId: string | null;
  setActiveFeatureId: (v: string | null) => void;
  onAutoGenerateOperations: () => void;
  // Operations
  camOperations: CamOperation[];
  setCamOperations: (v: CamOperation[]) => void;
  activeOperationId: string;
  setActiveOperationId: (v: string) => void;
  // Simulation
  camSimulation: SimulationState;
  setCamSimulation: (v: SimulationState) => void;
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

  return (
    <div className="flex h-full w-full flex-col bg-[#0a0f1c] font-sans relative">
      {/* Tabs Header */}
      <div className="flex h-14 shrink-0 items-center px-4 bg-[#050814] overflow-x-auto custom-scrollbar gap-2">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as TabType)}
            className={cn(
              "flex items-center gap-2 px-4 py-2 rounded-lg transition-all duration-200 group whitespace-nowrap",
              activeTab === tab.id
                ? "bg-blue-600 text-white shadow-[0_0_15px_rgba(37,99,235,0.4)]"
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
      <div className="flex-1 overflow-y-auto bg-[#0a0f1c] custom-scrollbar p-6">
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
                    className="w-full bg-[#050814] border border-[#1e293b] rounded-lg px-3 py-3 text-xs text-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50 outline-none transition-all shadow-inner"
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
                  <select className="w-full bg-[#050814] border border-[#1e293b] rounded-lg px-3 py-3 text-xs text-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50 outline-none transition-all shadow-inner">
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
                  {props.camFeatures.length > 0 && (
                    <button onClick={props.onAutoGenerateOperations} className="text-blue-500 hover:text-blue-400 capitalize bg-blue-500/10 px-2 py-0.5 rounded text-[10px]">
                      Auto Generate Operations
                    </button>
                  )}
                </div>
                <FeatureOverviewSection
                  features={props.camFeatures}
                  activeFeatureId={props.activeFeatureId}
                  onFeatureSelect={props.setActiveFeatureId}
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
                  <CuttingParametersSection
                    parameters={props.camOperations.find(op => op.id === props.activeOperationId)!.parameters}
                    onChange={(p) => {
                      props.setCamOperations(props.camOperations.map(op => op.id === props.activeOperationId ? { ...op, parameters: p } : op));
                    }}
                  />
                </div>
              ) : (
                <div className="text-center text-muted-foreground/50 py-12 font-mono text-sm">No operation selected</div>
              )}
            </div>
          )}

          {activeTab === 'simulation' && (
            <SimulationControls
              state={props.camSimulation}
              onChange={(changes) => props.setCamSimulation({ ...props.camSimulation, ...changes })}
              onGenerateToolpath={props.onGenerateGCode}
              isGenerating={props.isGeneratingGcode}
            />
          )}

          {activeTab === 'gcode' && (
            <div className="flex flex-col gap-4">
              {/* Generate G-Code Button — always visible */}
              <button
                onClick={props.onGenerateGCode}
                disabled={props.isGeneratingGcode}
                className="flex w-full items-center justify-center gap-3 rounded-2xl bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 py-4 text-[11px] font-black uppercase tracking-widest text-white shadow-lg shadow-blue-500/20 transition-all active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
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

              {/* Summary of what will be generated */}
              {!props.gcodeContent && !props.isGeneratingGcode && (
                <div className="flex flex-col items-center justify-center py-12 gap-6 text-center">
                  <div className="size-16 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center">
                    <Code2 className="size-7 text-muted-foreground/40" />
                  </div>
                  <div className="flex flex-col gap-2 max-w-md">
                    <h3 className="text-sm font-bold text-white">Configure CAM Settings First</h3>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      Set up your machine, tools, operations, and cutting parameters in the tabs above.
                      Then click <strong className="text-blue-400">Generate G-Code</strong> to produce
                      machine-ready G-Code with proper tool changes, coolant control, spindle speeds,
                      and feed rates for your <strong className="text-white">{props.controller.toUpperCase()}</strong> controller.
                    </p>
                  </div>
                  <div className="grid grid-cols-3 gap-4 mt-2">
                    <div className="flex flex-col items-center gap-1 px-4 py-3 rounded-xl bg-white/5 border border-white/5">
                      <span className="text-lg font-bold text-blue-400">{props.camTools.length}</span>
                      <span className="text-[9px] uppercase tracking-widest text-muted-foreground font-bold">Tools</span>
                    </div>
                    <div className="flex flex-col items-center gap-1 px-4 py-3 rounded-xl bg-white/5 border border-white/5">
                      <span className="text-lg font-bold text-purple-400">{props.camOperations.length}</span>
                      <span className="text-[9px] uppercase tracking-widest text-muted-foreground font-bold">Operations</span>
                    </div>
                    <div className="flex flex-col items-center gap-1 px-4 py-3 rounded-xl bg-white/5 border border-white/5">
                      <span className="text-lg font-bold text-emerald-400">{props.camSetup.material.replace('_', ' ').toUpperCase()}</span>
                      <span className="text-[9px] uppercase tracking-widest text-muted-foreground font-bold">Material</span>
                    </div>
                  </div>
                </div>
              )}

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
