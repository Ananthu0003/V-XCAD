'use client';

import { FormEvent, useRef, useEffect } from 'react';
import { SendHorizontal, Upload, Loader2, Trash2 } from 'lucide-react';
import { ChatBubble } from './ChatBubble';

type ChatRole = 'user' | 'assistant' | 'system';

type ChatMessage = {
	id: string;
	role: ChatRole;
	content: string;
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

	useEffect(() => {
		scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
	}, [messages]);

	return (
		<section
			className={`flex shrink-0 flex-col border-r border-zinc-800 bg-[#09090b] relative z-20 transition-all duration-500 ease-[cubic-bezier(0.2,1,0.2,1)] overflow-hidden`}
			style={{ width: isOpen ? `${width}px` : '64px' }}
		>
			{/* Toggle Button */}
			<button
				onClick={() => setIsOpen(!isOpen)}
				className="absolute right-4 top-5 flex size-8 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-900/50 text-zinc-400 hover:border-amber-500 hover:text-amber-500 transition-all z-50"
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

			<div className={`flex h-full flex-1 flex-col min-h-0 transition-opacity duration-300 ${isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>

			{/* High-Fidelity Header */}
			<header className={`sticky top-0 z-40 flex h-16 shrink-0 items-center justify-between border-b border-zinc-800/50 bg-[#09090b]/80 pl-6 ${isOpen ? 'pr-16' : 'pr-6'} backdrop-blur-md transition-all`}>
				<div className="flex items-center gap-3 shrink-0">
					<div className="flex size-7 items-center justify-center rounded-lg bg-amber-500 shadow-[0_0_20px_rgba(245,158,11,0.4)]">
						<span className="text-sm font-black text-black">C</span>
					</div>
					<h1 className="text-[10px] font-bold tracking-widest text-zinc-100 font-sans uppercase hidden sm:block">Cad Copilot</h1>
				</div>

				<div className="flex items-center gap-3">
					{/* Model Switcher - Hardware Module Style */}
					<div className="relative group">
						<div className="flex items-center gap-2 rounded-full border border-amber-500/20 bg-amber-500/5 px-3 py-1.5 transition-all hover:border-amber-500/50 hover:bg-amber-500/10 shadow-[0_0_15px_rgba(245,158,11,0.05)] cursor-pointer">
							<div className="size-1 rounded-full bg-emerald-500 animate-pulse" />
							<div className="flex items-center gap-1.5">
								<select
									value={selectedModel}
									onChange={(e) => setSelectedModel(e.target.value)}
									className="bg-transparent text-[9px] font-mono font-bold uppercase tracking-widest text-zinc-400 focus:outline-none cursor-pointer appearance-none pr-3"
								>
									{modelOptions.map((opt) => (
										<option key={opt.value} value={opt.value} className="bg-[#09090b] text-zinc-100 uppercase">
											{opt.label.split(' ')[0].replace('gemini-', '')}
										</option>
									))}
								</select>
								<div className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2">
									<svg className="size-2.5 text-amber-500/50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
										<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M19 9l-7 7-7-7" />
									</svg>
								</div>
							</div>
						</div>
					</div>

					<div className="h-4 w-px bg-zinc-800" />

					{/* Clear Button */}
					<button
						onClick={onClear}
						className="flex size-8 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-900/50 text-zinc-500 transition-all hover:border-red-500/50 hover:bg-red-500/10 hover:text-red-500"
						title="Clear Session"
					>
						<Trash2 className="size-3.5" />
					</button>
				</div>
			</header>

			{/* Message Stream */}
			<div className="flex-1 space-y-8 overflow-y-auto px-6 py-8 custom-scrollbar scroll-smooth">
				{messages.map((msg) => (
					<ChatBubble key={msg.id} {...msg} />
				))}
				<div ref={scrollRef} />
			</div>

			{/* Action Card & Input */}
			<div className="p-6">
				<div className="relative">
					{/* Floating File Context */}
					{selectedFile && (
						<div className="absolute -top-14 left-0 right-0 z-10 animate-message">
							<div className="flex items-center gap-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-1.5 pl-3 pr-2 backdrop-blur-xl shadow-2xl">
								<div className="flex size-7 items-center justify-center rounded-lg bg-amber-500 text-black shadow-lg">
									<Upload className="size-3.5" />
								</div>
								<div className="flex-1 min-w-0">
									<p className="truncate text-[10px] font-mono font-bold text-amber-500/80 uppercase tracking-tighter">
										{selectedFile.name}
									</p>
								</div>
								<button
									type="button"
									onClick={() => handleFileChange(null)}
									className="p-1 text-zinc-500 hover:text-zinc-100 transition-colors"
								>
									<svg className="size-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
										<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
									</svg>
								</button>
							</div>
						</div>
					)}

					<form onSubmit={onSubmit} className="relative group/form">
						<div className="relative overflow-hidden rounded-2xl border border-zinc-800/50 bg-linear-to-b from-[#161618] to-[#0c0c0e] shadow-[0_20px_50px_rgba(0,0,0,0.5)] transition-all duration-300 focus-within:border-amber-500/40 focus-within:shadow-[0_0_30px_rgba(245,158,11,0.1)]">
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
								className="w-full resize-none bg-transparent p-5 text-sm text-zinc-100 placeholder:text-zinc-700 focus:outline-none font-sans leading-relaxed"
							/>

							<div className="flex items-center justify-between border-t border-zinc-800/30 bg-white/2 px-4 py-3">
								<div className="flex items-center gap-3">
									{/* Main blueprint upload */}
									<label 
										className={`group/btn relative flex cursor-pointer items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-[10px] font-mono font-bold uppercase tracking-wider transition-all duration-200 ${
											selectedFile 
												? 'border border-amber-500/20 bg-amber-500/5 text-amber-500 shadow-[0_0_15px_rgba(245,158,11,0.05)]' 
												: 'text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200'
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
									className={`group/btn relative flex h-9 items-center gap-2 rounded-lg px-4 text-[10px] font-black uppercase tracking-[0.25em] transition-all overflow-hidden ${
										isGenerating
											? 'border border-amber-500/30 bg-amber-500/10 text-amber-500 shadow-[0_0_15px_rgba(245,158,11,0.15)] animate-pulse'
											: !prompt.trim() || !selectedFile
												? 'bg-zinc-900/50 text-zinc-600 border border-zinc-850 cursor-not-allowed'
												: 'bg-amber-500 text-black shadow-[0_0_20px_rgba(245,158,11,0.2)] hover:bg-amber-400 hover:scale-[1.02] active:scale-[0.98]'
									}`}
								>
									{isGenerating ? (
										<>
											<Loader2 className="size-3.5 animate-spin shrink-0 text-amber-500" />
											<span className="whitespace-nowrap tracking-widest text-[9px] text-amber-500">Running</span>
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
			</div>

			{!isOpen && (
				<div className="flex h-full flex-col items-center gap-6 pt-20">
					<div className="rotate-90 whitespace-nowrap text-[10px] font-bold uppercase tracking-[0.4em] text-zinc-700">
						Design Assistant
					</div>
				</div>
			)}
		</section>
	);
}
