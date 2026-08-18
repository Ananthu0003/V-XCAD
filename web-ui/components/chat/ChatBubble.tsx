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

	// System messages render as a premium centered pill
	if (role === 'system') {
		const isRestoring = content.startsWith('Restoring session');
		const displayText = isRestoring ? content.replace('Restoring session:', '').replace('Restoring session', '').trim() : content;
		
		return (
			<div className="flex justify-center w-full my-5 animate-in fade-in slide-in-from-bottom-2 duration-500">
				<div className="flex items-center gap-3 rounded-full border border-blue-500/20 bg-blue-500/10 backdrop-blur-md px-4 py-2 shadow-[0_0_20px_rgba(59,130,246,0.1)] relative overflow-hidden group max-w-[90%]">
					{/* Animated shine effect on hover */}
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

								// Professional Engineering Report Transformation
								if (match && match[1] === 'python') {
									return (
										<div className="my-4 overflow-hidden rounded-2xl border border-transparent dark:border-border bg-accent/50 dark:bg-zinc-950/40 backdrop-blur-sm shadow-2xl">
											<div className="flex items-center justify-between bg-background dark:bg-zinc-900/50 px-4 py-3 border-b border-transparent dark:border-border">
												<div className="flex items-center gap-2.5">
													<div className="size-2 rounded-full bg-cyan-500 animate-pulse shadow-[0_0_10px_rgba(6,182,212,0.25)] shrink-0" />
													<span className="text-[10px] font-black uppercase tracking-[0.05em] text-foreground dark:text-zinc-300 truncate">VexCAD AI Engine</span>
												</div>
											</div>
											
											<div className="p-4">
												<div className="mb-4 flex flex-col gap-3">
													<div className="flex flex-col gap-2 rounded-lg bg-blue-500/10 border border-blue-500/20 p-3">
														<span className="text-[10px] font-bold text-blue-400 uppercase tracking-wider">Project Workflow Initialized</span>
														<div className="text-[11px] text-muted-foreground flex flex-col gap-1.5 mt-1">
															<div className="flex items-center gap-2"><Check className="size-3 text-blue-400" /> Blueprint analyzed</div>
															<div className="flex items-center gap-2"><Check className="size-3 text-blue-400" /> Features extracted</div>
															<div className="flex items-center gap-2"><Check className="size-3 text-blue-400" /> Generating 3D model...</div>
														</div>
													</div>
													
													<div className="font-mono text-[9px] text-muted-foreground/70 uppercase tracking-widest space-y-2 pl-3 mt-2 border-l-2 border-blue-500/30 overflow-hidden">
														<div className="animate-pulse truncate">_ Compiling Script</div>
														<div className="animate-pulse truncate" style={{ animationDelay: '150ms' }}>_ Synthesizing 3D Model</div>
														<div className="text-blue-400/80 truncate">_ Ready for Preview</div>
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
