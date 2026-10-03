'use client';

import React from 'react';
import { History, ChevronLeft, ChevronRight, RotateCcw, Sparkles, Sliders, Code2, Check, Clock } from 'lucide-react';

export interface IterationItem {
	id: string;
	sessionId: string;
	version: number;
	prompt?: string | null;
	source?: string;
	pythonScript: string;
	parameters?: any;
	annotations?: any;
	featureMap?: any;
	stlUrl?: string | null;
	stepUrl?: string | null;
	dxfUrl?: string | null;
	createdAt: string;
}

interface VersionTimelineProps {
	iterations: IterationItem[];
	activeVersion: number;
	latestVersion: number;
	onSelectVersion: (version: number) => void;
	onRestoreVersion?: (iteration: IterationItem) => void;
	isLoading?: boolean;
}

export function VersionTimeline({
	iterations,
	activeVersion,
	latestVersion,
	onSelectVersion,
	onRestoreVersion,
	isLoading = false,
}: VersionTimelineProps) {
	if (!iterations || iterations.length <= 1) {
		return null;
	}

	const activeIteration = iterations.find((it) => it.version === activeVersion) || iterations[iterations.length - 1];
	const isViewingHistorical = activeVersion < latestVersion;

	const getSourceIcon = (source?: string) => {
		switch (source) {
			case 'prompt':
				return <Sparkles className="w-3 h-3 text-blue-400" />;
			case 'parameter_tweak':
				return <Sliders className="w-3 h-3 text-amber-400" />;
			case 'editor_compile':
			default:
				return <Code2 className="w-3 h-3 text-emerald-400" />;
		}
	};

	const getSourceLabel = (source?: string) => {
		switch (source) {
			case 'prompt':
				return 'AI Prompt';
			case 'parameter_tweak':
				return 'Param Tweak';
			case 'editor_compile':
			default:
				return 'Code Compile';
		}
	};

	const currentIndex = iterations.findIndex((it) => it.version === activeVersion);
	const hasPrev = currentIndex > 0;
	const hasNext = currentIndex < iterations.length - 1;

	return (
		<div className="flex items-center gap-2 px-3 py-1.5 bg-zinc-950/80 backdrop-blur-md border border-zinc-800/80 rounded-xl shadow-lg transition-all">
			{/* Label / History icon */}
			<div className="flex items-center gap-1.5 text-xs font-semibold text-zinc-400 pr-1 border-r border-zinc-800">
				<History className="w-3.5 h-3.5 text-blue-400" />
				<span className="text-[11px] uppercase tracking-wider text-zinc-300">History</span>
			</div>

			{/* Arrow navigation */}
			<div className="flex items-center gap-0.5">
				<button
					type="button"
					onClick={() => hasPrev && onSelectVersion(iterations[currentIndex - 1].version)}
					disabled={!hasPrev || isLoading}
					className="p-1 rounded hover:bg-zinc-800/60 disabled:opacity-30 disabled:pointer-events-none text-zinc-400 hover:text-white transition-colors"
					title="Previous Version"
				>
					<ChevronLeft className="w-3.5 h-3.5" />
				</button>
				<button
					type="button"
					onClick={() => hasNext && onSelectVersion(iterations[currentIndex + 1].version)}
					disabled={!hasNext || isLoading}
					className="p-1 rounded hover:bg-zinc-800/60 disabled:opacity-30 disabled:pointer-events-none text-zinc-400 hover:text-white transition-colors"
					title="Next Version"
				>
					<ChevronRight className="w-3.5 h-3.5" />
				</button>
			</div>

			{/* Version Pills Container */}
			<div className="flex items-center gap-1 overflow-x-auto max-w-[280px] scrollbar-none py-0.5">
				{iterations.map((it) => {
					const isActive = it.version === activeVersion;
					const isLatest = it.version === latestVersion;

					return (
						<button
							key={it.id || it.version}
							type="button"
							onClick={() => onSelectVersion(it.version)}
							disabled={isLoading}
							title={`v${it.version}: ${it.prompt || getSourceLabel(it.source)}`}
							className={`relative px-2 py-0.5 text-xs font-mono rounded-md font-medium transition-all duration-200 flex items-center gap-1 ${
								isActive
									? 'bg-blue-600/20 text-blue-300 border border-blue-500/40 shadow-[0_0_12px_rgba(59,130,246,0.25)]'
									: 'bg-zinc-900/60 text-zinc-400 border border-zinc-800/60 hover:bg-zinc-800 hover:text-zinc-200'
							}`}
						>
							<span>v{it.version}</span>
							{isLatest && (
								<span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" title="Latest Version" />
							)}
						</button>
					);
				})}
			</div>

			{/* Historical / Rollback Status */}
			{isViewingHistorical && (
				<div className="flex items-center gap-2 pl-2 border-l border-zinc-800">
					<span className="px-1.5 py-0.5 bg-amber-500/10 border border-amber-500/20 text-amber-300 text-[10px] font-medium rounded">
						v{activeVersion} (Preview)
					</span>
					{onRestoreVersion && activeIteration && (
						<button
							type="button"
							onClick={() => onRestoreVersion(activeIteration)}
							className="flex items-center gap-1 px-2 py-0.5 bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/40 text-blue-300 text-[11px] font-medium rounded transition-colors active:scale-95 shadow-sm"
							title="Restore this version as the latest working model"
						>
							<RotateCcw className="w-3 h-3" />
							Restore
						</button>
					)}
				</div>
			)}
		</div>
	);
}
