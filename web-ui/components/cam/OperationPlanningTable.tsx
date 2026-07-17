import React from 'react';
import { CamOperation } from '../../types/cam';
import { Activity, AlertTriangle, CheckCircle2, AlertCircle, Wrench, XCircle } from 'lucide-react';

interface OperationPlanningTableProps {
    operations: CamOperation[];
    camValidation?: any;
    camSetups?: any[];
    selectedOperationIds?: Set<string>;
    features?: any[];
    onToggleOperation?: (opId: string) => void;
    onToggleAll?: (selectAll: boolean) => void;
    onChange?: (opId: string, updates: Partial<CamOperation>) => void;
}

const truncateId = (id: string) => {
    if (id.length > 12) return id.substring(0, 8) + '...';
    return id;
};

export const OperationPlanningTable: React.FC<OperationPlanningTableProps> = ({ 
    operations, 
    camValidation, 
    camSetups, 
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
                                                    isRoughing = typeLower.includes('rough') || typeLower.includes('pocket') || typeLower.includes('clear') || typeLower.includes('face');
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
                                                                <select
                                                                    value={op.type}
                                                                    onChange={(e) => onChange?.(op.id, { type: e.target.value, name: e.target.options[e.target.selectedIndex].text })}
                                                                    disabled={!onChange}
                                                                    className="w-full md:w-40 appearance-none bg-background border border-border/50 rounded-lg px-3 py-2 text-xs text-foreground focus:border-primary focus:ring-1 focus:ring-primary/30 outline-none transition-all cursor-pointer shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                                                                >
                                                                    <option value="facing">Facing</option>
                                                                    <option value="pocketing">Pocketing</option>
                                                                    <option value="drilling">Drilling</option>
                                                                    <option value="2d_contour_outer">Contouring</option>
                                                                    <option value="chamfer_milling">Chamfering</option>
                                                                    <option value="boss_clearing">Boss Clearing</option>
                                                                    <option value="od_turning">Turning (OD)</option>
                                                                    <option value="rotary_milling">Rotary Milling</option>
                                                                    <option value="indexed_4axis_milling">Indexed 4-Axis</option>
                                                                    <option value={op.type}>{op.name || op.type}</option>
                                                                </select>
                                                                <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none opacity-50">
                                                                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6"/></svg>
                                                                </div>
                                                            </div>
                                                        </td>
                                                        <td className="py-3 px-4 align-top min-w-[250px] whitespace-normal">
                                                            {op.toolId ? (
                                                                <div className="flex flex-col gap-1.5">
                                                                    <div className="flex items-center gap-2">
                                                                        <Wrench className="size-3 text-muted-foreground" />
                                                                        <span className="font-mono text-[9px] bg-muted/40 border border-border/50 px-1.5 py-0.5 rounded text-muted-foreground">
                                                                            {truncateId(op.toolId)}
                                                                        </span>
                                                                    </div>
                                                                    {op.parameters?.tool_selection_reason && (
                                                                        <span className="text-xs text-foreground/70 leading-relaxed">
                                                                            {op.parameters.tool_selection_reason}
                                                                        </span>
                                                                    )}
                                                                </div>
                                                            ) : (
                                                                <span className="text-xs text-muted-foreground/50 italic">No tool selected</span>
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
