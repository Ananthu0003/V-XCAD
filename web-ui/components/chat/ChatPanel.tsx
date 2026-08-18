'use client';

import { FormEvent, useRef, useEffect, useState } from 'react';
import { 
	Bot, LogOut, Loader2, SendHorizontal, Zap, Upload, FileImage, 
	Settings, BrainCircuit, Cuboid, Trash2, Crosshair, Sparkles, 
	ChevronDown, Check, SlidersHorizontal, Wrench, Layers, Tag, X,
	Target, PlusCircle, RefreshCw
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { ChatBubble } from '@/components/chat/ChatBubble';
import { SettingsPanel } from '@/components/workspace/SettingsPanel';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

// ── Starter prompts shown in the empty-chat welcome screen ──────────────────
const STARTER_PROMPTS = [
	{
		icon: Cuboid,
		tag: 'Generative',
		title: 'Mechanical Component',
		body: 'Design a stepped shaft with dual O-ring seal grooves, chamfers, and internal bore.',
	},
	{
		icon: FileImage,
		tag: 'Drafting',
		title: 'Blueprint to 3D CAD',
		body: 'Convert multi-view 2D blueprint drawing into a fully parametric 3D model.',
	},
	{
		icon: Wrench,
		tag: 'Inspection',
		title: 'Micro-Detail Inspection',
		body: 'Examine Detail-D and Detail-E to extract high-tolerance grooves and lead-in cones.',
	},
	{
		icon: RefreshCw,
		tag: 'Iteration',
		title: 'Parametric Refinement',
		body: 'Surgically adjust diameter steps, draft angles, thread depth, or blend radii.',
	},
] as const;

type StarterColor = 'blue' | 'cyan' | 'violet' | 'emerald';

const COLOR_MAP: Record<StarterColor, { card: string; icon: string; badge: string }> = {
	blue:    { card: 'border-blue-500/20 hover:border-blue-500/50 hover:bg-blue-500/5',    icon: 'bg-blue-500/15 text-blue-400',    badge: 'bg-blue-500/10 text-blue-400' },
	cyan:    { card: 'border-cyan-500/20 hover:border-cyan-500/50 hover:bg-cyan-500/5',    icon: 'bg-cyan-500/15 text-cyan-400',    badge: 'bg-cyan-500/10 text-cyan-400' },
	violet:  { card: 'border-violet-500/20 hover:border-violet-500/50 hover:bg-violet-500/5', icon: 'bg-violet-500/15 text-violet-400', badge: 'bg-violet-500/10 text-violet-400' },
	emerald: { card: 'border-emerald-500/20 hover:border-emerald-500/50 hover:bg-emerald-500/5', icon: 'bg-emerald-500/15 text-emerald-400', badge: 'bg-emerald-500/10 text-emerald-400' },
};

export type TargetPortion = {
	id: string;
	name: string;
	category: string;
	description?: string;
	quickPrompts?: string[];
};

export const CAD_PORTION_PRESETS: TargetPortion[] = [
	{
		id: 'groove',
		name: 'Groove / Undercut / O-Ring',
		category: 'Subtractive Features',
		description: 'Seal grooves, snap ring channels, neck undercuts (e.g. DETAIL-D/C)',
		quickPrompts: [
			'The blueprint shows two seal grooves on the collar with R0.2 fillets and a 15° rear taper that were missed.',
			'Add an O-ring groove: 1.45mm width, 1.95mm depth at the specified collar location.',
			'Fix groove draft angle to 15 degrees and add root fillets as shown in Detail D.'
		]
	},
	{
		id: 'chamfer',
		name: 'Chamfer / Bevel / Lead-In',
		category: 'Edge & Transition',
		description: 'Outer/inner edge chamfers or conical lead-in angles (e.g. 0.2x45°, 30° nose)',
		quickPrompts: [
			'Add a 0.2 x 45° chamfer to the outer collar corners as shown in Detail-D.',
			'The shaft tip has a 30-degree lead-in cone with 0.2mm corner blends (Detail-E).',
			'Add lead-in chamfer to the bore entrance.'
		]
	},
	{
		id: 'fillet',
		name: 'Fillet / Blend Radius',
		category: 'Edge & Transition',
		description: 'Internal blend radii or external corner rounds (e.g. R0.2, R0.4)',
		quickPrompts: [
			'Add R0.2 corner fillets to all groove root edges.',
			'The transition shoulder has an R0.4 fillet that was missed.',
			'Apply R0.2 corner blends at the shaft tip.'
		]
	},
	{
		id: 'stepped_bore',
		name: 'Stepped Bore / Hole / Counterbore',
		category: 'Internal Channels',
		description: 'Internal bore steps, counterbores, blind depths (e.g. SECTION-AA)',
		quickPrompts: [
			'Section AA shows a stepped bore: Ø17.4 to 1.3mm depth, Ø13.5 to 11.5mm, Ø14 H8, and Ø10 with 10° cone.',
			'The internal bore transition has a 10-degree taper angle at length 6mm.',
			'The central hole depth is incorrect, please verify the internal stepped profile.'
		]
	},
	{
		id: 'thread',
		name: 'Thread (Internal / External)',
		category: 'Manufacturing Callout',
		description: 'Tapped holes, bolt threads, ISO metric / UNC specifications',
		quickPrompts: [
			'Add M10x1.5 internal thread to the center bore for depth 15mm.',
			'Model standard metric thread on the external shaft.',
			'Update thread pitch to coarse standard.'
		]
	},
	{
		id: 'step_shoulder',
		name: 'Step / Shoulder / Collar',
		category: 'Outer Profile & Diameters',
		description: 'Diameter transitions, collars, stops (e.g. Ø25.5 -> Ø23 -> Ø18 -> Ø25 -> Ø16.975)',
		quickPrompts: [
			'The outer profile has intermediate diameter steps: Ø25.5, Ø23 f8, Ø18 h8, and Ø25.',
			'The shaft diameter should step down to Ø16.975 along the 38mm gasket working area.',
			'Add intermediate mounting collar at the specified Z-station.'
		]
	},
	{
		id: 'pocket_slot',
		name: 'Pocket / Slot / Keyway',
		category: 'Milling & Features',
		description: 'Drive keyways, flat milled slots, or internal pockets',
		quickPrompts: [
			'Add a drive keyway slot along the shaft.',
			'Cut a U-shaped slot at the edge with full radius bottom.',
			'Add milled pocket with depth matching the drawing note.'
		]
	},
	{
		id: 'missing_detail',
		name: 'Missing Detail View Feature',
		category: 'Detail & Micro-Geometry',
		description: 'Micro-features from Detail B, C, D, E or note callouts omitted in initial pass',
		quickPrompts: [
			'Detail-B shows an undercut with 1.4mm width, 15° angle, and R0.4 fillet.',
			'Detail-C shows a 20° undercut with 0.2x45° chamfer.',
			'Detail-E shows a 3mm max recess at the nose with 30° cone.'
		]
	},
	{
		id: 'body_envelope',
		name: 'Main Body / Overall Dimensions',
		category: 'Global Dimensions',
		description: 'Overall length, primary diameter, base prismoid dimensions',
		quickPrompts: [
			'Total part length should be exactly 98.6mm.',
			'Adjust outer stock diameter to match primary datum.',
			'Correct overall thickness of the main body.'
		]
	}
];

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
	hasActiveModel?: boolean;
	parameterEntries?: [string, unknown][];
	targetPortion?: TargetPortion | null;
	setTargetPortion?: (portion: TargetPortion | null) => void;
	blueprintUrl?: string | null;
	onToggleBlueprintView?: () => void;
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
	onClearSelectionContext,
	hasActiveModel = false,
	parameterEntries = [],
	targetPortion = null,
	setTargetPortion,
	blueprintUrl = null,
	onToggleBlueprintView,
}: ChatPanelProps) {
	const scrollRef = useRef<HTMLDivElement | null>(null);
	const router = useRouter();
	const [isLoggingOut, setIsLoggingOut] = useState(false);
	const [user, setUser] = useState<{name?: string; email?: string} | null>(null);
	const [isSettingsOpen, setIsSettingsOpen] = useState(false);
	const [isPortionPickerOpen, setIsPortionPickerOpen] = useState(false);

	useEffect(() => {
		fetch('/api/auth/me')
			.then(res => res.json())
			.then(data => {
				if (data.success && data.user) {
					setUser(data.user);
				}
			})
			.catch(() => {});
	}, []);

	useEffect(() => {
		scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
	}, [messages]);

	const handleLogout = async () => {
		setIsLoggingOut(true);
		try {
			await fetch('/api/auth/logout', { method: 'POST' });
			router.push('/login');
		} catch (error) {
			console.error('Logout failed:', error);
		} finally {
			setIsLoggingOut(false);
		}
	};

	const handleSelectPortion = (portion: TargetPortion) => {
		if (setTargetPortion) {
			setTargetPortion(portion);
		}
		setIsPortionPickerOpen(false);
	};

	const handleApplyQuickPrompt = (text: string) => {
		setPrompt(text);
	};

	return (
		<>
			<div className="flex h-full flex-col bg-sidebar/50 backdrop-blur-xl border-r border-sidebar-border">
				{/* Header */}
				<div className="flex items-center justify-between px-4 py-3 border-b border-sidebar-border/50">
					<div className="flex items-center gap-2.5">
						<div className="flex size-7 items-center justify-center rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400 shadow-sm">
							<Cuboid className="size-4" />
						</div>
						<div className="flex items-center gap-2">
							<span className="text-sm font-bold tracking-wider text-foreground">
								VEXCAD
							</span>
							<span className="text-[10px] text-muted-foreground font-mono bg-muted/60 px-1.5 py-0.5 rounded border border-border/50">
								v0.1.0
							</span>
						</div>
					</div>

					<div className="flex items-center gap-1.5">
						{messages.length > 0 && (
							<button
								onClick={onClear}
								className="flex size-7 items-center justify-center rounded-lg bg-zinc-900/60 border border-zinc-800/80 text-muted-foreground hover:bg-zinc-800 hover:text-foreground transition-colors"
								title="Clear chat"
							>
								<Trash2 className="size-3.5" />
							</button>
						)}
						<button
							onClick={() => setIsSettingsOpen(true)}
							className="flex size-7 items-center justify-center rounded-lg bg-zinc-900/60 border border-zinc-800/80 text-muted-foreground hover:bg-zinc-800 hover:text-foreground transition-colors"
							title="Settings"
						>
							<Settings className="size-3.5" />
						</button>
						<button
							onClick={handleLogout}
							disabled={isLoggingOut}
							className="flex size-7 items-center justify-center rounded-lg bg-zinc-900/60 border border-zinc-800/80 text-muted-foreground hover:bg-zinc-800 hover:text-foreground transition-colors disabled:opacity-50"
							title="Logout"
						>
							{isLoggingOut ? (
								<Loader2 className="size-3.5 animate-spin" />
							) : (
								<LogOut className="size-3.5" />
							)}
						</button>
					</div>
				</div>

				<SettingsPanel
					isOpen={isSettingsOpen}
					onClose={() => setIsSettingsOpen(false)}
					user={user}
				/>

				{/* Chat Messages / Clean Minimalist View */}
				<div className="flex-1 overflow-y-auto px-4 py-6 space-y-4">
					{messages.length === 0 ? (
						<div className="flex flex-col items-center justify-center h-full text-center px-4 space-y-6 max-w-xs mx-auto">
							{/* Minimalist Brand Cube */}
							<div className="relative flex items-center justify-center">
								<div className="absolute -inset-2 rounded-full bg-blue-500/10 blur-lg" />
								<div className="relative flex size-10 items-center justify-center rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-400">
									<Cuboid className="size-5" />
								</div>
							</div>

							{/* Clean Title */}
							<div className="space-y-1">
								<h3 className="text-sm font-semibold text-foreground">
									What would you like to model?
								</h3>
								<p className="text-[11px] text-muted-foreground leading-relaxed">
									Upload a blueprint or type parametric dimensions below.
								</p>
							</div>

							{/* Minimal Quick-Start Chips */}
							<div className="flex flex-col gap-1.5 w-full">
								<button
									type="button"
									onClick={() => setPrompt('Design a stepped shaft with dual O-ring seal grooves and internal bore.')}
									className="w-full px-3 py-2 rounded-lg border border-border bg-muted/40 hover:bg-muted hover:border-blue-500/30 text-left text-xs text-foreground/80 hover:text-foreground transition-colors flex items-center gap-2 group"
								>
									<span className="text-blue-400 group-hover:scale-110 transition-transform text-xs">⚡</span>
									<span className="truncate">Stepped Shaft with Grooves</span>
								</button>

								<button
									type="button"
									onClick={() => setPrompt('Convert attached 2D blueprint drawing into a fully parametric 3D model.')}
									className="w-full px-3 py-2 rounded-lg border border-border bg-muted/40 hover:bg-muted hover:border-blue-500/30 text-left text-xs text-foreground/80 hover:text-foreground transition-colors flex items-center gap-2 group"
								>
									<span className="text-cyan-400 group-hover:scale-110 transition-transform text-xs">📐</span>
									<span className="truncate">Convert Blueprint to 3D CAD</span>
								</button>

								<button
									type="button"
									onClick={() => setPrompt('Design an M8 threaded bolt with 40mm length and hex head.')}
									className="w-full px-3 py-2 rounded-lg border border-border bg-muted/40 hover:bg-muted hover:border-blue-500/30 text-left text-xs text-foreground/80 hover:text-foreground transition-colors flex items-center gap-2 group"
								>
									<span className="text-violet-400 group-hover:scale-110 transition-transform text-xs">🔩</span>
									<span className="truncate">M8 Threaded Fastener</span>
								</button>
							</div>
						</div>
					) : (
						<div className="space-y-4">
							{messages.map((msg) => (
								<ChatBubble key={msg.id} {...msg} />
							))}
							<div ref={scrollRef} />
						</div>
					)}
				</div>

				{/* Floating Command Input Dock */}
				<div className="px-4 pb-4 pt-1">
					<form onSubmit={onSubmit} className="relative group/form flex flex-col gap-1.5">
						{/* Target Feature Pill (When Model Active) */}
						{hasActiveModel && (
							<div className="flex flex-col gap-1 px-0.5">
								<div className="flex items-center justify-between gap-2">
									<div className="relative">
										<button
											type="button"
											onClick={() => setIsPortionPickerOpen(!isPortionPickerOpen)}
											className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-semibold transition-all border ${
												targetPortion
													? 'bg-cyan-500/15 border-cyan-500/40 text-cyan-300 shadow-[0_0_12px_rgba(6,182,212,0.2)]'
													: 'bg-zinc-900/80 border-zinc-800 text-zinc-400 hover:text-white hover:border-zinc-700'
											}`}
											title="Select specific CAD feature or detail view to inspect and refine"
										>
											<Target className={`size-3 ${targetPortion ? 'text-cyan-400' : 'text-zinc-500'}`} />
											<span className="truncate max-w-[160px]">
												{targetPortion ? targetPortion.name : 'Target: Whole Model'}
											</span>
											<ChevronDown className="size-2.5 opacity-60 ml-0.5" />
										</button>

										{/* Dropdown Menu for CAD Portions */}
										{isPortionPickerOpen && (
											<div className="absolute left-0 bottom-full mb-2 w-72 max-h-80 overflow-y-auto rounded-xl bg-zinc-950/95 backdrop-blur-2xl border border-zinc-800 shadow-2xl z-50 p-1.5 space-y-1 animate-in fade-in zoom-in-95">
												<div className="px-2.5 py-1.5 border-b border-zinc-800 flex items-center justify-between">
													<span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
														Target Portion for AI
													</span>
													{targetPortion && (
														<button
															type="button"
															onClick={() => {
																if (setTargetPortion) setTargetPortion(null);
																setIsPortionPickerOpen(false);
															}}
															className="text-[10px] text-cyan-400 hover:underline font-semibold"
														>
															Reset
														</button>
													)}
												</div>

												{/* All / Whole Model Option */}
												<button
													type="button"
													onClick={() => {
														if (setTargetPortion) setTargetPortion(null);
														setIsPortionPickerOpen(false);
													}}
													className={`w-full text-left px-2.5 py-1.5 rounded-lg text-xs transition-colors flex items-center justify-between ${
														!targetPortion
															? 'bg-cyan-500/20 text-cyan-300 font-semibold'
															: 'hover:bg-zinc-800/80 text-zinc-300'
													}`}
												>
													<span>🌐 Whole Model (Global)</span>
													{!targetPortion && <span className="text-[10px] text-cyan-400">Active</span>}
												</button>

												{/* Categorized Feature Presets */}
												<div className="space-y-0.5 pt-1 border-t border-zinc-800/60">
													{CAD_PORTION_PRESETS.map((preset) => (
														<button
															key={preset.id}
															type="button"
															onClick={() => handleSelectPortion(preset)}
															className={`w-full text-left px-2.5 py-1.5 rounded-lg text-xs transition-colors flex flex-col gap-0.5 ${
																targetPortion?.id === preset.id
																	? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
																	: 'hover:bg-zinc-800/80 text-zinc-300'
															}`}
														>
															<div className="flex items-center justify-between">
																<span className="font-medium text-[11px]">{preset.name}</span>
																<span className="text-[9px] text-zinc-500 font-mono">{preset.category}</span>
															</div>
															{preset.description && (
																<span className="text-[10px] text-zinc-500 line-clamp-1">
																	{preset.description}
																</span>
															)}
														</button>
													))}
												</div>

												{/* Active Parameters List */}
												{parameterEntries.length > 0 && (
													<div className="pt-1 border-t border-zinc-800/60">
														<div className="px-2 py-1 text-[9px] font-bold uppercase tracking-wider text-zinc-500">
															Model Parameters
														</div>
														<div className="max-h-24 overflow-y-auto space-y-0.5">
															{parameterEntries.map(([key, val]) => (
																<button
																	key={key}
																	type="button"
																	onClick={() => handleSelectPortion({
																		id: `param_${key}`,
																		name: `Param: ${key}`,
																		category: 'Parameter',
																		description: `Value: ${String(val)}`,
																		quickPrompts: [
																			`Adjust ${key} to match blueprint callout.`
																		]
																	})}
																	className="w-full text-left px-2 py-1 rounded text-[10px] font-mono flex items-center justify-between hover:bg-zinc-800/80 text-zinc-400 hover:text-white"
																>
																	<span className="truncate">{key}</span>
																	<span className="text-cyan-400 font-bold">{String(val)}</span>
																</button>
															))}
														</div>
													</div>
												)}
											</div>
										)}
									</div>

									{targetPortion && (
										<button
											type="button"
											onClick={() => {
												if (setTargetPortion) setTargetPortion(null);
											}}
											className="text-[10px] text-zinc-400 hover:text-white flex items-center gap-1 transition-colors px-1.5 py-0.5 rounded hover:bg-zinc-800"
											title="Clear targeted portion"
										>
											<X className="size-3" />
											<span>Clear</span>
										</button>
									)}
								</div>

								{/* Compact Quick Suggestion Pills */}
								{targetPortion?.quickPrompts && targetPortion.quickPrompts.length > 0 && (
									<div className="flex gap-1.5 overflow-x-auto py-0.5 no-scrollbar">
										{targetPortion.quickPrompts.map((qp, idx) => (
											<button
												key={idx}
												type="button"
												onClick={() => handleApplyQuickPrompt(qp)}
												className="shrink-0 text-left px-2.5 py-0.5 rounded-full bg-cyan-950/50 hover:bg-cyan-900/80 border border-cyan-500/25 text-[10px] text-cyan-300 hover:text-cyan-100 transition-colors truncate max-w-[210px]"
												title={qp}
											>
												💡 {qp}
											</button>
										))}
									</div>
								)}
							</div>
						)}

						{/* File Context Indicator */}
						{selectedFile && (
							<div className="flex items-center gap-2 rounded-lg border border-blue-500/30 bg-blue-500/10 px-3 py-1.5 text-xs text-blue-300">
								<Upload className="size-3.5 shrink-0 text-blue-400" />
								<span className="truncate flex-1 font-mono">{selectedFile.name}</span>
								<button
									type="button"
									onClick={() => handleFileChange(null)}
									className="p-0.5 hover:text-white transition-colors"
								>
									<X className="size-3.5" />
								</button>
							</div>
						)}

						{/* 3D Coordinate Targeting Chip */}
						{selectionContext && (
							<div className="flex items-center gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-1.5 text-xs text-rose-300">
								<Crosshair className="size-3.5 shrink-0 text-rose-400" />
								<span className="truncate flex-1 font-mono">
									Point [{selectionContext[0].toFixed(1)}, {selectionContext[1].toFixed(1)}, {selectionContext[2].toFixed(1)}]
								</span>
								<button
									type="button"
									onClick={onClearSelectionContext}
									className="p-0.5 hover:text-white transition-colors"
								>
									<X className="size-3.5" />
								</button>
							</div>
						)}

						{/* Main Floating Glass Input Dock */}
						<div className="relative flex flex-col rounded-2xl bg-zinc-900/90 border border-white/[0.08] shadow-[0_8px_32px_rgba(0,0,0,0.45)] backdrop-blur-2xl focus-within:border-cyan-500/40 focus-within:ring-1 focus-within:ring-cyan-500/20 transition-all duration-200">
							<textarea
								value={prompt}
								onChange={(e) => setPrompt(e.target.value)}
								onKeyDown={(e) => {
									if (e.key === 'Enter' && e.shiftKey) {
										e.preventDefault();
										onSubmit(e as any);
									}
								}}
								rows={2}
								placeholder={
									targetPortion
										? `Describe revisions for ${targetPortion.name}...`
										: hasActiveModel
											? "Iterate on geometry (e.g. increase groove depth, add 30° cone)..."
											: "Ask VEXCAD AI or describe your part..."
								}
								className="w-full resize-none bg-transparent px-4 pt-3.5 pb-2 text-xs text-foreground placeholder:text-zinc-500 focus:outline-none font-sans leading-relaxed"
							/>

							<div className="flex items-center justify-between px-3 pb-2.5 pt-0.5 border-t border-white/[0.04]">
								<div className="flex items-center gap-1.5">
									{/* Minimal Upload Button */}
									<label
										className={`flex size-7 cursor-pointer items-center justify-center rounded-lg transition-all duration-200 ${selectedFile
											? 'bg-blue-500/15 text-blue-400 hover:bg-blue-500/25 border border-blue-500/30'
											: 'text-zinc-400 hover:bg-white/[0.06] hover:text-white'
											}`}
										title="Attach technical blueprint (PDF/PNG/JPG)"
									>
										<Upload className="size-3.5" />
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

									{/* Model Selector Pill */}
									<Select value={selectedModel} onValueChange={(val: string | null) => val && setSelectedModel(val)}>
										<SelectTrigger 
											className="h-6 border border-white/[0.06] bg-zinc-800/60 px-2 rounded-md text-[10px] font-mono font-medium text-zinc-300 outline-none focus:ring-0 shadow-none hover:text-white hover:border-zinc-700 transition-colors truncate w-auto gap-1"
											title="Select AI Model"
										>
											<Sparkles className="size-2.5 text-cyan-400 shrink-0" />
											<SelectValue />
										</SelectTrigger>
										<SelectContent className="bg-zinc-950/95 border-zinc-800 backdrop-blur-xl">
											{modelOptions.map((opt) => (
												<SelectItem key={opt.value} value={opt.value} className="text-xs font-mono">
													{opt.label}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
								</div>

								{/* Send Button */}
								<button
									type="submit"
									disabled={isGenerating || !prompt.trim()}
									className={`flex size-7 items-center justify-center rounded-lg transition-all duration-200 ${isGenerating
										? 'bg-cyan-500/20 text-cyan-400 cursor-wait'
										: !prompt.trim()
											? 'bg-zinc-800/40 text-zinc-600 cursor-not-allowed'
											: 'bg-gradient-to-r from-cyan-500 to-blue-600 text-white hover:shadow-[0_0_16px_rgba(6,182,212,0.4)] hover:scale-105 active:scale-95'
										}`}
								>
									{isGenerating ? (
										<Loader2 className="size-3.5 animate-spin shrink-0" />
									) : (
										<SendHorizontal className="size-3.5 shrink-0" />
									)}
								</button>
							</div>
						</div>
					</form>
				</div>
			</div>
		</>
	);
}
