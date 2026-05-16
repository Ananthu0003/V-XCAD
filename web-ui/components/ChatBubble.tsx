'use client';

import ReactMarkdown from 'react-markdown';
import { toast } from 'sonner';
import { User, Cpu, Copy, Check } from 'lucide-react';
import { useState } from 'react';

type ChatRole = 'user' | 'assistant' | 'system';

type ChatBubbleProps = {
	role: ChatRole;
	content: string;
	id: string;
};

export function ChatBubble({ role, content }: ChatBubbleProps) {
	const [copied, setCopied] = useState(false);
	const isUser = role === 'user';
	const isAssistant = role === 'assistant';

	const bubbleClass = isUser
		? 'bg-gradient-to-br from-amber-500 to-amber-600 text-black shadow-[0_4px_20px_rgba(245,158,11,0.25)]'
		: 'bg-[#18181b]/80 backdrop-blur-xl text-zinc-200 border border-zinc-800/50 shadow-[0_8px_30px_rgb(0,0,0,0.5)]';

	const handleCopy = (text: string) => {
		navigator.clipboard.writeText(text);
		setCopied(true);
		toast.success('Code copied to clipboard');
		setTimeout(() => setCopied(false), 2000);
	};

	return (
		<div className={`group flex w-full flex-col gap-2.5 animate-message ${isUser ? 'items-end' : 'items-start'}`}>
			<div className={`flex items-center gap-2.5 px-1.5 text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500 ${isUser ? 'flex-row-reverse' : ''}`}>
				<div className={`flex size-6 items-center justify-center rounded-lg shadow-lg ${isUser ? 'bg-amber-400 text-black' : 'bg-zinc-800 text-amber-500'}`}>
					{isUser ? <User className="size-3.5" /> : <Cpu className="size-3.5" />}
				</div>
				<span className="opacity-60">{role}</span>
			</div>

			<div className={`relative max-w-[88%] rounded-2xl px-5 py-4 text-sm leading-[1.6] ${bubbleClass} ${isUser ? 'rounded-tr-none' : 'rounded-tl-none'}`}>
				<div className="prose prose-invert prose-sm max-w-none wrap-break-word font-sans">
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
										<div className="my-6 overflow-hidden rounded-2xl border border-white/10 bg-zinc-950/40 backdrop-blur-sm shadow-2xl">
											<div className="flex items-center justify-between bg-zinc-900/50 px-5 py-3.5 border-b border-white/5">
												<div className="flex items-center gap-3">
													<div className="size-2 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_10px_rgba(16,185,129,0.5)]" />
													<span className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-300">Technical Analysis Report</span>
												</div>
												<div className="flex items-center gap-2 px-2 py-0.5 rounded-full bg-black/40 border border-white/5">
													<span className="text-[8px] font-bold text-zinc-500 uppercase tracking-widest">Model Fidelity: High</span>
												</div>
											</div>
											
											<div className="p-5">
												<div className="mb-4 flex items-center gap-4">
													<h3 className="text-[9px] font-black uppercase tracking-[0.3em] text-amber-500/80">Extracted Dimensions</h3>
													<div className="h-px flex-1 bg-linear-to-r from-white/10 to-transparent" />
												</div>
												
												<div className="grid grid-cols-2 gap-x-6 gap-y-3 mb-6">
													{Object.entries(params).map(([key, val]) => (
														<div key={key} className="flex items-center justify-between group/item">
															<span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider group-hover/item:text-zinc-400 transition-colors">{key.replace(/_/g, ' ')}</span>
															<div className="flex items-center gap-1.5">
																<span className="text-[11px] font-mono font-bold text-amber-400">{val}</span>
																<span className="text-[8px] font-bold text-zinc-700">mm</span>
															</div>
														</div>
													))}
												</div>

												<div className="pt-4 border-t border-white/5 flex items-center justify-between">
													<div className="flex items-center gap-4">
														<div className="flex -space-x-1">
															{[1,2,3].map(i => (
																<div key={i} className="size-4 rounded-full border border-zinc-950 bg-zinc-800 flex items-center justify-center">
																	<div className="size-1 rounded-full bg-amber-500/50" />
																</div>
															))}
														</div>
														<span className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest italic">Core logic dispatched to engine</span>
													</div>
													<div className="text-[10px] font-black uppercase tracking-widest text-zinc-400 border-b border-amber-500/20 pb-0.5">
														Ready for Sync
													</div>
												</div>
											</div>
										</div>
									);
								}

								if (match) {
									return (
										<div className="relative my-4 overflow-hidden rounded-xl bg-black/40 border border-white/5 shadow-inner group/code">
											<div className="flex items-center justify-between bg-white/3 px-4 py-2.5 text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400 border-b border-white/5">
												<span className="flex items-center gap-2">
													<div className="size-1.5 rounded-full bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.5)]" />
													{match[1]}
												</span>
												<button
													onClick={() => handleCopy(codeText)}
													className="flex items-center gap-1.5 hover:text-amber-400 transition-colors opacity-0 group-hover/code:opacity-100 duration-200"
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
									<code className="rounded-md bg-zinc-800/80 px-1.5 py-0.5 font-mono text-[11px] text-amber-300 border border-zinc-700/50" {...props}>
										{children}
									</code>
								);
							},
							p: ({ children }) => <p className="mb-3 last:mb-0 font-light">{children}</p>,
							ul: ({ children }) => <ul className="mb-3 list-disc pl-5 last:mb-0 marker:text-amber-500/50">{children}</ul>,
							ol: ({ children }) => <ol className="mb-3 list-decimal pl-5 last:mb-0 marker:text-amber-500/50">{children}</ol>,
							strong: ({ children }) => <strong className="font-bold text-amber-400/90 tracking-tight">{children}</strong>,
						}}
					>
						{content || '...'}
					</ReactMarkdown>
				</div>
			</div>
		</div>
	);
}
