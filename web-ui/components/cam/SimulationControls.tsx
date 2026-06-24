import { Play, Pause, RotateCcw, Activity } from 'lucide-react';
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
				const nextProgress = state.progress >= 100 ? 100 : Math.min(100, state.progress + (state.speed * 0.5));
				
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
		<div className="flex flex-col gap-4">
			{/* Machine Readout Panel */}
			{state.segments && state.segments.length > 0 && (
				<div className="flex flex-col gap-2 rounded-2xl border border-border dark:border-white/5 bg-black/5 dark:bg-white/5 p-4">
					<div className="flex items-center justify-between mb-2 border-b border-border dark:border-white/5 pb-2">
						<span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Machine Readout</span>
						<span className="text-[10px] font-mono text-cyan-500">
							{activeSegment ? (activeSegment as any).type?.toUpperCase() || 'UNKNOWN' : 'IDLE'}
						</span>
					</div>
					
					<div className="grid grid-cols-3 gap-2">
						<div className="flex flex-col bg-background/50 rounded-lg p-2">
							<span className="text-[9px] font-bold text-muted-foreground">X</span>
							<span className="font-mono text-xs text-foreground">{activeSegment ? ((activeSegment as any).end?.x || 0).toFixed(3) : '0.000'}</span>
						</div>
						<div className="flex flex-col bg-background/50 rounded-lg p-2">
							<span className="text-[9px] font-bold text-muted-foreground">Y</span>
							<span className="font-mono text-xs text-foreground">{activeSegment ? ((activeSegment as any).end?.y || 0).toFixed(3) : '0.000'}</span>
						</div>
						<div className="flex flex-col bg-background/50 rounded-lg p-2">
							<span className="text-[9px] font-bold text-muted-foreground">Z</span>
							<span className="font-mono text-xs text-foreground">{activeSegment ? ((activeSegment as any).end?.z || 0).toFixed(3) : '0.000'}</span>
						</div>
					</div>

					<div className="grid grid-cols-2 gap-2 mt-1">
						<div className="flex flex-col bg-background/50 rounded-lg p-2">
							<span className="text-[9px] font-bold text-muted-foreground">FEED (mm/min)</span>
							<span className="font-mono text-xs text-foreground">{(activeSegment as any)?.feedrate || 0}</span>
						</div>
						<div className="flex flex-col bg-background/50 rounded-lg p-2">
							<span className="text-[9px] font-bold text-muted-foreground">SPINDLE (RPM)</span>
							<span className="font-mono text-xs text-foreground">{(activeSegment as any)?.spindle || 0}</span>
						</div>
					</div>
				</div>
			)}

			<div className="flex flex-col gap-4 rounded-2xl border border-border dark:border-white/5 bg-black/5 dark:bg-white/5 p-4">
				<div className="flex items-center justify-between">
					<div className="flex items-center gap-3">
						<span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Toolpaths</span>
						<button
							onClick={onGenerateToolpath}
							disabled={isGenerating}
							className="flex items-center gap-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-white shadow-md transition active:scale-[0.98] disabled:opacity-50"
						>
							<Activity className={`size-3.5 ${isGenerating ? 'animate-spin' : ''}`} />
							<span>{isGenerating ? 'Generating...' : 'Generate'}</span>
						</button>
					</div>
					<div className="flex gap-2 items-center">
						<button
							onClick={() => onChange({ ...state, showTool: state.showTool === undefined ? false : !state.showTool })}
							className={`px-2 py-1.5 text-[10px] font-bold uppercase tracking-wider rounded-md transition-colors border ${
								state.showTool !== false 
									? 'bg-blue-500/20 text-blue-500 border-blue-500/30' 
									: 'bg-background/50 text-muted-foreground border-transparent hover:bg-accent'
							}`}
							title="Toggle 3D Tool"
						>
							Tool
						</button>
						<div className="flex gap-1 bg-background/50 rounded-lg p-1">
						{[1, 2, 5, 10].map(s => (
							<button
								key={s}
								onClick={() => setSpeed(s as any)}
								className={`px-2 py-1 text-[9px] font-bold rounded-md transition-colors ${
									state.speed === s 
										? 'bg-blue-500 text-white' 
										: 'text-muted-foreground hover:bg-accent'
								}`}
							>
								{s}x
							</button>
						))}
						</div>
					</div>
				</div>

				<div className="flex items-center gap-2">
					<button
						onClick={reset}
						className="p-2 rounded-xl border border-border bg-background text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
					>
						<RotateCcw className="size-4" />
					</button>
					<button
						onClick={togglePlay}
						disabled={toolpathValid === false || !state.segments || state.segments.length === 0 || toolpathsStale}
						className="flex-1 flex items-center justify-center gap-2 p-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white shadow-md transition-all active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
					>
						{!state.segments || state.segments.length === 0 ? (
							<>
								<Activity className="size-4" fill="currentColor" />
								<span className="text-[11px] font-bold uppercase tracking-wider">Generate Toolpaths First</span>
							</>
						) : state.isPlaying ? (
							<>
								<Pause className="size-4" fill="currentColor" />
								<span className="text-[11px] font-bold uppercase tracking-wider">Pause</span>
							</>
						) : (
							<>
								<Play className="size-4" fill="currentColor" />
								<span className="text-[11px] font-bold uppercase tracking-wider">Simulate</span>
							</>
						)}
					</button>
				</div>

				{/* Progress Bar / Timeline */}
				<div className="flex flex-col gap-1 mt-2">
					<div className="flex justify-between text-[9px] font-mono text-muted-foreground">
						<span>{Math.round(state.progress)}%</span>
						<span>{state.segments ? `Segment ${state.activeSegmentIndex || 0} / ${state.segments.length}` : '100%'}</span>
					</div>
					<div className="relative h-2 w-full bg-zinc-800 rounded-full overflow-hidden cursor-pointer" onClick={(e) => {
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
							className="absolute top-0 left-0 h-full bg-cyan-500 transition-all duration-100 pointer-events-none"
							style={{ width: `${state.progress}%` }}
						/>
					</div>
				</div>
			</div>
		</div>
	);
}
