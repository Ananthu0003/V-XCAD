import type { CamOperation, CuttingParameters, CoolantType } from '@/types/cam';
import { Settings, Maximize2, GitMerge } from 'lucide-react';

type OperationPropertyPanelProps = {
    operation: CamOperation;
    onChange: (operation: CamOperation) => void;
};

export function OperationPropertyPanel({ operation, onChange }: OperationPropertyPanelProps) {
    const updateParams = (field: keyof CuttingParameters, value: any) => {
        onChange({ ...operation, parameters: { ...operation.parameters, [field]: value } });
    };

    const updateHeights = (field: string, value: any) => {
        const heights = operation.heights || {
            clearanceHeight: 15,
            retractHeight: 5,
            feedHeight: 2,
            topHeight: 'stock_top',
            bottomHeight: 'model_bottom'
        };
        onChange({ ...operation, heights: { ...heights, [field]: value } as any });
    };

    const updateLinking = (field: string, value: any) => {
        const linking = operation.parameters.linking || {
            leadInRadius: 2,
            leadOutRadius: 2,
            helicalEntry: false,
            rampAngle: 2,
            transitionMoves: 'smooth',
            smoothing: true
        };
        updateParams('linking', { ...linking, [field]: value });
    };

    const params = operation.parameters;
    const heights = operation.heights || {
        clearanceHeight: 15, retractHeight: 5, feedHeight: 2, topHeight: 'stock_top', bottomHeight: 'model_bottom'
    };
    const linking = params.linking || {
        leadInRadius: 2, leadOutRadius: 2, helicalEntry: false, rampAngle: 2, transitionMoves: 'smooth', smoothing: true
    };

    return (
        <div className="flex flex-col gap-6">
            {/* Generic Feeds & Speeds */}
            <div className="flex flex-col gap-4">
                <div className="flex items-center gap-2 border-b border-border/50 pb-2">
                    <Settings className="size-4 text-blue-500" />
                    <span className="text-xs font-semibold text-foreground">Feeds & Speeds</span>
                </div>
                
                <div className="grid grid-cols-2 gap-3">
                    <div className="flex flex-col gap-2">
                        <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Spindle (RPM)</label>
                        <input type="number" value={params.spindleSpeed} onChange={(e) => updateParams('spindleSpeed', parseFloat(e.target.value) || 0)} className="w-full bg-input border border-border rounded-lg px-3 py-3 text-xs text-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50 outline-none transition-all shadow-inner" />
                    </div>
                    <div className="flex flex-col gap-2">
                        <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Coolant</label>
                        <select value={params.coolant} onChange={(e) => updateParams('coolant', e.target.value)} className="w-full bg-input border border-border rounded-lg px-3 py-3 text-xs text-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50 outline-none transition-all shadow-inner">
                            <option value="off">Off</option>
                            <option value="flood">Flood (M08)</option>
                            <option value="mist">Mist (M07)</option>
                            <option value="through_tool">Through Tool</option>
                            <option value="air_blast">Air Blast</option>
                        </select>
                    </div>
                    <div className="flex flex-col gap-2">
                        <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Feed (mm/min)</label>
                        <input type="number" value={params.feedRate} onChange={(e) => updateParams('feedRate', parseFloat(e.target.value) || 0)} className="w-full bg-input border border-border rounded-lg px-3 py-3 text-xs text-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50 outline-none transition-all shadow-inner" />
                    </div>
                    <div className="flex flex-col gap-2">
                        <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Plunge (mm/min)</label>
                        <input type="number" value={params.plungeRate} onChange={(e) => updateParams('plungeRate', parseFloat(e.target.value) || 0)} className="w-full bg-input border border-border rounded-lg px-3 py-3 text-xs text-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50 outline-none transition-all shadow-inner" />
                    </div>
                </div>
            </div>

            {/* Operation Specific Geometry / Passes */}
            <div className="flex flex-col gap-4">
                <div className="flex items-center gap-2 border-b border-border/50 pb-2">
                    <Maximize2 className="size-4 text-amber-500" />
                    <span className="text-xs font-semibold text-foreground capitalize">{operation.type.replace('_', ' ')} Passes</span>
                </div>

                {operation.type === '2d_contour' && (
                    <div className="grid grid-cols-2 gap-3">
                        <div className="flex flex-col gap-2">
                            <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Side</label>
                            <select value={params.insideOutside || 'outside'} onChange={(e) => updateParams('insideOutside', e.target.value)} className="w-full bg-input border border-border rounded-lg px-3 py-3 text-xs text-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50 outline-none transition-all shadow-inner">
                                <option value="outside">Outside</option>
                                <option value="inside">Inside</option>
                            </select>
                        </div>
                        <div className="flex flex-col gap-2">
                            <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Direction</label>
                            <select value={params.climbConventional || 'climb'} onChange={(e) => updateParams('climbConventional', e.target.value)} className="w-full bg-input border border-border rounded-lg px-3 py-3 text-xs text-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50 outline-none transition-all shadow-inner">
                                <option value="climb">Climb</option>
                                <option value="conventional">Conventional</option>
                            </select>
                        </div>
                        <div className="flex flex-col gap-2">
                            <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Compensation</label>
                            <select value={params.compensation || 'computer'} onChange={(e) => updateParams('compensation', e.target.value)} className="w-full bg-input border border-border rounded-lg px-3 py-3 text-xs text-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50 outline-none transition-all shadow-inner">
                                <option value="computer">In Computer</option>
                                <option value="wear">In Control (Wear)</option>
                                <option value="off">Off</option>
                            </select>
                        </div>
                        <div className="flex flex-col gap-2">
                            <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Stock to Leave</label>
                            <input type="number" step="0.1" value={params.stockToLeave || 0} onChange={(e) => updateParams('stockToLeave', parseFloat(e.target.value) || 0)} className="w-full bg-input border border-border rounded-lg px-3 py-3 text-xs text-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50 outline-none transition-all shadow-inner" />
                        </div>
                    </div>
                )}

                {operation.type === 'pocket' && (
                    <div className="grid grid-cols-2 gap-3">
                        <div className="flex flex-col gap-2 col-span-2">
                            <label className="text-[10px] font-bold flex items-center gap-2"><input type="checkbox" checked={params.adaptive || false} onChange={e => updateParams('adaptive', e.target.checked)} className="rounded" /> Adaptive Clearing</label>
                        </div>
                        <div className="flex flex-col gap-2">
                            <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Stepover %</label>
                            <input type="number" value={params.stepoverPercentage} onChange={(e) => updateParams('stepoverPercentage', parseFloat(e.target.value) || 40)} className="w-full bg-input border border-border rounded-lg px-3 py-3 text-xs text-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50 outline-none transition-all shadow-inner" />
                        </div>
                        <div className="flex flex-col gap-2">
                            <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Stock to Leave</label>
                            <input type="number" step="0.1" value={params.stockToLeave || 0} onChange={(e) => updateParams('stockToLeave', parseFloat(e.target.value) || 0)} className="w-full bg-input border border-border rounded-lg px-3 py-3 text-xs text-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50 outline-none transition-all shadow-inner" />
                        </div>
                        <div className="flex flex-col gap-2 col-span-2">
                            <label className="text-[10px] font-bold flex items-center gap-2"><input type="checkbox" checked={params.restMachining || false} onChange={e => updateParams('restMachining', e.target.checked)} className="rounded" /> Rest Machining</label>
                        </div>
                    </div>
                )}

                {operation.type === 'facing' && (
                    <div className="grid grid-cols-2 gap-3">
                        <div className="flex flex-col gap-2">
                            <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Pattern</label>
                            <select value={params.facingPattern || 'zig_zag'} onChange={(e) => updateParams('facingPattern', e.target.value)} className="w-full bg-input border border-border rounded-lg px-3 py-3 text-xs text-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50 outline-none transition-all shadow-inner">
                                <option value="zig_zag">Zig-Zag</option>
                                <option value="one_way">One Way</option>
                                <option value="spiral">Spiral</option>
                            </select>
                        </div>
                        <div className="flex flex-col gap-2">
                            <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Overlap %</label>
                            <input type="number" value={params.overlapPercentage || 50} onChange={(e) => updateParams('overlapPercentage', parseFloat(e.target.value) || 50)} className="w-full bg-input border border-border rounded-lg px-3 py-3 text-xs text-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50 outline-none transition-all shadow-inner" />
                        </div>
                        <div className="flex flex-col gap-2">
                            <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Stepover %</label>
                            <input type="number" value={params.stepoverPercentage} onChange={(e) => updateParams('stepoverPercentage', parseFloat(e.target.value) || 40)} className="w-full bg-input border border-border rounded-lg px-3 py-3 text-xs text-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50 outline-none transition-all shadow-inner" />
                        </div>
                    </div>
                )}

                {operation.type === 'drilling' && (
                    <div className="grid grid-cols-2 gap-3">
                        <div className="flex flex-col gap-2">
                            <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Cycle</label>
                            <select value={params.drillCycle || 'G81'} onChange={(e) => updateParams('drillCycle', e.target.value)} className="w-full bg-input border border-border rounded-lg px-3 py-3 text-xs text-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50 outline-none transition-all shadow-inner">
                                <option value="G81">G81 (Standard)</option>
                                <option value="G82">G82 (Dwell)</option>
                                <option value="G83">G83 (Deep Peck)</option>
                                <option value="G84">G84 (Tapping)</option>
                            </select>
                        </div>
                        <div className="flex flex-col gap-2">
                            <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Peck Depth</label>
                            <input type="number" step="0.5" value={params.peckDepth || 0} onChange={(e) => updateParams('peckDepth', parseFloat(e.target.value) || 0)} className="w-full bg-input border border-border rounded-lg px-3 py-3 text-xs text-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50 outline-none transition-all shadow-inner" disabled={params.drillCycle !== 'G83'} />
                        </div>
                        <div className="flex flex-col gap-2">
                            <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Dwell (s)</label>
                            <input type="number" step="0.1" value={params.dwellTime || 0} onChange={(e) => updateParams('dwellTime', parseFloat(e.target.value) || 0)} className="w-full bg-input border border-border rounded-lg px-3 py-3 text-xs text-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50 outline-none transition-all shadow-inner" disabled={params.drillCycle !== 'G82'} />
                        </div>
                        <div className="flex flex-col gap-2">
                            <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Retract</label>
                            <select value={params.retractType || 'G98'} onChange={(e) => updateParams('retractType', e.target.value)} className="w-full bg-input border border-border rounded-lg px-3 py-3 text-xs text-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50 outline-none transition-all shadow-inner">
                                <option value="G98">G98 (Clearance)</option>
                                <option value="G99">G99 (Retract)</option>
                            </select>
                        </div>
                    </div>
                )}

                {operation.type === 'chamfer' && (
                    <div className="grid grid-cols-2 gap-3">
                        <div className="flex flex-col gap-2">
                            <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Chamfer Width</label>
                            <input type="number" step="0.1" value={params.chamferWidth || 1} onChange={(e) => updateParams('chamferWidth', parseFloat(e.target.value) || 1)} className="w-full bg-input border border-border rounded-lg px-3 py-3 text-xs text-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50 outline-none transition-all shadow-inner" />
                        </div>
                        <div className="flex flex-col gap-2">
                            <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Chamfer Angle</label>
                            <input type="number" value={params.chamferAngle || 45} onChange={(e) => updateParams('chamferAngle', parseFloat(e.target.value) || 45)} className="w-full bg-input border border-border rounded-lg px-3 py-3 text-xs text-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50 outline-none transition-all shadow-inner" />
                        </div>
                    </div>
                )}
            </div>

            {/* Heights */}
            <div className="flex flex-col gap-4">
                <div className="flex items-center gap-2 border-b border-border/50 pb-2">
                    <Maximize2 className="size-4 text-emerald-500" />
                    <span className="text-xs font-semibold text-foreground">Heights</span>
                </div>
                <div className="grid grid-cols-2 gap-3">
                    <div className="flex flex-col gap-2">
                        <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Clearance (mm)</label>
                        <input type="number" value={heights.clearanceHeight} onChange={(e) => updateHeights('clearanceHeight', parseFloat(e.target.value) || 0)} className="w-full bg-input border border-border rounded-lg px-3 py-3 text-xs text-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50 outline-none transition-all shadow-inner" />
                    </div>
                    <div className="flex flex-col gap-2">
                        <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Retract (mm)</label>
                        <input type="number" value={heights.retractHeight} onChange={(e) => updateHeights('retractHeight', parseFloat(e.target.value) || 0)} className="w-full bg-input border border-border rounded-lg px-3 py-3 text-xs text-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50 outline-none transition-all shadow-inner" />
                    </div>
                    <div className="flex flex-col gap-2">
                        <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Top Height</label>
                        <select value={heights.topHeight} onChange={(e) => updateHeights('topHeight', e.target.value)} className="w-full bg-input border border-border rounded-lg px-3 py-3 text-xs text-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50 outline-none transition-all shadow-inner">
                            <option value="stock_top">Stock Top</option>
                            <option value="model_top">Model Top</option>
                        </select>
                    </div>
                    <div className="flex flex-col gap-2">
                        <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Bottom Height</label>
                        <select value={heights.bottomHeight} onChange={(e) => updateHeights('bottomHeight', e.target.value)} className="w-full bg-input border border-border rounded-lg px-3 py-3 text-xs text-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50 outline-none transition-all shadow-inner">
                            <option value="model_bottom">Model Bottom</option>
                            <option value="stock_bottom">Stock Bottom</option>
                            <option value="selection">Selection</option>
                        </select>
                    </div>
                </div>
            </div>

            {/* Linking */}
            <div className="flex flex-col gap-4">
                <div className="flex items-center gap-2 border-b border-border/50 pb-2">
                    <GitMerge className="size-4 text-purple-500" />
                    <span className="text-xs font-semibold text-foreground">Linking</span>
                </div>
                <div className="grid grid-cols-2 gap-3">
                    <div className="flex flex-col gap-2">
                        <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Lead In Radius</label>
                        <input type="number" value={linking.leadInRadius} onChange={(e) => updateLinking('leadInRadius', parseFloat(e.target.value) || 0)} className="w-full bg-input border border-border rounded-lg px-3 py-3 text-xs text-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50 outline-none transition-all shadow-inner" />
                    </div>
                    <div className="flex flex-col gap-2">
                        <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Lead Out Radius</label>
                        <input type="number" value={linking.leadOutRadius} onChange={(e) => updateLinking('leadOutRadius', parseFloat(e.target.value) || 0)} className="w-full bg-input border border-border rounded-lg px-3 py-3 text-xs text-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50 outline-none transition-all shadow-inner" />
                    </div>
                    <div className="flex flex-col gap-2 col-span-2">
                        <label className="text-[10px] font-bold flex items-center gap-2"><input type="checkbox" checked={linking.helicalEntry} onChange={e => updateLinking('helicalEntry', e.target.checked)} className="rounded" /> Helical Entry</label>
                    </div>
                </div>
            </div>
            
            {/* Toolpath Statistics (if generated) */}
            {operation.statistics && (
                <div className="flex flex-col gap-2 p-3 bg-black/40 border border-border rounded-lg mt-2">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">Statistics</div>
                    <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-xs text-muted-foreground">
                        <div className="flex justify-between"><span>Cycle Time:</span><span className="text-foreground">{Math.floor(operation.statistics.cycleTimeSeconds / 60)}m {Math.floor(operation.statistics.cycleTimeSeconds % 60)}s</span></div>
                        <div className="flex justify-between"><span>Rapid Dist:</span><span className="text-foreground">{operation.statistics.rapidDistance} mm</span></div>
                        <div className="flex justify-between"><span>Cut Dist:</span><span className="text-foreground">{operation.statistics.cutDistance} mm</span></div>
                        <div className="flex justify-between"><span>Vol Removed:</span><span className="text-foreground">{operation.statistics.materialRemovedVolume} mm³</span></div>
                    </div>
                </div>
            )}

            {/* Diagnostics */}
            {(operation as any).geometry?.diagnostics || (operation as any).geometry?.status === 'failed' || (operation as any).status === 'error' ? (
                <div className="flex flex-col gap-2 p-3 bg-red-950/20 border border-red-900/30 rounded-lg mt-2">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-red-500/80 mb-1 flex items-center gap-2">
                        Diagnostics
                    </div>
                    <div className="grid grid-cols-1 gap-1 text-xs text-muted-foreground">
                        {/* Geometry Found */}
                        <div className="flex justify-between items-center border-b border-border/20 pb-1">
                            <span>Geometry Found:</span>
                            <span className="text-foreground capitalize">
                                {((operation as any).geometry?.diagnostics?.feature_type || 'Unknown').replace('_', ' ')}
                            </span>
                        </div>
                        {/* Region Area */}
                        <div className="flex justify-between items-center border-b border-border/20 pb-1">
                            <span>Region Area:</span>
                            <span className="text-foreground">
                                {((operation as any).geometry?.diagnostics?.mapped_area || 0).toFixed(2)} mm²
                            </span>
                        </div>
                        {/* Boundary Count */}
                        <div className="flex justify-between items-center border-b border-border/20 pb-1">
                            <span>Boundary Count:</span>
                            <span className="text-foreground">
                                {(operation as any).geometry?.diagnostics?.boundary_count || 0}
                            </span>
                        </div>
                        {/* Toolpath Count */}
                        <div className="flex justify-between items-center border-b border-border/20 pb-1">
                            <span>Toolpath Count:</span>
                            <span className="text-foreground">
                                {(operation as any).toolpaths?.length || 0} segments
                            </span>
                        </div>
                        {/* Failure Reason */}
                        {((operation as any).geometry?.status === 'failed' || (operation as any).status === 'error') && (
                            <div className="flex flex-col mt-1">
                                <span className="text-red-400">Failure Reason:</span>
                                <span className="text-red-300 text-[10px] leading-tight">
                                    {(operation as any).geometry?.error || (operation as any).parameters?.error || 'Unknown error'}
                                </span>
                            </div>
                        )}
                    </div>
                </div>
            ) : null}
        </div>
    );
}
