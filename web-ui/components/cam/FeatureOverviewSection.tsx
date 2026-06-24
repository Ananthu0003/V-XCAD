import { useEffect } from 'react';
import type { CamFeature } from '@/types/cam';
import { Target, AlertTriangle, XCircle, CheckCircle2, Wand2, ArrowDown, ArrowUp } from 'lucide-react';

type FeatureOverviewSectionProps = {
    features: CamFeature[];
    activeFeatureId: string | null;
    onFeatureSelect: (id: string | null) => void;
    onAutoGenerate: () => void;
    workflowStage?: string;
    setWorkflowStage?: (v: string) => void;
    onRunFeatureRecognition?: () => void;
};

export function FeatureOverviewSection({
    features,
    activeFeatureId,
    onFeatureSelect,
    onAutoGenerate,
    workflowStage,
    setWorkflowStage,
    onRunFeatureRecognition
}: FeatureOverviewSectionProps) {

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (features.length === 0) return;
            // Only trigger if we aren't typing in an input
            if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') return;

            const currentIndex = activeFeatureId ? features.findIndex(f => f.id === activeFeatureId) : -1;
            
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                const nextIdx = currentIndex === -1 ? 0 : (currentIndex + 1) % features.length;
                onFeatureSelect(features[nextIdx].id);
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                const prevIdx = currentIndex === -1 ? features.length - 1 : (currentIndex - 1 + features.length) % features.length;
                onFeatureSelect(features[prevIdx].id);
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [activeFeatureId, features, onFeatureSelect]);

    if (features.length === 0) {
        return (
            <div className="rounded-xl border border-border p-6 text-center bg-black/20 dark:bg-white/5 text-[12px] text-muted-foreground flex flex-col items-center justify-center min-h-[150px] gap-4 relative overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 to-transparent pointer-events-none" />
                {workflowStage === 'cad' ? (
                    <>
                        <div className="flex flex-col gap-1 z-10">
                            <span className="text-white font-bold tracking-wider uppercase">Feature Analysis Required</span>
                            <span className="opacity-70">Proceed to the CAM workspace to analyze 3D geometry and extract machinable features.</span>
                        </div>
                        <button 
                            onClick={() => {
                                if (setWorkflowStage) setWorkflowStage('cam');
                                if (onRunFeatureRecognition) onRunFeatureRecognition();
                            }}
                            className="z-10 mt-2 flex items-center gap-2 px-6 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-bold uppercase tracking-widest shadow-[0_0_20px_rgba(37,99,235,0.4)] hover:shadow-[0_0_30px_rgba(37,99,235,0.6)] transition-all"
                        >
                            <Wand2 className="size-4" />
                            Run Feature Recognition
                        </button>
                    </>
                ) : (
                    "No features detected yet."
                )}
            </div>
        );
    }

    const typeSummary = features.reduce((acc, feat) => {
        acc[feat.type] = (acc[feat.type] || 0) + 1;
        return acc;
    }, {} as Record<string, number>);

    return (
        <div className="space-y-3 flex flex-col h-full">
            <button 
                onClick={onAutoGenerate}
                className="w-full flex items-center justify-center gap-2 bg-blue-500 hover:bg-blue-600 text-white py-2 rounded-lg text-xs font-semibold transition-colors shadow"
            >
                <Wand2 className="size-4" />
                Auto Generate All Operations
            </button>

            <div className="flex justify-between items-center pb-2 border-b border-border/50">
                <div className="flex gap-2 flex-wrap">
                    {Object.entries(typeSummary).map(([type, count]) => (
                        <div key={type} className="text-[10px] bg-black/10 dark:bg-white/10 px-2 py-0.5 rounded capitalize">
                            {type.replace('_', ' ')}: {count}
                        </div>
                    ))}
                </div>
                <div className="flex gap-1 text-[10px] text-muted-foreground items-center" title="Use Arrow Keys to navigate">
                    <ArrowUp className="size-3" />
                    <ArrowDown className="size-3" />
                </div>
            </div>

            <div className="space-y-1 overflow-y-auto flex-1 pb-20">
                {features.map((feat) => {
                    const isActive = activeFeatureId === feat.id;
                    return (
                        <div 
                            key={feat.id}
                            className={`p-2.5 rounded-lg cursor-pointer transition-all border text-[11px] ${isActive ? 'bg-blue-500/10 border-blue-500/50 shadow-sm ring-1 ring-blue-500/20' : 'bg-background hover:bg-black/5 dark:hover:bg-white/5 border-border'}`}
                            onClick={() => onFeatureSelect(isActive ? null : feat.id)}
                        >
                            <div className="flex justify-between items-start">
                                <div className="flex items-center gap-1.5 font-medium">
                                    <Target className={`size-3.5 ${isActive ? 'text-blue-500' : 'text-muted-foreground'}`} />
                                    <span className={isActive ? 'text-blue-500 font-bold' : ''}>{feat.name || feat.type.replace(/_/g, ' ')}</span>
                                </div>
                                <div className="flex items-center gap-1">
                                    {feat.status === 'machinable' && <span title="Machinable"><CheckCircle2 className="size-3.5 text-emerald-500" /></span>}
                                    {feat.status === 'limited' && <span title="Limited Accessibility"><AlertTriangle className="size-3.5 text-amber-500" /></span>}
                                    {feat.status === 'not_machinable' && <span title="Not Machinable"><XCircle className="size-3.5 text-rose-500" /></span>}
                                </div>
                            </div>
                            
                            {(feat.count && feat.count > 1) && (
                                <div className="text-[10px] text-blue-400 mt-1 flex justify-between">
                                    <span>Group: {feat.count} items</span>
                                </div>
                            )}
                            
                            <div className="text-muted-foreground flex gap-3 mt-1.5 text-[10px]">
                                {Object.entries(feat.dimensions).slice(0, 2).map(([key, value]) => (
                                    <span key={key} className="flex gap-1">
                                        <span className="capitalize">{key}:</span>
                                        <span className="font-mono text-foreground">{value}mm</span>
                                    </span>
                                ))}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
