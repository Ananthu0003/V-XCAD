import type { CamFeature } from '@/types/cam';
import { Target, AlertTriangle, XCircle, CheckCircle2 } from 'lucide-react';

export function FeatureOverviewSection({
    features,
    activeFeatureId,
    onFeatureSelect
}: {
    features: CamFeature[];
    activeFeatureId: string | null;
    onFeatureSelect: (id: string | null) => void;
}) {
    if (features.length === 0) {
        return (
            <div className="rounded border border-border p-3 text-center bg-black/5 dark:bg-white/5 text-[11px] text-muted-foreground">
                No features detected yet.
            </div>
        );
    }

    const typeSummary = features.reduce((acc, feat) => {
        acc[feat.type] = (acc[feat.type] || 0) + 1;
        return acc;
    }, {} as Record<string, number>);

    return (
        <div className="space-y-3">
            <div className="flex gap-2 flex-wrap pb-2 border-b border-border/50">
                {Object.entries(typeSummary).map(([type, count]) => (
                    <div key={type} className="text-[10px] bg-black/10 dark:bg-white/10 px-2 py-0.5 rounded capitalize">
                        {type.replace('_', ' ')}: {count}
                    </div>
                ))}
            </div>

            <div className="space-y-1">
                {features.map((feat) => {
                    const isActive = activeFeatureId === feat.id;
                    return (
                        <div 
                            key={feat.id}
                            className={`p-2 rounded cursor-pointer transition-colors border text-[11px] ${isActive ? 'bg-blue-500/10 border-blue-500/30' : 'bg-background hover:bg-black/5 dark:hover:bg-white/5 border-border'}`}
                            onClick={() => onFeatureSelect(isActive ? null : feat.id)}
                        >
                            <div className="flex justify-between items-start mb-1">
                                <div className="flex items-center gap-1.5 font-medium capitalize">
                                    <Target className="size-3 text-blue-500" />
                                    <span>{feat.type.replace('_', ' ')}</span>
                                </div>
                                <div className="flex items-center gap-1">
                                    {feat.status === 'machinable' && <span title="Machinable"><CheckCircle2 className="size-3 text-emerald-500" /></span>}
                                    {feat.status === 'limited' && <span title="Limited Accessibility"><AlertTriangle className="size-3 text-amber-500" /></span>}
                                    {feat.status === 'not_machinable' && <span title="Not Machinable"><XCircle className="size-3 text-rose-500" /></span>}
                                </div>
                            </div>
                            
                            <div className="text-muted-foreground grid grid-cols-2 gap-x-2 gap-y-1 text-[10px]">
                                {Object.entries(feat.dimensions).map(([key, value]) => (
                                    <div key={key} className="flex justify-between">
                                        <span className="capitalize">{key}:</span>
                                        <span className="font-mono text-foreground">{value} mm</span>
                                    </div>
                                ))}
                            </div>

                            {feat.statusReason && (
                                <div className={`mt-1.5 text-[10px] px-1.5 py-0.5 rounded flex gap-1.5 items-center ${feat.status === 'not_machinable' ? 'bg-rose-500/10 text-rose-500' : 'bg-amber-500/10 text-amber-500'}`}>
                                    <AlertTriangle className="size-3 shrink-0" />
                                    <span>{feat.statusReason}</span>
                                </div>
                            )}

                            {isActive && (
                                <div className="mt-2 pt-2 border-t border-border/50 flex flex-col gap-1 text-[10px] text-muted-foreground">
                                    <div className="flex justify-between">
                                        <span>Rec. Tool:</span>
                                        <span className="capitalize text-foreground">{feat.recommendedToolType.replace(/_/g, ' ')}</span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span>Rec. Op:</span>
                                        <span className="capitalize text-foreground">{feat.recommendedOperation.replace(/_/g, ' ')}</span>
                                    </div>
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
