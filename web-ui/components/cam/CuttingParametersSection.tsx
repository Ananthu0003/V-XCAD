import type { CuttingParameters, CoolantType } from '@/types/cam';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

type CuttingParametersSectionProps = {
	parameters: CuttingParameters;
	onChange: (parameters: CuttingParameters) => void;
};

export function CuttingParametersSection({ parameters, onChange }: CuttingParametersSectionProps) {
	const update = (field: keyof CuttingParameters, value: any) => {
		onChange({ ...parameters, [field]: value });
	};

	return (
		<div className="flex flex-col gap-4">
			<div className="grid grid-cols-2 gap-3">
				{/* Spindle Speed */}
				<div className="flex flex-col gap-2">
					<label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Spindle (RPM)</label>
					<input
						type="number"
						value={parameters.spindleSpeed}
						onChange={(e) => update('spindleSpeed', parseFloat(e.target.value) || 0)}
						className="w-full bg-background border border-border rounded-lg px-3 py-3 text-xs text-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50 outline-none transition-all shadow-inner"
					/>
				</div>
				{/* Coolant */}
				<div className="flex flex-col gap-2">
					<label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Coolant</label>
					<Select value={parameters.coolant} onValueChange={(val: string | null) => val && update('coolant', val as CoolantType)}>
						<SelectTrigger className="w-full bg-background border border-border rounded-lg px-3 py-3 text-xs text-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50 outline-none transition-all shadow-inner h-[42px]">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="off">Off</SelectItem>
							<SelectItem value="flood">Flood</SelectItem>
							<SelectItem value="mist">Mist</SelectItem>
						</SelectContent>
					</Select>
				</div>
			</div>

			<div className="grid grid-cols-2 gap-3">
				{/* Feed Rate */}
				<div className="flex flex-col gap-2">
					<label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Feed (mm/min)</label>
					<input
						type="number"
						value={parameters.feedRate}
						onChange={(e) => update('feedRate', parseFloat(e.target.value) || 0)}
						className="w-full bg-background border border-border rounded-lg px-3 py-3 text-xs text-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50 outline-none transition-all shadow-inner"
					/>
				</div>
				{/* Plunge Rate */}
				<div className="flex flex-col gap-2">
					<label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Plunge (mm/min)</label>
					<input
						type="number"
						value={parameters.plungeRate}
						onChange={(e) => update('plungeRate', parseFloat(e.target.value) || 0)}
						className="w-full bg-background border border-border rounded-lg px-3 py-3 text-xs text-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50 outline-none transition-all shadow-inner"
					/>
				</div>
			</div>

			{/* Max Stepdown Slider */}
			<div className="flex flex-col gap-2">
				<div className="flex justify-between items-center">
					<label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Max Stepdown (Z)</label>
					<span className="text-xs font-mono font-bold text-blue-500">{parameters.maxStepdown} mm</span>
				</div>
				<input
					type="range"
					min="0.1"
					max="6.0"
					step="0.1"
					value={parameters.maxStepdown}
					onChange={(e) => update('maxStepdown', parseFloat(e.target.value))}
					className="w-full accent-blue-500 cursor-pointer h-1.5 rounded-lg bg-zinc-800"
				/>
			</div>

			{/* Stepover & Tolerance */}
			<div className="grid grid-cols-2 gap-3">
				{/* Stepover */}
				<div className="flex flex-col gap-2">
					<label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Stepover %</label>
					<input
						type="number"
						value={parameters.stepoverPercentage}
						min="1"
						max="100"
						onChange={(e) => update('stepoverPercentage', parseFloat(e.target.value) || 40)}
						className="w-full bg-background border border-border rounded-lg px-3 py-3 text-xs text-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50 outline-none transition-all shadow-inner"
					/>
				</div>
				{/* Tolerance */}
				<div className="flex flex-col gap-2">
					<label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Tolerance (mm)</label>
					<input
						type="number"
						value={parameters.tolerance}
						step="0.001"
						onChange={(e) => update('tolerance', parseFloat(e.target.value) || 0.01)}
						className="w-full bg-background border border-border rounded-lg px-3 py-3 text-xs text-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50 outline-none transition-all shadow-inner"
					/>
				</div>
			</div>

			{/* Total Depth Slider */}
			<div className="flex flex-col gap-2">
				<div className="flex justify-between items-center">
					<label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Total Depth</label>
					<span className="text-xs font-mono font-bold text-blue-500">{parameters.totalDepth} mm</span>
				</div>
				<input
					type="range"
					min="1.0"
					max="50.0"
					step="0.5"
					value={parameters.totalDepth}
					onChange={(e) => update('totalDepth', parseFloat(e.target.value))}
					className="w-full accent-blue-500 cursor-pointer h-1.5 rounded-lg bg-zinc-800"
				/>
			</div>
		</div>
	);
}
