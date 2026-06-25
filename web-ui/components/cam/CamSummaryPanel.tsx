import { SetupSettings, Tool, CamOperation, CamFeature } from '@/types/cam';
import { Target, Layers, Settings2, Scissors, Activity, FileCode } from 'lucide-react';

type CamSummaryPanelProps = {
    setup: SetupSettings;
    tools: Tool[];
    operations: CamOperation[];
    features?: CamFeature[];
    coordValidation?: any;
    onClickSection: (sectionId: string) => void;
};

export function CamSummaryPanel({ setup, tools, operations, features = [], coordValidation, onClickSection }: CamSummaryPanelProps) {
    const totalCycleTime = operations.reduce((acc, op) => acc + (op.statistics?.cycleTimeSeconds || 0), 0);
    const formatTime = (seconds: number) => {
        if (!seconds) return 'N/A';
        const m = Math.floor(seconds / 60);
        const s = Math.floor(seconds % 60);
        return `${m}m ${s}s`;
    };

    return (
        <div className="flex flex-col gap-4 p-4 rounded-xl border border-border bg-black/40 shadow-xl overflow-y-auto">
            <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                <Activity className="size-4" /> CAM Setup Summary
            </h3>
            
            <div className="grid grid-cols-1 gap-2">
                {/* Setup Section */}
                <div 
                    onClick={() => onClickSection('setup')}
                    className="p-3 rounded-lg bg-background hover:bg-accent/50 cursor-pointer border border-transparent hover:border-border transition-all flex flex-col gap-1"
                >
                    <div className="flex items-center gap-2 text-blue-500 font-semibold text-xs uppercase tracking-wide">
                        <Settings2 className="size-3.5" /> Setup
                    </div>
                    <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-[11px] text-muted-foreground mt-1">
                        <div>Machine:</div><div className="text-foreground capitalize">{setup.machine || 'Not selected'}</div>
                        <div>Type:</div><div className="text-foreground capitalize">{(setup as any).setupType || '3-Axis'}</div>
                        <div>Tool Axis:</div><div className="text-foreground font-mono">[{(setup as any).toolAxis?.join(', ') || '0, 0, 1'}]</div>
                        <div>Material:</div><div className="text-foreground capitalize">{setup.material.replace('_', ' ')}</div>
                        <div>Stock:</div><div className="text-foreground">{setup.stockDimensions.join(' x ')} mm</div>
                        <div>WCS:</div><div className="text-foreground">{setup.wcs}</div>
                    </div>
                </div>

                {/* Tools Section */}
                <div 
                    onClick={() => onClickSection('tools')}
                    className="p-3 rounded-lg bg-background hover:bg-accent/50 cursor-pointer border border-transparent hover:border-border transition-all flex flex-col gap-1"
                >
                    <div className="flex items-center gap-2 text-emerald-500 font-semibold text-xs uppercase tracking-wide">
                        <Scissors className="size-3.5" /> Selected Tools ({tools.length})
                    </div>
                    <div className="flex flex-col gap-1 mt-1">
                        {tools.length === 0 ? (
                            <span className="text-[11px] text-muted-foreground">No tools selected</span>
                        ) : (
                            tools.map(t => (
                                <div key={t.id} className="text-[11px] flex justify-between">
                                    <span className="text-muted-foreground">{t.number} {t.type.replace(/_/g, ' ')}</span>
                                    <span className="font-mono text-foreground">Ø{t.diameter}</span>
                                </div>
                            ))
                        )}
                    </div>
                </div>

                {/* Features Section */}
                <div 
                    className="p-3 rounded-lg bg-background border border-transparent transition-all flex flex-col gap-1"
                >
                    <div className="flex items-center gap-2 text-cyan-500 font-semibold text-xs uppercase tracking-wide">
                        <Target className="size-3.5" /> Detected Features ({features.length})
                    </div>
                    <div className="flex flex-col gap-1 mt-1">
                        {features.length === 0 ? (
                            <span className="text-[11px] text-muted-foreground">No features detected</span>
                        ) : (
                            features.map(f => {
                                const isBlocked = f.machinable_in_current_setup === false;
                                return (
                                    <div key={f.id} className="text-[11px] flex flex-col gap-0.5 pb-2 mb-2 border-b border-border/40 last:border-0 last:pb-0 last:mb-0">
                                        <div className="flex justify-between items-start">
                                            <span className="text-foreground font-medium capitalize">{f.name || f.type?.replace('_', ' ')}</span>
                                            <span className="text-[10px] whitespace-nowrap">
                                                {isBlocked ? '🛑 Blocked' : '✅ Machinable'}
                                            </span>
                                        </div>
                                        <div className="flex flex-col gap-0.5 text-[9px] text-muted-foreground font-mono ml-1 border-l border-border/50 pl-2">
                                            <div><span className="text-foreground/60">ID:</span> {f.id}</div>
                                            <div><span className="text-foreground/60">Type:</span> {f.type} / {(f as any).subtype || '—'}</div>
                                            {f.axis && <div><span className="text-foreground/60">Axis:</span> [{f.axis.map(v => v.toFixed(2)).join(', ')}]</div>}
                                            {f.machining_region && <div><span className="text-foreground/60">Region:</span> {f.machining_region}</div>}
                                            {isBlocked && f.blocked_reason && (
                                                <div className="text-red-400 mt-1 whitespace-pre-wrap font-sans text-[10px]">
                                                    {f.blocked_reason}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                );
                            })
                        )}
                    </div>
                </div>

                {/* Operations Section */}
                <div 
                    onClick={() => onClickSection('operations')}
                    className="p-3 rounded-lg bg-background hover:bg-accent/50 cursor-pointer border border-transparent hover:border-border transition-all flex flex-col gap-1"
                >
                    <div className="flex items-center gap-2 text-amber-500 font-semibold text-xs uppercase tracking-wide">
                        <Layers className="size-3.5" /> Operations ({operations.length})
                    </div>
                    <div className="flex flex-col gap-1 mt-1">
                        {operations.length === 0 ? (
                            <span className="text-[11px] text-muted-foreground">No operations</span>
                        ) : (
                            operations.map(op => {
                                const numSegments = op.toolpaths ? op.toolpaths.length : 0;
                                return (
                                    <div key={op.id} className="text-[11px] flex flex-col gap-1 pb-2 mb-2 border-b border-border/40 last:border-0 last:pb-0 last:mb-0">
                                        <div className="flex justify-between items-start">
                                            <span className="text-foreground font-medium capitalize">{op.name || op.type.replace('_', ' ')}</span>
                                            <span className="text-[10px] whitespace-nowrap">
                                                {op.status === 'ready' ? '🟢 OK' : op.status === 'error' ? '🔴 Error' : op.status === 'blocked_requires_reorientation' ? '🛑 Blocked' : op.status === 'missing_tool' ? '🔴 No Tool' : op.status === 'requires_regeneration' ? '🟡 Needs Regen' : '🟢 OK'}
                                            </span>
                                        </div>
                                        <div className="flex flex-col gap-0.5 text-[9px] text-muted-foreground font-mono ml-1 border-l border-border/50 pl-2">
                                            <div><span className="text-foreground/60">Feature ID:</span> {op.feature_id || 'None'}</div>
                                            <div><span className="text-foreground/60">Strategy:</span> {op.type}</div>
                                            <div><span className="text-foreground/60">Segments:</span> <span className={numSegments > 2000 ? "text-amber-500 font-bold" : ""}>{numSegments}</span></div>
                                            {op.parameters?.diagnostics && (
                                                <>
                                                    <div><span className="text-foreground/60">Region Area:</span> {op.parameters.diagnostics.region_area} mm²</div>
                                                    <div><span className="text-foreground/60">Toolpath Area:</span> {op.parameters.diagnostics.toolpath_area} mm²</div>
                                                </>
                                            )}
                                            {op.status === 'error' && op.parameters?.error && (
                                                <div className="text-red-400 mt-1 whitespace-pre-wrap font-sans">{op.parameters.error}</div>
                                            )}
                                        </div>
                                    </div>
                                );
                            })
                        )}
                    </div>
                </div>

                {/* Details Section */}
                <div 
                    onClick={() => onClickSection('setup')}
                    className="p-3 rounded-lg bg-background hover:bg-accent/50 cursor-pointer border border-transparent hover:border-border transition-all flex flex-col gap-1"
                >
                    <div className="flex items-center gap-2 text-purple-500 font-semibold text-xs uppercase tracking-wide">
                        <FileCode className="size-3.5" /> Manufacturing Details
                    </div>
                    <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-[11px] text-muted-foreground mt-1">
                        <div>Post:</div><div className="text-foreground capitalize">{setup.postProcessor || 'Not selected'}</div>
                        <div>Cycle Time:</div><div className="text-foreground font-mono">{formatTime(totalCycleTime)}</div>
                    </div>
                </div>

                {/* Diagnostics Section */}
                {coordValidation?.diagnostics && (
                    <div 
                        className="p-3 rounded-lg bg-background border border-border flex flex-col gap-1"
                    >
                        <div className="flex items-center gap-2 text-rose-500 font-semibold text-xs uppercase tracking-wide">
                            <Activity className="size-3.5" /> Diagnostics
                        </div>
                        <div className="grid grid-cols-1 gap-1 text-[10px] text-muted-foreground font-mono mt-1">
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
