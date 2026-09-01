import { SetupSettings, Tool, CamOperation, CamFeature, CamSetupPlan, CostEstimateResult } from '@/types/cam';
import { Target, Layers, Settings2, Scissors, Activity, FileCode, CircleDollarSign, AlertTriangle } from 'lucide-react';
import { MACHINE_MATRIX } from '@/lib/cam/machineProfiles';
import { getMaterialLabel } from '@/lib/cam/materialProfiles';
import { CostEstimateBill } from './CostEstimateBill';

function fmt(currency: string, value?: number): string {
    if (value == null || isNaN(value)) return '—';
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency || 'USD' }).format(value);
}

function Row({ label, value, currency, sub }: { label: string; value?: number; currency: string; sub?: string }) {
    return (
        <div className="flex justify-between">
            <span className="text-muted-foreground">{label}</span>
            <span className="flex flex-col items-end">
                <span className="font-medium text-foreground">{fmt(currency, value)}</span>
                {sub && <span className="text-[8px] text-muted-foreground/70 font-mono">{sub}</span>}
            </span>
        </div>
    );
}

type CamSummaryPanelProps = {
    setup: SetupSettings;
    setups?: CamSetupPlan[];
    tools: Tool[];
    operations: CamOperation[];
    features?: CamFeature[];
    coordValidation?: any;
    costEstimate?: CostEstimateResult;
    profitMargin?: number;
    onProfitMarginChange?: (margin: number) => void;
    onClickSection?: (sectionId: string) => void;
};

export function CamSummaryPanel({ setup, setups = [], tools, operations, features = [], coordValidation, costEstimate, profitMargin, onProfitMarginChange, onClickSection = () => {} }: CamSummaryPanelProps) {
    const totalCycleTime = operations.reduce((acc, op) => acc + (op.estimated_time_s || op.statistics?.cycleTimeSeconds || 0), 0);
    const formatTime = (seconds: number) => {
        if (!seconds) return 'N/A';
        const m = Math.floor(seconds / 60);
        const s = Math.floor(seconds % 60);
        return `${m}m ${s}s`;
    };

    return (
        <div className="flex flex-col gap-4 pb-4">
            <h3 className="text-[10px] font-bold uppercase tracking-[0.15em] text-muted-foreground flex items-center gap-2 mb-2">
                <Activity className="size-4" /> CAM Setup Summary
            </h3>
            
            {/* Cost Estimation Panel */}
            {costEstimate && (
                <CostEstimateBill 
                    costEstimate={costEstimate} 
                    setup={setup} 
                    tools={tools}
                    profitMargin={profitMargin}
                    onProfitMarginChange={onProfitMarginChange}
                />
            )}
            
            <div className="grid grid-cols-1 gap-2">
                {/* Setups Section - Maps over multiple setups if available */}
                {setups.length > 0 ? setups.map((s, idx) => {
                    const setupFeatures = features.filter(f => s.assignedFeatureIds.includes(f.id));
                    const setupOps = operations.filter(op => op.setup_id === s.setupId || (!op.setup_id && idx === 0)); // fallback if no setup_id on op
                    return (
                        <div key={s.setupId} className="flex flex-col gap-2 mt-2 pt-2 border-t border-border">
                            <div 
                                onClick={() => onClickSection('setup')}
                                className="p-4 rounded-xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 hover:bg-slate-100 dark:hover:bg-white/10 cursor-pointer transition-all flex flex-col gap-2 dark:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.1)]"
                            >
                                <div className="flex items-center gap-2 text-blue-700 dark:text-blue-400 font-bold text-[11px] uppercase tracking-widest">
                                    <Settings2 className="size-3.5" /> {s.setupName} ({s.setupType})
                                </div>
                                <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-[11px] text-muted-foreground mt-1">
                                    <div>Tool Axis:</div><div className="text-foreground font-mono">[{(s.toolAxis || []).join(', ')}]</div>
                                    <div>WCS:</div><div className="text-foreground">{s.workCoordinateSystem}</div>
                                </div>
                            </div>
                            
                            {setupFeatures.length > 0 && (
                                <div className="p-4 mt-2 rounded-xl bg-cyan-50 dark:bg-cyan-900/10 border border-cyan-200 dark:border-cyan-500/20 transition-all flex flex-col gap-2 dark:shadow-[inset_0_1px_0_0_rgba(6,182,212,0.1)]">
                                    <div className="flex items-center gap-2 text-cyan-700 dark:text-cyan-400 font-bold text-[11px] uppercase tracking-widest">
                                        <Target className="size-3.5" /> Setup Features ({setupFeatures.length})
                                    </div>
                                    <div className="flex flex-col gap-1 mt-1">
                                        {setupFeatures.map(f => {
                                            const status = f.machining_info?.status || 'machinable_in_active_setup';
                                            let statusLabel = '✅ Machinable';
                                            let isBlocked = false;

                                            if (status === 'machinable_in_secondary_setup') {
                                                statusLabel = '🔄 Assigned to secondary setup';
                                            } else if (status === 'requires_turning') {
                                                statusLabel = '🔄 Requires turning';
                                            } else if (status === 'requires_4axis_indexing') {
                                                statusLabel = '🔄 Requires 4-axis indexing';
                                            } else if (status === 'unsupported') {
                                                statusLabel = '🛑 Blocked';
                                                isBlocked = true;
                                            } else if (status !== 'machinable_in_active_setup') {
                                                statusLabel = `🛑 Blocked (${status})`;
                                                isBlocked = true;
                                            }

                                            return (
                                                <div key={f.id} className="text-[11px] flex flex-col gap-0.5 pb-2 mb-2 border-b border-border/40 last:border-0 last:pb-0 last:mb-0">
                                                    <div className="flex justify-between items-start">
                                                        <span className="text-foreground font-medium capitalize">{f.name || f.type?.replace('_', ' ')}</span>
                                                        <span className="text-[10px] whitespace-nowrap">
                                                            {statusLabel}
                                                        </span>
                                                    </div>
                                                    {isBlocked && f.machining_info?.reason && (
                                                        <div className="text-red-400 mt-1 whitespace-pre-wrap font-sans text-[10px]">
                                                            {f.machining_info.reason}
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}

                            {setupOps.length > 0 && (
                                <div onClick={() => onClickSection('operations')} className="p-4 mt-2 rounded-xl bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-500/20 hover:bg-amber-100 dark:hover:bg-amber-900/20 cursor-pointer transition-all flex flex-col gap-2 dark:shadow-[inset_0_1px_0_0_rgba(245,158,11,0.1)]">
                                    <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400 font-bold text-[11px] uppercase tracking-widest">
                                        <Layers className="size-3.5" /> Setup Operations ({setupOps.length})
                                    </div>
                                    <div className="flex flex-col gap-1 mt-1">
                                        {setupOps.map(op => {
                                            return (
                                                <div key={op.id} className="text-[11px] flex flex-col gap-1 pb-2 mb-2 border-b border-border/40 last:border-0 last:pb-0 last:mb-0">
                                                    <div className="flex justify-between items-start">
                                                        <span className="text-foreground font-medium capitalize">{op.name || op.type?.replace('_', ' ')}</span>
                                                        <span className="text-[10px] whitespace-nowrap">
                                                            {op.status === 'ready' || op.status === 'planned' ? '🟢 OK' : op.status === 'error' ? '🔴 Error' : op.status === 'blocked' || op.status === 'blocked_requires_reorientation' ? '🚧 Blocked' : op.status === 'missing_tool' ? '⚠️ No Tool' : op.status === 'requires_regeneration' ? '⚠️ Needs Regen' : op.status || '🟢 OK'}
                                                        </span>
                                                    </div>
                                                    <div className="flex flex-col gap-0.5 text-[9px] text-muted-foreground font-mono ml-1 border-l border-border/50 pl-2">
                                                        <div><span className="text-foreground/60">Strategy:</span> {op.type}</div>
                                                        <div><span className="text-foreground/60">Tool ID:</span> {op.toolId}</div>
                                                        {(op.estimated_time_s || op.statistics?.cycleTimeSeconds) && (
                                                            <div className="text-blue-500/80"><span className="text-foreground/60">Cycle Time:</span> {formatTime(op.estimated_time_s || op.statistics?.cycleTimeSeconds || 0)}</div>
                                                        )}
                                                        {(op.status === 'blocked' || op.status === 'error') && op.parameters?.error && (
                                                            <div className="text-red-400 mt-1 whitespace-pre-wrap font-sans text-[10px]">
                                                                {op.parameters.error}
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}
                        </div>
                    );
                }) : (
                    <>
                        {/* Fallback Legacy Setup Section */}
                        <div 
                            onClick={() => onClickSection('setup')}
                            className="p-3.5 rounded-xl bg-slate-50 dark:bg-white/[0.03] hover:bg-slate-100/80 dark:hover:bg-white/[0.06] cursor-pointer border border-slate-200/80 dark:border-white/10 transition-all flex flex-col gap-1 shadow-xs dark:shadow-none"
                        >
                            <div className="flex items-center gap-2 text-blue-600 dark:text-blue-400 font-bold text-xs uppercase tracking-wide">
                                <Settings2 className="size-3.5" /> Setup
                            </div>
                            <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-[11px] text-slate-500 dark:text-muted-foreground mt-1">
                                <div>Machine:</div><div className="text-slate-800 dark:text-foreground capitalize font-medium">{setup?.machineProfile ? (MACHINE_MATRIX.machineProfiles.find(p => p.id === setup.machineProfile)?.label || setup.machineProfile) : 'Not selected'}</div>
                                <div>Type:</div><div className="text-slate-800 dark:text-foreground capitalize font-medium">{setup?.machineType ? setup.machineType.replace(/_/g, ' ') : ((setup as any)?.setupType || 'Not set')}</div>
                                <div>Tool Axis:</div><div className="text-slate-800 dark:text-foreground font-mono font-medium">{(setup as any)?.toolAxis ? `[${(setup as any).toolAxis.join(', ')}]` : 'Not set'}</div>
                                <div>Material:</div><div className="text-slate-800 dark:text-foreground font-medium">{setup?.material ? getMaterialLabel(setup.material) : 'Not selected'}</div>
                                <div>Stock:</div>
                                <div className="text-slate-800 dark:text-foreground font-mono font-medium">
                                    {(() => {
                                        if (!setup?.stockDimensions || (!setup.stockDimensions[0] && !setup.stockDimensions[1] && !setup.stockDimensions[2])) {
                                            return 'Not set';
                                        }
                                        const isCyl = setup.stockType?.includes('cylinder') || (setup as any).machineType === 'CNC_LATHE';
                                        const d0 = Number(setup.cylinderDiameter ?? setup.stockDimensions[0]).toFixed(2).replace(/\.00$/, '');
                                        const d1 = Number(setup.stockDimensions[1]).toFixed(2).replace(/\.00$/, '');
                                        const d2 = Number(setup.cylinderLength ?? setup.stockDimensions[2]).toFixed(2).replace(/\.00$/, '');
                                        const unit = setup.displayUnits || setup.units || 'mm';

                                        if (isCyl) {
                                            return `ø${d0} × ${d2} ${unit}`;
                                        }
                                        return `${d0} × ${d1} × ${d2} ${unit}`;
                                    })()}
                                </div>
                                <div>WCS:</div><div className="text-slate-800 dark:text-foreground font-medium">{setup?.wcs || 'Not set'}</div>
                            </div>
                        </div>

                        {/* Legacy Features Section */}
                        <div 
                            className="p-3.5 rounded-xl bg-slate-50 dark:bg-white/[0.03] border border-slate-200/80 dark:border-white/10 transition-all flex flex-col gap-1 shadow-xs dark:shadow-none"
                        >
                            <div className="flex items-center gap-2 text-cyan-600 dark:text-cyan-400 font-bold text-xs uppercase tracking-wide">
                                <Target className="size-3.5" /> Detected Features ({features.length})
                            </div>
                            <div className="flex flex-col gap-1 mt-1">
                                {features.length === 0 ? (
                                    <span className="text-[11px] text-slate-500 dark:text-muted-foreground">No features detected</span>
                                ) : (
                                    features.map(f => {
                                        const status = f.machining_info?.status || 'machinable_in_active_setup';
                                        let statusLabel = '✅ Machinable';
                                        let isBlocked = false;

                                        if (status === 'machinable_in_secondary_setup') {
                                            statusLabel = '🔄 Assigned to secondary setup';
                                        } else if (status === 'requires_turning') {
                                            statusLabel = '🔄 Requires turning';
                                        } else if (status === 'requires_4axis_indexing') {
                                            statusLabel = '🔄 Requires 4-axis indexing';
                                        } else if (status === 'unsupported') {
                                            statusLabel = '🛑 Blocked';
                                            isBlocked = true;
                                        } else if (status !== 'machinable_in_active_setup') {
                                            statusLabel = `🛑 Blocked (${status})`;
                                            isBlocked = true;
                                        }

                                        return (
                                            <div key={f.id} className="text-[11px] flex flex-col gap-0.5 pb-2 mb-2 border-b border-border/40 last:border-0 last:pb-0 last:mb-0">
                                                <div className="flex justify-between items-start">
                                                    <span className="text-foreground font-medium capitalize">{f.name || f.type?.replace('_', ' ')}</span>
                                                    <span className="text-[10px] whitespace-nowrap">
                                                        {statusLabel}
                                                    </span>
                                                </div>
                                                <div className="flex flex-col gap-0.5 text-[9px] text-muted-foreground font-mono ml-1 border-l border-border/50 pl-2">
                                                    <div><span className="text-foreground/60">ID:</span> {f.id}</div>
                                                    <div><span className="text-foreground/60">Type:</span> {f.type} / {(f as any).subtype || '—'}</div>
                                                    {f.axis && <div><span className="text-foreground/60">Axis:</span> [{f.axis.map(v => v.toFixed(2)).join(', ')}]</div>}
                                                    {f.machining_region && <div><span className="text-foreground/60">Region:</span> {f.machining_region}</div>}
                                                    {isBlocked && f.machining_info?.reason && (
                                                        <div className="text-red-400 mt-1 whitespace-pre-wrap font-sans text-[10px]">
                                                            {f.machining_info.reason}
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })
                                )}
                            </div>
                        </div>

                        {/* Legacy Operations Section */}
                        <div 
                            onClick={() => onClickSection('operations')}
                            className="p-3.5 rounded-xl bg-slate-50 dark:bg-white/[0.03] hover:bg-slate-100/80 dark:hover:bg-white/[0.06] cursor-pointer border border-slate-200/80 dark:border-white/10 transition-all flex flex-col gap-1 shadow-xs dark:shadow-none"
                        >
                            <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400 font-bold text-xs uppercase tracking-wide">
                                <Layers className="size-3.5" /> Operations ({operations.length})
                            </div>
                            <div className="flex flex-col gap-1 mt-1">
                                {operations.length === 0 ? (
                                    <span className="text-[11px] text-slate-500 dark:text-muted-foreground">No operations</span>
                                ) : (
                                    operations.map(op => {
                                        const numSegments = op.toolpaths ? op.toolpaths.length : 0;
                                        const isOutdated = op.toolpaths && op.toolpaths.length > 0 && op.toolpath_schema_version !== 'semantic_v1';
                                        const displayStatus = isOutdated ? 'outdated' : op.status;
                                        
                                        return (
                                            <div key={op.id} className="text-[11px] flex flex-col gap-1 pb-2 mb-2 border-b border-border/40 last:border-0 last:pb-0 last:mb-0">
                                                <div className="flex justify-between items-start">
                                                    <span className="text-foreground font-medium capitalize">{op.name || op.type?.replace('_', ' ')}</span>
                                                    <span className="text-[10px] whitespace-nowrap">
                                                        {displayStatus === 'ready' || displayStatus === 'planned' ? '🟢 OK' : displayStatus === 'error' ? '🔴 Error' : displayStatus === 'blocked' || displayStatus === 'blocked_requires_reorientation' ? '🚧 Blocked' : displayStatus === 'missing_tool' ? '⚠️ No Tool' : displayStatus === 'requires_regeneration' || displayStatus === 'outdated' ? '⚠️ Needs Regen' : displayStatus || '🟢 OK'}
                                                    </span>
                                                </div>
                                                <div className="flex flex-col gap-0.5 text-[9px] text-muted-foreground font-mono ml-1 border-l border-border/50 pl-2">
                                                    <div><span className="text-foreground/60">Feature ID:</span> {op.feature_id || 'None'}</div>
                                                    <div><span className="text-foreground/60">Strategy:</span> {op.type}</div>
                                                    <div><span className="text-foreground/60">Segments:</span> <span className={numSegments > 2000 ? "text-amber-500 font-bold" : ""}>{numSegments}</span></div>
                                                    {(op.estimated_time_s || op.statistics?.cycleTimeSeconds) && (
                                                        <div className="text-blue-500/80"><span className="text-foreground/60">Cycle Time:</span> {formatTime(op.estimated_time_s || op.statistics?.cycleTimeSeconds || 0)}</div>
                                                    )}
                                                    {op.parameters?.diagnostics && (
                                                        <>
                                                            <div><span className="text-foreground/60">Region Area:</span> {op.parameters.diagnostics.region_area} mm²</div>
                                                            <div><span className="text-foreground/60">Toolpath Area:</span> {op.parameters.diagnostics.toolpath_area} mm²</div>
                                                        </>
                                                    )}
                                                    {(displayStatus === 'error' || displayStatus === 'blocked') && op.parameters?.error && (
                                                        <div className="text-red-400 mt-1 whitespace-pre-wrap font-sans text-[10px]">{op.parameters.error}</div>
                                                    )}
                                                    {isOutdated && (
                                                        <div className="text-amber-400 mt-1 whitespace-pre-wrap font-sans text-[10px]">Operation toolpath uses outdated or missing schema. Regenerate toolpaths.</div>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })
                                )}
                            </div>
                        </div>
                    </>
                )}

                {/* Details Section */}
                <div 
                    onClick={() => onClickSection('setup')}
                    className="p-3.5 rounded-xl bg-slate-50 dark:bg-white/[0.03] hover:bg-slate-100/80 dark:hover:bg-white/[0.06] cursor-pointer border border-slate-200/80 dark:border-white/10 transition-all flex flex-col gap-1 shadow-xs dark:shadow-none"
                >
                    <div className="flex items-center gap-2 text-purple-600 dark:text-purple-400 font-bold text-xs uppercase tracking-wide">
                        <FileCode className="size-3.5" /> Manufacturing Details
                    </div>
                    <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-[11px] text-slate-500 dark:text-muted-foreground mt-1">
                        <div>Post:</div><div className="text-slate-800 dark:text-foreground capitalize font-medium">{setup.postProcessor || 'Not selected'}</div>
                        <div>Cycle Time:</div><div className="text-slate-800 dark:text-foreground font-mono font-medium">{formatTime(totalCycleTime)}</div>
                    </div>
                </div>

                {/* Diagnostics Section */}
                {coordValidation?.diagnostics && (
                    <div 
                        className="p-3.5 rounded-xl bg-slate-50 dark:bg-white/[0.03] border border-slate-200/80 dark:border-white/10 flex flex-col gap-1 shadow-xs dark:shadow-none"
                    >
                        <div className="flex items-center gap-2 text-rose-600 dark:text-rose-400 font-bold text-xs uppercase tracking-wide">
                            <Activity className="size-3.5" /> Diagnostics
                        </div>
                        <div className="grid grid-cols-1 gap-1 text-[10px] text-slate-600 dark:text-muted-foreground font-mono mt-1">
                            <div>
                                <span className="text-foreground/70">Model BBox: </span> 
                                [{coordValidation.diagnostics.model_bbox?.min?.map((v:number)=>v.toFixed(1)).join(',')}] to [{coordValidation.diagnostics.model_bbox?.max?.map((v:number)=>v.toFixed(1)).join(',')}]
                            </div>
                            <div>
                                <span className="text-foreground/70">Toolpath BBox: </span> 
                                [{coordValidation.diagnostics.toolpath_bbox?.min?.map((v:number)=>v.toFixed(1)).join(',')}] to [{coordValidation.diagnostics.toolpath_bbox?.max?.map((v:number)=>v.toFixed(1)).join(',')}]
                            </div>
                            <div>
                                <span className="text-foreground/70">Offset: </span> 
                                [{coordValidation.diagnostics.coordinate_offset?.map((v:number)=>v.toFixed(2)).join(', ')}] ({coordValidation.diagnostics.offset_distance?.toFixed(2)}mm)
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
