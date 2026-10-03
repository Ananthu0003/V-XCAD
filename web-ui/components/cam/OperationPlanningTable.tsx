import React from 'react';
import { CamOperation } from '../../types/cam';
import { Activity, AlertTriangle, CheckCircle2, AlertCircle, Wrench, XCircle } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface OperationPlanningTableProps {
    operations: CamOperation[];
    camValidation?: any;
    camSetups?: any[];
    tools?: any[];
    selectedOperationIds?: Set<string>;
    features?: any[];
    onToggleOperation?: (opId: string) => void;
    onToggleAll?: (selectAll: boolean) => void;
    onChange?: (opId: string, updates: Partial<CamOperation>) => void;
}

const truncateId = (id: string) => {
    if (!id) return '';
    if (id.length > 12) return id.substring(0, 8) + '...';
    return id;
};

function getToolTypeWarning(opType: string, toolType: string | undefined, toolName: string | undefined): string | null {
    if (!toolType && !toolName) return null;
    const tt = (toolType || '').toLowerCase();
    const tn = (toolName || '').toLowerCase();
    const ot = (opType || '').toLowerCase();

    const isKnurling = tt.includes('knurl') || tn.includes('knurl');
    const isTurning = tt.includes('turn') || tn.includes('turn') || tt.includes('cut_off');
    const isDrill = tt === 'drill' || tn.includes('drill');
    const isFaceMill = tt === 'face_mill' || tn.includes('face mill');

    if (isKnurling) {
        if (ot !== 'knurling') return 'Knurling tool incompatible with milling/drilling';
    }
    if (ot === 'drilling' && (isFaceMill || isTurning || isKnurling)) {
        return 'Incompatible tool for drilling';
    }
    if (ot === 'facing' && (isDrill || isKnurling || isTurning)) {
        return 'Incompatible tool for facing';
    }
    if ((ot === 'pocketing' || ot === 'boss_clearing' || ot.includes('contour')) && (isKnurling || isTurning)) {
        return 'Incompatible tool for milling';
    }
    return null;
}

export const OperationPlanningTable: React.FC<OperationPlanningTableProps> = ({ 
    operations, 
    camValidation, 
    camSetups, 
    tools,
    selectedOperationIds,
    features,
    onToggleOperation,
    onToggleAll,
    onChange 
}) => {
    // Group operations by setup_id
    const groupedOps: Record<string, CamOperation[]> = {};
    operations.forEach(op => {
        const setupId = op.setup_id || 'unassigned';
        if (!groupedOps[setupId]) {
            groupedOps[setupId] = [];
        }
        groupedOps[setupId].push(op);
    });

    const setupIds = Object.keys(groupedOps);
    
    // Sort so 'unassigned' is at the bottom, and other setups are in order
    setupIds.sort((a, b) => {
        if (a === 'unassigned') return 1;
        if (b === 'unassigned') return -1;
        return a.localeCompare(b);
    });

    const allSelected = operations.length > 0 && selectedOperationIds?.size === operations.length;
    const someSelected = selectedOperationIds ? selectedOperationIds.size > 0 && selectedOperationIds.size < operations.length : false;

    return (
        <div className="w-full flex flex-col gap-4 animate-in fade-in duration-300">
            {camValidation && !camValidation.featureCoveragePassed && (
                <div className="flex items-center gap-3 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-500 shadow-sm">
                    <AlertTriangle className="size-5 shrink-0" />
                    <div className="flex flex-col">
                        <span className="text-sm font-bold">Feature Coverage Incomplete</span>
                        <span className="text-xs text-red-400/80 mt-0.5">
                            {camValidation.missingDecisionFeatures?.length || 0} features have no manufacturing decision. G-Code generation is blocked.
                        </span>
                    </div>
                </div>
            )}

            <div className="rounded-xl border border-border/50 bg-background/40 shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left whitespace-nowrap">
                        <thead className="bg-muted/30 text-muted-foreground border-b border-border/50">
                            <tr>
                                <th className="py-3 px-4 text-[10px] font-bold uppercase tracking-wider w-8">
                                    <input 
                                        type="checkbox" 
                                        className="rounded border-border/50 bg-background/50 accent-primary cursor-pointer w-4 h-4"
                                        checked={allSelected}
                                        ref={input => {
                                            if (input) input.indeterminate = someSelected;
                                        }}
                                        onChange={(e) => onToggleAll?.(e.target.checked)}
                                    />
                                </th>
                                <th className="py-3 px-4 text-[10px] font-bold uppercase tracking-wider">Feature</th>
                                <th className="py-3 px-4 text-[10px] font-bold uppercase tracking-wider">Machining Strategy</th>
                                <th className="py-3 px-4 text-[10px] font-bold uppercase tracking-wider">Selected Tool</th>
                                <th className="py-3 px-4 text-[10px] font-bold uppercase tracking-wider">Cycle Time</th>
                                <th className="py-3 px-4 text-[10px] font-bold uppercase tracking-wider">Status</th>
                                <th className="py-3 px-4 text-[10px] font-bold uppercase tracking-wider">Reason</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border/30">
                            {setupIds.length === 0 && operations.length === 0 ? (
                                <tr>
                                    <td colSpan={6} className="py-12 text-center">
                                        <div className="flex flex-col items-center justify-center text-muted-foreground/50">
                                            <Activity className="size-8 mb-3 opacity-20" />
                                            <span className="text-sm font-medium">No operations generated</span>
                                            <span className="text-xs mt-1">Click "Auto Generate All Operations" to begin</span>
                                        </div>
                                    </td>
                                </tr>
                            ) : (
                                setupIds.map(setupId => {
                                    const setupOps = groupedOps[setupId];
                                    const setupInfo = camSetups?.find(s => s.setupId === setupId || s.id === setupId);
                                    const setupName = setupInfo ? (setupInfo.setupName || `Setup ${setupIds.indexOf(setupId) + 1} (${setupInfo.machineType === 'milling_3axis' && setupInfo.fixtureSide ? setupInfo.fixtureSide.toUpperCase() : 'MAIN'})`) : 'Unassigned Features';
                                    
                                    return (
                                        <React.Fragment key={setupId}>
                                            <tr className="bg-muted/10 border-t border-b border-border/40">
                                                <td colSpan={6} className="py-2.5 px-4">
                                                    <div className="flex items-center gap-2">
                                                        <span className="text-[10px] font-bold text-primary uppercase tracking-widest">{setupName}</span>
                                                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-background border border-border/50 text-muted-foreground">
                                                            {setupOps.length} ops
                                                        </span>
                                                    </div>
                                                </td>
                                            </tr>
                                            {setupOps.map(op => {
                                                const isReady = op.status === 'ready';
                                                const isWarning = op.status === 'warning';
                                                const isError = op.status === 'blocked' || op.status === 'unsupported' || op.status === 'error';
                                                
                                                const StatusIcon = isReady ? CheckCircle2 : isWarning ? AlertTriangle : isError ? XCircle : AlertCircle;
                                                const statusColor = 
                                                    isReady ? 'text-green-500 bg-green-500/10 border-green-500/20' :
                                                    isWarning ? 'text-amber-500 bg-amber-500/10 border-amber-500/20' :
                                                    isError ? 'text-red-500 bg-red-500/10 border-red-500/20' :
                                                    'text-muted-foreground bg-muted/20 border-border/50';

                                                const displayStatus = op.status === 'unsupported' && op.type === 'turning_required' ? 'REQUIRES TURNING' : op.status;

                                                const typeLower = (op.type || '').toLowerCase();
                                                const opNameLower = (op.name || '').toLowerCase();
                                                const featNameLower = (() => {
                                                    if (!op.feature_id) return '';
                                                    const feat = features?.find(f => f.id === op.feature_id);
                                                    if (!feat) return '';
                                                    return (feat.name || feat.type || '').toLowerCase();
                                                })();

                                                const combinedName = `${opNameLower} ${featNameLower}`;
                                                
                                                const nameSaysRough = combinedName.includes('rough') || combinedName.includes('clear');
                                                const nameSaysFinish = combinedName.includes('finish') || combinedName.includes('smooth');

                                                let isRoughing = false;
                                                let isSmoothing = false;

                                                if (nameSaysRough && !nameSaysFinish) {
                                                    isRoughing = true;
                                                } else if (nameSaysFinish && !nameSaysRough) {
                                                    isSmoothing = true;
                                                } else {
                                                    isRoughing = typeLower.includes('rough') || typeLower.includes('pocket') || typeLower.includes('clear') || typeLower.includes('face') || typeLower.includes('facing') || typeLower.includes('drill');
                                                    isSmoothing = typeLower.includes('finish') || typeLower.includes('smooth') || typeLower.includes('contour');
                                                }

                                                const isSelected = selectedOperationIds ? selectedOperationIds.has(op.id) : true;

                                                return (
                                                    <tr key={op.id} className={`hover:bg-muted/5 transition-colors group ${!isSelected ? 'opacity-60 grayscale-[0.5]' : ''}`}>
                                                        <td className="py-3 px-4 align-top w-8">
                                                            <input 
                                                                type="checkbox" 
                                                                className="rounded border-border/50 bg-background/50 accent-primary cursor-pointer w-4 h-4 mt-1"
                                                                checked={isSelected}
                                                                onChange={() => onToggleOperation?.(op.id)}
                                                            />
                                                        </td>
                                                        <td className="py-3 px-4 align-top">
                                                            <div className="flex flex-col gap-1">
                                                                <div className="flex flex-wrap items-center gap-2">
                                                                    <span className="font-medium text-foreground/90">{
                                                                        (() => {
                                                                            if (!op.feature_id) return 'Unknown Feature';
                                                                            const feat = features?.find(f => f.id === op.feature_id);
                                                                            if (!feat) return op.feature_id;
                                                                            return feat.name || (feat.type ? feat.type.replace(/_/g, ' ') : op.feature_id);
                                                                        })()
                                                                    }</span>
                                                                    {isRoughing && <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-purple-500/10 text-purple-400 border border-purple-500/30">Roughing</span>}
                                                                    {isSmoothing && <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-teal-500/10 text-teal-400 border border-teal-500/30">Finishing</span>}
                                                                </div>
                                                            </div>
                                                        </td>
                                                        <td className="py-3 px-4 align-top">
                                                            <div className="relative group">
                                                                <Select
                                                                    value={op.type}
                                                                    onValueChange={(val: string | null) => {
                                                                        if (!val) return;
                                                                        const options: Record<string, string> = {
                                                                            "facing": "Facing",
                                                                            "pocketing": "Pocketing",
                                                                            "drilling": "Drilling",
                                                                            "2d_contour_outer": "Contouring",
                                                                            "chamfer_milling": "Chamfering",
                                                                            "boss_clearing": "Boss Clearing",
                                                                            "od_turning": "Turning (OD)",
                                                                            "rotary_milling": "Rotary Milling",
                                                                            "indexed_4axis_milling": "Indexed 4-Axis"
                                                                        };
                                                                        onChange?.(op.id!, { type: val as any, name: options[val] || val });
                                                                    }}
                                                                    disabled={!onChange}
                                                                >
                                                                    <SelectTrigger className="w-full md:w-36 bg-background border-border/50 text-xs text-foreground focus:ring-1 focus:ring-primary/30 h-8">
                                                                        <SelectValue />
                                                                    </SelectTrigger>
                                                                    <SelectContent>
                                                                        <SelectItem value="facing">Facing</SelectItem>
                                                                        <SelectItem value="pocketing">Pocketing</SelectItem>
                                                                        <SelectItem value="drilling">Drilling</SelectItem>
                                                                        <SelectItem value="2d_contour_outer">Contouring</SelectItem>
                                                                        <SelectItem value="chamfer_milling">Chamfering</SelectItem>
                                                                        <SelectItem value="boss_clearing">Boss Clearing</SelectItem>
                                                                        <SelectItem value="od_turning">Turning (OD)</SelectItem>
                                                                        <SelectItem value="rotary_milling">Rotary Milling</SelectItem>
                                                                        <SelectItem value="indexed_4axis_milling">Indexed 4-Axis</SelectItem>
                                                                        {!["facing", "pocketing", "drilling", "2d_contour_outer", "chamfer_milling", "boss_clearing", "od_turning", "rotary_milling", "indexed_4axis_milling"].includes(op.type) && (
                                                                            <SelectItem value={op.type}>{op.name || op.type}</SelectItem>
                                                                        )}
                                                                    </SelectContent>
                                                                </Select>
                                                            </div>
                                                        </td>
                                                        <td className="py-3 px-4 align-top min-w-[200px] whitespace-normal">
                                                            {(() => {
                                                                const activeToolId = op.toolId || (op as any).tool_id || (op as any).tool?.id || (op as any).tool?.tool_id;
                                                                const activeToolObj = tools?.find(t => t.id === activeToolId || t.tool_id === activeToolId || t.dbId === activeToolId) || (op as any).tool;
                                                                const toolWarning = getToolTypeWarning(op.type, activeToolObj?.type, activeToolObj?.name);

                                                                return (
                                                                    <div className="flex flex-col gap-1.5">
                                                                        {tools && tools.length > 0 ? (
                                                                            <Select
                                                                                value={activeToolId || ''}
                                                                                onValueChange={(val: string | null) => {
                                                                                    if (!val) return;
                                                                                    const selTool = tools.find(t => t.id === val || t.tool_id === val || t.dbId === val);
                                                                                    onChange?.(op.id!, {
                                                                                        toolId: val,
                                                                                        tool: selTool
                                                                                    } as any);
                                                                                }}
                                                                                disabled={!onChange}
                                                                            >
                                                                                <SelectTrigger className="w-full max-w-[180px] bg-background border-border/50 text-[10px] text-foreground focus:ring-1 focus:ring-primary/30 h-7 px-2">
                                                                                    <SelectValue placeholder="Select Tool...">
                                                                                        {activeToolObj ? (
                                                                                            <div className="flex items-center gap-1.5 truncate max-w-[160px]">
                                                                                                <span className="font-medium truncate">{activeToolObj.name || activeToolObj.number || `T${activeToolId}`}</span>
                                                                                                {(activeToolObj.diameter || activeToolObj.geometry?.diameter) && <span className="opacity-70">Ø{activeToolObj.diameter || activeToolObj.geometry?.diameter}</span>}
                                                                                                {activeToolObj.type && <span className="uppercase opacity-50 truncate">{String(activeToolObj.type).replace(/_/g, ' ')}</span>}
                                                                                            </div>
                                                                                        ) : "Select Tool..."}
                                                                                    </SelectValue>
                                                                                </SelectTrigger>
                                                                                <SelectContent>
                                                                                    {tools.map(t => {
                                                                                        const tid = t.id || t.tool_id || t.dbId;
                                                                                        const tName = t.name || t.number || `Tool ${tid}`;
                                                                                        const tType = t.type ? String(t.type).replace(/_/g, ' ') : '';
                                                                                        const tDia = t.diameter || t.geometry?.diameter ? `Ø${t.diameter || t.geometry?.diameter}mm` : '';
                                                                                        return (
                                                                                            <SelectItem key={tid} value={tid}>
                                                                                                <div className="flex items-center gap-2">
                                                                                                    <span className="font-semibold">{tName}</span>
                                                                                                    {tDia && <span className="text-[10px] opacity-70">({tDia})</span>}
                                                                                                    {tType && <span className="text-[9px] uppercase px-1 py-0.5 rounded bg-muted/40 text-muted-foreground">{tType}</span>}
                                                                                                </div>
                                                                                            </SelectItem>
                                                                                        );
                                                                                    })}
                                                                                </SelectContent>
                                                                            </Select>
                                                                        ) : activeToolId ? (
                                                                            <div className="flex items-center gap-2">
                                                                                <Wrench className="size-3 text-muted-foreground" />
                                                                                <span className="font-mono text-[9px] bg-muted/40 border border-border/50 px-1.5 py-0.5 rounded text-muted-foreground">
                                                                                    {activeToolObj?.name || truncateId(activeToolId)}
                                                                                </span>
                                                                            </div>
                                                                        ) : (
                                                                            <span className="text-xs text-muted-foreground/50 italic">No tool selected</span>
                                                                        )}

                                                                        {toolWarning && (
                                                                            <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-amber-500/10 border border-amber-500/30 text-amber-400 text-[10px] font-medium">
                                                                                <AlertTriangle className="size-3 shrink-0 text-amber-400" />
                                                                                <span>{toolWarning}</span>
                                                                            </div>
                                                                        )}

                                                                        {op.parameters?.tool_selection_reason && !toolWarning && (
                                                                            <span className="text-[10px] text-foreground/60 leading-relaxed">
                                                                                {op.parameters.tool_selection_reason}
                                                                            </span>
                                                                        )}
                                                                    </div>
                                                                );
                                                            })()}
                                                        </td>
                                                        <td className="py-3 px-4 align-top">
                                                            {op.estimated_time_s !== undefined && op.estimated_time_s > 0 ? (
                                                                <div className="flex flex-col gap-1">
                                                                    <span className="text-xs font-mono text-foreground/90 font-medium">
                                                                        {op.estimated_time_s < 60 
                                                                            ? `${op.estimated_time_s.toFixed(1)}s` 
                                                                            : `${Math.floor(op.estimated_time_s / 60)}m ${Math.round(op.estimated_time_s % 60)}s`}
                                                                    </span>
                                                                    {op.estimated_breakdown?.cutting_time_seconds !== undefined && (
                                                                        <span className="text-[9px] text-muted-foreground/70 uppercase tracking-wider font-semibold">
                                                                            Cut: {op.estimated_breakdown.cutting_time_seconds.toFixed(1)}s
                                                                        </span>
                                                                    )}
                                                                </div>
                                                            ) : (
                                                                <span className="text-xs text-muted-foreground/40 italic">-</span>
                                                            )}
                                                        </td>
                                                        <td className="py-3 px-4 align-top">
                                                            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-[10px] font-bold uppercase tracking-wider ${statusColor}`}>
                                                                <StatusIcon className="size-3" />
                                                                {displayStatus}
                                                            </span>
                                                        </td>
                                                        <td className="py-3 px-4 align-top whitespace-normal min-w-[200px]">
                                                            {(op.parameters?.errorReason || op.parameters?.error) ? (
                                                                <div className="flex flex-col gap-1">
                                                                    <span className="text-xs text-muted-foreground leading-relaxed">
                                                                        {op.parameters.errorReason || op.parameters.error}
                                                                    </span>
                                                                    {op.parameters?.recommended_machine && (
                                                                        <span className="text-[10px] text-primary/80 mt-1 font-medium bg-primary/10 border border-primary/20 px-2 py-1 rounded w-fit">
                                                                            Recommendation: {op.parameters.recommended_machine}
                                                                        </span>
                                                                    )}
                                                                </div>
                                                            ) : (
                                                                <span className="text-xs text-muted-foreground/40 italic">-</span>
                                                            )}
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </React.Fragment>
                                    );
                                })
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
            
            {camValidation && (
                <div className="flex justify-end items-center text-[10px] font-medium text-muted-foreground/60 gap-4 px-2">
                    <span className="flex items-center gap-1.5"><div className="size-2 rounded-full bg-green-500/50" /> {camValidation.readyOperations || 0} Ready</span>
                    <span className="flex items-center gap-1.5"><div className="size-2 rounded-full bg-amber-500/50" /> {camValidation.warningOperations || 0} Warning</span>
                    <span className="flex items-center gap-1.5"><div className="size-2 rounded-full bg-red-500/50" /> {(camValidation.blockedOperations || 0) + (camValidation.errorOperations || 0)} Blocked/Error</span>
                </div>
            )}
        </div>
    );
};
