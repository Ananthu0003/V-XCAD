'use client';

import { FormEvent, useRef, useEffect, useState, useMemo } from 'react';
import { 
	Bot, LogOut, Loader2, SendHorizontal, Zap, Upload, FileImage, 
	Settings, BrainCircuit, Cuboid, Trash2, Crosshair, Sparkles, 
	ChevronDown, ChevronRight, ChevronLeft, Check, SlidersHorizontal, Wrench, Layers, Tag, X,
	Target, PlusCircle, RefreshCw, Paperclip, Send, Plus, Ruler
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { ChatBubble } from '@/components/chat/ChatBubble';
import { SettingsPanel } from '@/components/workspace/SettingsPanel';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { 
	deriveTargetPortions, 
	TargetPortion, 
	ADD_NEW_FEATURE_TEMPLATES, 
	TargetPortionSource 
} from '@/lib/derive-target-portions';
import type { CamFeature } from '@/types/cam';
import type { StlGeometryInfo } from '@/components/viewport/StlMesh';

export type { TargetPortion, TargetPortionSource };

export const CAD_PORTION_PRESETS: TargetPortion[] = ADD_NEW_FEATURE_TEMPLATES;

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
	fileInputRef?: React.RefObject<HTMLInputElement | null>;
	selectionContext?: [number, number, number] | null;
	onClearSelectionContext?: () => void;
	hasActiveModel?: boolean;
	parameters?: Record<string, unknown>;
	parameterEntries?: [string, unknown][];
	parameterMetadata?: Record<string, any>;
	annotations?: Record<string, any>;
	camFeatures?: CamFeature[];
	geometryInfo?: StlGeometryInfo | null;
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
	fileInputRef,
	selectionContext,
	onClearSelectionContext,
	hasActiveModel = false,
	parameters = {},
	parameterEntries = [],
	parameterMetadata = {},
	annotations = {},
	camFeatures = [],
	geometryInfo = null,
	targetPortion = null,
	setTargetPortion,
	blueprintUrl = null,
	onToggleBlueprintView,
	activeRevisionId,
	onRestoreRevision,
	onDeleteRevision,
}: ChatPanelProps) {
	const scrollRef = useRef<HTMLDivElement | null>(null);
	const textareaRef = useRef<HTMLTextAreaElement | null>(null);
	const router = useRouter();
	const [isLoggingOut, setIsLoggingOut] = useState(false);
	const [user, setUser] = useState<{name?: string; email?: string} | null>(null);
	const [isSettingsOpen, setIsSettingsOpen] = useState(false);
	const [isPortionPickerOpen, setIsPortionPickerOpen] = useState(false);

	const activeParams = useMemo(() => {
		if (parameters && Object.keys(parameters).length > 0) return parameters;
		if (parameterEntries && parameterEntries.length > 0) {
			return Object.fromEntries(parameterEntries);
		}
		return {};
	}, [parameters, parameterEntries]);

	const { existingPortions, newFeaturePortions, allPortions } = useMemo(() => {
		return deriveTargetPortions({
			parameters: activeParams,
			parameterMetadata,
			annotations,
			camFeatures,
			geometryInfo,
		});
	}, [activeParams, parameterMetadata, annotations, camFeatures, geometryInfo]);

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
			<div className="flex h-full min-h-0 flex-col bg-[var(--ui-panel)] select-none text-[var(--ui-text-primary)] overflow-hidden">
				{/* Header */}
				<div className="flex h-12 shrink-0 items-center justify-between px-4 border-b border-[var(--ui-border)] bg-[var(--ui-panel)]">
					<div className="flex items-center gap-2.5">
						<div className="flex size-7 items-center justify-center rounded-lg bg-[var(--ui-input)] border border-[var(--ui-border-ctrl)] text-[var(--ui-accent)]">
							<Cuboid className="size-4" />
						</div>
						<div className="flex items-center gap-2">
							<span className="text-sm font-bold tracking-wider text-[var(--ui-text-primary)] font-mono">
								VEXCAD
							</span>
							<span className="text-[9px] text-[var(--ui-text-muted)] font-mono font-bold bg-[var(--ui-input)] px-1.5 py-0.5 rounded border border-[var(--ui-border-ctrl)]">
								v0.1.0
							</span>
						</div>
					</div>

					{/* Action Buttons Cluster */}
					<div className="flex items-center gap-1">
						<button
							onClick={onClear}
							className="ui-btn ui-btn--ghost !h-7 !px-2"
							title="New Blueprint CAD Project"
						>
							<PlusCircle className="size-3.5 text-emerald-400" />
						</button>
						{messages.length > 0 && (
							<button
								onClick={onClear}
								className="ui-btn ui-btn--ghost !h-7 !px-2"
								title="Clear active workspace"
							>
								<Trash2 className="size-3.5" />
							</button>
						)}
						<button
							onClick={() => setIsSettingsOpen(true)}
							className="ui-btn ui-btn--ghost !h-7 !px-2"
							title="Settings"
						>
							<Settings className="size-3.5" />
						</button>
						<button
							onClick={handleLogout}
							disabled={isLoggingOut}
							className="ui-btn ui-btn--ghost !h-7 !px-2 text-rose-400 hover:text-rose-300"
							title="Logout"
						>
							{isLoggingOut ? (
								<Loader2 className="size-3.5 animate-spin" />
							) : (
								<LogOut className="size-3.5" />
							)}
						</button>
						<button
							type="button"
							onClick={() => setIsOpen(false)}
							className="ui-btn ui-btn--ghost !h-7 !w-7 !p-0 ml-1 text-[var(--ui-text-muted)] hover:text-[var(--ui-accent)] cursor-pointer"
							title="Push Left Panel (Collapse)"
						>
							<ChevronLeft className="size-4" />
						</button>
					</div>
				</div>

				<SettingsPanel
					isOpen={isSettingsOpen}
					onClose={() => setIsSettingsOpen(false)}
					user={user}
				/>

				{/* Chat Messages Stream */}
				<div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-3.5 no-scrollbar">
					{messages.length === 0 ? (
						<div className="flex flex-col items-center justify-center h-full text-center px-4 space-y-5 max-w-xs mx-auto animate-in fade-in duration-300">
							<div className="flex size-12 items-center justify-center rounded-2xl bg-[var(--ui-input)] border border-[var(--ui-border-ctrl)] text-[var(--ui-accent)] shadow-sm">
								<Cuboid className="size-6" />
							</div>

							<div className="space-y-1">
								<h3 className="text-xs font-bold uppercase tracking-wider text-[var(--ui-text-primary)] font-mono">
									Parametric CAD Copilot
								</h3>
								<p className="text-[11px] text-[var(--ui-text-muted)] leading-relaxed">
									Describe your mechanical part in natural language, attach a 2D blueprint drawing, or import a 3D STEP solid model.
								</p>
							</div>

							{/* Quick Start Cards */}
							<div className="flex flex-col gap-2 w-full pt-1">
								<button
									type="button"
									onClick={() => setPrompt('Design a stepped shaft with dual O-ring seal grooves and internal bore.')}
									className="w-full px-3.5 py-2.5 rounded-xl border border-[var(--ui-border)] bg-[var(--ui-input)] hover:border-[var(--ui-border-strong)] text-left text-xs transition-all flex items-center justify-between gap-2 cursor-pointer group shadow-sm"
								>
									<div className="flex items-center gap-2.5 min-w-0">
										<div className="size-6 rounded-lg bg-[var(--ui-panel)] border border-[var(--ui-border-ctrl)] text-[var(--ui-accent)] flex items-center justify-center shrink-0">
											<Zap className="size-3.5" />
										</div>
										<span className="truncate font-medium text-[11.5px] text-[var(--ui-text-primary)]">
											Stepped Shaft with Grooves
										</span>
									</div>
									<ChevronRight className="size-3.5 text-[var(--ui-text-muted)] group-hover:text-[var(--ui-text-primary)] shrink-0" />
								</button>

								<button
									type="button"
									onClick={() => setPrompt('Design a mounting bracket with 4 counterbore holes and center cut-out.')}
									className="w-full px-3.5 py-2.5 rounded-xl border border-[var(--ui-border)] bg-[var(--ui-input)] hover:border-[var(--ui-border-strong)] text-left text-xs transition-all flex items-center justify-between gap-2 cursor-pointer group shadow-sm"
								>
									<div className="flex items-center gap-2.5 min-w-0">
										<div className="size-6 rounded-lg bg-[var(--ui-panel)] border border-[var(--ui-border-ctrl)] text-[var(--ui-accent)] flex items-center justify-center shrink-0">
											<Ruler className="size-3.5" />
										</div>
										<span className="truncate font-medium text-[11.5px] text-[var(--ui-text-primary)]">
											Mounting Bracket with Holes
										</span>
									</div>
									<ChevronRight className="size-3.5 text-[var(--ui-text-muted)] group-hover:text-[var(--ui-text-primary)] shrink-0" />
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
											const found = allPortions.find(
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
								<div className="flex items-center gap-2.5 p-3 rounded-xl bg-[var(--ui-input)] border border-[var(--ui-border)] text-[var(--ui-text-secondary)] text-xs">
									<RefreshCw className="size-3.5 animate-spin text-[var(--ui-accent)]" />
									<span>Computing CAD Geometry & B-Rep Topology...</span>
								</div>
							)}
							<div ref={scrollRef} />
						</div>
					)}
				</div>

				{/* Floating Command Input Dock */}
				<div className="shrink-0 p-3 border-t border-[var(--ui-border)] bg-[var(--ui-panel)]">
					<form onSubmit={onSubmit} className="flex flex-col gap-2">
						{/* Target Feature Pill (When Model Active) */}
						{hasActiveModel && (
							<div className="flex items-center justify-between gap-2">
								<div className="relative">
									<button
										type="button"
										onClick={() => setIsPortionPickerOpen(!isPortionPickerOpen)}
										className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-mono font-semibold transition-all border cursor-pointer ${
											targetPortion
												? 'bg-[var(--ui-input)] border-[var(--ui-accent)] text-[var(--ui-accent)]'
												: 'bg-[var(--ui-input)] border-[var(--ui-border-ctrl)] text-[var(--ui-text-secondary)] hover:text-[var(--ui-text-primary)]'
										}`}
										title="Target specific CAD feature"
									>
										<Target className={`size-3 ${targetPortion ? 'text-[var(--ui-accent)]' : 'text-[var(--ui-text-muted)]'}`} />
										<span className="truncate max-w-[150px]">
											{targetPortion ? targetPortion.name : 'Target: Whole Model'}
										</span>
										<ChevronDown className="size-2.5 opacity-60 ml-0.5" />
									</button>

									{/* Dropdown Menu for CAD Portions */}
									{isPortionPickerOpen && (
										<div className="absolute bottom-full left-0 mb-2 w-80 rounded-2xl border border-[var(--ui-border)] bg-[var(--ui-panel)] shadow-2xl p-2 z-50 space-y-1.5 animate-in fade-in zoom-in-95 duration-150 text-[var(--ui-text-primary)]">
											<div className="flex items-center justify-between px-2 py-1 border-b border-[var(--ui-border)] text-[10px] font-bold uppercase tracking-wider text-[var(--ui-text-muted)] font-mono">
												<span>Select CAD Feature Focus</span>
												<button
													type="button"
													onClick={() => setIsPortionPickerOpen(false)}
													className="text-[var(--ui-text-muted)] hover:text-[var(--ui-text-primary)] p-0.5 cursor-pointer"
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
												className="w-full text-left px-2.5 py-1.5 rounded-lg text-xs hover:bg-[var(--ui-hover)] text-[var(--ui-text-primary)] flex items-center justify-between cursor-pointer"
											>
												<div className="flex items-center gap-1.5">
													<Cuboid className="size-3.5 text-[var(--ui-accent)]" />
													<span className="font-semibold">Whole Model (Default)</span>
												</div>
												{!targetPortion && <Check className="size-3 text-[var(--ui-accent)]" />}
											</button>

											<div className="max-h-60 overflow-y-auto space-y-2 no-scrollbar pr-0.5">
												{/* 1. Recognized Model Features */}
												<div>
													<div className="px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-[var(--ui-text-muted)] font-mono flex items-center gap-1">
														<span className="size-1.5 rounded-full bg-[var(--ui-accent)]" />
														<span>Active Model Features ({existingPortions.length})</span>
													</div>
													<div className="mt-1 space-y-0.5">
														{existingPortions.map((p) => (
															<button
																key={p.id}
																type="button"
																onClick={() => handleSelectPortion(p)}
																className={`w-full text-left px-2.5 py-1.5 rounded-lg text-xs transition-colors flex items-center justify-between cursor-pointer ${
																	targetPortion?.id === p.id
																		? 'bg-[var(--ui-input)] text-[var(--ui-accent)] font-bold border border-[var(--ui-accent)]'
																		: 'hover:bg-[var(--ui-hover)] text-[var(--ui-text-secondary)] hover:text-[var(--ui-text-primary)]'
																}`}
															>
																<div className="flex flex-col truncate pr-2">
																	<span className="truncate font-medium text-[var(--ui-text-primary)]">{p.name}</span>
																	{p.description && (
																		<span className="text-[10px] text-[var(--ui-text-muted)] truncate">{p.description}</span>
																	)}
																</div>
																{targetPortion?.id === p.id && <Check className="size-3 text-[var(--ui-accent)] shrink-0" />}
															</button>
														))}
													</div>
												</div>

												{/* 2. Add New Feature Templates */}
												<div className="pt-1 border-t border-[var(--ui-border)]">
													<div className="px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-[var(--ui-text-muted)] font-mono flex items-center gap-1">
														<Plus className="size-2.5 text-[var(--ui-accent)]" />
														<span>Add Missing Feature</span>
													</div>
													<div className="mt-1 space-y-0.5">
														{newFeaturePortions.map((p) => (
															<button
																key={p.id}
																type="button"
																onClick={() => handleSelectPortion(p)}
																className={`w-full text-left px-2.5 py-1.5 rounded-lg text-xs transition-colors flex items-center justify-between cursor-pointer ${
																	targetPortion?.id === p.id
																		? 'bg-[var(--ui-input)] text-[var(--ui-accent)] font-bold border border-[var(--ui-accent)]'
																		: 'hover:bg-[var(--ui-hover)] text-[var(--ui-text-secondary)] hover:text-[var(--ui-text-primary)]'
																}`}
															>
																<div className="flex flex-col truncate pr-2">
																	<span className="truncate font-medium text-[var(--ui-text-primary)]">{p.name}</span>
																	{p.description && (
																		<span className="text-[10px] text-[var(--ui-text-muted)] truncate">{p.description}</span>
																	)}
																</div>
																{targetPortion?.id === p.id && <Check className="size-3 text-[var(--ui-accent)] shrink-0" />}
															</button>
														))}
													</div>
												</div>
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
										className="text-[10px] text-[var(--ui-text-muted)] hover:text-rose-400 flex items-center gap-1 transition-colors px-1.5 py-0.5 rounded cursor-pointer"
										title="Clear targeted portion"
									>
										<X className="size-3" />
										<span>Clear</span>
									</button>
								)}
							</div>
						)}

						{/* Attached File Preview */}
						{selectedFile && (
							<div className="flex items-center gap-2 rounded-lg border border-[var(--ui-border-ctrl)] bg-[var(--ui-input)] px-2.5 py-1 text-xs text-[var(--ui-text-primary)] font-mono">
								<Paperclip className="size-3.5 shrink-0 text-[var(--ui-accent)]" />
								<span className="truncate flex-1 font-medium">{selectedFile.name}</span>
								<button
									type="button"
									onClick={() => handleFileChange(null)}
									className="p-0.5 hover:text-rose-400 transition-colors cursor-pointer"
								>
									<X className="size-3.5" />
								</button>
							</div>
						)}

						{/* 3D Coordinate Targeting Chip */}
						{selectionContext && (
							<div className="flex items-center gap-2 rounded-lg border border-[var(--ui-border-ctrl)] bg-[var(--ui-input)] px-2.5 py-1 text-xs text-[var(--ui-text-primary)] font-mono">
								<Crosshair className="size-3.5 shrink-0 text-rose-400" />
								<span className="truncate flex-1">
									Target [{selectionContext[0].toFixed(1)}, {selectionContext[1].toFixed(1)}, {selectionContext[2].toFixed(1)}]
								</span>
								<button
									type="button"
									onClick={onClearSelectionContext}
									className="p-0.5 hover:text-rose-400 transition-colors cursor-pointer"
								>
									<X className="size-3.5" />
								</button>
							</div>
						)}

						{/* Secondary bar: model select + file attach */}
						<div className="flex items-center justify-between gap-2 px-1">
							<div className="flex items-center gap-1.5">
								<Select value={selectedModel} onValueChange={(val: string | null) => val && setSelectedModel(val)}>
									<SelectTrigger className="ui-btn ui-btn--ghost !h-7 !px-2 text-[11px] font-mono gap-1.5 cursor-pointer">
										<Sparkles className="size-3 text-[var(--ui-accent)]" />
										<SelectValue placeholder="Model" />
									</SelectTrigger>
									<SelectContent className="rounded-xl border border-[var(--ui-border)] bg-[var(--ui-panel)] text-xs z-50 text-[var(--ui-text-primary)]">
										{modelOptions.map((opt) => (
											<SelectItem key={opt.value} value={opt.value} className="text-xs font-mono">
												{opt.label}
											</SelectItem>
										))}
									</SelectContent>
								</Select>

								<label
									className={`ui-btn ui-btn--ghost !h-7 !w-7 !p-0 cursor-pointer flex items-center justify-center ${
										selectedFile ? 'border-[var(--ui-accent)] text-[var(--ui-accent)]' : ''
									}`}
									title="Attach blueprint (PDF/PNG/JPG) or 3D solid model (.STEP, .STP)"
								>
									<Paperclip className="size-3.5" />
									<input
										ref={fileInputRef}
										type="file"
										accept="image/png,image/jpeg,image/webp,application/pdf,.step,.stp"
										className="hidden"
										onChange={(e) => {
											const file = e.target.files?.[0] || null;
											if (file) {
												const isStep = file.name.toLowerCase().endsWith('.step') || file.name.toLowerCase().endsWith('.stp');
												const maxLimit = isStep ? 50 * 1024 * 1024 : 10 * 1024 * 1024;
												if (file.size > maxLimit) {
													alert(`File size exceeds the ${isStep ? '50MB' : '10MB'} limit.`);
													e.target.value = '';
													return;
												}
											}
											handleFileChange(file);
										}}
									/>
								</label>
							</div>
						</div>

						{/* Main Rounded Prompt Box */}
						<div className="ui-prompt">
							<textarea
								ref={textareaRef}
								value={prompt}
								onChange={(e) => {
									setPrompt(e.target.value);
									if (textareaRef.current) {
										textareaRef.current.style.height = 'auto';
										textareaRef.current.style.height = `${Math.min(120, textareaRef.current.scrollHeight)}px`;
									}
								}}
								onKeyDown={(e) => {
									if (e.key === 'Enter' && !e.shiftKey) {
										e.preventDefault();
										if ((prompt.trim() || selectedFile) && !isGenerating) {
											onSubmit(e as any);
										}
									}
								}}
								rows={1}
								placeholder={
									targetPortion
										? `Describe revisions for ${targetPortion.name}...`
										: hasActiveModel
											? "Iterate on geometry..."
											: "Ask VEXCAD AI or describe your part..."
								}
							/>

							<button
								type="submit"
								disabled={isGenerating || (!prompt.trim() && !selectedFile)}
								className="ui-prompt-send"
								title="Send instruction to AI CAD (Enter)"
							>
								{isGenerating ? (
									<Loader2 size={15} className="animate-spin" />
								) : (
									<SendHorizontal size={15} />
								)}
							</button>
						</div>
					</form>
				</div>
			</div>
		</>
	);
}
