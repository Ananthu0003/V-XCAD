'use client';

import { FormEvent, useRef, useEffect, useState } from 'react';
import { 
	Bot, LogOut, Loader2, SendHorizontal, Zap, Upload, FileImage, 
	Settings, BrainCircuit, Cuboid, Trash2, Crosshair, Sparkles, 
	ChevronDown, Check, SlidersHorizontal, Wrench, Layers, Tag, X,
	Target, PlusCircle, RefreshCw, Paperclip, Send
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { ChatBubble } from '@/components/chat/ChatBubble';
import { SettingsPanel } from '@/components/workspace/SettingsPanel';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export type TargetPortion = {
	id: string;
	name: string;
	category: string;
	description?: string;
	quickPrompts?: string[];
	cropBox?: { x: number; y: number; w: number; h: number };
};

export const CAD_PORTION_PRESETS: TargetPortion[] = [
	{
		id: 'groove',
		name: 'Groove / Undercut / O-Ring',
		category: 'Subtractive Features',
		description: 'Seal grooves, snap ring channels, neck undercuts from detail-view callouts',
		quickPrompts: [
			'Add the groove/undercut feature at the location indicated, using the width, depth and root fillet from the callout.',
			'Add an O-ring groove at the location indicated, using the width and depth from the callout.',
			'Fix the groove draft angle and add root fillets as specified in the detail view.'
		]
	},
	{
		id: 'chamfer',
		name: 'Chamfer / Bevel / Lead-In',
		category: 'Edge & Transition',
		description: 'Outer/inner edge chamfers or conical lead-in angles from the callouts',
		quickPrompts: [
			'Add the chamfer to the outer corners at the dimensions specified in the detail view callout.',
			'Model the conical lead-in cone with corner blends as dimensioned in the detail view.',
			'Add a lead-in chamfer to the bore entrance as specified.'
		]
	},
	{
		id: 'fillet',
		name: 'Fillet / Blend Radius',
		category: 'Edge & Transition',
		description: 'Internal blend radii or external corner rounds from the callouts',
		quickPrompts: [
			'Add corner fillets to all groove root edges at the radius specified in the callout.',
			'The transition shoulder has a blend fillet that was missed; apply the radius from the callout.',
			'Apply corner blends at the shaft tip at the radius specified in the detail view.'
		]
	},
	{
		id: 'stepped_bore',
		name: 'Stepped Bore / Hole / Counterbore',
		category: 'Internal Channels',
		description: 'Internal bore steps, counterbores, blind depths from the section view',
		quickPrompts: [
			'The internal stepped bore must follow the diameters and depths called out in the section view.',
			'The internal bore transition has a taper angle as specified; verify the stepped profile against the callout.',
			'The central hole depth is incorrect; verify the internal stepped profile against the callout.'
		]
	},
	{
		id: 'thread',
		name: 'Thread (Internal / External)',
		category: 'Manufacturing Callout',
		description: 'Tapped holes, bolt threads, ISO metric / UNC specifications',
		quickPrompts: [
			'Add the internal thread to the center bore at the diameter, pitch and depth called out.',
			'Model the standard metric thread on the external shaft as specified.',
			'Update thread pitch to the coarse standard for the nominal diameter.'
		]
	},
	{
		id: 'step_shoulder',
		name: 'Step / Shoulder / Collar',
		category: 'Outer Profile & Diameters',
		description: 'Diameter transitions, collars, stops from the profile callouts',
		quickPrompts: [
			'The outer profile has intermediate diameter steps that must match the callouts.',
			'The shaft diameter should step down as dimensioned along the working area.',
			'Add the intermediate mounting collar at the Z-station specified.'
		]
	},
	{
		id: 'pocket_slot',
		name: 'Pocket / Slot / Keyway',
		category: 'Milling & Features',
		description: 'Drive keyways, flat milled slots, or internal pockets',
		quickPrompts: [
			'Add a drive keyway slot along the shaft as specified.',
			'Cut a U-shaped slot at the edge with full radius bottom as dimensioned.',
			'Add a milled pocket with depth matching the drawing note.'
		]
	},
	{
		id: 'missing_detail',
		name: 'Missing Detail View Feature',
		category: 'Detail & Micro-Geometry',
		description: 'Micro-features from detail views or note callouts omitted in initial pass',
		quickPrompts: [
			'The detail view shows an undercut with the width, angle, and fillet specified in the callout.',
			'The detail view shows an undercut with a chamfer as dimensioned.',
			'The detail view shows a recess at the nose with a cone angle as specified.'
		]
	},
	{
		id: 'body_envelope',
		name: 'Main Body / Overall Dimensions',
		category: 'Global Dimensions',
		description: 'Overall length, primary diameter, base prismoid dimensions',
		quickPrompts: [
			'Total part length should be exactly as dimensioned in the callout.',
			'Adjust outer stock diameter to match the primary datum.',
			'Correct the overall thickness of the main body as specified.'
		]
	}
];

type ChatRole = 'user' | 'assistant' | 'system';

type ChatMessage = {
	id: string;
	role: ChatRole;
	content: string;
	fileName?: string;
	targetPortion?: string;
	revisionId?: string;
	revisionNumber?: number;
	changeLog?: any;
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
	activeRevisionId?: string | null;
	onRestoreRevision?: (revisionId: string) => void;
	onDeleteRevision?: (revisionId: string) => void;
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
	activeRevisionId,
	onRestoreRevision,
	onDeleteRevision,
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
		if (scrollRef.current) {
			scrollRef.current.scrollIntoView({ behavior: 'smooth' });
		}
	}, [messages, isGenerating]);

	const handleLogout = async () => {
		setIsLoggingOut(true);
		try {
			await fetch('/api/auth/logout', { method: 'POST' });
			router.push('/login');
		} catch (error) {
			console.error('Logout error:', error);
			setIsLoggingOut(false);
		}
	};

	const handleSelectPortion = (portion: TargetPortion) => {
		if (setTargetPortion) {
			setTargetPortion(portion);
		}
		setIsPortionPickerOpen(false);
	};

	const handleApplyQuickPrompt = (quickText: string) => {
		setPrompt(quickText);
	};

	return (
		<>
			<div className="flex h-full flex-col bg-[#070b14]/95 backdrop-blur-2xl border-r border-white/[0.08] select-none">
				{/* Top Ambient Highlight */}
				<div className="h-[1px] w-full bg-gradient-to-r from-transparent via-cyan-500/40 to-transparent" />

				{/* Header */}
				<div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.06] bg-white/[0.01]">
					<div className="flex items-center gap-2.5">
						<div className="flex size-7 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-500/20 to-blue-600/10 border border-cyan-500/30 text-cyan-400 shadow-[0_0_12px_rgba(34,211,238,0.2)]">
							<Cuboid className="size-4" />
						</div>
						<div className="flex items-center gap-2">
							<span className="text-sm font-extrabold tracking-wider text-white font-mono">
								VEXCAD
							</span>
							<span className="text-[9px] text-cyan-300 font-mono font-bold bg-cyan-500/10 px-1.5 py-0.5 rounded-md border border-cyan-500/25">
								v0.1.0
							</span>
						</div>
					</div>

					{/* Action Buttons Cluster */}
					<div className="flex items-center gap-1">
						<button
							onClick={onClear}
							className="flex size-7 items-center justify-center rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 hover:text-emerald-300 transition-all cursor-pointer shadow-sm"
							title="New Blueprint CAD Project"
						>
							<PlusCircle className="size-3.5" />
						</button>
						{messages.length > 0 && (
							<button
								onClick={onClear}
								className="flex size-7 items-center justify-center rounded-lg bg-white/[0.03] hover:bg-white/[0.08] border border-white/10 text-muted-foreground hover:text-white transition-colors cursor-pointer"
								title="Clear active workspace"
							>
								<Trash2 className="size-3.5" />
							</button>
						)}
						<button
							onClick={() => setIsSettingsOpen(true)}
							className="flex size-7 items-center justify-center rounded-lg bg-white/[0.03] hover:bg-white/[0.08] border border-white/10 text-muted-foreground hover:text-white transition-colors cursor-pointer"
							title="Settings"
						>
							<Settings className="size-3.5" />
						</button>
						<button
							onClick={handleLogout}
							disabled={isLoggingOut}
							className="flex size-7 items-center justify-center rounded-lg bg-white/[0.03] hover:bg-white/[0.08] border border-white/10 text-muted-foreground hover:text-rose-400 transition-colors disabled:opacity-50 cursor-pointer"
							title="Logout"
						>
							{isLoggingOut ? (
								<Loader2 className="size-3.5 animate-spin text-cyan-400" />
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

				{/* Chat Messages Stream */}
				<div className="flex-1 overflow-y-auto px-4 py-4 space-y-3.5 no-scrollbar">
					{messages.length === 0 ? (
						<div className="flex flex-col items-center justify-center h-full text-center px-4 space-y-5 max-w-xs mx-auto animate-in fade-in duration-300">
							<div className="relative flex items-center justify-center">
								<div className="absolute -inset-3 rounded-full bg-cyan-500/10 blur-xl" />
								<div className="relative flex size-12 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-500/20 to-blue-600/10 border border-cyan-500/30 text-cyan-400 shadow-[0_0_20px_rgba(34,211,238,0.2)]">
									<Cuboid className="size-6" />
								</div>
							</div>

							<div className="space-y-1">
								<h3 className="text-xs font-bold uppercase tracking-wider text-white font-mono">
									Parametric CAD Copilot
								</h3>
								<p className="text-[11px] text-muted-foreground leading-relaxed">
									Upload a 2D engineering blueprint or enter parametric CAD prompts below.
								</p>
							</div>

							{/* Quick Start Cards */}
							<div className="flex flex-col gap-1.5 w-full">
								<button
									type="button"
									onClick={() => setPrompt('Design a stepped shaft with dual O-ring seal grooves and internal bore.')}
									className="w-full px-3 py-2 rounded-xl border border-white/10 bg-white/[0.02] hover:bg-white/[0.06] hover:border-cyan-500/40 text-left text-xs text-muted-foreground hover:text-white transition-all flex items-center gap-2 cursor-pointer group"
								>
									<span className="text-cyan-400 group-hover:scale-110 transition-transform text-xs">⚡</span>
									<span className="truncate">Stepped Shaft with Grooves</span>
								</button>

								<button
									type="button"
									onClick={() => setPrompt('Convert attached 2D blueprint drawing into a fully parametric 3D model.')}
									className="w-full px-3 py-2 rounded-xl border border-white/10 bg-white/[0.02] hover:bg-white/[0.06] hover:border-cyan-500/40 text-left text-xs text-muted-foreground hover:text-white transition-all flex items-center gap-2 cursor-pointer group"
								>
									<span className="text-emerald-400 group-hover:scale-110 transition-transform text-xs">📐</span>
									<span className="truncate">Convert Blueprint to 3D CAD</span>
								</button>
							</div>
						</div>
					) : (
						<div className="space-y-3.5">
							{messages.map((msg) => (
								<ChatBubble
									key={msg.id}
									{...msg}
									activeRevisionId={activeRevisionId}
									onRestoreRevision={onRestoreRevision}
									onDeleteRevision={onDeleteRevision}
									onRestorePrompt={(text, portionName) => {
										setPrompt(text);
										if (portionName && setTargetPortion) {
											const found = CAD_PORTION_PRESETS.find(
												(p) => p.name === portionName || p.id === portionName
											);
											if (found) {
												setTargetPortion(found);
											}
										}
									}}
								/>
							))}

							{isGenerating && (
								<div className="flex items-center gap-2.5 p-3 rounded-2xl bg-cyan-500/[0.05] border border-cyan-500/20 text-cyan-300 text-xs animate-pulse">
									<RefreshCw className="size-3.5 animate-spin text-cyan-400" />
									<span>Computing CAD Geometry & B-Rep Topology...</span>
								</div>
							)}
							<div ref={scrollRef} />
						</div>
					)}
				</div>

				{/* Floating Command Input Dock */}
				<div className="px-3.5 pb-3.5 pt-1.5 border-t border-white/[0.06] bg-[#070b14]">
					<form onSubmit={onSubmit} className="relative flex flex-col gap-1.5">
						{/* Target Feature Pill (When Model Active) */}
						{hasActiveModel && (
							<div className="flex flex-col gap-1">
								<div className="flex items-center justify-between gap-2">
									<div className="relative">
										<button
											type="button"
											onClick={() => setIsPortionPickerOpen(!isPortionPickerOpen)}
											className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-mono font-semibold transition-all border cursor-pointer ${
												targetPortion
													? 'bg-cyan-500/15 border-cyan-500/40 text-cyan-300 shadow-[0_0_12px_rgba(34,211,238,0.2)]'
													: 'bg-white/[0.03] border-white/10 text-muted-foreground hover:text-white hover:border-cyan-500/40'
											}`}
											title="Target specific CAD feature"
										>
											<Target className={`size-3 ${targetPortion ? 'text-cyan-400' : 'text-muted-foreground'}`} />
											<span className="truncate max-w-[150px]">
												{targetPortion ? targetPortion.name : 'Target: Whole Model'}
											</span>
											<ChevronDown className="size-2.5 opacity-60 ml-0.5" />
										</button>

										{/* Dropdown Menu for CAD Portions */}
										{isPortionPickerOpen && (
											<div className="absolute bottom-full left-0 mb-2 w-72 rounded-2xl border border-white/10 bg-[#0c1222]/95 backdrop-blur-2xl shadow-2xl p-2 z-50 space-y-1 animate-in fade-in zoom-in-95 duration-150">
												<div className="flex items-center justify-between px-2 py-1 border-b border-white/[0.06] text-[10px] font-bold uppercase tracking-wider text-cyan-400 font-mono">
													<span>Select CAD Feature Focus</span>
													<button
														type="button"
														onClick={() => setIsPortionPickerOpen(false)}
														className="text-muted-foreground hover:text-white p-0.5"
													>
														<X className="size-3" />
													</button>
												</div>

												<button
													type="button"
													onClick={() => {
														if (setTargetPortion) setTargetPortion(null);
														setIsPortionPickerOpen(false);
													}}
													className="w-full text-left px-2.5 py-1.5 rounded-lg text-xs hover:bg-white/10 text-white flex items-center justify-between cursor-pointer"
												>
													<span className="font-semibold">Whole Model (Default)</span>
													{!targetPortion && <Check className="size-3 text-cyan-400" />}
												</button>

												<div className="max-h-48 overflow-y-auto space-y-0.5 no-scrollbar">
													{CAD_PORTION_PRESETS.map((p) => (
														<button
															key={p.id}
															type="button"
															onClick={() => handleSelectPortion(p)}
															className={`w-full text-left px-2.5 py-1.5 rounded-lg text-xs transition-colors flex items-center justify-between cursor-pointer ${
																targetPortion?.id === p.id
																	? 'bg-cyan-500/20 text-cyan-300 font-bold'
																	: 'hover:bg-white/[0.06] text-muted-foreground hover:text-white'
															}`}
														>
															<span className="truncate">{p.name}</span>
															{targetPortion?.id === p.id && <Check className="size-3 text-cyan-400 shrink-0" />}
														</button>
													))}
												</div>
											</div>
										)}
									</div>

									{targetPortion && (
										<button
											type="button"
											onClick={() => {
												if (setTargetPortion) setTargetPortion(null);
											}}
											className="text-[10px] text-muted-foreground hover:text-rose-400 flex items-center gap-1 transition-colors px-1.5 py-0.5 rounded cursor-pointer"
											title="Clear targeted portion"
										>
											<X className="size-3" />
											<span>Clear</span>
										</button>
									)}
								</div>
							</div>
						)}

						{/* Attached File Preview */}
						{selectedFile && (
							<div className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs text-emerald-300 font-mono">
								<Upload className="size-3.5 shrink-0 text-emerald-400" />
								<span className="truncate flex-1 font-semibold">{selectedFile.name}</span>
								<button
									type="button"
									onClick={() => handleFileChange(null)}
									className="p-0.5 hover:text-white transition-colors cursor-pointer"
								>
									<X className="size-3.5" />
								</button>
							</div>
						)}

						{/* 3D Coordinate Targeting Chip */}
						{selectionContext && (
							<div className="flex items-center gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-1.5 text-xs text-rose-300 font-mono">
								<Crosshair className="size-3.5 shrink-0 text-rose-400" />
								<span className="truncate flex-1">
									Target [{selectionContext[0].toFixed(1)}, {selectionContext[1].toFixed(1)}, {selectionContext[2].toFixed(1)}]
								</span>
								<button
									type="button"
									onClick={onClearSelectionContext}
									className="p-0.5 hover:text-white transition-colors cursor-pointer"
								>
									<X className="size-3.5" />
								</button>
							</div>
						)}

						{/* Main Floating Glass Input Bar */}
						<div className="relative flex flex-col rounded-2xl bg-white/[0.03] border border-white/10 focus-within:border-cyan-400/60 focus-within:bg-white/[0.05] shadow-[0_8px_30px_rgba(0,0,0,0.5)] backdrop-blur-xl transition-all duration-200">
							<textarea
								value={prompt}
								onChange={(e) => setPrompt(e.target.value)}
								onKeyDown={(e) => {
									if (e.key === 'Enter' && !e.shiftKey) {
										e.preventDefault();
										onSubmit(e as any);
									}
								}}
								rows={2}
								placeholder={
									targetPortion
										? `Describe revisions for ${targetPortion.name}...`
										: hasActiveModel
											? "Iterate on geometry (e.g. increase boss height, add 4x holes)..."
											: "Ask VEXCAD AI or describe your part..."
								}
								className="w-full resize-none bg-transparent px-3.5 pt-3 pb-2 text-xs text-foreground placeholder:text-muted-foreground/60 focus:outline-none font-sans leading-relaxed"
							/>

							<div className="flex items-center justify-between px-3 pb-2.5 pt-1 border-t border-white/[0.04]">
								<div className="flex items-center gap-1.5">
									{/* Attach File Button */}
									<label
										className={`flex size-7 cursor-pointer items-center justify-center rounded-xl transition-all duration-200 ${
											selectedFile
												? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
												: 'text-muted-foreground hover:bg-white/10 hover:text-white'
										}`}
										title="Attach technical blueprint (PDF/PNG/JPG)"
									>
										<Paperclip className="size-3.5" />
										<input
											ref={fileInputRef}
											type="file"
											accept="image/*,.pdf"
											className="hidden"
											onChange={(e) => {
												const file = e.target.files?.[0] || null;
												handleFileChange(file);
											}}
										/>
									</label>

									{/* Model Selector Dropdown */}
									<Select value={selectedModel} onValueChange={(val: string | null) => val && setSelectedModel(val)}>
										<SelectTrigger className="h-7 px-2 border-0 bg-transparent hover:bg-white/5 text-[10.5px] font-mono font-semibold text-muted-foreground hover:text-white rounded-lg focus:ring-0 gap-1">
											<Sparkles className="size-3 text-cyan-400" />
											<SelectValue placeholder="Model" />
										</SelectTrigger>
										<SelectContent className="rounded-xl border border-white/10 bg-[#090e1a]/95 backdrop-blur-xl text-xs z-50">
											{modelOptions.map((opt) => (
												<SelectItem key={opt.value} value={opt.value} className="text-xs font-mono">
													{opt.label}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
								</div>

								{/* High-Emphasis Send Button */}
								<button
									type="submit"
									disabled={isGenerating || (!prompt.trim() && !selectedFile)}
									className="size-7.5 rounded-xl bg-cyan-400 hover:bg-cyan-300 disabled:opacity-30 text-black flex items-center justify-center transition-all shadow-[0_0_12px_rgba(34,211,238,0.3)] shrink-0 cursor-pointer font-bold"
									title="Generate CAD Model (Enter)"
								>
									{isGenerating ? (
										<Loader2 className="size-3.5 animate-spin text-black" />
									) : (
										<Send className="size-3.5" />
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
