'use client';

import { useState } from 'react';
import Editor from '@monaco-editor/react';
import { 
	ChevronLeft, 
	ChevronRight, 
	Wrench, 
	Loader2, 
	Code2, 
	Sliders, 
	History,
	Copy,
	Check
} from 'lucide-react';

type DrawerTab = 'parameters' | 'code';

type EditorDrawerProps = {
	isOpen: boolean;
	setIsOpen: (v: boolean) => void;
	activeTab: DrawerTab;
	setActiveTab: (v: DrawerTab) => void;
	pythonScript: string;
	onScriptChange: (v: string) => void;
	onRenderSync: () => void;
	isRecompiling: boolean;
	hasSession: boolean;
	onHistoryClick: () => void;
	children?: React.ReactNode; // For ParameterInputs
};

export function EditorDrawer({
	isOpen,
	setIsOpen,
	activeTab,
	setActiveTab,
	pythonScript,
	onScriptChange,
	onRenderSync,
	isRecompiling,
	hasSession,
	onHistoryClick,
	children
}: EditorDrawerProps) {
	const [copied, setCopied] = useState(false);

	const handleCopy = () => {
		navigator.clipboard.writeText(pythonScript);
		setCopied(true);
		setTimeout(() => setCopied(false), 2000);
	};

	return (
		<aside
			className={`relative shrink-0 overflow-hidden border-l border-white/5 bg-zinc-950/80 backdrop-blur-xl transition-all duration-700 ease-[cubic-bezier(0.2,1,0.2,1)] ${
				isOpen ? 'w-112.5' : 'w-16'
			}`}
		>
			<button
				onClick={() => setIsOpen(!isOpen)}
				className="absolute left-4 top-5 flex size-8 items-center justify-center rounded-lg border border-white/10 bg-zinc-900/50 text-zinc-500 hover:border-amber-500/50 hover:text-amber-400 hover:bg-amber-500/10 transition-all z-20 group"
			>
				{isOpen ? (
					<ChevronRight className="size-4 group-hover:translate-x-0.5 transition-transform" />
				) : (
					<ChevronLeft className="size-4 group-hover:-translate-x-0.5 transition-transform" />
				)}
			</button>

			<div className={`flex h-full flex-col ${!isOpen ? 'opacity-0' : 'opacity-100'} transition-opacity duration-500`}>
				<header className="flex h-16 items-center justify-between border-b border-white/5 bg-black/40 px-6 pl-16">
					<div className="flex p-1 bg-zinc-900/50 rounded-xl border border-white/5">
						<button
							onClick={() => setActiveTab('parameters')}
							className={`flex items-center gap-2 rounded-lg px-4 py-2 text-[10px] font-black uppercase tracking-[0.15em] transition-all duration-300 ${
								activeTab === 'parameters'
									? 'bg-amber-500 text-black shadow-[0_0_15px_rgba(245,158,11,0.4)]'
									: 'text-zinc-500 hover:text-zinc-300 hover:bg-white/5'
							}`}
						>
							<Sliders className={`size-3.5 ${activeTab === 'parameters' ? 'animate-pulse' : ''}`} />
							Params
						</button>
						<button
							onClick={() => setActiveTab('code')}
							className={`flex items-center gap-2 rounded-lg px-4 py-2 text-[10px] font-black uppercase tracking-[0.15em] transition-all duration-300 ${
								activeTab === 'code'
									? 'bg-amber-500 text-black shadow-[0_0_15px_rgba(245,158,11,0.4)]'
									: 'text-zinc-500 hover:text-zinc-300 hover:bg-white/5'
							}`}
						>
							<Code2 className={`size-3.5 ${activeTab === 'code' ? 'animate-pulse' : ''}`} />
							Engine
						</button>
					</div>

					<button
						onClick={onHistoryClick}
						className="flex items-center gap-2 rounded-lg px-3 py-2 text-[10px] font-bold uppercase tracking-widest bg-zinc-900/80 border border-white/5 text-zinc-400 hover:text-amber-400 hover:border-amber-500/30 transition-all active:scale-95"
					>
						<History className="size-3.5 text-amber-500" />
						History
					</button>
				</header>

				<div className="flex-1 overflow-y-auto px-6 py-6 custom-scrollbar">
					{activeTab === 'parameters' ? (
						<div className="space-y-8">
							<div className="flex items-center gap-4">
								<div className="size-1.5 rounded-full bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,1)]" />
								<h2 className="text-[11px] font-black uppercase tracking-[0.3em] text-zinc-400">Dynamic Props</h2>
								<div className="h-px flex-1 bg-linear-to-r from-white/10 to-transparent" />
							</div>
							<div className="space-y-2">
								{children}
							</div>
						</div>
					) : (
						<div className="h-full flex flex-col">
							<div className="mb-6 flex items-center justify-between">
								<div className="flex items-center gap-4">
									<div className="size-1.5 rounded-full bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,1)]" />
									<h2 className="text-[11px] font-black uppercase tracking-[0.3em] text-zinc-400">Core Script</h2>
								</div>
								<div className="flex items-center gap-2 px-3 py-1 rounded-full bg-black/40 border border-white/5">
									<div className="size-1 rounded-full bg-emerald-500 animate-pulse" />
									<span className="text-[9px] font-mono font-bold text-zinc-500 uppercase tracking-widest">
										PY 3.13 // BUILD123D
									</span>
								</div>
							</div>
							
							<div className="flex-1 overflow-hidden rounded-2xl border border-white/5 bg-black/20 backdrop-blur-sm shadow-2xl relative group/editor">
								<button
									onClick={handleCopy}
									className={`absolute right-4 top-4 z-10 flex items-center gap-2 rounded-lg border px-3 py-2 text-[9px] font-black uppercase tracking-widest transition-all duration-300 ${
										copied
											? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-400 shadow-[0_0_10px_rgba(16,185,129,0.2)]'
											: 'border-white/10 bg-zinc-900/80 text-zinc-400 hover:border-amber-500/50 hover:text-amber-400 opacity-0 group-hover/editor:opacity-100 translate-y-2 group-hover/editor:translate-y-0'
									}`}
								>
									{copied ? <Check className="size-3" /> : <Copy className="size-3" />}
									{copied ? 'Copied' : 'Copy'}
								</button>
								
								<div className="absolute inset-0 bg-linear-to-b from-amber-500/5 to-transparent opacity-0 group-hover/editor:opacity-100 transition-opacity duration-700 pointer-events-none" />
								<Editor
									height="100%"
									language="python"
									theme="vs-dark"
									value={pythonScript}
									onChange={(v) => onScriptChange(v || '')}
									options={{
										minimap: { enabled: false },
										fontSize: 13,
										fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
										lineNumbers: 'on',
										lineNumbersMinChars: 3,
										glyphMargin: false,
										folding: true,
										wordWrap: 'on',
										scrollBeyondLastLine: false,
										padding: { top: 20, bottom: 20 },
										renderLineHighlight: 'all',
										cursorBlinking: 'smooth',
										cursorSmoothCaretAnimation: 'on',
										mouseWheelZoom: true,
									}}
								/>
							</div>
						</div>
					)}
				</div>

				<div className="border-t border-white/5 p-6 bg-black/40 backdrop-blur-xl">
					<button
						onClick={onRenderSync}
						disabled={isRecompiling || !hasSession || !pythonScript}
						className="group relative flex w-full items-center justify-center gap-4 overflow-hidden rounded-2xl bg-emerald-500 py-4 text-[11px] font-black uppercase tracking-[0.2em] text-black shadow-[0_0_30px_rgba(16,185,129,0.2)] hover:bg-emerald-400 hover:shadow-[0_0_40px_rgba(16,185,129,0.4)] hover:scale-[1.02] active:scale-[0.98] transition-all duration-300 disabled:opacity-20 disabled:grayscale disabled:scale-100 disabled:shadow-none"
					>
						<div className="absolute inset-0 bg-linear-to-r from-transparent via-white/30 to-transparent -translate-x-full group-hover:animate-[shimmer_1.5s_infinite] pointer-events-none" />
						
						{isRecompiling ? (
							<Loader2 className="size-5 animate-spin" />
						) : (
							<Wrench className="size-5 group-hover:rotate-45 transition-transform duration-500" />
						)}
						
						<span>{isRecompiling ? 'System Syncing...' : 'Sync to Engine'}</span>
					</button>
					
					<div className="mt-4 flex items-center justify-center gap-4 opacity-30">
						<div className="h-px w-8 bg-white/20" />
						<span className="text-[8px] font-bold uppercase tracking-[0.3em] text-zinc-500">Authorized Access Only</span>
						<div className="h-px w-8 bg-white/20" />
					</div>
				</div>
			</div>

			{!isOpen && (
				<div className="flex h-full flex-col items-center gap-8 pt-24">
					<div className="rotate-90 whitespace-nowrap text-[9px] font-black uppercase tracking-[0.5em] text-zinc-600/50">
						Logic & System Params
					</div>
					<div className="w-px h-12 bg-linear-to-b from-zinc-800 to-transparent" />
				</div>
			)}
		</aside>
	);
}
