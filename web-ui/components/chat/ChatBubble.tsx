import ReactMarkdown from 'react-markdown';
import { toast } from 'sonner';
import { 
	User, Cpu, Copy, Check, Info, FileImage, Target, RotateCcw, 
	AlertTriangle, CornerDownLeft, Sparkles, SlidersHorizontal, 
	ArrowRight, Plus, Minus, Edit3, Code2, ChevronDown, ChevronRight,
	Layers, CheckCircle2
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
	onRestoreRevision 
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

	// System messages render as a premium centered pill
	if (role === 'system') {
		const isRestoring = content.startsWith('Restoring session');
		const displayText = isRestoring ? content.replace('Restoring session:', '').replace('Restoring session', '').trim() : content;
		
		return (
			<div className="flex justify-center w-full my-5 animate-in fade-in slide-in-from-bottom-2 duration-500">
				<div className="flex items-center gap-3 rounded-full border border-blue-500/20 bg-blue-500/10 backdrop-blur-md px-4 py-2 shadow-[0_0_20px_rgba(59,130,246,0.1)] relative overflow-hidden group max-w-[90%]">
					<div className="absolute inset-0 bg-gradient-to-r from-transparent via-blue-400/10 to-transparent -translate-x-full group-hover:animate-[shimmer_1.5s_infinite] pointer-events-none" />
					
					{isRestoring ? (
						<>
							<div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-blue-500/20 border border-blue-500/30">
								<Info className="size-3.5 text-blue-400" />
							</div>
							<div className="flex flex-col min-w-0">
								<span className="text-[9px] font-bold uppercase tracking-[0.2em] text-blue-400">Session Restored</span>
								<span className="text-[11px] font-medium text-slate-300 truncate" title={displayText}>
									{displayText || 'Workspace loaded'}
								</span>
							</div>
						</>
					) : (
						<>
							<Info className="size-4 shrink-0 text-muted-foreground" />
							<p className="text-[11px] font-medium text-muted-foreground truncate">{content}</p>
						</>
					)}
				</div>
			</div>
		);
	}

	const bubbleClass = isUser
		? 'bg-gradient-to-br from-[#1e293b] to-[#0f172a] border border-[#334155] text-foreground shadow-xl'
		: isError
		? 'bg-rose-950/30 backdrop-blur-md text-rose-200 border border-rose-500/40 shadow-[0_0_20px_rgba(244,63,94,0.15)]'
		: 'bg-muted/80 backdrop-blur-md text-blue-50 border border-blue-500/30 shadow-[0_0_20px_rgba(59,130,246,0.15)]';

	const handleCopy = (text: string) => {
		navigator.clipboard.writeText(text);
		setCopied(true);
		toast.success('Code copied to clipboard');
		setTimeout(() => setCopied(false), 2000);
	};

	return (
		<div className={`group flex w-full flex-col gap-2.5 animate-message ${isUser ? 'items-end' : 'items-start'}`}>
			<div className={`flex items-center gap-2 px-1.5 text-[9px] font-bold uppercase tracking-[0.1em] ${isUser ? 'flex-row-reverse text-slate-400' : 'text-blue-400'}`}>
				<div className={`flex size-6 items-center justify-center rounded-lg shadow-lg ${isUser ? 'bg-slate-800 text-slate-300 border border-slate-700' : 'bg-blue-950/50 text-blue-400 border border-blue-500/50 relative'}`}>
					{!isUser && <div className="absolute inset-0 bg-blue-500/20 animate-pulse rounded-lg" />}
					{isUser ? <User className="size-3.5" /> : <Cpu className="size-3.5 relative z-10" />}
				</div>
				<span className="opacity-80">{role === 'assistant' ? 'VexCAD AI' : 'Engineer'}</span>
			</div>

			<div className={`relative w-full rounded-2xl px-4 py-3 text-sm leading-[1.6] ${bubbleClass} ${isUser ? 'rounded-tr-none ml-auto max-w-[92%]' : 'rounded-tl-none max-w-[96%]'}`}>
				{targetPortion && (
					<div className="flex items-center gap-1.5 mb-2.5 px-2.5 py-1 rounded-lg bg-cyan-500/15 border border-cyan-500/30 text-cyan-300 w-fit backdrop-blur-sm shadow-inner text-[10px] font-semibold">
						<Target className="size-3 text-cyan-400 shrink-0" />
						<span className="truncate max-w-[220px]">Target: {targetPortion}</span>
					</div>
				)}
				{fileName && (
					<div className="flex items-center gap-2 mb-3 px-3 py-2 rounded-xl bg-black/5 dark:bg-black/20 border border-transparent dark:border-border w-fit backdrop-blur-sm shadow-inner">
						<FileImage className="size-3.5 text-blue-400" />
						<span className="text-[10px] font-mono font-bold text-blue-200 uppercase tracking-wider truncate max-w-[200px]">{fileName}</span>
					</div>
				)}
				<div className="prose prose-sm dark:prose-invert max-w-none wrap-break-word font-sans">
					<ReactMarkdown
						components={{
							code({ node, className, children, ...props }) {
								const match = /language-(\w+)/.exec(className || '');
								const codeText = String(children).replace(/\n$/, '');

								// Detailed AI Engineering Modification Report
								if (match && match[1] === 'python') {
									const { summary, details } = extractInlineLog(codeText);
									const paramDiffs = changeLog?.parameterDiff || [];
									const activeTarget = targetPortion || changeLog?.targetPortion;

									return (
										<div className="my-2.5 overflow-hidden rounded-xl border border-blue-500/30 bg-zinc-950/70 backdrop-blur-md shadow-xl w-full">
											{/* Report Top Bar */}
											<div className="flex items-center justify-between gap-2 bg-zinc-900/90 px-3 py-2 border-b border-border/60">
												<div className="flex items-center gap-1.5 min-w-0">
													<div className="size-2 rounded-full bg-cyan-400 animate-pulse shadow-[0_0_6px_rgba(6,182,212,0.6)] shrink-0" />
													<span className="text-[10px] font-bold uppercase tracking-wider text-cyan-300 truncate">
														{revisionNumber ? `Revision #${revisionNumber}` : 'Model Synthesis'}
													</span>
												</div>
												{activeTarget && (
													<span className="text-[9px] font-mono text-cyan-400 bg-cyan-950/90 border border-cyan-500/30 px-1.5 py-0.5 rounded truncate max-w-[110px]" title={activeTarget}>
														{activeTarget}
													</span>
												)}
											</div>
											
											{/* Report Body */}
											<div className="p-3 space-y-2.5">
												{/* Summary Narrative */}
												<div className="p-2.5 rounded-lg bg-blue-500/10 border border-blue-500/20 text-xs text-blue-100/90 leading-relaxed flex items-start gap-2">
													<Sparkles className="size-3.5 text-cyan-400 shrink-0 mt-0.5" />
													<div className="space-y-0.5 min-w-0">
														<div className="text-[9px] font-bold uppercase tracking-wider text-cyan-300">
															Iteration Summary & Modifications
														</div>
														<p className="text-[11px] text-zinc-200 break-words font-normal leading-normal">
															{summary}
														</p>
													</div>
												</div>

												{/* No Changes Detected Notice (when revision > 1 and 0 parameter/geometric diffs) */}
												{revisionNumber && revisionNumber > 1 && paramDiffs.length === 0 && details.length === 0 && (
													<div className="p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/25 text-xs text-amber-200/90 leading-relaxed space-y-1">
														<div className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-wider text-amber-400">
															<AlertTriangle className="size-3 text-amber-400 shrink-0" />
															<span>No Geometric Changes in this Iteration</span>
														</div>
														<p className="text-[10px] text-amber-100/80 leading-normal">
															The AI reviewed your prompt, but no dimensional values or shapes were modified from Revision #{revisionNumber - 1}.
														</p>
														<p className="text-[9px] text-muted-foreground pt-1 border-t border-amber-500/20">
															💡 <strong>Tip:</strong> Specify exact dimensions (e.g. <em>&quot;Set outer_dia to 28mm&quot;</em>) or edit directly in the CAD Design panel on the right.
														</p>
													</div>
												)}

												{/* Parameter Differences Badge Section */}
												{paramDiffs.length > 0 && (
													<div className="space-y-1">
														<div className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
															<SlidersHorizontal className="size-3 text-blue-400 shrink-0" />
															<span>Parameter Adjustments ({paramDiffs.length})</span>
														</div>
														<div className="space-y-1">
															{paramDiffs.map((diff, i) => (
																<div 
																	key={`diff_${i}`} 
																	className="flex items-center justify-between gap-2 px-2 py-1 rounded bg-zinc-900/90 border border-border/70 text-[11px] font-mono"
																>
																	<span className="font-medium text-zinc-300 truncate max-w-[130px]" title={diff.name}>
																		{diff.name}
																	</span>
																	<div className="flex items-center gap-1 shrink-0 text-[10px]">
																		{diff.type === 'modified' ? (
																			<>
																				<span className="text-zinc-500 line-through text-[9px]">{String(diff.oldValue)}</span>
																				<ArrowRight className="size-2 text-cyan-400" />
																				<span className="text-emerald-400 font-bold">{String(diff.newValue)}</span>
																				{typeof diff.oldValue === 'number' && typeof diff.newValue === 'number' && (
																					<span className="text-[8px] text-cyan-400/80">
																						({diff.newValue - diff.oldValue > 0 ? '+' : ''}{(diff.newValue - diff.oldValue).toFixed(2)})
																					</span>
																				)}
																			</>
																		) : diff.type === 'added' ? (
																			<span className="text-emerald-400 font-bold flex items-center gap-0.5">
																				<Plus className="size-2" /> {String(diff.newValue)}
																			</span>
																		) : (
																			<span className="text-rose-400 font-bold flex items-center gap-0.5">
																				<Minus className="size-2" /> Deleted
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
													<div className="space-y-1">
														<div className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
															<Layers className="size-3 text-cyan-400 shrink-0" />
															<span>Geometric Changes</span>
														</div>
														<ul className="space-y-1 text-[11px] text-zinc-300">
															{details.map((d, i) => (
																<li key={`detail_${i}`} className="flex items-start gap-1.5 leading-snug break-words">
																	<CheckCircle2 className="size-3 text-emerald-400 shrink-0 mt-0.5" />
																	<span className="break-words min-w-0">{d}</span>
																</li>
															))}
														</ul>
													</div>
												)}

												{/* Expandable Python Code View */}
												<div className="pt-2 border-t border-border/40 flex items-center justify-between text-[10px] font-mono">
													<button
														type="button"
														onClick={() => setIsCodeExpanded(!isCodeExpanded)}
														className="flex items-center gap-1 text-muted-foreground hover:text-cyan-300 transition-colors py-0.5 cursor-pointer"
													>
														{isCodeExpanded ? <ChevronDown className="size-3 text-cyan-400" /> : <ChevronRight className="size-3 text-cyan-400" />}
														<Code2 className="size-3" />
														<span>{isCodeExpanded ? 'Hide Python Script' : 'View Python Script'}</span>
													</button>
													<button
														type="button"
														onClick={() => handleCopy(codeText)}
														className="flex items-center gap-1 text-muted-foreground hover:text-cyan-300 transition-colors py-0.5 px-1.5 rounded hover:bg-zinc-800 cursor-pointer"
													>
														{copied ? <Check className="size-3 text-emerald-400" /> : <Copy className="size-3" />}
														<span>{copied ? 'Copied' : 'Copy'}</span>
													</button>
												</div>

												{isCodeExpanded && (
													<div className="rounded-lg bg-black/80 border border-border/80 overflow-hidden animate-in fade-in duration-200">
														<pre className="overflow-x-auto p-3 text-[10px] font-mono leading-relaxed text-cyan-100/90 custom-scrollbar max-h-52">
															<code>{codeText}</code>
														</pre>
													</div>
												)}
											</div>
										</div>
									);
								}

								if (match) {
									return (
										<div className="relative my-2.5 overflow-hidden rounded-xl bg-black/5 dark:bg-black/40 border border-transparent dark:border-border shadow-inner group/code">
											<div className="flex items-center justify-between bg-black/5 dark:bg-white/3 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.05em] text-muted-foreground border-b border-transparent dark:border-border">
												<span className="flex items-center gap-1.5">
													<div className="size-1.5 rounded-full bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.25)]" />
													{match[1]}
												</span>
												<button
													onClick={() => handleCopy(codeText)}
													className="flex items-center gap-1 hover:text-blue-400 transition-colors opacity-0 group-hover/code:opacity-100 duration-200"
												>
													{copied ? <Check className="size-3" /> : <Copy className="size-3" />}
													{copied ? 'Copied' : 'Copy'}
												</button>
											</div>
											<pre className="overflow-x-auto p-3 font-mono text-[11px] leading-[1.6] whitespace-pre custom-scrollbar">
												<code className={className} {...props}>
													{children}
												</code>
											</pre>
										</div>
									);
								}
								return (
									<code className="rounded-md bg-accent dark:bg-zinc-800/80 px-1.5 py-0.5 font-mono text-[11px] text-blue-600 dark:text-blue-400 border border-transparent dark:border-zinc-700/50" {...props}>
										{children}
									</code>
								);
							},
							p: ({ children }) => <p className="mb-2 last:mb-0 font-light leading-relaxed">{children}</p>,
							ul: ({ children }) => <ul className="mb-2 list-disc pl-4 last:mb-0 marker:text-blue-500/50 space-y-0.5">{children}</ul>,
							ol: ({ children }) => <ol className="mb-2 list-decimal pl-4 last:mb-0 marker:text-blue-500/50 space-y-0.5">{children}</ol>,
							strong: ({ children }) => <strong className="font-bold text-blue-400/90 tracking-tight">{children}</strong>,
						}}
					>
						{content || '...'}
					</ReactMarkdown>
				</div>
				{isAssistant && revisionId && (
					<div className="mt-2.5 pt-2 border-t border-blue-500/20 flex items-center justify-between gap-2">
						<div className="flex items-center gap-1.5 text-[10px] font-semibold text-blue-300 min-w-0">
							<span className="size-1.5 rounded-full bg-cyan-400 animate-pulse shrink-0" />
							<span className="truncate">CAD Version {revisionNumber ? `#${revisionNumber}` : ''}</span>
						</div>
						{activeRevisionId === revisionId ? (
							<span className="flex items-center gap-1 text-[9px] font-bold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20 shrink-0">
								<Check className="size-2.5" /> Active Model
							</span>
						) : (
							<button
								type="button"
								onClick={() => onRestoreRevision?.(revisionId)}
								className="flex items-center gap-1 text-[10px] font-bold text-cyan-300 hover:text-white bg-cyan-500/20 hover:bg-cyan-500/30 px-2.5 py-1 rounded-lg border border-cyan-500/30 transition-all shadow-sm active:scale-95 cursor-pointer shrink-0 whitespace-nowrap"
								title="Revert the 3D model, script, and parameters back to this version"
							>
								<RotateCcw className="size-2.5 text-cyan-400" />
								<span>Revert to this version</span>
							</button>
						)}
					</div>
				)}
				{isUser && onRestorePrompt && (
					<div className="mt-2 pt-2 border-t border-slate-700/50 flex justify-end">
						<button
							type="button"
							onClick={() => {
								onRestorePrompt(content, targetPortion);
								toast.info('Prompt loaded into editor');
							}}
							className="flex items-center gap-1 text-[10px] text-slate-400 hover:text-cyan-300 transition-colors opacity-70 group-hover:opacity-100"
							title="Load this prompt back into the input box"
						>
							<CornerDownLeft className="size-3" />
							<span>Edit in input</span>
						</button>
					</div>
				)}
				{isError && (
					<div className="mt-3 pt-2.5 border-t border-rose-500/20 flex items-center justify-between">
						<div className="flex items-center gap-1.5 text-[11px] text-rose-300/90 font-medium">
							<AlertTriangle className="size-3.5 text-rose-400 shrink-0" />
							<span>Prompt preserved in text box for editing</span>
						</div>
					</div>
				)}
			</div>
		</div>
	);
}
