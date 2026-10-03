import { Target, Info, Target as TargetIcon, Search, PlusCircle, CheckCircle2, AlertTriangle, Settings, Settings2, Trash2, Cpu, Wrench } from 'lucide-react';
import type { CamFeature, Tool, OperationType, CamOperation } from '@/types/cam';

type FeatureInspectorPanelProps = {
    feature: CamFeature;
    tools: Tool[];
    operations: CamOperation[];
    onClose: () => void;
    onGenerateOperation: (feature: CamFeature, recommendedTool: string, recommendedOp: OperationType) => void;
    onSimulateFeature: (feature: CamFeature) => void;
    onAssignTool: (feature: CamFeature) => void;
    onDeleteOperation: (operationId: string) => void;
};

export function FeatureInspectorPanel({
    feature,
    tools,
    operations,
    onClose,
    onGenerateOperation,
    onSimulateFeature,
    onAssignTool,
    onDeleteOperation
}: FeatureInspectorPanelProps) {
    // Find if operation already exists
    const relatedOperation = operations.find(op => 
        // Simple heuristic: operation has the feature's name or is derived from it. 
        // In a real app we'd map via IDs or a metadata link.
        op.name?.includes(feature.name || feature.type.replace(/_/g, ' ')) ||
        (op.id === `op_${feature.id}`)
    );

    // Find recommended tool
    const matchingTool = tools.find(t => {
        if (feature.recommendedToolType === 'drill' && t.type === 'drill') {
            return t.diameter === feature.dimensions.diameter;
        }
        if (feature.recommendedToolType === 'flat_end_mill' && t.type === 'flat_end_mill') {
            return t.diameter <= (feature.dimensions.width || feature.dimensions.diameter || 10);
        }
        return false;
    }) || tools[0];

    const hasOperation = !!relatedOperation;
    const hasTool = !!matchingTool;

    return (
        <div className="absolute right-6 top-24 z-40 w-80 rounded-xl border border-blue-500/30 bg-background/95 p-4 shadow-2xl backdrop-blur-xl animate-in fade-in slide-in-from-right-4 duration-300">
            {/* Header */}
            <div className="flex items-start justify-between border-b border-border/50 pb-3">
                <div className="flex items-center gap-2">
                    <div className="flex size-8 items-center justify-center rounded-lg bg-blue-500/10 text-blue-500">
                        <TargetIcon className="size-4" />
                    </div>
                    <div className="flex flex-col">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                            {feature.id.replace('feat_', 'Feature ')}
                        </span>
                        <span className="text-sm font-semibold capitalize text-foreground">
                            {feature.name || feature.type.replace(/_/g, ' ')}
                        </span>
                    </div>
                </div>
                <button onClick={onClose} className="rounded-md p-1 text-muted-foreground hover:bg-white/5 hover:text-foreground transition-colors">
                    <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
            </div>

            {/* Quick Actions */}
            <div className="py-3 grid grid-cols-2 gap-2 border-b border-border/50">
                {!hasOperation ? (
                    <button 
                        onClick={() => onGenerateOperation(feature, matchingTool?.id || 't1', feature.recommendedOperation as OperationType)}
                        className="flex items-center justify-center gap-1.5 rounded-md bg-blue-500 hover:bg-blue-600 px-2 py-2 text-[11px] font-semibold text-white shadow-sm transition-colors"
                    >
                        <PlusCircle className="size-3.5" />
                        Generate Op
                    </button>
                ) : (
                    <button 
                        onClick={() => onDeleteOperation(relatedOperation.id)}
                        className="flex items-center justify-center gap-1.5 rounded-md bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/20 px-2 py-2 text-[11px] font-semibold text-rose-500 transition-colors"
                    >
                        <Trash2 className="size-3.5" />
                        Delete Op
                    </button>
                )}
                <button 
                    onClick={() => onSimulateFeature(feature)}
                    className="flex items-center justify-center gap-1.5 rounded-md bg-white/5 hover:bg-white/10 border border-white/10 px-2 py-2 text-[11px] font-semibold text-foreground transition-colors"
                >
                    <Search className="size-3.5" />
                    Simulate
                </button>
            </div>

            {/* Details */}
            <div className="py-3 space-y-3">
                <div className="flex items-center gap-2 text-[11px]">
                    <Cpu className="size-3.5 text-muted-foreground" />
                    <span className="font-semibold text-muted-foreground uppercase tracking-widest">Properties</span>
                </div>
                <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-[11px]">
                    {Object.entries(feature.dimensions).map(([key, value]) => (
                        <div key={key} className="flex justify-between rounded bg-black/20 dark:bg-white/5 px-2 py-1.5">
                            <span className="capitalize text-muted-foreground">{key}</span>
                            <span className="font-mono font-medium text-foreground">{value} mm</span>
                        </div>
                    ))}
                    <div className="flex justify-between rounded bg-black/20 dark:bg-white/5 px-2 py-1.5">
                        <span className="capitalize text-muted-foreground">Loc X</span>
                        <span className="font-mono font-medium text-foreground">{feature.location[0].toFixed(1)}</span>
                    </div>
                    <div className="flex justify-between rounded bg-black/20 dark:bg-white/5 px-2 py-1.5">
                        <span className="capitalize text-muted-foreground">Loc Y</span>
                        <span className="font-mono font-medium text-foreground">{feature.location[1].toFixed(1)}</span>
                    </div>
                </div>

                {/* Auto Recommendation */}
                <div className="mt-4 flex flex-col gap-2 rounded-lg border border-border/50 bg-black/10 dark:bg-white/5 p-3">
                    <div className="flex items-center gap-2 text-[11px]">
                        <Wrench className="size-3.5 text-blue-400" />
                        <span className="font-semibold text-blue-400 uppercase tracking-widest">Recommendations</span>
                    </div>
                    
                    <div className="flex flex-col gap-1 text-[11px]">
                        <div className="flex justify-between items-center">
                            <span className="text-muted-foreground">Operation:</span>
                            <span className="font-medium text-foreground capitalize">{feature.recommendedOperation.replace(/_/g, ' ')}</span>
                        </div>
                        <div className="flex justify-between items-center">
                            <span className="text-muted-foreground">Tool:</span>
                            <span className="font-medium text-foreground flex items-center gap-1">
                                {matchingTool ? (
                                    <>
                                        <CheckCircle2 className="size-3 text-emerald-500" />
                                        {matchingTool.name || matchingTool.number} ({matchingTool.diameter}mm)
                                    </>
                                ) : (
                                    <>
                                        <AlertTriangle className="size-3 text-amber-500" />
                                        {feature.recommendedToolType.replace(/_/g, ' ')}
                                    </>
                                )}
                            </span>
                        </div>
                    </div>
                </div>

                {/* Status */}
                <div className="flex flex-col gap-1 pt-2 border-t border-border/50">
                    <div className="flex items-center gap-2 text-[11px]">
                        <Info className="size-3.5 text-muted-foreground" />
                        <span className="font-semibold text-muted-foreground uppercase tracking-widest">Status</span>
                    </div>
                    <div className="flex items-center gap-2 text-[11px] mt-1">
                        {hasOperation ? <CheckCircle2 className="size-3.5 text-emerald-500" /> : <AlertTriangle className="size-3.5 text-amber-500" />}
                        <span className={hasOperation ? "text-emerald-500" : "text-amber-500"}>
                            {hasOperation ? "Operation Generated" : "Operation Missing"}
                        </span>
                    </div>
                    <div className="flex items-center gap-2 text-[11px]">
                        {hasTool ? <CheckCircle2 className="size-3.5 text-emerald-500" /> : <AlertTriangle className="size-3.5 text-amber-500" />}
                        <span className={hasTool ? "text-emerald-500" : "text-amber-500"}>
                            {hasTool ? "Tool Available" : "Suggested Tool Missing"}
                        </span>
                    </div>
                </div>
            </div>
        </div>
    );
}
