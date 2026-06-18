import { Play, Pause, RotateCcw, Activity } from 'lucide-react';
import type { SimulationState } from '@/types/cam';

type SimulationControlsProps = {
	state: SimulationState;
	onChange: (state: SimulationState) => void;
	onGenerateToolpath: () => void;
	isGenerating?: boolean;
};

export function SimulationControls({ state, onChange, onGenerateToolpath, isGenerating }: SimulationControlsProps) {
	const togglePlay = () => {
		onChange({ ...state, isPlaying: !state.isPlaying });
	};

	const reset = () => {
		onChange({ ...state, isPlaying: false, progress: 0 });
	};

	const setSpeed = (speed: 1 | 2 | 5 | 10) => {
		onChange({ ...state, speed });
	};

	return (
		<div className="flex flex-col gap-4">
			{/* Generate Button */}
			<button
				onClick={onGenerateToolpath}
				disabled={isGenerating}
				className="flex w-full items-center justify-center gap-2 rounded-2xl bg-blue-600 hover:bg-blue-500 py-3 text-[11px] font-black uppercase tracking-widest text-white shadow-lg transition active:scale-[0.98] disabled:opacity-50"
			>
				<Activity className={`size-4 ${isGenerating ? 'animate-spin' : ''}`} />
				<span>{isGenerating ? 'Generating...' : 'Generate Toolpath'}</span>
			</button>

			<div className="flex flex-col gap-3 rounded-2xl border border-border dark:border-white/5 bg-black/5 dark:bg-white/5 p-4">
				<div className="flex items-center justify-between">
					<span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Simulation</span>
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

				<div className="flex items-center gap-2">
					<button
						onClick={reset}
						className="p-2 rounded-xl border border-border bg-background text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
					>
						<RotateCcw className="size-4" />
					</button>
					<button
						onClick={togglePlay}
						className="flex-1 flex items-center justify-center gap-2 p-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white shadow-md transition-all active:scale-[0.98]"
					>
						{state.isPlaying ? (
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

				{/* Progress Bar */}
				<div className="flex flex-col gap-1 mt-2">
					<div className="flex justify-between text-[9px] font-mono text-muted-foreground">
						<span>0%</span>
						<span>100%</span>
					</div>
					<div className="h-1.5 w-full bg-zinc-800 rounded-full overflow-hidden">
						<div 
							className="h-full bg-cyan-500 transition-all duration-300"
							style={{ width: `${state.progress}%` }}
						/>
					</div>
				</div>
			</div>
		</div>
	);
}
