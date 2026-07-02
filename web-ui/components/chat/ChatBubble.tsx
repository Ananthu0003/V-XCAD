'use client';

import ReactMarkdown from 'react-markdown';
import { toast } from 'sonner';
import { User, Cpu, Copy, Check, Info, FileImage } from 'lucide-react';
import { useState } from 'react';

type ChatRole = 'user' | 'assistant' | 'system';

type ChatBubbleProps = {
	role: ChatRole;
	content: string;
	id: string;
	fileName?: string;
};

export function ChatBubble({ role, content, fileName }: ChatBubbleProps) {
	const [copied, setCopied] = useState(false);
	const isUser = role === 'user';
	const isAssistant = role === 'assistant';

	// System messages render as a compact inline hint strip
	if (role === 'system') {
		return (
			<div className="flex items-center gap-2.5 rounded-xl border border-transparent/50 dark:border-border bg-background dark:bg-muted/50 shadow-sm px-3.5 py-2.5 animate-message">
				<Info className="size-3.5 shrink-0 text-blue-500/60" />
				<p className="text-[11px] leading-snug text-muted-foreground font-sans">{content}</p>
			</div>
		);
	}

	const bubbleClass = isUser
		? 'bg-gradient-to-br from-[#1e293b] to-[#0f172a] border border-[#334155] text-foreground shadow-xl'
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
				<span className="opacity-80">{role === 'assistant' ? 'AI Co-Pilot' : 'Engineer'}</span>
			</div>

			<div className={`relative max-w-[88%] rounded-2xl px-5 py-4 text-sm leading-[1.6] ${bubbleClass} ${isUser ? 'rounded-tr-none' : 'rounded-tl-none'}`}>
				{fileName && isUser && (
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

								// Professional Engineering Report Transformation
								if (match && match[1] === 'python' && codeText.includes('PARAMETERS')) {
									const paramsMatch = codeText.match(/PARAMETERS\s*=\s*\{([\s\S]*?)\}/);
									const params: Record<string, string> = {};
									
									if (paramsMatch) {
										const lines = paramsMatch[1].split('\n');
										lines.forEach(line => {
											const m = line.match(/"(\w+)":\s*([\d.]+)/);
											if (m) params[m[1]] = m[2];
										});
									}

									return (
										<div className="my-6 overflow-hidden rounded-2xl border border-transparent dark:border-border bg-accent/50 dark:bg-zinc-950/40 backdrop-blur-sm shadow-2xl">
											<div className="flex items-center justify-between bg-background dark:bg-zinc-900/50 px-5 py-3.5 border-b border-transparent dark:border-border">
												<div className="flex items-center gap-3">
													<div className="size-2 rounded-full bg-cyan-500 animate-pulse shadow-[0_0_10px_rgba(6,182,212,0.25)]" />
													<span className="text-[10px] font-black uppercase tracking-[0.05em] text-foreground dark:text-zinc-300">Technical Analysis Report</span>
												</div>
												<div className="flex items-center gap-2 px-2 py-0.5 rounded-full bg-black/5 dark:bg-black/40 border border-transparent dark:border-border">
													<span className="text-[8px] font-bold text-muted-foreground uppercase tracking-wide">Model Fidelity: High</span>
												</div>
											</div>
											
											<div className="p-5">
												<div className="mb-4 flex items-center gap-4">
													<h3 className="text-[9px] font-black uppercase tracking-[0.1em] text-blue-500/80">Extracted Dimensions</h3>
													<div className="h-px flex-1 bg-linear-to-r from-white/10 to-transparent" />
												</div>
												
												<div className="grid grid-cols-1 gap-3 mb-6">
													{Object.entries(params).map(([key, val]) => (
														<div key={key} className="flex items-center justify-between group/item gap-4">
															<span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider group-hover/item:text-foreground transition-colors truncate" title={key.replace(/_/g, ' ')}>
																{key.replace(/_/g, ' ')}
															</span>
															<div className="flex items-center gap-1.5">
																<span className="text-[11px] font-mono font-bold text-blue-500 dark:text-blue-400">{val}</span>
																<span className="text-[8px] font-bold text-muted-foreground">mm</span>
															</div>
														</div>
													))}
												</div>

												<div className="pt-4 border-t border-transparent dark:border-border flex items-center justify-between">
													<div className="flex items-center gap-4">
														<div className="flex -space-x-1">
															{[1,2,3].map(i => (
																<div key={i} className="size-4 rounded-full border border-background dark:border-zinc-950 bg-accent dark:bg-zinc-800 flex items-center justify-center">
																	<div className="size-1 rounded-full bg-blue-500/50" />
																</div>
															))}
														</div>
														<span className="text-[9px] font-bold text-muted-foreground uppercase tracking-wide italic">Core logic dispatched to engine</span>
													</div>
													<div className="text-[10px] font-black uppercase tracking-wide text-muted-foreground border-b border-blue-500/20 pb-0.5">
														Ready for Sync
													</div>
												</div>
											</div>
										</div>
									);
								}

								if (match) {
									return (
										<div className="relative my-4 overflow-hidden rounded-xl bg-black/5 dark:bg-black/40 border border-transparent dark:border-border shadow-inner group/code">
											<div className="flex items-center justify-between bg-black/5 dark:bg-white/3 px-4 py-2.5 text-[10px] font-bold uppercase tracking-[0.05em] text-muted-foreground border-b border-transparent dark:border-border">
												<span className="flex items-center gap-2">
													<div className="size-1.5 rounded-full bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.25)]" />
													{match[1]}
												</span>
												<button
													onClick={() => handleCopy(codeText)}
													className="flex items-center gap-1.5 hover:text-blue-400 transition-colors opacity-0 group-hover/code:opacity-100 duration-200"
												>
													{copied ? <Check className="size-3" /> : <Copy className="size-3" />}
													{copied ? 'Copied' : 'Copy'}
												</button>
											</div>
											<pre className="overflow-x-auto p-5 font-mono text-[12px] leading-[1.7] whitespace-pre custom-scrollbar">
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
							p: ({ children }) => <p className="mb-3 last:mb-0 font-light">{children}</p>,
							ul: ({ children }) => <ul className="mb-3 list-disc pl-5 last:mb-0 marker:text-blue-500/50">{children}</ul>,
							ol: ({ children }) => <ol className="mb-3 list-decimal pl-5 last:mb-0 marker:text-blue-500/50">{children}</ol>,
							strong: ({ children }) => <strong className="font-bold text-blue-400/90 tracking-tight">{children}</strong>,
						}}
					>
						{content || '...'}
					</ReactMarkdown>
				</div>
			</div>
		</div>
	);
}
