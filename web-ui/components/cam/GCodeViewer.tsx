'use client';

import { useState, useMemo } from 'react';
import type { ReactNode } from 'react';
import { Copy, Download, Check, Code2, Clock, Wrench, Hash } from 'lucide-react';

interface GCodeViewerProps {
	content: string;
	onDownload?: () => void;
}

function highlightGCodeLine(line: string): ReactNode {
	// Comments
	if (line.trim().startsWith('(') || line.trim().startsWith(';')) {
		return <span className="text-emerald-600/70 italic">{line}</span>;
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
				if (part.startsWith('(')) return <span key={i} className="text-emerald-600/70 italic">{part}</span>;
				return <span key={i} className="text-gray-400">{part}</span>;
			})}
		</>
	);
}

export function GCodeViewer({ content, onDownload }: GCodeViewerProps) {
	const [copied, setCopied] = useState(false);

	const lines = useMemo(() => content.split('\n'), [content]);

	const stats = useMemo(() => {
		let toolChanges = 0;
		let gCodes = new Set<string>();
		let mCodes = new Set<string>();
		let hasCoolant = false;
		let estimatedMins = 0;

		for (const line of lines) {
			const trimmed = line.trim().toUpperCase();
			if (trimmed.match(/^T\d+\s+M0?6/)) toolChanges++;
			if (trimmed.includes('M06')) toolChanges++;

			const gMatches = trimmed.match(/G\d+/g);
			if (gMatches) gMatches.forEach(g => gCodes.add(g));

			const mMatches = trimmed.match(/M\d+/g);
			if (mMatches) mMatches.forEach(m => mCodes.add(m));

			if (trimmed.includes('M07') || trimmed.includes('M08')) hasCoolant = true;
		}

		// Rough estimate: ~0.5 seconds per G-code line of motion
		const motionLines = lines.filter(l => l.trim().match(/^G0[01]\s/i)).length;
		estimatedMins = Math.max(1, Math.round(motionLines * 0.5 / 60));

		return { toolChanges, lineCount: lines.length, gCodes: gCodes.size, mCodes: mCodes.size, hasCoolant, estimatedMins };
	}, [lines]);

	const handleCopy = async () => {
		try {
			await navigator.clipboard.writeText(content);
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
		} catch { }
	};

	return (
		<div className="flex flex-col gap-4 h-full">
			{/* Stats Bar */}
			<div className="flex items-center gap-6 px-4 py-3 bg-background rounded-xl border border-white/5">
				<div className="flex items-center gap-2">
					<Hash className="size-3.5 text-blue-400" />
					<span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Lines</span>
					<span className="text-xs font-bold text-white ml-1">{stats.lineCount}</span>
				</div>
				<div className="w-px h-5 bg-white/10" />
				<div className="flex items-center gap-2">
					<Wrench className="size-3.5 text-yellow-400" />
					<span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Tool Changes</span>
					<span className="text-xs font-bold text-white ml-1">{stats.toolChanges}</span>
				</div>
				<div className="w-px h-5 bg-white/10" />
				<div className="flex items-center gap-2">
					<Clock className="size-3.5 text-cyan-400" />
					<span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Est. Time</span>
					<span className="text-xs font-bold text-white ml-1">~{stats.estimatedMins} min</span>
				</div>
				<div className="w-px h-5 bg-white/10" />
				<div className="flex items-center gap-2">
					<Code2 className="size-3.5 text-purple-400" />
					<span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">G-Codes</span>
					<span className="text-xs font-bold text-white ml-1">{stats.gCodes}</span>
				</div>

				<div className="flex-1" />

				{/* Actions */}
				<button
					onClick={handleCopy}
					className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 text-xs text-white transition-all"
				>
					{copied ? <Check className="size-3.5 text-green-400" /> : <Copy className="size-3.5" />}
					<span className="text-[10px] font-bold uppercase tracking-wider">{copied ? 'Copied' : 'Copy'}</span>
				</button>
				{onDownload && (
					<button
						onClick={onDownload}
						className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-xs text-white transition-all"
					>
						<Download className="size-3.5" />
						<span className="text-[10px] font-bold uppercase tracking-wider">Download</span>
					</button>
				)}
			</div>

			<div className="flex-1 overflow-auto rounded-xl border border-white/5 bg-background">
				<table className="w-full border-collapse font-mono text-[11px] leading-[1.8]">
					<tbody>
						{lines.map((line, idx) => (
							<tr
								key={idx}
								className="hover:bg-white/5 transition-colors group"
							>
								<td className="select-none text-right pr-4 pl-4 text-[10px] text-white/15 group-hover:text-white/30 font-mono w-[50px] align-top border-r border-white/5">
									{idx + 1}
								</td>
								<td className="pl-4 pr-4 whitespace-pre">
									{highlightGCodeLine(line)}
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</div>
	);
}
