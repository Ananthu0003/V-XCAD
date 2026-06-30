'use client';

type ParameterInputProps = {
	label: string;
	value: unknown;
	onChange: (nextValue: unknown) => void;
	isActive?: boolean;
	description?: string;
};

export function ParameterInput({ label, value, onChange, isActive = false, description }: ParameterInputProps) {
	const inputBase = "w-full rounded-lg border border-border dark:border-white/10 bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50 focus:outline-none transition-all group-hover:border-blue-500/30";

	const renderInput = () => {
		if (typeof value === 'number') {
			return (
				<input
					type="number"
					value={Number.isFinite(value) ? value : 0}
					onChange={(e) => onChange(Number(e.target.value))}
					className={inputBase}
				/>
			);
		}

		if (typeof value === 'boolean') {
			return (
				<label className="flex items-center gap-3 cursor-pointer group">
					<div className="relative flex size-5 items-center justify-center">
						<input
							type="checkbox"
							checked={value}
							onChange={(e) => onChange(e.target.checked)}
							className="peer size-full cursor-pointer appearance-none rounded border border-zinc-700 bg-zinc-900 transition-all checked:bg-blue-500 checked:border-blue-400"
						/>
						<div className="pointer-events-none absolute scale-0 opacity-0 peer-checked:scale-100 peer-checked:opacity-100 transition-all text-black font-bold text-[10px]">
							✓
						</div>
					</div>
					<span className="text-xs font-medium text-zinc-400 group-hover:text-zinc-200 transition-colors">Enabled</span>
				</label>
			);
		}

		if (typeof value === 'string') {
			return (
				<input
					type="text"
					value={value}
					onChange={(e) => onChange(e.target.value)}
					className={inputBase}
				/>
			);
		}

		const serialized = JSON.stringify(value, null, 2);
		return (
			<textarea
				value={serialized}
				onChange={(e) => {
					try {
						onChange(JSON.parse(e.target.value));
					} catch {
						// Ignore incomplete JSON edits
					}
				}}
				rows={4}
				className={`${inputBase} font-mono text-[11px] resize-none`}
			/>
		);
	};

	return (
		<div className={`space-y-1.5 rounded-xl px-3 py-2.5 transition-all duration-200 group border ${
			isActive
				? 'bg-blue-500/5 border-blue-500/30 shadow-[0_0_12px_rgba(59,130,246,0.05)]'
				: 'border-transparent hover:bg-black/5 dark:hover:bg-white/5 hover:border-border dark:hover:border-white/10'
		}`}>
			<div className="flex items-center justify-between pl-1">
				<label className={`block text-[10px] font-bold uppercase tracking-wider transition-colors ${
					isActive ? 'text-blue-500' : 'text-muted-foreground group-hover:text-foreground'
				}`}>
					{label.replace(/_/g, ' ')}
				</label>
			</div>
			{description && (
				<p className="text-[10px] text-muted-foreground/70 pl-1 leading-snug">
					{description}
				</p>
			)}
			{renderInput()}
		</div>
	);
}
