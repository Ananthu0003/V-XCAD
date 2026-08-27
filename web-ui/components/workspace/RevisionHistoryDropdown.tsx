'use client';

import { useState, useRef, useEffect } from 'react';
import { History, RotateCcw, Check, ChevronDown, Clock, Sparkles, Target, Sliders, Trash2 } from 'lucide-react';

export type CadRevision = {
	id: string;
	revisionNumber: number;
	timestamp: number;
	title: string;
	description?: string;
	targetPortion?: string;
	pythonScript: string;
	parameters: Record<string, unknown>;
	stlUrl: string | null;
	stepUrl: string | null;
	dxfUrl: string | null;
	annotations?: Record<string, any>;
	parameterMetadata?: Record<string, any>;
	camFeatures?: any[];
	setupMetadata?: any;
};

interface RevisionHistoryDropdownProps {
	revisions: CadRevision[];
	activeRevisionIndex: number;
	onRestoreRevision: (revisionId: string) => void;
	onDeleteRevision?: (revisionId: string) => void;
	canUndo: boolean;
	canRedo: boolean;
	onUndo: () => void;
	onRedo: () => void;
}

export function RevisionHistoryDropdown({
	revisions,
	activeRevisionIndex,
	onRestoreRevision,
	onDeleteRevision,
	canUndo,
	canRedo,
	onUndo,
	onRedo,
}: RevisionHistoryDropdownProps) {
	const [isOpen, setIsOpen] = useState(false);
	const dropdownRef = useRef<HTMLDivElement>(null);

	const activeRevision = revisions[activeRevisionIndex];

	useEffect(() => {
		const handleClickOutside = (e: MouseEvent) => {
			if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
				setIsOpen(false);
			}
		};
		if (isOpen) {
			document.addEventListener('mousedown', handleClickOutside);
		}
		return () => document.removeEventListener('mousedown', handleClickOutside);
	}, [isOpen]);

	if (revisions.length === 0) {
		return null;
	}

	const formatTime = (timestamp: number) => {
		const d = new Date(timestamp);
		return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
	};

	return (
		<div className="inline-flex items-center rounded-xl border border-white/10 bg-black/40 backdrop-blur-md p-0.5 shadow-sm" ref={dropdownRef}>
			{/* Undo Button */}
			<button
				type="button"
				onClick={onUndo}
				disabled={!canUndo}
				className="flex size-7 items-center justify-center rounded-lg text-muted-foreground hover:text-white hover:bg-white/10 disabled:opacity-20 disabled:hover:bg-transparent transition-all cursor-pointer"
				title={canUndo ? `Undo (Ctrl+Z)` : 'No earlier version to undo'}
			>
				<RotateCcw className="size-3.5" />
			</button>

			<div className="w-px h-3.5 bg-white/10 mx-0.5" />

			{/* Revisions Selector */}
			<div className="relative">
				<button
					type="button"
					onClick={() => setIsOpen(!isOpen)}
					className={`flex h-7 items-center gap-1.5 px-2.5 rounded-lg text-[11px] font-mono font-bold transition-all cursor-pointer ${
						isOpen
							? 'bg-cyan-500/20 text-cyan-300'
							: 'text-cyan-400 hover:text-white hover:bg-white/10'
					}`}
					title="Browse and restore CAD model revision history"
				>
					<History className="size-3 text-cyan-400" />
					<span>
						REV {activeRevision ? activeRevision.revisionNumber : 1}/{revisions.length}
					</span>
					<ChevronDown className={`size-3 text-muted-foreground transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
				</button>

				{/* Dropdown Menu */}
				{isOpen && (
					<div className="absolute right-0 mt-2 w-80 max-h-96 overflow-y-auto rounded-2xl border border-border/80 bg-popover/95 backdrop-blur-2xl shadow-2xl z-50 p-2 space-y-1.5 animate-in fade-in zoom-in-95 duration-150">
						<div className="px-3 py-2 border-b border-border/60 flex items-center justify-between">
							<div className="flex items-center gap-2">
								<History className="size-4 text-blue-400" />
								<span className="text-xs font-bold text-foreground">CAD Revision History</span>
							</div>
							<span className="text-[10px] font-mono text-muted-foreground">
								{revisions.length} {revisions.length === 1 ? 'version' : 'versions'}
							</span>
						</div>

						<div className="space-y-1 pt-1">
							{[...revisions].reverse().map((rev) => {
								const isActive = rev.id === activeRevision?.id;
								const paramCount = Object.keys(rev.parameters || {}).length;

								return (
									<div
										key={rev.id}
										onClick={() => {
											if (!isActive) {
												onRestoreRevision(rev.id);
												setIsOpen(false);
											}
										}}
										className={`group flex flex-col gap-1.5 p-2.5 rounded-xl border transition-all cursor-pointer ${
											isActive
												? 'bg-blue-500/10 border-blue-500/40 shadow-inner'
												: 'bg-background/40 border-border/40 hover:bg-muted/80 hover:border-border'
										}`}
									>
										<div className="flex items-center justify-between gap-2">
											<div className="flex items-center gap-2 min-w-0">
												<span
													className={`px-1.5 py-0.5 rounded text-[9px] font-mono font-bold uppercase tracking-wider ${
														isActive
															? 'bg-blue-500 text-black'
															: 'bg-muted text-muted-foreground group-hover:bg-blue-500/20 group-hover:text-blue-300'
													}`}
												>
													Rev #{rev.revisionNumber}
												</span>
												<span className="text-xs font-semibold text-foreground truncate" title={rev.title}>
													{rev.title}
												</span>
											</div>

											<div className="flex items-center gap-1 shrink-0">
												{isActive ? (
													<span className="flex items-center gap-1 text-[10px] font-bold text-emerald-400 shrink-0">
														<Check className="size-3" /> Active
													</span>
												) : (
													<button
														type="button"
														onClick={(e) => {
															e.stopPropagation();
															onRestoreRevision(rev.id);
															setIsOpen(false);
														}}
														className="flex items-center gap-1 text-[10px] font-bold text-blue-400 hover:text-blue-300 bg-blue-500/10 hover:bg-blue-500/20 px-2 py-0.5 rounded-md border border-blue-500/20 transition-all opacity-0 group-hover:opacity-100 shrink-0"
													>
														<RotateCcw className="size-2.5" /> Revert
													</button>
												)}

												{onDeleteRevision && revisions.length > 1 && (
													<button
														type="button"
														onClick={(e) => {
															e.stopPropagation();
															onDeleteRevision(rev.id);
														}}
														className="flex items-center justify-center size-6 text-muted-foreground hover:text-red-400 hover:bg-red-500/15 rounded-md border border-transparent hover:border-red-500/30 transition-all opacity-0 group-hover:opacity-100 shrink-0"
														title={`Delete Revision #${rev.revisionNumber}`}
													>
														<Trash2 className="size-3" />
													</button>
												)}
											</div>
										</div>

										{rev.targetPortion && (
											<div className="flex items-center gap-1 text-[10px] text-cyan-400 bg-cyan-500/10 px-2 py-0.5 rounded-md border border-cyan-500/20 w-fit">
												<Target className="size-3 shrink-0" />
												<span className="truncate max-w-[200px]">{rev.targetPortion}</span>
											</div>
										)}

										{rev.description && rev.description !== rev.title && (
											<p className="text-[11px] text-muted-foreground line-clamp-1 italic">
												&ldquo;{rev.description}&rdquo;
											</p>
										)}

										<div className="flex items-center justify-between text-[10px] text-muted-foreground pt-1 border-t border-border/30">
											<span className="flex items-center gap-1">
												<Clock className="size-3 opacity-60" />
												{formatTime(rev.timestamp)}
											</span>
											<span>{paramCount} parameters</span>
										</div>
									</div>
								);
							})}
						</div>
					</div>
				)}
			</div>

			<div className="w-px h-3.5 bg-white/10 mx-0.5" />

			{/* Redo Button */}
			<button
				type="button"
				onClick={onRedo}
				disabled={!canRedo}
				className="flex size-7 items-center justify-center rounded-lg text-muted-foreground hover:text-white hover:bg-white/10 disabled:opacity-20 disabled:hover:bg-transparent transition-all cursor-pointer"
				title={canRedo ? `Redo (Ctrl+Y)` : 'No newer version to redo'}
			>
				<RotateCcw className="size-3.5 -scale-x-100" />
			</button>
		</div>
	);
}
