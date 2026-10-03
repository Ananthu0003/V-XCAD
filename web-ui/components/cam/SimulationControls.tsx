import { Play, Pause, RotateCcw, Activity, Eye, EyeOff } from 'lucide-react';
import { useEffect } from 'react';
import type { SimulationState } from '@/types/cam';

type SimulationControlsProps = {
    state: SimulationState;
    onChange: (state: SimulationState) => void;
    onGenerateToolpath: () => void;
    isGenerating?: boolean;
    toolpathValid?: boolean;
    toolpathsStale?: boolean;
};

export function SimulationControls({ state, onChange, onGenerateToolpath, isGenerating, toolpathValid, toolpathsStale }: SimulationControlsProps) {
    useEffect(() => {
        let intervalId: NodeJS.Timeout;
        
        if (state.isPlaying) {
            intervalId = setInterval(() => {
                // Reduced from 0.5 to 0.2 to make 1x speed significantly slower and easier to watch
                const nextProgress = state.progress >= 100 ? 100 : Math.min(100, state.progress + (state.speed * 0.2));
                
                let nextSegmentIndex = state.activeSegmentIndex || 0;
                if (state.segments && state.segments.length > 0) {
                    nextSegmentIndex = Math.floor((nextProgress / 100) * state.segments.length);
                    if (nextSegmentIndex >= state.segments.length) nextSegmentIndex = state.segments.length - 1;
                }

                onChange({
                    ...state,
                    progress: nextProgress,
                    activeSegmentIndex: nextSegmentIndex,
                    isPlaying: nextProgress >= 100 ? false : state.isPlaying
                });
            }, 100);
        }
        
        return () => {
            if (intervalId) clearInterval(intervalId);
        };
    }, [state, onChange]);

    const togglePlay = () => {
        if (state.progress >= 100) {
            onChange({ ...state, isPlaying: true, progress: 0, activeSegmentIndex: 0 });
        } else {
            onChange({ ...state, isPlaying: !state.isPlaying });
        }
    };

    const reset = () => {
        onChange({ ...state, isPlaying: false, progress: 0, activeSegmentIndex: 0 });
    };

    const setSpeed = (speed: 1 | 2 | 5 | 10) => {
        onChange({ ...state, speed });
    };

    const activeSegment = state.segments && state.activeSegmentIndex !== undefined ? state.segments[state.activeSegmentIndex] : null;

    return (
        <div className="flex flex-col gap-6 animate-in fade-in duration-300">
            {/* Machine Readout Panel (Digital DRO Style) */}
            {state.segments && state.segments.length > 0 && (
                <div className="flex flex-col gap-4 rounded-xl border border-border/50 bg-background/40 shadow-sm p-5 relative overflow-hidden">
                    {/* Subtle glow behind the DRO */}
                    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[80%] h-[80%] bg-cyan-500/5 blur-[50px] rounded-full pointer-events-none" />
                    
                    <div className="flex items-center justify-between border-b border-border/50 pb-3 relative z-10">
                        <div className="flex items-center gap-2">
                            <div className="size-1.5 rounded-full bg-cyan-500 animate-pulse" />
                            <span className="text-[10px] font-bold uppercase tracking-widest text-primary">Live Machine Readout</span>
                        </div>
                        <span className="text-[10px] font-bold tracking-widest text-cyan-400 bg-cyan-500/10 border border-cyan-500/20 px-2 py-0.5 rounded">
                            {activeSegment ? (activeSegment as any).type?.toUpperCase() || 'UNKNOWN' : 'IDLE'}
                        </span>
                    </div>
                    
                    <div className="grid grid-cols-3 gap-4 relative z-10">
                        {['X', 'Y', 'Z'].map((axis) => {
                            const val = axis === 'X' ? ((activeSegment as any)?.end?.x || 0) 
                                      : axis === 'Y' ? ((activeSegment as any)?.end?.y || 0)
                                      : ((activeSegment as any)?.end?.z || 0);
                            return (
                                <div key={axis} className="flex flex-col bg-black/60 rounded-lg p-3 border border-border/30 shadow-inner">
                                    <span className="text-[9px] font-bold text-muted-foreground/70 uppercase tracking-widest mb-1">{axis} AXIS</span>
                                    <span className="font-mono text-xl tracking-wider text-cyan-400 font-medium">
                                        {val.toFixed(3)}
                                    </span>
                                </div>
                            );
                        })}
                    </div>

                    <div className="grid grid-cols-2 gap-4 relative z-10">
                        <div className="flex flex-col bg-black/60 rounded-lg p-3 border border-border/30 shadow-inner">
                            <span className="text-[9px] font-bold text-muted-foreground/70 uppercase tracking-widest mb-1">FEEDRATE (mm/min)</span>
                            <span className="font-mono text-base tracking-wider text-amber-400/90 font-medium">
                                {((activeSegment as any)?.feedrate || (activeSegment as any)?.feed_rate || 0).toString().padStart(4, '0')}
                            </span>
                        </div>
                        <div className="flex flex-col bg-black/60 rounded-lg p-3 border border-border/30 shadow-inner">
                            <span className="text-[9px] font-bold text-muted-foreground/70 uppercase tracking-widest mb-1">SPINDLE SPEED (RPM)</span>
                            <span className="font-mono text-base tracking-wider text-green-400/90 font-medium">
                                {((activeSegment as any)?.spindle || (activeSegment as any)?.rpm || 0).toString().padStart(4, '0')}
                            </span>
                        </div>
                    </div>
                </div>
            )}

            {/* Playback Controls */}
            <div className="flex flex-col gap-5 rounded-xl border border-border/50 bg-background/40 shadow-sm p-5">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <span className="text-[10px] font-bold uppercase tracking-widest text-primary">Toolpaths</span>
                        <button
                            onClick={onGenerateToolpath}
                            disabled={isGenerating}
                            className="flex items-center gap-1.5 rounded-md bg-primary/10 border border-primary/20 hover:bg-primary/20 hover:border-primary/40 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-primary transition-all active:scale-[0.98] disabled:opacity-50"
                        >
                            <Activity className={`size-3.5 ${isGenerating ? 'animate-spin text-primary' : ''}`} />
                            <span>{isGenerating ? 'Generating...' : 'Generate New'}</span>
                        </button>
                    </div>

                    <div className="flex gap-4 items-center">
                        <button
                            onClick={() => onChange({ ...state, showMachine: state.showMachine === undefined ? false : !state.showMachine })}
                            className={`flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider rounded-md transition-all border ${
                                state.showMachine !== false
                                    ? 'bg-primary/10 text-primary border-primary/30 shadow-[0_0_10px_rgba(59,130,246,0.15)]' 
                                    : 'bg-background text-muted-foreground border-border hover:bg-muted'
                            }`}
                            title="Toggle Machine Visibility"
                        >
                            {state.showMachine !== false ? <Eye className="size-3" /> : <EyeOff className="size-3" />}
                            Machine
                        </button>
                        <button
                            onClick={() => onChange({ ...state, showStock: state.showStock === undefined ? false : !state.showStock })}
                            className={`flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider rounded-md transition-all border ${
                                state.showStock !== false 
                                    ? 'bg-primary/10 text-primary border-primary/30 shadow-[0_0_10px_rgba(59,130,246,0.15)]' 
                                    : 'bg-background text-muted-foreground border-border hover:bg-muted'
                            }`}
                            title="Toggle Stock Visibility"
                        >
                            {state.showStock !== false ? <Eye className="size-3" /> : <EyeOff className="size-3" />}
                            Stock
                        </button>
                        <button
                            onClick={() => onChange({ ...state, showTool: state.showTool === undefined ? false : !state.showTool })}
                            className={`flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider rounded-md transition-all border ${
                                state.showTool !== false 
                                    ? 'bg-primary/10 text-primary border-primary/30 shadow-[0_0_10px_rgba(59,130,246,0.15)]' 
                                    : 'bg-background text-muted-foreground border-border hover:bg-muted'
                            }`}
                            title="Toggle 3D Tool Visibility"
                        >
                            {state.showTool !== false ? <Eye className="size-3" /> : <EyeOff className="size-3" />}
                            Tool
                        </button>
                        <div className="flex items-center bg-muted/40 p-1 rounded-lg border border-border/50">
                            {[1, 2, 5, 10].map(s => (
                                <button
                                    key={s}
                                    onClick={() => setSpeed(s as any)}
                                    className={`px-3 py-1 text-[10px] font-bold rounded-md transition-all ${
                                        state.speed === s 
                                            ? 'bg-background shadow-sm text-foreground ring-1 ring-border' 
                                            : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                                    }`}
                                >
                                    {s}x
                                </button>
                            ))}
                        </div>
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    <button
                        onClick={reset}
                        className="p-3 rounded-xl border border-border/50 bg-background/50 text-muted-foreground hover:bg-muted hover:text-foreground transition-all shadow-sm"
                        title="Reset Simulation"
                    >
                        <RotateCcw className="size-4" />
                    </button>
                    <button
                        onClick={togglePlay}
                        disabled={toolpathValid === false || !state.segments || state.segments.length === 0 || toolpathsStale}
                        className="flex-1 flex items-center justify-center gap-2 p-3 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white shadow-[0_0_15px_rgba(8,145,178,0.4)] transition-all active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none relative overflow-hidden group"
                    >
                        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent translate-x-[-100%] group-hover:animate-[shimmer_1.5s_infinite] pointer-events-none" />
                        
                        {!state.segments || state.segments.length === 0 ? (
                            <>
                                <Activity className="size-4" fill="currentColor" />
                                <span className="text-[11px] font-bold uppercase tracking-wider">Generate Toolpaths First</span>
                            </>
                        ) : state.isPlaying ? (
                            <>
                                <Pause className="size-4" fill="currentColor" />
                                <span className="text-[11px] font-bold uppercase tracking-wider">Pause Simulation</span>
                            </>
                        ) : (
                            <>
                                <Play className="size-4" fill="currentColor" />
                                <span className="text-[11px] font-bold uppercase tracking-wider">Play Simulation</span>
                            </>
                        )}
                    </button>
                </div>

                {/* Progress Bar / Timeline */}
                <div className="flex flex-col gap-2 mt-2">
                    <div className="flex justify-between items-end">
                        <span className="text-[10px] font-mono text-cyan-500 font-bold tracking-wider">{Math.round(state.progress)}%</span>
                        <span className="text-[9px] font-mono text-muted-foreground uppercase tracking-widest">{state.segments ? `Block ${state.activeSegmentIndex || 0} / ${state.segments.length}` : '100%'}</span>
                    </div>
                    <div className="relative h-2.5 w-full bg-muted/50 border border-border/50 rounded-full overflow-hidden cursor-pointer group" onClick={(e) => {
                        const rect = e.currentTarget.getBoundingClientRect();
                        const clickX = e.clientX - rect.left;
                        const pct = Math.max(0, Math.min(100, (clickX / rect.width) * 100));
                        
                        let newActiveIndex = state.activeSegmentIndex || 0;
                        if (state.segments && state.segments.length > 0) {
                            newActiveIndex = Math.floor((pct / 100) * state.segments.length);
                            if (newActiveIndex >= state.segments.length) newActiveIndex = state.segments.length - 1;
                        }
                        
                        onChange({ ...state, progress: pct, activeSegmentIndex: newActiveIndex });
                    }}>
                        <div 
                            className="absolute top-0 left-0 h-full bg-gradient-to-r from-cyan-600 to-cyan-400 transition-all duration-100 pointer-events-none"
                            style={{ width: `${state.progress}%` }}
                        >
                            <div className="absolute right-0 top-0 bottom-0 w-4 bg-white/20 blur-[2px]" />
                        </div>
                        {/* Hover seeker */}
                        <div className="absolute top-0 bottom-0 w-0.5 bg-foreground/30 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" style={{ left: 'var(--mouse-x, 0%)' }} />
                    </div>
                </div>
            </div>
        </div>
    );
}
