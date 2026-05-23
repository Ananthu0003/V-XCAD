'use client';

type ParameterInputProps = {
	label: string;
	value: unknown;
	onChange: (nextValue: unknown) => void;
	isActive?: boolean;
};

export function ParameterInput({ label, value, onChange, isActive = false }: ParameterInputProps) {
	const inputBase = "w-full rounded-xl border border-zinc-800 bg-black/50 px-4 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-blue-500/50 focus:outline-none transition-all";

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
		<div className={`space-y-2 rounded-xl px-2 py-1.5 transition-all duration-200 ${
			isActive
				? 'bg-blue-500/5 ring-1 ring-blue-500/30 shadow-[0_0_12px_rgba(59,130,246,0.08)]'
				: ''
		}`}>
			<label className={`block text-[10px] font-bold uppercase tracking-wider pl-1 transition-colors ${
				isActive ? 'text-blue-500' : 'text-zinc-500'
			}`}>
				{label.replace(/_/g, ' ')}
			</label>
			{renderInput()}
		</div>
	);
}
