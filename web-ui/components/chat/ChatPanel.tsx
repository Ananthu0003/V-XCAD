'use client';

import { FormEvent, useRef, useEffect, useState } from 'react';
import { Bot, LogOut, Loader2, SendHorizontal, Zap, Upload, FileImage, Settings, BrainCircuit } from 'lucide-react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { ChatBubble } from '@/components/chat/ChatBubble';
import { SettingsPanel } from '@/components/workspace/SettingsPanel';

// ── Starter prompts shown in the empty-chat welcome screen ──────────────────
const STARTER_PROMPTS = [
	{
		icon: Bot,
		color: 'blue',
		title: 'Mechanical Part',
		body: 'Design a bolt with M8 threading, 40 mm length, and hex head.',
	},
	{
		icon: Bot,
		color: 'cyan',
		title: 'Enclosure / Housing',
		body: 'Create a rectangular electronics enclosure 80×50×30 mm with snap-fit lid and cable grommet.',
	},
	{
		icon: Bot,
		color: 'violet',
		title: 'Sketch → 3D',
		body: 'I have a 2D drawing — convert it to a parametric build123d script.',
	},
	{
		icon: Bot,
		color: 'emerald',
		title: 'Iterate & Refine',
		body: 'Modify the current model: increase wall thickness to 3 mm and add filleted edges.',
	},
] as const;

type StarterColor = 'blue' | 'cyan' | 'violet' | 'emerald';

const COLOR_MAP: Record<StarterColor, { card: string; icon: string; badge: string }> = {
	blue:    { card: 'border-blue-500/20 hover:border-blue-500/50 hover:bg-blue-500/5',    icon: 'bg-blue-500/15 text-blue-400',    badge: 'bg-blue-500/10 text-blue-400' },
	cyan:    { card: 'border-cyan-500/20 hover:border-cyan-500/50 hover:bg-cyan-500/5',    icon: 'bg-cyan-500/15 text-cyan-400',    badge: 'bg-cyan-500/10 text-cyan-400' },
	violet:  { card: 'border-violet-500/20 hover:border-violet-500/50 hover:bg-violet-500/5', icon: 'bg-violet-500/15 text-violet-400', badge: 'bg-violet-500/10 text-violet-400' },
	emerald: { card: 'border-emerald-500/20 hover:border-emerald-500/50 hover:bg-emerald-500/5', icon: 'bg-emerald-500/15 text-emerald-400', badge: 'bg-emerald-500/10 text-emerald-400' },
};

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
	onOpenAuthModal?: () => void;
	fileInputRef?: React.RefObject<HTMLInputElement | null>;
	selectionContext?: [number, number, number] | null;
	onClearSelectionContext?: () => void;
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
	setIsOpen,
	onOpenAuthModal,
	fileInputRef,
	selectionContext,
	onClearSelectionContext
}: ChatPanelProps) {
	const scrollRef = useRef<HTMLDivElement | null>(null);
	const router = useRouter();
	const [isLoggingOut, setIsLoggingOut] = useState(false);
	const [user, setUser] = useState<{name?: string; email?: string} | null>(null);
	const [isSettingsOpen, setIsSettingsOpen] = useState(false);

	useEffect(() => {
		fetch('/api/auth/me')
			.then(res => res.json())
			.then(data => {
				if (data.success && data.user) {
					setUser(data.user);
				}
			})
			.catch(err => console.error("Failed to load user:", err));
	}, []);

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
		<>
		<SettingsPanel
			isOpen={isSettingsOpen}
			onClose={() => setIsSettingsOpen(false)}
			user={user}
		/>
		<aside 
			className={`absolute right-0 top-0 bottom-0 z-50 flex flex-col border-l border-border bg-popover/95 backdrop-blur-xl shadow-2xl transition-all duration-300 ease-in-out font-sans overflow-hidden`}
			style={{ 
				width, 
				transform: isOpen ? 'translateX(0)' : 'translateX(120%)',
				opacity: isOpen ? 1 : 0,
				pointerEvents: isOpen ? 'auto' : 'none'
			}}
		>


			<div className={`flex h-full flex-col ${!isOpen ? 'opacity-0 pointer-events-none' : 'opacity-100'} transition-opacity duration-500`}>
					<header className={`sticky top-0 z-40 flex min-h-[64px] shrink-0 items-center justify-between border-b border-white/5 bg-transparent backdrop-blur-md px-4 transition-all gap-2`}>
						<div className="flex items-center gap-2 shrink-0">
							<div className="flex items-center gap-3 shrink-0">
								<div className="relative w-8 h-8 flex items-center justify-center shrink-0">
									<div className="absolute inset-0 bg-blue-500 rounded-lg transform rotate-45 opacity-20 animate-pulse"></div>
									<BrainCircuit className="w-4 h-4 text-blue-400 relative z-10" />
								</div>
								<div className="flex flex-col">
									<h1 className="text-[14px] font-bold tracking-widest bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-cyan-300 font-sans uppercase shrink-0 leading-none">VEX AI</h1>
									<span className="text-[8px] font-bold tracking-widest uppercase text-blue-500/50 mt-1">Co-Pilot System</span>
								</div>
							</div>
						</div>

						<div className="flex items-center gap-2 flex-1 justify-end min-w-0">
							{/* Settings Button */}
							<button
								onClick={() => setIsSettingsOpen(true)}
								className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border dark:border-white/10 bg-black/5 dark:bg-white/5 text-muted-foreground transition-all hover:border-blue-500/50 hover:bg-blue-500/10 hover:text-blue-500 dark:hover:text-blue-400"
								title="Settings"
							>
								<Settings className="size-3.5" />
							</button>
							
							{/* Close Button */}
							<button
								onClick={() => setIsOpen(false)}
								className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border dark:border-white/10 bg-black/5 dark:bg-white/5 text-muted-foreground transition-all hover:border-red-500/50 hover:bg-red-500/10 hover:text-red-500 dark:hover:text-red-400"
								title="Close Chat"
							>
								<svg className="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
									<path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
								</svg>
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

					{/* Message Stream / Welcome Screen */}
					<div className="flex-1 overflow-y-auto px-5 py-5 custom-scrollbar scroll-smooth">
						{messages.length === 0 ? (
							// ── Welcome / Starter prompts ──
							<div className="flex flex-col items-center gap-6 pt-12 pb-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
								<div className="text-center">
									<h2 className="text-lg font-bold text-foreground leading-snug">What are we building<br/>today?</h2>
									<p className="text-[11px] text-muted-foreground mt-1 leading-relaxed max-w-[200px] mx-auto">
										Describe a part, upload a sketch, or pick a prompt below.
									</p>
								</div>

								{/* Starter prompt cards grid */}
								<div className="grid grid-cols-2 gap-2 w-full">
									{STARTER_PROMPTS.map((p, i) => {
										const colors = COLOR_MAP[p.color as StarterColor] ?? COLOR_MAP.blue;
										const Icon = p.icon;
										return (
											<button
												key={i}
												type="button"
												onClick={() => setPrompt(p.body)}
												className={`group relative flex flex-col items-start gap-2.5 rounded-xl border bg-transparent dark:bg-white/[0.02] p-3 text-left transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg active:scale-[0.98] cursor-pointer ${colors.card}`}
											>
												<div className={`flex items-center justify-center w-7 h-7 rounded-lg shrink-0 transition-transform duration-200 group-hover:scale-110 ${colors.icon}`}>
													<Icon className="w-3.5 h-3.5" />
												</div>
												<div className="space-y-0.5">
													<p className="text-[10px] font-bold uppercase tracking-wider text-foreground/70">{p.title}</p>
													<p className="text-[10px] text-muted-foreground leading-relaxed line-clamp-2">{p.body}</p>
												</div>
											</button>
										);
									})}
								</div>

								{/* Subtle tip */}
								<p className="text-[9px] font-mono text-muted-foreground/40 text-center flex items-center gap-1.5">
									<Zap className="w-2.5 h-2.5" />
									Shift + Enter to send
								</p>
							</div>
						) : (
							// ── Normal message thread ──
							<div className="space-y-4">
								{messages.map((msg) => (
									<ChatBubble key={msg.id} {...msg} />
								))}
								<div ref={scrollRef} />
							</div>
						)}
					</div>

					{/* Action Card & Input */}
					<div className="px-5 pb-5 pt-2">
							<form onSubmit={onSubmit} className="relative group/form flex flex-col gap-3">
								{/* File Context Indicator */}
								{selectedFile && (
									<div className="animate-message">
										<div className="flex items-center gap-3 rounded-xl border border-blue-500/30 bg-blue-500/10 p-2 pl-3 pr-2 backdrop-blur-xl">
											<div className="flex size-7 items-center justify-center rounded-lg bg-blue-500 text-black shadow-sm">
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
								{selectionContext && (
									<div className="animate-message">
										<div className="flex items-center gap-3 rounded-xl border border-red-500/30 bg-red-500/10 p-2 pl-3 pr-2 backdrop-blur-xl">
											<div className="flex size-7 items-center justify-center rounded-lg bg-red-500 text-black shadow-sm">
												<svg className="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
													<circle cx="12" cy="12" r="10" />
													<line x1="12" y1="8" x2="12" y2="16" />
													<line x1="8" y1="12" x2="16" y2="12" />
												</svg>
											</div>
											<div className="flex-1 min-w-0">
												<p className="truncate text-[10px] font-sans font-bold text-red-400 uppercase tracking-wider">
													Targeting [{selectionContext[0].toFixed(2)}, {selectionContext[1].toFixed(2)}, {selectionContext[2].toFixed(2)}]
												</p>
											</div>
											<button
												type="button"
												onClick={onClearSelectionContext}
												className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-black/10 dark:hover:bg-white/10 transition-colors"
											>
												<svg className="size-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
													<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
												</svg>
											</button>
										</div>
									</div>
								)}
								<div className="relative overflow-hidden rounded-2xl border border-white/10 bg-[#030408]/90 shadow-[0_0_20px_rgba(0,0,0,0.5)] backdrop-blur-xl transition-all duration-300 focus-within:border-blue-500/40 focus-within:shadow-[0_0_25px_rgba(59,130,246,0.15)]">
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
										placeholder="Describe your design intent or paste dimensions..."
										className="w-full resize-none bg-transparent p-5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none font-sans leading-relaxed"
									/>

									<div className="flex items-center justify-between border-t border-white/5 bg-black/20 px-4 py-3">
										<div className="flex items-center gap-3">
											{/* Main blueprint upload */}
											<label
												className={`group/btn relative flex cursor-pointer items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-[10px] font-mono font-bold uppercase tracking-wider transition-all duration-200 ${selectedFile
													? 'border border-blue-500/20 bg-blue-500/5 text-blue-500'
													: 'text-muted-foreground hover:bg-accent hover:text-foreground'
													}`}
												title="Upload engineering blueprint drawing"
											>
												<Upload className="size-3.5 shrink-0" />
												<span className="whitespace-nowrap">{selectedFile ? 'Blueprint' : 'Upload'}</span>
												<input
													ref={fileInputRef}
													type="file"
													accept="image/*,.pdf"
													className="hidden"
													onChange={(e) => {
														const file = e.target.files?.[0] || null;
														if (file) handleFileChange(file);
													}}
												/>
											</label>

											{/* Model Selection */}
											<select
												value={selectedModel}
												onChange={(e) => setSelectedModel(e.target.value)}
												className="max-w-[130px] rounded-lg border border-border dark:border-white/10 bg-transparent px-2 py-1.5 text-[10px] font-mono uppercase tracking-wider text-muted-foreground outline-none focus:border-blue-500/40 focus:text-foreground transition-colors cursor-pointer truncate"
												title="Select AI Model"
											>
												{modelOptions.map((opt) => (
													<option key={opt.value} value={opt.value} className="bg-background text-foreground">
														{opt.label}
													</option>
												))}
											</select>
										</div>

										<button
											type="submit"
											disabled={isGenerating || !prompt.trim()}
											className={`group/btn relative flex h-9 items-center gap-2 rounded-lg px-4 text-[11px] font-bold uppercase tracking-[0.2em] transition-all overflow-hidden ${isGenerating
												? 'border border-blue-500/30 bg-blue-500/10 text-blue-500 animate-pulse'
												: !prompt.trim()
													? 'bg-black/5 dark:bg-white/5 text-muted-foreground border border-border dark:border-white/10 cursor-not-allowed'
													: 'bg-gradient-to-b from-blue-500 to-blue-700 text-white border border-blue-400/30 shadow-md hover:from-blue-400 hover:to-blue-600 hover:scale-[1.02] active:scale-[0.98]'
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

					{/* Professional Profile Section Removed for Sleeker AI Look */}
				</div>

			{!isOpen && (
				<div className="absolute top-0 left-0 right-0 h-1/2 flex flex-col items-center justify-center gap-8 pointer-events-none animate-in fade-in duration-300">
					<div className="rotate-270 whitespace-nowrap text-[9px] font-black uppercase tracking-[0.5em] text-muted-foreground/50">
						Design Assistant
					</div>
					<div className="w-px h-12 bg-linear-to-b from-border dark:from-zinc-800 to-transparent" />
				</div>
			)}
		</aside>
		</>
	);
}
