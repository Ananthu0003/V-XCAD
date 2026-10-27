'use client';

import { useState, useMemo } from 'react';
import type { ReactNode } from 'react';
import { Copy, Download, Check, Code2, Clock, Wrench, Hash, FileText, Package, Layers } from 'lucide-react';

interface GCodeViewerProps {
	content: string;
	onDownload?: () => void;
	setupName?: string;
	sessionId?: string;
	perSetupGcode?: Record<string, string>;
	setupSheets?: Record<string, any>;
	masterRoutingSheet?: any;
	setups?: any[];
	activeSetupId?: string | null;
	onSelectSetup?: (setupId: string) => void;
	onDownloadPackage?: () => void;
}

function highlightGCodeLine(line: string): ReactNode {
	// Comments
	if (line.trim().startsWith('(') || line.trim().startsWith(';')) {
		return <span className="text-emerald-400/80 italic">{line}</span>;
	}

	// Program delimiters
	if (line.trim() === '%') {
		return <span className="text-yellow-500 font-bold">{line}</span>;
	}

	// Highlight tokens
	const parts = line.split(/(\b[GMTSNFHXYZ]\d*\.?\d*\b|\(.*?\))/gi);
	return (
		<>
			{parts.map((part, i) => {
				const upper = part.toUpperCase();
				// G-codes
				if (/^G\d/.test(upper)) return <span key={i} className="text-blue-400 font-semibold">{part}</span>;
				// M-codes
				if (/^M\d/.test(upper)) return <span key={i} className="text-purple-400 font-semibold">{part}</span>;
				// Tool number
				if (/^T\d/.test(upper)) return <span key={i} className="text-yellow-400 font-semibold">{part}</span>;
				// Spindle speed
				if (/^S\d/.test(upper)) return <span key={i} className="text-orange-400">{part}</span>;
				// Feed rate
				if (/^F\d/.test(upper)) return <span key={i} className="text-cyan-400">{part}</span>;
				// Coordinates
				if (/^[XYZ]-?\d/.test(upper)) return <span key={i} className="text-white">{part}</span>;
				// Tool offset
				if (/^H\d/.test(upper)) return <span key={i} className="text-amber-300">{part}</span>;
				// Line number
				if (/^N\d/.test(upper)) return <span key={i} className="text-gray-500">{part}</span>;
				// Comments in parens
				if (part.startsWith('(')) return <span key={i} className="text-emerald-400/80 italic">{part}</span>;
				return <span key={i} className="text-gray-400">{part}</span>;
			})}
		</>
	);
}

export function GCodeViewer({
	content,
	onDownload,
	setupName,
	sessionId,
	perSetupGcode = {},
	setupSheets = {},
	masterRoutingSheet,
	setups = [],
	activeSetupId,
	onSelectSetup,
	onDownloadPackage,
}: GCodeViewerProps) {
	const [copied, setCopied] = useState(false);
	const [viewTab, setViewTab] = useState<'gcode' | 'setupsheet'>('gcode');
	const [selectedProgramKey, setSelectedProgramKey] = useState<string>('master');

	// Active text to display
	const activeGcode = useMemo(() => {
		if (selectedProgramKey === 'master' || !perSetupGcode[selectedProgramKey]) {
			return content;
		}
		return perSetupGcode[selectedProgramKey] || content;
	}, [selectedProgramKey, perSetupGcode, content]);

	const activeSetupSheetText = useMemo(() => {
		if (selectedProgramKey === 'master') {
			if (masterRoutingSheet?.formatted_text) return masterRoutingSheet.formatted_text;
			// Concatenate all setup sheets if master routing text missing
			const allTexts = Object.values(setupSheets).map((s: any) => s?.formatted_text || String(s)).filter(Boolean);
			return allTexts.length > 0 ? allTexts.join('\n\n' + '='.repeat(60) + '\n\n') : 'No setup sheet generated yet.';
		}
		const sData = setupSheets[selectedProgramKey];
		if (sData) {
			return sData.formatted_text || (typeof sData === 'string' ? sData : JSON.stringify(sData, null, 2));
		}
		return masterRoutingSheet?.formatted_text || 'No setup sheet found for this setup.';
	}, [selectedProgramKey, masterRoutingSheet, setupSheets]);

	const lines = useMemo(() => {
		const textToSplit = viewTab === 'gcode' ? activeGcode : activeSetupSheetText;
		return (textToSplit || '').split('\n');
	}, [viewTab, activeGcode, activeSetupSheetText]);

	const stats = useMemo(() => {
		let toolChanges = 0;
		const gCodes = new Set<string>();
		const mCodes = new Set<string>();
		let hasCoolant = false;

		const gcodeLines = (activeGcode || '').split('\n');
		for (const line of gcodeLines) {
			const trimmed = line.trim().toUpperCase();
			if (trimmed.match(/^T\d+\s+M0?6/)) toolChanges++;
			if (trimmed.includes('M06')) toolChanges++;

			const gMatches = trimmed.match(/G\d+/g);
			if (gMatches) gMatches.forEach(g => gCodes.add(g));

			const mMatches = trimmed.match(/M\d+/g);
			if (mMatches) mMatches.forEach(m => mCodes.add(m));

			if (trimmed.includes('M07') || trimmed.includes('M08')) hasCoolant = true;
		}

		const motionLines = gcodeLines.filter(l => l.trim().match(/^G0[01]\s/i)).length;
		const estimatedMins = Math.max(1, Math.round((motionLines * 0.5) / 60));

		return { toolChanges, lineCount: gcodeLines.length, gCodes: gCodes.size, mCodes: mCodes.size, hasCoolant, estimatedMins };
	}, [activeGcode]);

	const handleCopy = async () => {
		try {
			const text = viewTab === 'gcode' ? activeGcode : activeSetupSheetText;
			await navigator.clipboard.writeText(text);
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
		} catch {}
	};

	const handleDownloadActive = () => {
		if (onDownload && selectedProgramKey === 'master') {
			onDownload();
			return;
		}
		const text = viewTab === 'gcode' ? activeGcode : activeSetupSheetText;
		const ext = viewTab === 'gcode' ? 'nc' : 'txt';
		const name = selectedProgramKey === 'master' ? 'MASTER_PROGRAM' : selectedProgramKey;
		const blob = new Blob([text], { type: 'text/plain' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `${name}.${ext}`;
		a.click();
		URL.revokeObjectURL(url);
	};

	const handleDownloadZipPackage = () => {
		if (onDownloadPackage) {
			onDownloadPackage();
			return;
		}
		if (sessionId) {
			window.location.href = `/api/cam/export-package?session_id=${sessionId}`;
		}
	};

	return (
		<div className="flex flex-col gap-4 h-full">
			{/* Top Bar with Mode Switchers and Stats */}
			<div className="flex flex-wrap items-center justify-between gap-4 px-4 py-3 bg-background rounded-xl border border-white/5">
				{/* View Mode: G-Code vs Setup Sheet */}
				<div className="flex items-center gap-1.5 p-1 bg-white/5 rounded-lg border border-white/10">
					<button
						onClick={() => setViewTab('gcode')}
						className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-semibold transition-all ${
							viewTab === 'gcode'
								? 'bg-blue-600 text-white shadow-sm'
								: 'text-muted-foreground hover:text-white'
						}`}
					>
						<Code2 className="size-3.5" />
						<span>CNC G-Code</span>
					</button>
					<button
						onClick={() => setViewTab('setupsheet')}
						className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-semibold transition-all ${
							viewTab === 'setupsheet'
								? 'bg-emerald-600 text-white shadow-sm'
								: 'text-muted-foreground hover:text-white'
						}`}
					>
						<FileText className="size-3.5" />
						<span>Setup Sheet</span>
					</button>
				</div>

				{/* Multi-Setup Selector Pills */}
				<div className="flex items-center gap-1 overflow-x-auto max-w-full">
					<button
						onClick={() => {
							setSelectedProgramKey('master');
						}}
						className={`px-2.5 py-1 text-xs rounded-md font-medium transition-all ${
							selectedProgramKey === 'master'
								? 'bg-white/15 text-white border border-white/20'
								: 'bg-white/5 text-muted-foreground hover:text-white border border-transparent'
						}`}
					>
						Master (All Setups)
					</button>

					{setups.map((s: any) => {
						const sId = s.setupId || s.id;
						const sWcs = s.workCoordinateSystem || s.wcs || 'G54';
						const isSelected = selectedProgramKey === sId;
						return (
							<button
								key={sId}
								onClick={() => {
									setSelectedProgramKey(sId);
									if (onSelectSetup) onSelectSetup(sId);
								}}
								className={`flex items-center gap-1 px-2.5 py-1 text-xs rounded-md font-medium transition-all ${
									isSelected
										? 'bg-blue-600/30 text-blue-300 border border-blue-500/50'
										: 'bg-white/5 text-muted-foreground hover:text-white border border-transparent'
								}`}
							>
								<span>{s.setupName || sId}</span>
								<span className="text-[10px] px-1 py-0.2 rounded bg-white/10 font-mono text-white/80">{sWcs}</span>
							</button>
						);
					})}
				</div>

				{/* Action Buttons */}
				<div className="flex items-center gap-2">
					<button
						onClick={handleCopy}
						className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 text-xs text-white transition-all"
						title="Copy content to clipboard"
					>
						{copied ? <Check className="size-3.5 text-green-400" /> : <Copy className="size-3.5" />}
						<span className="text-[10px] font-bold uppercase tracking-wider">{copied ? 'Copied' : 'Copy'}</span>
					</button>

					<button
						onClick={handleDownloadActive}
						className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-xs text-white transition-all shadow-sm"
						title="Download active program"
					>
						<Download className="size-3.5" />
						<span className="text-[10px] font-bold uppercase tracking-wider">
							Download {viewTab === 'gcode' ? '.NC' : '.TXT'}
						</span>
					</button>

					<button
						onClick={handleDownloadZipPackage}
						className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-xs text-white transition-all shadow-sm font-semibold"
						title="Download full CAM package ZIP with NC programs, setup sheets, and manifest"
					>
						<Package className="size-3.5" />
						<span className="text-[10px] font-bold uppercase tracking-wider">CAM Package (.ZIP)</span>
					</button>
				</div>
			</div>

			{/* Stats Bar */}
			{viewTab === 'gcode' && (
				<div className="flex items-center gap-6 px-4 py-2.5 bg-background/60 rounded-lg border border-white/5 text-xs text-muted-foreground">
					<div className="flex items-center gap-2">
						<Hash className="size-3.5 text-blue-400" />
						<span className="text-[10px] font-bold uppercase tracking-widest">Lines:</span>
						<span className="font-bold text-white font-mono">{stats.lineCount}</span>
					</div>
					<div className="w-px h-4 bg-white/10" />
					<div className="flex items-center gap-2">
						<Wrench className="size-3.5 text-yellow-400" />
						<span className="text-[10px] font-bold uppercase tracking-widest">Tool Changes:</span>
						<span className="font-bold text-white font-mono">{stats.toolChanges}</span>
					</div>
					<div className="w-px h-4 bg-white/10" />
					<div className="flex items-center gap-2">
						<Clock className="size-3.5 text-cyan-400" />
						<span className="text-[10px] font-bold uppercase tracking-widest">Est. Cycle:</span>
						<span className="font-bold text-white font-mono">~{stats.estimatedMins} min</span>
					</div>
					<div className="w-px h-4 bg-white/10" />
					<div className="flex items-center gap-2">
						<Code2 className="size-3.5 text-purple-400" />
						<span className="text-[10px] font-bold uppercase tracking-widest">G-Dialects:</span>
						<span className="font-bold text-white font-mono">{stats.gCodes} codes</span>
					</div>
				</div>
			)}

			{/* Code / Sheet Display Area */}
			<div className="flex-1 overflow-auto rounded-xl border border-white/5 bg-background custom-scrollbar">
				{viewTab === 'gcode' ? (
					<table className="w-full border-collapse font-mono text-[11px] leading-[1.8]">
						<tbody>
							{lines.map((line: string, idx: number) => (
								<tr key={idx} className="hover:bg-white/5 transition-colors group">
									<td className="select-none text-right pr-4 pl-4 text-[10px] text-white/15 group-hover:text-white/30 font-mono w-[50px] align-top border-r border-white/5">
										{idx + 1}
									</td>
									<td className="pl-4 pr-4 whitespace-pre">{highlightGCodeLine(line)}</td>
								</tr>
							))}
						</tbody>
					</table>
				) : (
					<pre className="p-6 font-mono text-xs leading-relaxed text-emerald-300/90 whitespace-pre overflow-x-auto selection:bg-emerald-800">
						{activeSetupSheetText}
					</pre>
				)}
			</div>
		</div>
	);
}
