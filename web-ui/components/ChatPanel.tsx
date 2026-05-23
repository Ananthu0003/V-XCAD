'use client';

import { FormEvent, useRef, useEffect, useState } from 'react';
import { SendHorizontal, Upload, Loader2, Trash2, Cuboid, LogOut } from 'lucide-react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ChatBubble } from './ChatBubble';

type ChatRole = 'user' | 'assistant' | 'system';

type ChatMessage = {
	id: string;
	role: ChatRole;
	content: string;
	fileName?: string;
};

type ChatPanelProps = {
	messages: ChatMessage[];
	prompt: string;
	setPrompt: (v: string) => void;
	selectedModel: string;
	setSelectedModel: (v: string) => void;
	modelOptions: { value: string; label: string }[];
	selectedFile: File | null;
	handleFileChange: (file: File | null) => void;
	isGenerating: boolean;
	onSubmit: (e: FormEvent<HTMLFormElement>) => void;
	onClear: () => void;
	width: number;
	isOpen: boolean;
	setIsOpen: (v: boolean) => void;
};

export function ChatPanel({
	messages,
	prompt,
	setPrompt,
	selectedModel,
	setSelectedModel,
	modelOptions,
	selectedFile,
	handleFileChange,
	isGenerating,
	onSubmit,
	onClear,
	width,
	isOpen,
	setIsOpen
}: ChatPanelProps) {
	const scrollRef = useRef<HTMLDivElement | null>(null);
	const router = useRouter();
	const [isLoggingOut, setIsLoggingOut] = useState(false);

	const handleLogout = async () => {
		setIsLoggingOut(true);
		try {
			await fetch('/api/auth/logout', { method: 'POST' });
			router.push('/');
			router.refresh();
		} finally {
			setIsLoggingOut(false);
		}
	};

	useEffect(() => {
		scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
	}, [messages]);

	return (
		<section
			className={`flex shrink-0 flex-col border-r border-border bg-zinc-50/90 dark:bg-background/80 backdrop-blur-2xl relative z-20 transition-all duration-500 ease-[cubic-bezier(0.2,1,0.2,1)] overflow-hidden font-sans shadow-[4px_0_24px_rgba(0,0,0,0.02)] dark:shadow-2xl`}
			style={{ width: isOpen ? `${width}px` : '64px' }}
		>
				{/* High-Fidelity Header */}
			<div className={`flex h-full flex-1 flex-col min-h-0 transition-opacity duration-300 ${isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
				<header className={`sticky top-0 z-40 flex min-h-[64px] shrink-0 items-center justify-between border-b border-border dark:border-white/5 bg-transparent px-4 transition-all gap-2`}>
					<div className="flex items-center gap-2 shrink-0">
						{/* Toggle Button */}
						<button
							onClick={() => setIsOpen(!isOpen)}
							className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border dark:border-white/10 bg-black/5 dark:bg-white/5 text-muted-foreground hover:border-blue-500/50 hover:bg-blue-500/10 hover:text-blue-500 dark:hover:text-blue-400 transition-all z-50"
						>
							{isOpen ? (
								<svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
									<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
								</svg>
							) : (
								<svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
									<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
								</svg>
							)}
						</button>
						<Link href="/" className="flex items-center gap-3 group shrink-0 hover:opacity-80 transition-opacity" title="Back to Home">
							<div className="relative w-8 h-8 hidden sm:flex items-center justify-center group shrink-0">
								<div className="absolute inset-0 bg-blue-500 rounded-lg transform rotate-45 opacity-20 group-hover:opacity-30 transition-opacity"></div>
								<Cuboid className="w-5 h-5 text-blue-400 relative z-10" />
							</div>
							<h1 className="text-[18px] font-bold tracking-widest bg-clip-text text-transparent bg-gradient-to-r from-gray-800 to-gray-500 dark:from-gray-100 dark:to-gray-500 font-sans uppercase hidden xl:block shrink-0">CADVΞX</h1>
						</Link>
					</div>

					<div className="flex items-center gap-2 flex-1 justify-end min-w-0">
						{/* Model Switcher - Hardware Module Style */}
						{/* <div className="relative group shrink min-w-0">
							<div className="flex items-center gap-2 rounded-full border border-blue-500/20 bg-blue-500/5 px-2 sm:px-3 py-1.5 transition-all hover:border-blue-500/50 hover:bg-blue-500/10 shadow-[0_0_15px_rgba(59,130,246,0.05)] cursor-pointer overflow-hidden max-w-[120px] sm:max-w-full">
								<div className="size-1 shrink-0 rounded-full bg-cyan-500 animate-pulse" />
								<div className="flex items-center gap-1.5 w-full min-w-0">
									<select
										value={selectedModel}
										onChange={(e) => setSelectedModel(e.target.value)}
										className="bg-transparent text-[10px] font-sans font-bold uppercase tracking-widest text-blue-600 dark:text-blue-200 focus:outline-none cursor-pointer appearance-none pr-3 w-full truncate"
									>
										{modelOptions.map((opt) => (
											<option key={opt.value} value={opt.value} className="bg-background text-foreground uppercase">
												{opt.label.split(' ')[0].replace('gemini-', '')}
											</option>
										))}
									</select>
									<div className="pointer-events-none absolute right-2 sm:right-3 top-1/2 -translate-y-1/2 bg-black/40 pl-1">
										<svg className="size-2.5 text-blue-500/50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
											<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M19 9l-7 7-7-7" />
										</svg>
									</div>
								</div>
							</div>
						</div>
						<div className="h-4 w-px bg-border dark:bg-white/10 shrink-0" /> */}

						<button
							onClick={onClear}
							className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border dark:border-white/10 bg-black/5 dark:bg-white/5 text-muted-foreground transition-all hover:border-red-500/50 hover:bg-red-500/10 hover:text-red-500"
							title="Clear Session"
						>
							<Trash2 className="size-3.5" />
						</button>

						{/* Logout Button */}
						<button
							onClick={handleLogout}
							disabled={isLoggingOut}
							className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border dark:border-white/10 bg-black/5 dark:bg-white/5 text-muted-foreground transition-all hover:border-blue-500/50 hover:bg-blue-500/10 hover:text-blue-500 dark:hover:text-blue-400 disabled:opacity-50"
							title="Sign Out"
						>
							{isLoggingOut ? <Loader2 className="size-3.5 animate-spin" /> : <LogOut className="size-3.5" />}
						</button>
					</div>
				</header>

				{/* Message Stream */}
				<div className="flex-1 space-y-4 overflow-y-auto px-5 py-5 custom-scrollbar scroll-smooth">
					{messages.map((msg) => (
						<ChatBubble key={msg.id} {...msg} />
					))}
					<div ref={scrollRef} />
				</div>

				{/* Action Card & Input */}
				<div className="p-6">
						<form onSubmit={onSubmit} className="relative group/form flex flex-col gap-3">
							{/* File Context Indicator */}
							{selectedFile && (
								<div className="animate-message">
									<div className="flex items-center gap-3 rounded-xl border border-blue-500/30 bg-blue-500/10 p-2 pl-3 pr-2 backdrop-blur-xl">
										<div className="flex size-7 items-center justify-center rounded-lg bg-blue-500 text-black shadow-[0_0_15px_rgba(59,130,246,0.5)]">
											<Upload className="size-3.5" />
										</div>
										<div className="flex-1 min-w-0">
											<p className="truncate text-[10px] font-sans font-bold text-blue-400 uppercase tracking-wider">
												{selectedFile.name}
											</p>
										</div>
										<button
											type="button"
											onClick={() => handleFileChange(null)}
											className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-black/10 dark:hover:bg-white/10 transition-colors"
										>
											<svg className="size-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
												<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
											</svg>
										</button>
									</div>
								</div>
							)}
							<div className="relative overflow-hidden rounded-2xl border border-border dark:border-white/10 bg-white dark:bg-black/60 shadow-[0_2px_20px_rgba(0,0,0,0.04)] dark:shadow-[0_20px_50px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,255,255,0.1)] backdrop-blur-xl transition-all duration-300 focus-within:border-blue-500/40 focus-within:shadow-[0_0_30px_rgba(37,99,235,0.1)] dark:focus-within:shadow-[0_0_30px_rgba(37,99,235,0.2),inset_0_1px_0_rgba(255,255,255,0.1)]">
								<textarea
									value={prompt}
									onChange={(e) => setPrompt(e.target.value)}
									onKeyDown={(e) => {
										if (e.key === 'Enter' && e.shiftKey) {
											e.preventDefault();
											onSubmit(e as any);
										}
									}}
									rows={3}
									placeholder="Describe your design intent..."
									className="w-full resize-none bg-transparent p-5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none font-sans leading-relaxed"
								/>

								<div className="flex items-center justify-between border-t border-border dark:border-white/10 bg-zinc-50/50 dark:bg-white/5 px-4 py-3">
									<div className="flex items-center gap-3">
										{/* Main blueprint upload */}
										<label
											className={`group/btn relative flex cursor-pointer items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-[10px] font-mono font-bold uppercase tracking-wider transition-all duration-200 ${selectedFile
												? 'border border-blue-500/20 bg-blue-500/5 text-blue-500 shadow-[0_0_15px_rgba(59,130,246,0.05)]'
												: 'text-muted-foreground hover:bg-accent hover:text-foreground'
												}`}
											title="Upload engineering blueprint drawing"
										>
											<Upload className="size-3.5 shrink-0" />
											<span className="whitespace-nowrap">{selectedFile ? 'Blueprint' : 'Upload'}</span>
											<input
												type="file"
												accept="image/*,.pdf"
												className="hidden"
												onChange={(e) => {
													const file = e.target.files?.[0] || null;
													if (file) handleFileChange(file);
												}}
											/>
										</label>
									</div>

									<button
										type="submit"
										disabled={isGenerating || !prompt.trim() || !selectedFile}
										className={`group/btn relative flex h-9 items-center gap-2 rounded-lg px-4 text-[11px] font-bold uppercase tracking-[0.2em] transition-all overflow-hidden ${isGenerating
											? 'border border-blue-500/30 bg-blue-500/10 text-blue-500 shadow-[0_0_15px_rgba(59,130,246,0.15)] animate-pulse'
											: !prompt.trim() || !selectedFile
												? 'bg-black/5 dark:bg-white/5 text-muted-foreground border border-border dark:border-white/10 cursor-not-allowed'
												: 'bg-gradient-to-b from-blue-500 to-blue-700 text-white border border-blue-400/30 shadow-[0_0_20px_rgba(37,99,235,0.4)] hover:from-blue-400 hover:to-blue-600 hover:scale-[1.02] active:scale-[0.98]'
											}`}
									>
										{isGenerating ? (
											<>
												<Loader2 className="size-3.5 animate-spin shrink-0 text-blue-500" />
												<span className="whitespace-nowrap tracking-widest text-[9px] text-blue-500">Running</span>
											</>
										) : (
											<>
												<SendHorizontal className="size-3.5 shrink-0" />
												<span className="whitespace-nowrap">Generate</span>
											</>
										)}
										{!isGenerating && (
											<div className="absolute inset-0 -translate-x-full bg-linear-to-r from-transparent via-white/30 to-transparent group-hover/btn:translate-x-full transition-transform duration-700" />
										)}
									</button>
								</div>
							</div>
						</form>
				</div>
			</div>

			{!isOpen && (
				<div className="flex h-full flex-col items-center gap-6 pt-4">
					<button
						onClick={() => setIsOpen(true)}
						className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border dark:border-white/10 bg-black/5 dark:bg-white/5 text-muted-foreground hover:border-blue-500/50 hover:bg-blue-500/10 hover:text-blue-500 dark:hover:text-blue-400 transition-all z-50"
					>
						<svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
							<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
						</svg>
					</button>
					<div className="mt-8 rotate-90 whitespace-nowrap text-[10px] font-bold uppercase tracking-[0.4em] text-muted-foreground">
						Design Assistant
					</div>
				</div>
			)}
		</section>
	);
}
