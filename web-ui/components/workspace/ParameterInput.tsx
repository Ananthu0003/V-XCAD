'use client';

import React from 'react';
import { Minus, Plus, Check } from 'lucide-react';

type ParameterInputProps = {
	label: string;
	value: unknown;
	onChange: (nextValue: unknown) => void;
	isActive?: boolean;
	description?: string;
};

const stepperBtnStyle: React.CSSProperties = {
	width: 22,
	height: 28,
	borderRadius: 8,
	background: 'var(--ui-input)',
	border: '1px solid var(--ui-border-ctrl)',
	color: 'var(--ui-text-secondary)',
	fontSize: 13,
	cursor: 'pointer',
	display: 'flex',
	alignItems: 'center',
	justifyContent: 'center',
	flexShrink: 0,
	userSelect: 'none',
};

export function ParameterInput({ label, value, onChange, isActive = false, description }: ParameterInputProps) {
	const renderInput = () => {
		if (typeof value === 'number') {
			const numVal = Number.isFinite(value) ? value : 0;
			return (
				<div style={{ display: 'flex', alignItems: 'center', gap: 3, flexShrink: 0 }}>
					<button
						type="button"
						onClick={(e) => {
							e.stopPropagation();
							onChange(parseFloat((numVal - 1).toFixed(3)));
						}}
						style={stepperBtnStyle}
						title="Decrease"
					>
						<Minus size={11} />
					</button>
					<input
						type="number"
						value={numVal}
						onClick={(e) => e.stopPropagation()}
						onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
						style={{
							width: 58,
							height: 28,
							borderRadius: 8,
							background: 'var(--ui-input)',
							border: '1px solid var(--ui-border-ctrl)',
							color: 'var(--ui-text-primary)',
							fontSize: 12,
							fontFamily: 'var(--font-mono)',
							fontVariantNumeric: 'tabular-nums',
							textAlign: 'right',
							padding: '0 6px',
							outline: 'none',
						}}
					/>
					<button
						type="button"
						onClick={(e) => {
							e.stopPropagation();
							onChange(parseFloat((numVal + 1).toFixed(3)));
						}}
						style={stepperBtnStyle}
						title="Increase"
					>
						<Plus size={11} />
					</button>
				</div>
			);
		}

		if (typeof value === 'boolean') {
			return (
				<label className="flex items-center gap-2 cursor-pointer" onClick={(e) => e.stopPropagation()}>
					<input
						type="checkbox"
						checked={value}
						onChange={(e) => onChange(e.target.checked)}
						className="size-4 rounded border-[var(--ui-border-ctrl)] bg-[var(--ui-input)] accent-[var(--ui-accent)] cursor-pointer"
					/>
					<span className="text-xs text-[var(--ui-text-secondary)] font-medium">Enabled</span>
				</label>
			);
		}

		if (typeof value === 'string') {
			return (
				<input
					type="text"
					value={value}
					onClick={(e) => e.stopPropagation()}
					onChange={(e) => onChange(e.target.value)}
					style={{
						height: 28,
						borderRadius: 8,
						background: 'var(--ui-input)',
						border: '1px solid var(--ui-border-ctrl)',
						color: 'var(--ui-text-primary)',
						fontSize: 12,
						fontFamily: 'var(--font-mono)',
						padding: '0 8px',
						outline: 'none',
						width: 120,
					}}
				/>
			);
		}

		const serialized = JSON.stringify(value, null, 2);
		return (
			<textarea
				value={serialized}
				onClick={(e) => e.stopPropagation()}
				onChange={(e) => {
					try {
						onChange(JSON.parse(e.target.value));
					} catch {
						// Ignore incomplete JSON edits
					}
				}}
				rows={3}
				style={{
					borderRadius: 8,
					background: 'var(--ui-input)',
					border: '1px solid var(--ui-border-ctrl)',
					color: 'var(--ui-text-primary)',
					fontSize: 11,
					fontFamily: 'var(--font-mono)',
					padding: '4px 8px',
					outline: 'none',
					width: '100%',
					resize: 'none',
				}}
			/>
		);
	};

	return (
		<div
			className={`rounded-xl px-3 py-2 transition-all flex items-center justify-between gap-3 ${
				isActive
					? 'bg-[var(--ui-raised)] border border-[var(--ui-accent)]'
					: 'border border-transparent hover:bg-[var(--ui-hover)]'
			}`}
		>
			<div className="flex-1 min-w-0">
				<label className={`block text-xs font-medium truncate transition-colors ${
					isActive ? 'text-[var(--ui-accent)] font-semibold' : 'text-[var(--ui-text-secondary)]'
				}`}>
					{label.replace(/_/g, ' ')}
				</label>
				{description && (
					<p className="text-[10px] text-[var(--ui-text-muted)] truncate leading-snug mt-0.5">
						{description}
					</p>
				)}
			</div>
			{renderInput()}
		</div>
	);
}
