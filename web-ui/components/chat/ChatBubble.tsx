'use client';

import ReactMarkdown from 'react-markdown';
import { toast } from 'sonner';
import { 
	User, Bot, Copy, Check, Info, FileImage, Target, RotateCcw, 
	AlertTriangle, CornerDownLeft, Sparkles, SlidersHorizontal, 
	ArrowRight, Plus, Minus, Edit3, Code2, ChevronDown, ChevronRight,
	Layers, CheckCircle2, Trash2, ShieldCheck, Clock
} from 'lucide-react';
import { useState } from 'react';

type ChatRole = 'user' | 'assistant' | 'system';

export type ParameterDiff = {
	name: string;
	oldValue?: any;
	newValue?: any;
	type: 'added' | 'modified' | 'deleted';
};

export type IterationChangeLog = {
	summary?: string;
	details?: string[];
	parameterDiff?: ParameterDiff[];
	targetPortion?: string;
};

type ChatBubbleProps = {
	role: ChatRole;
	content: string;
	id: string;
	fileName?: string;
	targetPortion?: string;
	revisionId?: string;
	revisionNumber?: number;
	activeRevisionId?: string | null;
	changeLog?: IterationChangeLog;
	onRestorePrompt?: (text: string, targetPortion?: string) => void;
	onRestoreRevision?: (revisionId: string) => void;
	onDeleteRevision?: (revisionId: string) => void;
};

export function ChatBubble({ 
	role, 
	content, 
	fileName, 
	targetPortion, 
	revisionId, 
	revisionNumber, 
	activeRevisionId, 
	changeLog,
	onRestorePrompt, 
	onRestoreRevision,
	onDeleteRevision
}: ChatBubbleProps) {
	const [copied, setCopied] = useState(false);
	const [isCodeExpanded, setIsCodeExpanded] = useState(false);
	const isUser = role === 'user';
	const isAssistant = role === 'assistant';
	const isError = isAssistant && (content.startsWith('Error:') || content.includes('Generation failed') || content.includes('Failed to'));

	// Helper to extract log from python code text if changeLog prop is not provided
	const extractInlineLog = (codeText: string) => {
		let summary = changeLog?.summary;
		const details: string[] = [...(changeLog?.details || [])];

		if (!summary) {
			const logMatch = codeText.match(/#\s*---\s*REVISION\s*&\s*MODIFICATION\s*LOG\s*---([\s\S]*?)(?:#\s*---+|PARAMETERS|with\s+bd)/i);
			if (logMatch) {
				const block = logMatch[1];
				const sumMatch = block.match(/#\s*SUMMARY:\s*(.+)/i);
				if (sumMatch) summary = sumMatch[1].trim();

				const lines = block.split('\n');
				for (const line of lines) {
					const trimmed = line.trim().replace(/^#\s*/, '');
					if ((trimmed.startsWith('-') || trimmed.startsWith('*')) && !details.includes(trimmed.replace(/^[-*]\s*/, '').trim())) {
						details.push(trimmed.replace(/^[-*]\s*/, '').trim());
					}
				}
			}
		}

		if (!summary) {
			const walkMatch = codeText.match(/#\s*---\s*MENTAL\s*WALKTHROUGH\s*---([\s\S]*?)(?:#\s*---+|with\s+bd)/i);
			if (walkMatch) {
				const lines = walkMatch[1].split('\n')
					.map(l => l.trim().replace(/^#\s*/, ''))
					.filter(l => l && !l.startsWith('---'));
				if (lines.length > 0) {
					summary = lines[0];
					if (lines.length > 1 && details.length === 0) {
						details.push(...lines.slice(1));
					}
				}
			}
		}

		return {
			summary: summary || (targetPortion ? `Applied targeted geometric repairs to ${targetPortion}.` : 'Synthesized 3D CAD model conforming to blueprint constraints.'),
			details,
		};
	};

	// System messages render as a sleek centered pill
	if (role === 'system') {
		const isRestoring = content.startsWith('Restoring session');
		const displayText = isRestoring ? content.replace('Restoring session:', '').replace('Restoring session', '').trim() : content;
		
		return (
			<div className="flex justify-center w-full my-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
				<div className="flex items-center gap-2.5 rounded-full border border-white/10 bg-black/40 backdrop-blur-md px-3.5 py-1.5 shadow-lg text-xs max-w-[90%]">
					<Info className="size-3.5 text-cyan-400 shrink-0" />
					<span className="text-[11px] text-muted-foreground truncate" title={displayText}>
						{displayText || 'Workspace loaded'}
					</span>
				</div>
			</div>
		);
	}

	const handleCopy = (text: string) => {
		navigator.clipboard.writeText(text);
		setCopied(true);
		toast.success('Prompt copied to clipboard');
		setTimeout(() => setCopied(false), 2000);
	};

	return (
		<div className={`group flex w-full flex-col gap-1.5 animate-in fade-in duration-200 ${isUser ? 'items-end' : 'items-start'}`}>
			{/* Role Header & Metadata */}
			<div className={`flex items-center gap-2 px-1 text-[10px] font-bold uppercase tracking-wider ${isUser ? 'flex-row-reverse text-muted-foreground' : 'text-cyan-400'}`}>
				<div className={`flex size-5 items-center justify-center rounded-lg shadow-md ${
					isUser 
						? 'bg-white/10 text-white border border-white/15' 
						: 'bg-cyan-500/15 text-cyan-400 border border-cyan-500/30 shadow-[0_0_10px_rgba(34,211,238,0.2)]'
				}`}>
					{isUser ? <User className="size-3 text-white" /> : <Bot className="size-3 text-cyan-400" />}
				</div>
				<span className="font-mono text-[9.5px]">
					{role === 'assistant' ? 'VEXCAD AI' : 'ENGINEER'}
				</span>
				{revisionNumber && (
					<span className="px-1.5 py-0.2 rounded text-[8.5px] font-mono font-extrabold bg-cyan-400/15 text-cyan-300 border border-cyan-400/30">
						v{revisionNumber}
					</span>
				)}
			</div>

			{/* Main Chat Bubble Card */}
			<div className={`relative w-full rounded-2xl p-3.5 text-xs leading-relaxed transition-all shadow-lg ${
				isUser
					? 'bg-gradient-to-br from-[#111a2e] to-[#0a1120] border border-cyan-500/20 text-white rounded-tr-none ml-auto max-w-[94%] shadow-[0_8px_24px_rgba(0,0,0,0.4)]'
					: isError
					? 'bg-rose-950/40 backdrop-blur-md text-rose-200 border border-rose-500/40 rounded-tl-none max-w-[96%] shadow-[0_0_20px_rgba(244,63,94,0.15)]'
					: 'bg-[#0b101d]/90 backdrop-blur-xl text-foreground border border-white/[0.08] rounded-tl-none max-w-[96%] shadow-[0_8px_30px_rgba(0,0,0,0.5)]'
			}`}>
				{/* Target Tag Badge */}
				{targetPortion && (
					<div className="flex items-center gap-1.5 mb-2 px-2 py-0.5 rounded-lg bg-cyan-500/15 border border-cyan-500/30 text-cyan-300 w-fit text-[10px] font-mono font-semibold">
						<Target className="size-3 text-cyan-400 shrink-0" />
						<span className="truncate max-w-[200px]">Target: {targetPortion}</span>
					</div>
				)}

				{/* Blueprint Attachment Badge */}
				{fileName && (
					<div className="flex items-center gap-2 mb-2.5 px-2.5 py-1.5 rounded-xl bg-black/40 border border-emerald-500/30 text-emerald-300 w-fit text-[10.5px] font-mono">
						<FileImage className="size-3.5 text-emerald-400" />
						<span className="font-semibold truncate max-w-[180px]">{fileName}</span>
					</div>
				)}

				{/* Markdown Content */}
				<div className="prose prose-invert prose-xs max-w-none break-words font-sans text-[12px] leading-relaxed text-white/90 w-full min-w-0">
					<ReactMarkdown
						components={{
							pre: ({ children }) => <div className="w-full min-w-0 my-1">{children}</div>,
							code({ node, className, children, ...props }) {
								const match = /language-(\w+)/.exec(className || '');
								const codeText = String(children).replace(/\n$/, '');

								// Detailed AI Engineering Modification Report
								if (match && match[1] === 'python') {
									const { summary, details } = extractInlineLog(codeText);
									const paramDiffs = changeLog?.parameterDiff || [];
									const activeTarget = targetPortion || changeLog?.targetPortion;

									return (
										<div className="my-2.5 overflow-hidden rounded-xl border border-cyan-500/25 bg-black/60 backdrop-blur-md shadow-xl w-full min-w-0">
											{/* Report Top Bar */}
											<div className="flex items-center justify-between gap-2 bg-white/[0.03] px-3 py-2 border-b border-white/[0.08]">
												<div className="flex items-center gap-1.5 min-w-0">
													<div className="size-2 rounded-full bg-cyan-400 animate-pulse shadow-[0_0_6px_rgba(34,211,238,0.6)] shrink-0" />
													<span className="text-[10px] font-extrabold uppercase tracking-wider text-cyan-300 font-mono">
														{revisionNumber ? `Revision v${revisionNumber}` : 'Model Synthesis'}
													</span>
												</div>
												{activeTarget && (
													<span className="text-[9px] font-mono text-cyan-400 bg-cyan-950/90 border border-cyan-500/30 px-1.5 py-0.5 rounded truncate max-w-[110px]" title={activeTarget}>
														{activeTarget}
													</span>
												)}
											</div>
											
											{/* Report Body */}
											<div className="p-3 space-y-2.5 w-full min-w-0">
												{/* Summary Narrative */}
												<div className="p-2.5 rounded-lg bg-cyan-500/10 border border-cyan-500/20 text-xs text-cyan-100 leading-relaxed flex items-start gap-2 w-full min-w-0">
													<Sparkles className="size-3.5 text-cyan-400 shrink-0 mt-0.5" />
													<div className="space-y-0.5 min-w-0 flex-1">
														<p className="text-[11px] text-white/90 break-words font-normal leading-relaxed whitespace-normal">
															{summary}
														</p>
													</div>
												</div>

												{/* Parameter Differences Badge Section */}
												{paramDiffs.length > 0 && (
													<div className="space-y-1 pt-1 w-full min-w-0">
														<div className="flex items-center gap-1.5 text-[9.5px] font-bold uppercase tracking-wider text-muted-foreground">
															<SlidersHorizontal className="size-3 text-cyan-400 shrink-0" />
															<span>Parameter Adjustments ({paramDiffs.length})</span>
														</div>
														<div className="space-y-1">
															{paramDiffs.map((diff, i) => (
																<div 
																	key={`diff_${i}`} 
																	className="flex items-center justify-between gap-2 px-2 py-1 rounded-lg bg-black/50 border border-white/[0.06] text-[10.5px] font-mono"
																>
																	<span className="font-medium text-white/80 truncate max-w-[130px]" title={diff.name}>
																		{diff.name}
																	</span>
																	<div className="flex items-center gap-1 shrink-0 text-[10px]">
																		{diff.type === 'modified' ? (
																			<>
																				<span className="text-muted-foreground line-through text-[9px]">{String(diff.oldValue)}</span>
																				<ArrowRight className="size-2.5 text-cyan-400" />
																				<span className="text-emerald-400 font-bold">{String(diff.newValue)}</span>
																			</>
																		) : diff.type === 'added' ? (
																			<span className="text-emerald-400 font-bold flex items-center gap-0.5">
																				<Plus className="size-2.5" /> {String(diff.newValue)}
																			</span>
																		) : (
																			<span className="text-rose-400 font-bold flex items-center gap-0.5">
																				<Minus className="size-2.5" /> Deleted
																			</span>
																		)}
																	</div>
																</div>
															))}
														</div>
													</div>
												)}

												{/* Geometric Details List */}
												{details.length > 0 && (
													<div className="space-y-1.5 pt-1 w-full min-w-0">
														<div className="flex items-center gap-1.5 text-[9.5px] font-bold uppercase tracking-wider text-muted-foreground">
															<Layers className="size-3 text-cyan-400 shrink-0" />
															<span>Geometric Modifications</span>
														</div>
														<ul className="space-y-1.5 text-[11px] text-white/80 w-full min-w-0">
															{details.map((d, i) => (
																<li key={`detail_${i}`} className="flex items-start gap-1.5 leading-snug break-words w-full min-w-0">
																	<CheckCircle2 className="size-3 text-emerald-400 shrink-0 mt-0.5" />
																	<span className="break-words min-w-0 flex-1 whitespace-normal text-white/90">{d}</span>
																</li>
															))}
														</ul>
													</div>
												)}

												{/* Expandable Python Code View */}
												<div className="pt-2 border-t border-white/[0.08] flex items-center justify-between text-[10px] font-mono">
													<button
														type="button"
														onClick={() => setIsCodeExpanded(!isCodeExpanded)}
														className="text-cyan-400 hover:text-cyan-300 flex items-center gap-1 transition-colors cursor-pointer"
													>
														<Code2 className="size-3" />
														<span>{isCodeExpanded ? 'Hide Code' : 'View Generated CAD Script'}</span>
														{isCodeExpanded ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
													</button>
													<button
														type="button"
														onClick={() => handleCopy(codeText)}
														className="text-muted-foreground hover:text-white flex items-center gap-1 transition-colors cursor-pointer"
														title="Copy Python script"
													>
														{copied ? <Check className="size-3 text-emerald-400" /> : <Copy className="size-3" />}
														<span>{copied ? 'Copied' : 'Copy'}</span>
													</button>
												</div>

												{isCodeExpanded && (
													<div className="mt-2 p-2.5 rounded-lg bg-black/90 border border-white/10 overflow-x-auto max-h-60 text-[10.5px] font-mono text-cyan-200 leading-normal">
														<pre className="whitespace-pre">{codeText}</pre>
													</div>
												)}
											</div>
										</div>
									);
								}
								return (
									<code className="rounded px-1.5 py-0.5 font-mono text-[11px] text-cyan-300 bg-white/10 border border-white/10" {...props}>
										{children}
									</code>
								);
							},
							p: ({ children }) => <p className="mb-2 last:mb-0 leading-relaxed break-words whitespace-normal">{children}</p>,
							ul: ({ children }) => <ul className="mb-2 list-disc pl-4 last:mb-0 marker:text-cyan-400 space-y-1">{children}</ul>,
							ol: ({ children }) => <ol className="mb-2 list-decimal pl-4 last:mb-0 marker:text-cyan-400 space-y-1">{children}</ol>,
							strong: ({ children }) => <strong className="font-extrabold text-cyan-300">{children}</strong>,
						}}
					>
						{content || '...'}
					</ReactMarkdown>
				</div>

				{/* Assistant Revision Action Footer */}
				{isAssistant && revisionId && (
					<div className="mt-2.5 pt-2 border-t border-white/[0.08] flex items-center justify-between gap-2">
						<div className="flex items-center gap-1.5 text-[10px] font-mono text-muted-foreground min-w-0">
							<span className="size-1.5 rounded-full bg-cyan-400 animate-pulse shrink-0" />
							<span className="truncate">Rev {revisionNumber ? `#${revisionNumber}` : ''}</span>
						</div>

						<div className="flex items-center gap-1.5 shrink-0">
							{activeRevisionId === revisionId ? (
								<span className="flex items-center gap-1 text-[9.5px] font-bold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-lg border border-emerald-500/25 shrink-0 font-mono">
									<Check className="size-2.5" /> Active
								</span>
							) : (
								<button
									type="button"
									onClick={() => onRestoreRevision?.(revisionId)}
									className="flex items-center gap-1 text-[10px] font-bold text-cyan-300 hover:text-white bg-cyan-500/15 hover:bg-cyan-500/25 px-2.5 py-1 rounded-lg border border-cyan-500/30 transition-all shadow-sm active:scale-95 cursor-pointer shrink-0 whitespace-nowrap"
									title="Revert to this revision"
								>
									<RotateCcw className="size-2.5 text-cyan-400" />
									<span>Revert to v{revisionNumber}</span>
								</button>
							)}

							{onDeleteRevision && (
								<button
									type="button"
									onClick={() => onDeleteRevision(revisionId)}
									className="p-1 text-muted-foreground hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition-colors cursor-pointer shrink-0"
									title="Delete revision"
								>
									<Trash2 className="size-3" />
								</button>
							)}
						</div>
					</div>
				)}

				{/* User Action Footer (Quick Reuse Prompt) */}
				{isUser && onRestorePrompt && (
					<div className="mt-2 pt-1.5 border-t border-white/10 flex justify-end">
						<button
							type="button"
							onClick={() => {
								onRestorePrompt(content, targetPortion);
								toast.info('Prompt loaded into input');
							}}
							className="flex items-center gap-1 text-[9.5px] font-semibold text-muted-foreground hover:text-cyan-300 transition-colors cursor-pointer"
							title="Load this prompt back into the input box"
						>
							<CornerDownLeft className="size-2.5 text-cyan-400" />
							<span>Edit in input</span>
						</button>
					</div>
				)}
			</div>
		</div>
	);
}
