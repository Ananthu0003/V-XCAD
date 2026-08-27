'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { 
	Sparkles, X, Send, Camera, RefreshCw, Copy, Check, 
	ArrowUpRight, AlertCircle, AlertTriangle, Trash2, Eye, FileImage, Plus, Bot, Layers,
	ZoomIn, ZoomOut, RotateCcw, Crop, CheckCircle2, Maximize2, Move
} from 'lucide-react';
import { toast } from 'sonner';

export type DiscrepancyItem = {
	feature: string;
	location?: string;
	issue: string;
	action?: string;
};

export type UnsupportedClaimItem = {
	claim?: string;
	feature?: string;
	reason?: string;
	issue?: string;
};

export type BlueprintFeatureItem = {
	name: string;
	callout?: string;
	specification?: string;
	description?: string;
	status?: string;
	action?: string;
	location?: string;
};

export type AssistantAnalysis = {
	object_name?: string;
	blueprint_features?: BlueprintFeatureItem[];
	unsupported_or_invalid_claims?: UnsupportedClaimItem[];
	discrepancies?: DiscrepancyItem[];
	reply?: string;
	suggested_prompt?: string;
};

export type ChatMessage = {
	id: string;
	role: 'user' | 'assistant';
	content: string;
	analysis?: AssistantAnalysis | null;
	suggested_prompt?: string | null;
	timestamp: number;
};

interface PromptAssistantWidgetProps {
	blueprintUrl?: string | null;
	sessionId?: string | null;
	onApplyPrompt?: (prompt: string) => void;
}

interface CropBoxPercent {
	x: number; // percentage (0-100)
	y: number; // percentage (0-100)
	width: number; // percentage (10-100)
	height: number; // percentage (10-100)
}

const INITIAL_ASSISTANT_MESSAGE: ChatMessage = {
	id: 'welcome',
	role: 'assistant',
	content: "Capture 3D camera angles below or describe missing features. I'll inspect the blueprint and generate your next precision CAD prompt.",
	timestamp: Date.now(),
};

export function PromptAssistantWidget({
	blueprintUrl,
	sessionId,
	onApplyPrompt,
}: PromptAssistantWidgetProps) {
	const [isOpen, setIsOpen] = useState(false);
	const [inputMessage, setInputMessage] = useState('');
	const [isLoading, setIsLoading] = useState(false);
	const [copiedId, setCopiedId] = useState<string | null>(null);
	const [appliedId, setAppliedId] = useState<string | null>(null);
	const [capturedSnapshots, setCapturedSnapshots] = useState<string[]>([]);
	
	// Cropped & Target Region Blueprint state
	const [croppedBlueprintUrl, setCroppedBlueprintUrl] = useState<string | null>(null);

	// Lightbox & Cropper state
	const [previewModal, setPreviewModal] = useState<{ url: string; title: string; isBlueprint?: boolean } | null>(null);
	const [zoomLevel, setZoomLevel] = useState<number>(1);
	const [panOffset, setPanOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
	const [isPanning, setIsPanning] = useState<boolean>(false);
	const panStartRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

	// Crop box state (percentages 0-100 of the visible image)
	const [isCroppingMode, setIsCroppingMode] = useState<boolean>(false);
	const [cropBox, setCropBox] = useState<CropBoxPercent>({ x: 20, y: 20, width: 60, height: 60 });
	const [activeDragHandle, setActiveDragHandle] = useState<string | null>(null); // 'move' | 'nw' | 'ne' | 'sw' | 'se' | 'draw'
	const dragStartRef = useRef<{ clientX: number; clientY: number; initialBox: CropBoxPercent }>({
		clientX: 0,
		clientY: 0,
		initialBox: { x: 20, y: 20, width: 60, height: 60 },
	});

	const imgWrapperRef = useRef<HTMLDivElement>(null);
	const imgRef = useRef<HTMLImageElement>(null);

	const [messages, setMessages] = useState<ChatMessage[]>([INITIAL_ASSISTANT_MESSAGE]);

	// Auto-reset when project/session is cleared or workspace is reset
	useEffect(() => {
		if (!blueprintUrl && !sessionId) {
			setMessages([
				{
					...INITIAL_ASSISTANT_MESSAGE,
					timestamp: Date.now(),
				}
			]);
			setCapturedSnapshots([]);
			setCroppedBlueprintUrl(null);
			setInputMessage('');
		}
	}, [blueprintUrl, sessionId]);

	const handleClearAssistantChat = () => {
		setMessages([
			{
				...INITIAL_ASSISTANT_MESSAGE,
				timestamp: Date.now(),
			}
		]);
		setCapturedSnapshots([]);
		setCroppedBlueprintUrl(null);
		setInputMessage('');
		toast.info('Prompt Assistant chat reset.');
	};

	const chatEndRef = useRef<HTMLDivElement>(null);

	// Auto-scroll chat stream
	useEffect(() => {
		if (isOpen) {
			chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
		}
	}, [messages, isOpen]);

	// Robust Canvas Capture
	const captureCanvasSnapshot = (showToast = false): string | null => {
		try {
			let canvas: HTMLCanvasElement | null =
				typeof window !== 'undefined' ? (window as any).__VEXCAD_CANVAS__ || null : null;

			if (!canvas || !(canvas instanceof HTMLCanvasElement)) {
				const container = document.getElementById('cad-three-canvas');
				if (container) {
					canvas =
						container.querySelector('canvas') ||
						(container instanceof HTMLCanvasElement ? container : null);
				}
			}

			if (!canvas || !(canvas instanceof HTMLCanvasElement)) {
				const allCanvases = document.querySelectorAll('canvas');
				let maxArea = 0;
				allCanvases.forEach((c) => {
					if (c instanceof HTMLCanvasElement) {
						const area = (c.width || c.clientWidth || 0) * (c.height || c.clientHeight || 0);
						if (area > maxArea) {
							maxArea = area;
							canvas = c;
						}
					}
				});
			}

			if (canvas && canvas instanceof HTMLCanvasElement) {
				const dataUrl = canvas.toDataURL('image/png');
				setCapturedSnapshots((prev) => {
					if (prev.length >= 6) {
						toast.info('Max 6 view angles reached. Replaced oldest.');
						return [...prev.slice(1), dataUrl];
					}
					return [...prev, dataUrl];
				});

				if (showToast) {
					toast.success(`View Angle #${capturedSnapshots.length + 1} captured!`);
				}
				return dataUrl;
			} else {
				if (showToast) {
					toast.error('No 3D CAD model found in viewport. Generate a model first.');
				}
			}
		} catch (err: any) {
			console.error('[PromptAssistant] Canvas capture failed:', err);
			if (showToast) {
				toast.error(`Snapshot failed: ${err?.message || 'Canvas error'}`);
			}
		}
		return null;
	};

	const deleteSnapshotAt = (index: number) => {
		setCapturedSnapshots((prev) => prev.filter((_, i) => i !== index));
		toast.info(`Angle #${index + 1} deleted.`);
	};

	// Auto-capture initial view on open if none exist
	useEffect(() => {
		if (isOpen && capturedSnapshots.length === 0) {
			captureCanvasSnapshot(false);
		}
	}, [isOpen]);

	// Open Lightbox Modal with reset controls
	const openLightbox = (url: string, title: string, isBlueprint = false) => {
		setPreviewModal({ url, title, isBlueprint });
		setZoomLevel(1);
		setPanOffset({ x: 0, y: 0 });
		setIsCroppingMode(false);
		setCropBox({ x: 20, y: 20, width: 60, height: 60 });
	};

	// Toggle Cropping Mode
	const toggleCroppingMode = () => {
		if (!isCroppingMode) {
			// Entering crop mode -> Reset zoom and pan for clear bounding box placement
			setZoomLevel(1);
			setPanOffset({ x: 0, y: 0 });
			setCropBox({ x: 20, y: 20, width: 60, height: 60 });
			setIsCroppingMode(true);
		} else {
			setIsCroppingMode(false);
		}
	};

	// Apply Cropped Selection to Canvas
	const applyCropSelection = () => {
		if (!imgRef.current) {
			toast.error('No blueprint image available to crop.');
			return;
		}

		try {
			const img = imgRef.current;
			const naturalW = img.naturalWidth || img.width;
			const naturalH = img.naturalHeight || img.height;

			// Convert percentage cropBox to exact natural image pixel coordinates
			const sx = Math.round((cropBox.x / 100) * naturalW);
			const sy = Math.round((cropBox.y / 100) * naturalH);
			const sWidth = Math.round((cropBox.width / 100) * naturalW);
			const sHeight = Math.round((cropBox.height / 100) * naturalH);

			if (sWidth < 20 || sHeight < 20) {
				toast.error('Selected crop region is too small.');
				return;
			}

			const offscreenCanvas = document.createElement('canvas');
			offscreenCanvas.width = sWidth;
			offscreenCanvas.height = sHeight;
			const ctx = offscreenCanvas.getContext('2d');

			if (ctx) {
				ctx.drawImage(img, sx, sy, sWidth, sHeight, 0, 0, sWidth, sHeight);
				const croppedData = offscreenCanvas.toDataURL('image/png');
				setCroppedBlueprintUrl(croppedData);
				setPreviewModal(null);
				setIsCroppingMode(false);
				toast.success('Cropped blueprint section set as active target!');
			}
		} catch (err: any) {
			console.error('Failed to crop blueprint image:', err);
			toast.error('Could not crop image. Check permissions.');
		}
	};

	// Handle Mouse Down on Crop Handles / Box
	const handleCropMouseDown = (e: React.MouseEvent, handle: string) => {
		e.stopPropagation();
		setActiveDragHandle(handle);
		dragStartRef.current = {
			clientX: e.clientX,
			clientY: e.clientY,
			initialBox: { ...cropBox },
		};
	};

	// Global Mouse Move & Up for Smooth Dragging
	useEffect(() => {
		const handleMouseMove = (e: MouseEvent) => {
			if (!activeDragHandle || !imgWrapperRef.current) return;

			const wrapperRect = imgWrapperRef.current.getBoundingClientRect();
			if (wrapperRect.width === 0 || wrapperRect.height === 0) return;

			const dxPercent = ((e.clientX - dragStartRef.current.clientX) / wrapperRect.width) * 100;
			const dyPercent = ((e.clientY - dragStartRef.current.clientY) / wrapperRect.height) * 100;
			const initial = dragStartRef.current.initialBox;

			setCropBox(() => {
				let nextX = initial.x;
				let nextY = initial.y;
				let nextW = initial.width;
				let nextH = initial.height;

				if (activeDragHandle === 'move') {
					nextX = Math.max(0, Math.min(100 - initial.width, initial.x + dxPercent));
					nextY = Math.max(0, Math.min(100 - initial.height, initial.y + dyPercent));
				} else if (activeDragHandle === 'se') {
					nextW = Math.max(10, Math.min(100 - initial.x, initial.width + dxPercent));
					nextH = Math.max(10, Math.min(100 - initial.y, initial.height + dyPercent));
				} else if (activeDragHandle === 'sw') {
					const potentialW = initial.width - dxPercent;
					if (potentialW >= 10 && initial.x + dxPercent >= 0) {
						nextX = initial.x + dxPercent;
						nextW = potentialW;
					}
					nextH = Math.max(10, Math.min(100 - initial.y, initial.height + dyPercent));
				} else if (activeDragHandle === 'ne') {
					nextW = Math.max(10, Math.min(100 - initial.x, initial.width + dxPercent));
					const potentialH = initial.height - dyPercent;
					if (potentialH >= 10 && initial.y + dyPercent >= 0) {
						nextY = initial.y + dyPercent;
						nextH = potentialH;
					}
				} else if (activeDragHandle === 'nw') {
					const potentialW = initial.width - dxPercent;
					if (potentialW >= 10 && initial.x + dxPercent >= 0) {
						nextX = initial.x + dxPercent;
						nextW = potentialW;
					}
					const potentialH = initial.height - dyPercent;
					if (potentialH >= 10 && initial.y + dyPercent >= 0) {
						nextY = initial.y + dyPercent;
						nextH = potentialH;
					}
				}

				return { x: nextX, y: nextY, width: nextW, height: nextH };
			});
		};

		const handleMouseUp = () => {
			if (activeDragHandle) {
				setActiveDragHandle(null);
			}
		};

		if (activeDragHandle) {
			window.addEventListener('mousemove', handleMouseMove);
			window.addEventListener('mouseup', handleMouseUp);
		}
		return () => {
			window.removeEventListener('mousemove', handleMouseMove);
			window.removeEventListener('mouseup', handleMouseUp);
		};
	}, [activeDragHandle]);

	const handleSendMessage = async (customText?: string) => {
		const activeBlueprint = croppedBlueprintUrl || blueprintUrl;
		const text = (customText || inputMessage).trim();
		if (!text && !activeBlueprint && capturedSnapshots.length === 0) {
			toast.error('Please enter a message or capture at least one 3D view.');
			return;
		}

		const userMsg: ChatMessage = {
			id: `user_${Date.now()}`,
			role: 'user',
			content: text || (croppedBlueprintUrl ? '🔍 Inspect Cropped Blueprint Region vs 3D Model' : '🔍 Compare Blueprint vs 3D Model'),
			timestamp: Date.now(),
		};

		setMessages((prev) => [...prev, userMsg]);
		setInputMessage('');
		setIsLoading(true);

		try {
			let blueprintBase64 = activeBlueprint || null;
			if (activeBlueprint && !activeBlueprint.startsWith('data:')) {
				try {
					const resp = await fetch(activeBlueprint);
					const blob = await resp.blob();
					blueprintBase64 = await new Promise<string>((resolve) => {
						const reader = new FileReader();
						reader.onloadend = () => resolve(reader.result as string);
						reader.readAsDataURL(blob);
					});
				} catch (e) {
					console.warn('Could not fetch blueprint blob:', e);
				}
			}

			const historyPayload = messages.slice(-6).map((m) => ({
				role: m.role,
				content: m.content,
			}));

			const res = await fetch('/api/assistant/compare', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					blueprint_image: blueprintBase64,
					model_snapshots: capturedSnapshots,
					message: croppedBlueprintUrl
						? `${text} (Note: Inspecting the specifically zoomed-in/cropped section of the blueprint).`
						: text,
					history: historyPayload,
				}),
			});

			if (!res.ok) {
				const errData = await res.json();
				throw new Error(errData.error || `Server returned ${res.status}`);
			}

			const data = await res.json();

			const botMsg: ChatMessage = {
				id: `bot_${Date.now()}`,
				role: 'assistant',
				content: data.reply || 'Comparison complete.',
				analysis: data.analysis,
				suggested_prompt: data.suggested_prompt,
				timestamp: Date.now(),
			};

			setMessages((prev) => [...prev, botMsg]);
		} catch (err: any) {
			toast.error(`Assistant error: ${err.message}`);
			setMessages((prev) => [
				...prev,
				{
					id: `err_${Date.now()}`,
					role: 'assistant',
					content: `⚠️ Failed to analyze: ${err.message}. Check your API keys in .env.`,
					timestamp: Date.now(),
				},
			]);
		} finally {
			setIsLoading(false);
		}
	};

	const handleCopy = (id: string, text: string) => {
		navigator.clipboard.writeText(text);
		setCopiedId(id);
		toast.success('Prompt copied to clipboard!');
		setTimeout(() => setCopiedId(null), 2000);
	};

	const handleApply = (id: string, promptText: string) => {
		if (onApplyPrompt) {
			onApplyPrompt(promptText);
			setAppliedId(id);
			toast.success('Applied to CAD generator!');
			setTimeout(() => setAppliedId(null), 2500);
		} else {
			handleCopy(id, promptText);
		}
	};

	return (
		<div className="relative inline-block font-sans">
			{/* Trigger Button Stacked Above ThemeToggle */}
			<button
				type="button"
				onClick={() => setIsOpen(!isOpen)}
				aria-label="Toggle AI Prompt Assistant"
				className={`relative group flex items-center justify-center size-11 rounded-full transition-all duration-300 shadow-2xl border cursor-pointer ${
					isOpen
						? 'bg-cyan-500/20 border-cyan-400 text-cyan-300 shadow-[0_0_25px_rgba(34,211,238,0.55)] ring-2 ring-cyan-400/40'
						: 'bg-[#0a101f]/95 hover:bg-[#111c33] border-cyan-500/30 hover:border-cyan-400 text-cyan-400 hover:text-cyan-200 shadow-[0_4px_25px_rgba(0,0,0,0.6),0_0_15px_rgba(34,211,238,0.2)]'
				}`}
				title="AI Prompt Assistant Robot"
			>
				{/* Animated Robot Icon */}
				<div className="relative flex items-center justify-center">
					<Bot className="size-5 transition-transform duration-300 group-hover:scale-110 group-hover:rotate-6 text-cyan-400 group-hover:text-cyan-300" />
					
					{/* Robot Eye Blink Glow Animation */}
					<span className="absolute top-[5px] left-[4px] size-1 rounded-full bg-cyan-300 shadow-[0_0_4px_#22d3ee] animate-ping opacity-75 pointer-events-none" />
					<span className="absolute top-[5px] right-[4px] size-1 rounded-full bg-cyan-300 shadow-[0_0_4px_#22d3ee] animate-ping opacity-75 pointer-events-none" />
				</div>

				{!isOpen && (
					<span className="absolute -top-1 -right-1 flex h-2.5 w-2.5">
						<span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
						<span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-cyan-500 shadow-[0_0_6px_rgba(34,211,238,1)]"></span>
					</span>
				)}
			</button>

			{/* Floating Chatbox Panel */}
			{isOpen && (
				<div
					className="fixed bottom-20 right-6 z-50 w-[450px] max-w-[calc(100vw-32px)] h-[620px] max-h-[calc(100vh-100px)] flex flex-col rounded-2xl border border-cyan-500/25 bg-[#090d16]/95 backdrop-blur-2xl shadow-[0_25px_70px_rgba(0,0,0,0.85),0_0_40px_rgba(34,211,238,0.12)] overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-200"
				>
					{/* Top Ambient Glow Line */}
					<div className="h-[2px] w-full bg-gradient-to-r from-transparent via-cyan-400/80 to-transparent" />

					{/* Header */}
					<div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.08] bg-white/[0.02]">
						<div className="flex items-center gap-2.5">
							<div className="size-8 rounded-xl bg-gradient-to-br from-cyan-500/20 to-blue-600/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400 shadow-[0_0_15px_rgba(34,211,238,0.2)]">
								<Bot className="size-4.5" />
							</div>
							<div>
								<div className="flex items-center gap-2">
									<span className="text-[13px] font-extrabold tracking-wider text-white font-mono">
										PROMPT ASSISTANT
									</span>
									<span className="px-1.5 py-0.5 text-[8.5px] font-black uppercase tracking-widest rounded bg-cyan-400/15 text-cyan-300 border border-cyan-400/30">
										AI
									</span>
								</div>
								<p className="text-[10.5px] text-muted-foreground/80 leading-none mt-0.5">
									Iterative Blueprint vs. 3D Model Discrepancy
								</p>
							</div>
						</div>

						<div className="flex items-center gap-1">
							<button
								type="button"
								onClick={() => captureCanvasSnapshot(true)}
								className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/30 hover:border-cyan-400/60 text-cyan-300 transition-all font-medium cursor-pointer shadow-[0_0_12px_rgba(34,211,238,0.1)]"
								title="Capture current 3D viewport angle"
							>
								<Camera className="size-3.5 text-cyan-400" />
								<span>+ Snap</span>
							</button>
							<button
								type="button"
								onClick={handleClearAssistantChat}
								className="p-1.5 rounded-lg text-muted-foreground hover:text-rose-400 hover:bg-white/5 transition-colors cursor-pointer"
								title="Clear Prompt Assistant chat"
							>
								<Trash2 className="size-4" />
							</button>
							<button
								type="button"
								onClick={() => setIsOpen(false)}
								className="p-1.5 rounded-lg text-muted-foreground hover:text-white hover:bg-white/5 transition-colors cursor-pointer"
							>
								<X className="size-4" />
							</button>
						</div>
					</div>

					{/* Visual Context Ribbon (Blueprint + Multi-Angle 3D Gallery) */}
					<div className="px-4 py-2.5 border-b border-white/[0.06] bg-black/30">
						<div className="flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar">
							{/* 1. Blueprint Card */}
							<div className="flex items-center gap-2 px-2 py-1.5 rounded-xl border border-white/[0.08] bg-white/[0.02] shrink-0">
								{blueprintUrl ? (
									<div
										onClick={() => openLightbox(croppedBlueprintUrl || blueprintUrl, '2D Reference Blueprint', true)}
										className="relative size-8 rounded-lg overflow-hidden border border-emerald-400/50 bg-black/60 shrink-0 cursor-pointer group shadow-[0_0_10px_rgba(52,211,153,0.15)]"
										title="Click to zoom / crop blueprint"
									>
										{/* eslint-disable-next-line @next/next/no-img-element */}
										<img src={croppedBlueprintUrl || blueprintUrl} alt="Blueprint" className="w-full h-full object-cover" />
										<div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
											<Eye className="size-3 text-white" />
										</div>
									</div>
								) : (
									<div className="size-8 rounded-lg border border-dashed border-white/15 flex items-center justify-center text-muted-foreground/40 shrink-0">
										<FileImage className="size-3.5" />
									</div>
								)}
								<div className="pr-1 text-left">
									<div className="flex items-center gap-1">
										<span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
											{croppedBlueprintUrl ? 'Target Crop' : 'Blueprint'}
										</span>
										{croppedBlueprintUrl && (
											<button
												type="button"
												onClick={(e) => {
													e.stopPropagation();
													setCroppedBlueprintUrl(null);
													toast.info('Reverted to full blueprint.');
												}}
												className="text-muted-foreground hover:text-amber-300 text-[8.5px] underline cursor-pointer"
												title="Reset back to full blueprint"
											>
												Reset
											</button>
										)}
									</div>
									<div className="text-[10px] font-semibold text-white/90">
										{blueprintUrl ? (croppedBlueprintUrl ? 'Cropped Detail' : 'Full Sheet') : 'None'}
									</div>
								</div>
							</div>

							<div className="w-px h-6 bg-white/10 shrink-0" />

							{/* 2. Captured 3D View Angles */}
							{capturedSnapshots.map((snapUrl, idx) => (
								<div
									key={idx}
									className="relative flex items-center gap-2 px-2 py-1.5 rounded-xl border border-cyan-500/30 bg-cyan-500/[0.04] shrink-0 group"
								>
									<div
										onClick={() => openLightbox(snapUrl, `3D Model Angle #${idx + 1}`, false)}
										className="relative size-8 rounded-lg overflow-hidden border border-cyan-400/80 bg-black shrink-0 cursor-pointer shadow-[0_0_10px_rgba(34,211,238,0.25)]"
										title={`Click to preview View #${idx + 1}`}
									>
										{/* eslint-disable-next-line @next/next/no-img-element */}
										<img src={snapUrl} alt={`Snap #${idx + 1}`} className="w-full h-full object-cover" />
										<div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
											<Eye className="size-3 text-white" />
										</div>
									</div>

									<div className="text-left pr-0.5">
										<div className="text-[9px] font-extrabold uppercase tracking-wider text-cyan-300 font-mono">
											View #{idx + 1}
										</div>
										<button
											type="button"
											onClick={() => deleteSnapshotAt(idx)}
											className="text-[9.5px] text-muted-foreground/80 hover:text-rose-400 flex items-center gap-0.5 transition-colors cursor-pointer mt-0.5"
										>
											<Trash2 className="size-2.5" />
											<span>Remove</span>
										</button>
									</div>
								</div>
							))}

							{/* Add Angle Button */}
							{capturedSnapshots.length < 6 && (
								<button
									type="button"
									onClick={() => captureCanvasSnapshot(true)}
									className="flex items-center gap-1.5 px-2.5 py-2 rounded-xl border border-dashed border-cyan-500/30 hover:border-cyan-400 bg-cyan-500/[0.03] hover:bg-cyan-500/[0.08] text-cyan-300 text-[10.5px] font-medium transition-all shrink-0 cursor-pointer"
									title="Rotate 3D model and click to add angle"
								>
									<Plus className="size-3 text-cyan-400" />
									<span>Add Angle</span>
								</button>
							)}
						</div>
					</div>

					{/* Image Lightbox & Interactive Zoom / Pan / Crop Modal */}
					{previewModal && (
						<div className="absolute inset-0 z-50 bg-black/95 backdrop-blur-xl flex flex-col p-4 animate-in fade-in duration-150 select-none">
							{/* Lightbox Toolbar */}
							<div className="flex items-center justify-between pb-3 border-b border-white/10 text-xs">
								<div className="flex items-center gap-2">
									<span className="font-bold text-white font-mono">{previewModal.title}</span>
									{previewModal.isBlueprint && (
										<span className="text-[10px] text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20">
											Interactive Blueprint
										</span>
									)}
								</div>

								{/* Control Actions: Zoom / Pan / Crop */}
								<div className="flex items-center gap-1.5">
									{/* Zoom Controls (Always Available) */}
									<div className="flex items-center bg-white/5 border border-white/10 rounded-lg p-0.5">
										<button
											type="button"
											onClick={() => setZoomLevel((z) => Math.max(0.5, z - 0.25))}
											className="p-1 hover:bg-white/10 text-muted-foreground hover:text-white rounded transition-colors cursor-pointer"
											title="Zoom Out"
										>
											<ZoomOut className="size-3.5" />
										</button>
										<span className="px-1.5 text-[10px] font-mono text-muted-foreground min-w-[36px] text-center">
											{Math.round(zoomLevel * 100)}%
										</span>
										<button
											type="button"
											onClick={() => setZoomLevel((z) => Math.min(4, z + 0.25))}
											className="p-1 hover:bg-white/10 text-muted-foreground hover:text-white rounded transition-colors cursor-pointer"
											title="Zoom In"
										>
											<ZoomIn className="size-3.5" />
										</button>
										<button
											type="button"
											onClick={() => {
												setZoomLevel(1);
												setPanOffset({ x: 0, y: 0 });
											}}
											className="p-1 hover:bg-white/10 text-muted-foreground hover:text-white rounded transition-colors cursor-pointer border-l border-white/10 ml-0.5"
											title="Reset Zoom & Pan"
										>
											<RotateCcw className="size-3" />
										</button>
									</div>

									{/* Crop Region Tool Toggle */}
									{previewModal.isBlueprint && (
										<button
											type="button"
											onClick={toggleCroppingMode}
											className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold border transition-all cursor-pointer ${
												isCroppingMode
													? 'bg-cyan-400 text-black border-cyan-300 shadow-[0_0_12px_rgba(34,211,238,0.4)]'
													: 'bg-white/5 hover:bg-white/10 border-white/15 text-white'
											}`}
										>
											<Crop className="size-3.5" />
											<span>{isCroppingMode ? 'Cancel Crop' : 'Crop Section'}</span>
										</button>
									)}

									<button
										type="button"
										onClick={() => {
											setPreviewModal(null);
											setIsCroppingMode(false);
										}}
										className="p-1.5 rounded-lg text-muted-foreground hover:text-white bg-white/5 hover:bg-white/10 cursor-pointer ml-1"
									>
										<X className="size-4" />
									</button>
								</div>
							</div>

							{/* Interactive Canvas & Image Area */}
							<div
								onWheel={(e) => {
									e.preventDefault();
									const delta = e.deltaY > 0 ? -0.15 : 0.15;
									setZoomLevel((z) => Math.min(4, Math.max(0.5, z + delta)));
								}}
								onMouseDown={(e) => {
									if (!activeDragHandle && zoomLevel > 1) {
										setIsPanning(true);
										panStartRef.current = {
											x: e.clientX - panOffset.x,
											y: e.clientY - panOffset.y,
										};
									}
								}}
								onMouseMove={(e) => {
									if (isPanning && !activeDragHandle) {
										setPanOffset({
											x: e.clientX - panStartRef.current.x,
											y: e.clientY - panStartRef.current.y,
										});
									}
								}}
								onMouseUp={() => {
									setIsPanning(false);
								}}
								className={`flex-1 relative flex items-center justify-center p-2 overflow-hidden ${
									zoomLevel > 1 && !activeDragHandle ? 'cursor-grab active:cursor-grabbing' : 'cursor-default'
								}`}
							>
								{/* Image Wrapper (Position Relative for Absolute Crop Box) */}
								<div 
									ref={imgWrapperRef}
									style={{
										transform: `translate(${panOffset.x}px, ${panOffset.y}px) scale(${zoomLevel})`,
										transition: isPanning ? 'none' : 'transform 0.1s ease-out',
									}}
									className="relative max-w-full max-h-full flex items-center justify-center"
								>
									{/* Blueprint Image */}
									{/* eslint-disable-next-line @next/next/no-img-element */}
									<img
										ref={imgRef}
										src={previewModal.url}
										alt={previewModal.title}
										className="max-w-full max-h-[460px] object-contain rounded-lg border border-white/15 shadow-2xl pointer-events-none"
									/>

									{/* Visual Resizable Crop Box (Always Visible in Cropping Mode) */}
									{isCroppingMode && (
										<div
											style={{
												position: 'absolute',
												left: `${cropBox.x}%`,
												top: `${cropBox.y}%`,
												width: `${cropBox.width}%`,
												height: `${cropBox.height}%`,
												boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.55)',
											}}
											className="border-2 border-cyan-400 border-dashed rounded z-20 transition-shadow"
										>
											{/* Move Area (Center Drag) */}
											<div
												onMouseDown={(e) => handleCropMouseDown(e, 'move')}
												className="absolute inset-0 bg-cyan-400/10 cursor-move flex items-center justify-center group"
											>
												<span className="px-2 py-0.5 text-[9.5px] font-bold font-mono bg-cyan-400 text-black rounded shadow opacity-90 group-hover:opacity-100 transition-opacity">
													✂️ Drag or Resize Handles
												</span>
											</div>

											{/* 4 Corner Resize Handles */}
											{/* Top-Left */}
											<div
												onMouseDown={(e) => handleCropMouseDown(e, 'nw')}
												className="absolute -top-2 -left-2 size-4.5 bg-cyan-300 border-2 border-black rounded-full cursor-nwse-resize shadow-[0_0_8px_rgba(34,211,238,0.8)] z-30 hover:scale-125 transition-transform"
											/>
											{/* Top-Right */}
											<div
												onMouseDown={(e) => handleCropMouseDown(e, 'ne')}
												className="absolute -top-2 -right-2 size-4.5 bg-cyan-300 border-2 border-black rounded-full cursor-nesw-resize shadow-[0_0_8px_rgba(34,211,238,0.8)] z-30 hover:scale-125 transition-transform"
											/>
											{/* Bottom-Left */}
											<div
												onMouseDown={(e) => handleCropMouseDown(e, 'sw')}
												className="absolute -bottom-2 -left-2 size-4.5 bg-cyan-300 border-2 border-black rounded-full cursor-nesw-resize shadow-[0_0_8px_rgba(34,211,238,0.8)] z-30 hover:scale-125 transition-transform"
											/>
											{/* Bottom-Right */}
											<div
												onMouseDown={(e) => handleCropMouseDown(e, 'se')}
												className="absolute -bottom-2 -right-2 size-4.5 bg-cyan-300 border-2 border-black rounded-full cursor-nwse-resize shadow-[0_0_8px_rgba(34,211,238,0.8)] z-30 hover:scale-125 transition-transform"
											/>
										</div>
									)}
								</div>
							</div>

							{/* Cropping Action Footer */}
							{isCroppingMode && (
								<div className="pt-3 border-t border-white/10 flex items-center justify-between text-xs animate-in slide-in-from-bottom-2">
									<span className="text-muted-foreground text-[11px]">
										Drag the box or corner handles over the mechanical detail you want to target.
									</span>
									<div className="flex items-center gap-2">
										<button
											type="button"
											onClick={() => setCropBox({ x: 20, y: 20, width: 60, height: 60 })}
											className="px-3 py-1.5 rounded-lg border border-white/10 text-muted-foreground hover:text-white transition-colors cursor-pointer"
										>
											Reset Box
										</button>
										<button
											type="button"
											onClick={applyCropSelection}
											className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-gradient-to-r from-cyan-400 to-blue-500 text-black font-extrabold shadow-[0_0_15px_rgba(34,211,238,0.4)] hover:from-cyan-300 hover:to-blue-400 transition-all cursor-pointer"
										>
											<CheckCircle2 className="size-3.5" />
											<span>Set as Blueprint Target</span>
										</button>
									</div>
								</div>
							)}
						</div>
					)}

					{/* Chat Stream Body */}
					<div className="flex-1 overflow-y-auto p-4 space-y-3.5 text-[12.5px]">
						{messages.map((m) => (
							<div
								key={m.id}
								className={`flex flex-col ${
									m.role === 'user' ? 'items-end' : 'items-start'
								}`}
							>
								<div
									className={`p-3 rounded-2xl max-w-[92%] leading-relaxed ${
										m.role === 'user'
											? 'bg-gradient-to-r from-blue-600 to-cyan-600 text-white rounded-br-none shadow-lg font-medium'
											: 'bg-white/[0.04] text-foreground border border-white/[0.08] rounded-bl-none shadow-md backdrop-blur-md'
									}`}
								>
									{(() => {
										let cleanText = m.content || '';
										if (
											cleanText.trim().startsWith('{') ||
											cleanText.trim().startsWith(',') ||
											cleanText.includes('blueprint_features') ||
											cleanText.includes('object_name') ||
											cleanText.includes('suggested_prompt')
										) {
											cleanText = cleanText
												.replace(/\{[^{}]*\}/g, '')
												.replace(/["\',:{}\[\]]/g, '')
												.replace(/blueprint_features|object_name|suggested_prompt|discrepancies|unsupported_or_invalid_claims/gi, '')
												.trim();
										}
										if (!cleanText || cleanText.length < 5) {
											cleanText = "Inspected reference drawing and generated precision parametric CAD corrections.";
										}
										return (
											<div>
												<p className="whitespace-pre-wrap">{cleanText}</p>
												{m.role === 'assistant' && m.id !== 'welcome' && (
													<div className="flex items-center gap-2 mt-2 pt-1.5 border-t border-white/[0.06] text-[10px] font-mono">
														<button
															type="button"
															onClick={() => handleApply(`${m.id}_msg`, cleanText)}
															className="text-cyan-400 hover:text-cyan-300 flex items-center gap-1 transition-colors cursor-pointer font-medium"
															title="Apply this entire analysis description directly to CAD Generator input"
														>
															<ArrowUpRight className="size-2.5" />
															<span>{appliedId === `${m.id}_msg` ? 'Applied to CAD!' : 'Apply Analysis to CAD'}</span>
														</button>
														<span className="text-white/20">•</span>
														<button
															type="button"
															onClick={() => handleCopy(`${m.id}_msg`, cleanText)}
															className="text-muted-foreground hover:text-white flex items-center gap-1 transition-colors cursor-pointer"
															title="Copy analysis description"
														>
															<Copy className="size-2.5" />
															<span>{copiedId === `${m.id}_msg` ? 'Copied' : 'Copy'}</span>
														</button>
													</div>
												)}
											</div>
										);
									})()}

									{/* Non-Existent / Unsupported Claims Alert Card */}
									{m.analysis?.unsupported_or_invalid_claims && m.analysis.unsupported_or_invalid_claims.length > 0 && (
										<div className="mt-3 pt-2.5 border-t border-rose-500/30 space-y-1.5 animate-in fade-in duration-150">
											<div className="text-[10px] font-extrabold uppercase tracking-wider text-rose-400 flex items-center gap-1">
												<AlertTriangle className="size-3 text-rose-400" />
												<span>Blueprint Verification Warning ({m.analysis.unsupported_or_invalid_claims.length}):</span>
											</div>
											<div className="space-y-1">
												{m.analysis.unsupported_or_invalid_claims.map((claim, idx) => (
													<div
														key={idx}
														className="flex items-start gap-1.5 text-[11px] bg-rose-950/40 p-2 rounded-lg border border-rose-500/20 text-rose-200"
													>
														<span className="px-1.5 py-0.5 rounded text-[8.5px] font-black uppercase tracking-wider bg-rose-500/20 text-rose-300 border border-rose-500/30 shrink-0 mt-0.5">
															Not in Drawing
														</span>
														<div>
															<strong className="text-rose-300 capitalize">{claim.claim || claim.feature}:</strong>{' '}
															<span className="text-rose-200/90">{claim.reason || claim.issue}</span>
														</div>
													</div>
												))}
											</div>
										</div>
									)}

									{/* Feature Verification Table */}
									{m.analysis?.blueprint_features && m.analysis.blueprint_features.length > 0 && (
										<div className="mt-3 pt-2.5 border-t border-white/10 space-y-2">
											<div className="flex items-center justify-between">
												<div className="text-[10px] font-extrabold uppercase tracking-wider text-cyan-300 flex items-center gap-1 font-mono">
													<Layers className="size-3 text-cyan-400" />
													<span>Feature Verification Table ({m.analysis.blueprint_features.length})</span>
												</div>
												{m.analysis.object_name && (
													<span className="text-[9px] text-muted-foreground/80 font-mono truncate max-w-[170px]" title={m.analysis.object_name}>
														{m.analysis.object_name}
													</span>
												)}
											</div>

											<div className="rounded-xl border border-white/10 overflow-hidden bg-black/50 shadow-inner">
												<div className="overflow-x-auto max-h-[220px] no-scrollbar">
													<table className="w-full text-left text-[10.5px] border-collapse">
														<thead className="sticky top-0 bg-[#0c121e] border-b border-white/10 text-muted-foreground font-mono text-[9px] uppercase tracking-wider z-10">
															<tr>
																<th className="py-1.5 px-2 font-bold">Feature</th>
																<th className="py-1.5 px-2 font-bold">Blueprint Spec</th>
																<th className="py-1.5 px-2 font-bold text-center">3D Status</th>
																<th className="py-1.5 px-2 font-bold">Action</th>
															</tr>
														</thead>
														<tbody className="divide-y divide-white/5 font-sans leading-tight">
															{m.analysis.blueprint_features.map((feat, idx) => {
																const statusLower = (feat.status || '').toLowerCase();
																const isMatched = statusLower.includes('match') || statusLower.includes('accurate') || statusLower.includes('ok');
																const isMissing = statusLower.includes('miss') || statusLower.includes('absent');

																return (
																	<tr key={idx} className="hover:bg-white/[0.03] transition-colors">
																		<td className="py-1.5 px-2 font-medium text-white align-top">
																			<div className="font-semibold leading-snug">{feat.name}</div>
																			{feat.callout && (
																				<span className="text-[8.5px] text-cyan-400 font-mono block mt-0.5">
																					{feat.callout}
																				</span>
																			)}
																		</td>
																		<td className="py-1.5 px-2 text-muted-foreground/90 max-w-[130px] align-top text-[10px]">
																			{feat.specification || feat.description || '—'}
																		</td>
																		<td className="py-1.5 px-2 text-center shrink-0 align-top">
																			{isMatched ? (
																				<span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[8px] font-black uppercase tracking-wider bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
																					<Check className="size-2.5" /> Matched
																				</span>
																			) : isMissing ? (
																				<span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[8px] font-black uppercase tracking-wider bg-rose-500/15 text-rose-400 border border-rose-500/30">
																					<X className="size-2.5" /> Missing
																				</span>
																			) : (
																				<span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[8px] font-black uppercase tracking-wider bg-amber-500/15 text-amber-300 border border-amber-500/30">
																					<AlertCircle className="size-2.5" /> Inaccurate
																				</span>
																			)}
																		</td>
																		<td className="py-1.5 px-2 text-cyan-200/90 text-[9.5px] align-top">
																			{feat.action || (isMatched ? 'None' : isMissing ? 'Add to model' : 'Refine dimensions')}
																		</td>
																	</tr>
																);
															})}
														</tbody>
													</table>
												</div>
											</div>
										</div>
									)}

									{/* Detected Discrepancies */}
									{(!m.analysis?.blueprint_features || m.analysis.blueprint_features.length === 0) && m.analysis?.discrepancies && m.analysis.discrepancies.length > 0 && (
										<div className="mt-3 pt-2.5 border-t border-white/10 space-y-1.5">
											<div className="text-[10px] font-extrabold uppercase tracking-wider text-cyan-400 flex items-center gap-1">
												<AlertCircle className="size-3 text-cyan-400" />
												<span>Detected Discrepancies ({m.analysis.discrepancies.length}):</span>
											</div>
											<div className="space-y-1">
												{m.analysis.discrepancies.map((d, idx) => (
													<div
														key={idx}
														className="flex items-start gap-1.5 text-[11px] bg-black/40 p-2 rounded-lg border border-white/5"
													>
														<span className="px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-wider bg-amber-500/20 text-amber-300 border border-amber-500/30">
															{d.action || 'fix'}
														</span>
														<div>
															<strong className="text-white capitalize">{d.feature}:</strong>{' '}
															<span className="text-muted-foreground">{d.issue}</span>
														</div>
													</div>
												))}
											</div>
										</div>
									)}

									{/* Suggested CAD Prompt Card */}
									{m.suggested_prompt && (
										<div className="mt-3 pt-2.5 border-t border-cyan-500/30">
											<div className="text-[10px] font-extrabold uppercase tracking-wider text-cyan-400 mb-1.5 flex items-center justify-between">
												<span>🎯 Corrected CAD Prompt</span>
											</div>
											<div className="p-2.5 rounded-xl bg-black/60 border border-cyan-500/30 text-cyan-100 font-mono text-[11px] leading-relaxed break-words selection:bg-cyan-500 selection:text-black shadow-inner">
												{m.suggested_prompt}
											</div>

											{/* Action Buttons */}
											<div className="flex items-center gap-2 mt-2.5">
												<button
													type="button"
													onClick={() => handleApply(m.id, m.suggested_prompt!)}
													className="flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-gradient-to-r from-cyan-400 to-blue-500 hover:from-cyan-300 hover:to-blue-400 text-black font-extrabold text-[11px] tracking-wide transition-all shadow-[0_0_15px_rgba(34,211,238,0.3)] cursor-pointer"
												>
													{appliedId === m.id ? (
														<>
															<Check className="size-3.5" />
															<span>Applied to CAD!</span>
														</>
													) : (
														<>
															<ArrowUpRight className="size-3.5" />
															<span>Apply to CAD Input</span>
														</>
													)}
												</button>

												<button
													type="button"
													onClick={() => handleCopy(m.id, m.suggested_prompt!)}
													className="flex items-center gap-1 py-2 px-3 rounded-xl border border-white/10 bg-white/[0.03] hover:bg-white/[0.08] text-muted-foreground hover:text-white text-[11px] transition-colors cursor-pointer"
													title="Copy prompt"
												>
													{copiedId === m.id ? (
														<Check className="size-3.5 text-emerald-400" />
													) : (
														<Copy className="size-3.5" />
													)}
												</button>
											</div>
										</div>
									)}
								</div>
								<span className="text-[9px] text-muted-foreground/50 px-1 mt-1 font-mono">
									{new Date(m.timestamp).toLocaleTimeString([], {
										hour: '2-digit',
										minute: '2-digit',
									})}
								</span>
							</div>
						))}

						{isLoading && (
							<div className="flex items-center gap-2.5 p-3 rounded-xl bg-cyan-500/[0.05] border border-cyan-500/20 text-cyan-300 text-xs animate-pulse">
								<RefreshCw className="size-3.5 animate-spin text-cyan-400" />
								<span>Analyzing blueprint vs 3D model geometry...</span>
							</div>
						)}
						<div ref={chatEndRef} />
					</div>

					{/* Quick Suggestions Strip */}
					<div className="px-3.5 py-2 border-t border-white/[0.06] bg-black/40 flex gap-1.5 overflow-x-auto no-scrollbar">
						<button
							type="button"
							disabled={isLoading}
							onClick={() => handleSendMessage('Compare the blueprint specification with the 3D model renders and find all missing features.')}
							className="shrink-0 text-[10.5px] font-medium px-3 py-1 rounded-full border border-cyan-500/30 hover:border-cyan-400 bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-300 transition-all cursor-pointer shadow-sm"
						>
							Compare Full Model
						</button>
						<button
							type="button"
							disabled={isLoading}
							onClick={() => handleSendMessage('The mounting holes, boss, and keyways are missing or misaligned.')}
							className="shrink-0 text-[10.5px] font-medium px-3 py-1 rounded-full border border-white/10 hover:border-white/20 bg-white/[0.03] hover:bg-white/[0.07] text-muted-foreground hover:text-white transition-all cursor-pointer"
						>
							Check Holes & Keyway
						</button>
					</div>

					{/* Input Footer */}
					<div className="p-3 border-t border-white/[0.08] bg-[#090d16] flex items-center gap-2">
						<div className="flex-1 relative flex items-center">
							<input
								type="text"
								value={inputMessage}
								onChange={(e) => setInputMessage(e.target.value)}
								onKeyDown={(e) => {
									if (e.key === 'Enter' && !e.shiftKey) {
										e.preventDefault();
										handleSendMessage();
									}
								}}
								placeholder="Describe missing parts or ask for a fix..."
								disabled={isLoading}
								className="w-full bg-white/[0.04] border border-white/10 focus:border-cyan-400/70 focus:bg-white/[0.06] rounded-xl px-3.5 py-2.5 text-xs text-foreground placeholder:text-muted-foreground/60 focus:outline-none transition-all pr-8"
							/>
						</div>
						<button
							type="button"
							onClick={() => handleSendMessage()}
							disabled={isLoading || (!inputMessage.trim() && !blueprintUrl && capturedSnapshots.length === 0)}
							className="size-9 rounded-xl bg-cyan-400 hover:bg-cyan-300 disabled:opacity-30 text-black flex items-center justify-center transition-all shadow-[0_0_15px_rgba(34,211,238,0.35)] shrink-0 cursor-pointer font-bold"
						>
							<Send className="size-4" />
						</button>
					</div>
				</div>
			)}
		</div>
	);
}
