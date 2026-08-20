'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { 
	ZoomIn, ZoomOut, RotateCcw, Maximize2, Minimize2, Target, 
	Crosshair, Hand, MousePointer, Layers, Check, X, SlidersHorizontal,
	FileImage, Info, ChevronRight, Sparkles, Upload, AlertCircle
} from 'lucide-react';
import type { TargetPortion } from '@/components/chat/ChatPanel';
import { CAD_PORTION_PRESETS } from '@/components/chat/ChatPanel';

export type BlueprintHotspot = {
	id: string;
	portionId: string;
	name: string;
	callout: string;
	description: string;
	// Normalized coordinates in percentages (0-100%)
	x: number;
	y: number;
	w: number;
	h: number;
	category: string;
	quickPrompt: string;
};

type BlueprintViewerProps = {
	blueprintUrl: string | null;
	targetPortion: TargetPortion | null;
	onSelectPortion?: (portion: TargetPortion) => void;
	activeParameter?: string | null;
	onClose?: () => void;
	isFloating?: boolean;
	isSplitView?: boolean;
	className?: string;
	// Optional data-driven hotspot regions (e.g. supplied by the backend feature
	// map). Left empty by default - no blueprint-specific hardcoding.
	hotspots?: BlueprintHotspot[];
	onAttachBlueprint?: (file: File) => void;
};

type SelectionBox = {
	x: number;
	y: number;
	w: number;
	h: number;
};

export function BlueprintViewer({
	blueprintUrl,
	targetPortion,
	onSelectPortion,
	activeParameter,
	onClose,
	isFloating = false,
	isSplitView = false,
	className = '',
	hotspots = [],
	onAttachBlueprint,
}: BlueprintViewerProps) {
	const [zoom, setZoom] = useState(1);
	const [pan, setPan] = useState({ x: 0, y: 0 });
	const [toolMode, setToolMode] = useState<'select' | 'pan'>('select');
	const [isDragging, setIsDragging] = useState(false);
	const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
	const [hoveredHotspot, setHoveredHotspot] = useState<BlueprintHotspot | null>(null);
	const [showHotspots, setShowHotspots] = useState(true);
	const [imageError, setImageError] = useState(false);
	
	// Custom user free selection state
	const [customSelection, setCustomSelection] = useState<SelectionBox | null>(null);
	const [isSelecting, setIsSelecting] = useState(false);
	const [selectionOrigin, setSelectionOrigin] = useState<{ x: number; y: number } | null>(null);

	const containerRef = useRef<HTMLDivElement>(null);
	const imgRef = useRef<HTMLImageElement>(null);
	const fileInputRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		setImageError(false);
	}, [blueprintUrl]);

	// Find the active preset hotspot based on selected targetPortion
	const activeHotspot = (targetPortion && targetPortion.id !== 'custom_blueprint_region')
		? hotspots.find(h => 
			h.portionId === targetPortion.id || 
			targetPortion.name.toLowerCase().includes(h.portionId) ||
			h.name.toLowerCase().includes(targetPortion.name.toLowerCase())
		) || null
		: null;

	// Reset zoom and pan
	const handleResetView = useCallback(() => {
		setZoom(1);
		setPan({ x: 0, y: 0 });
	}, []);

	// Handle wheel zoom
	const handleWheel = (e: React.WheelEvent) => {
		e.preventDefault();
		e.stopPropagation();
		const zoomDelta = e.deltaY < 0 ? 0.15 : -0.15;
		setZoom(prev => Math.min(Math.max(prev + zoomDelta, 0.6), 4.0));
	};

	// Convert mouse client coordinates to 0-100% normalized blueprint coordinates
	const getNormalizedCoords = (e: React.MouseEvent) => {
		if (!imgRef.current) return null;
		const rect = imgRef.current.getBoundingClientRect();
		if (rect.width === 0 || rect.height === 0) return null;
		const x = ((e.clientX - rect.left) / rect.width) * 100;
		const y = ((e.clientY - rect.top) / rect.height) * 100;
		return {
			x: Math.max(0, Math.min(100, x)),
			y: Math.max(0, Math.min(100, y)),
		};
	};

	// Mouse down: start either pan or custom selection
	const handleMouseDown = (e: React.MouseEvent) => {
		if (e.button !== 0) return; // only left click

		if (toolMode === 'pan') {
			setIsDragging(true);
			setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
		} else {
			// Free selection mode
			const coords = getNormalizedCoords(e);
			if (coords) {
				setIsSelecting(true);
				setSelectionOrigin(coords);
				setCustomSelection({ x: coords.x, y: coords.y, w: 0, h: 0 });
			}
		}
	};

	// Mouse move: update pan or update custom selection rectangle
	const handleMouseMove = (e: React.MouseEvent) => {
		if (toolMode === 'pan' && isDragging) {
			setPan({
				x: e.clientX - dragStart.x,
				y: e.clientY - dragStart.y
			});
		} else if (toolMode === 'select' && isSelecting && selectionOrigin) {
			const current = getNormalizedCoords(e);
			if (current) {
				const x = Math.min(selectionOrigin.x, current.x);
				const y = Math.min(selectionOrigin.y, current.y);
				const w = Math.abs(current.x - selectionOrigin.x);
				const h = Math.abs(current.y - selectionOrigin.y);
				setCustomSelection({ x, y, w, h });
			}
		}
	};

	// Mouse up: finalize selection and emit TargetPortion
	const handleMouseUp = () => {
		if (toolMode === 'pan') {
			setIsDragging(false);
		} else if (toolMode === 'select' && isSelecting) {
			setIsSelecting(false);
			if (customSelection) {
				let finalBox = { ...customSelection };
				// If the user simply clicked a point without dragging a box, create a default focal region
				if (finalBox.w < 2 && finalBox.h < 2) {
					finalBox = {
						x: Math.max(0, finalBox.x - 7),
						y: Math.max(0, finalBox.y - 7),
						w: 14,
						h: 14,
					};
					setCustomSelection(finalBox);
				}

				const centerX = Math.round(finalBox.x + finalBox.w / 2);
				const centerY = Math.round(finalBox.y + finalBox.h / 2);

				const portion: TargetPortion = {
					id: 'custom_blueprint_region',
					name: `Custom Region (${centerX}%, ${centerY}%)`,
					category: 'Blueprint Free Target',
					description: `Targeted blueprint position at X:${centerX}% Y:${centerY}% (area: ${Math.round(finalBox.w)}% x ${Math.round(finalBox.h)}%)`,
					cropBox: {
						x: Math.round(finalBox.x),
						y: Math.round(finalBox.y),
						w: Math.round(finalBox.w),
						h: Math.round(finalBox.h)
					},
					quickPrompts: [
						`Inspect the targeted blueprint region at (${centerX}%, ${centerY}%) and update the CAD geometry according to the callouts there.`,
						`Revise the feature shown in the selected blueprint region at (${centerX}%, ${centerY}%): `
					]
				};

				if (onSelectPortion) {
					onSelectPortion(portion);
				}
			}
			setSelectionOrigin(null);
		}
	};

	// Auto-focus on active hotspot when targetPortion changes (only if preset) or clear custom selection when targetPortion is cleared
	useEffect(() => {
		if (!targetPortion) {
			setCustomSelection(null);
		} else if (activeHotspot && containerRef.current) {
			const targetCenterX = (activeHotspot.x + activeHotspot.w / 2 - 50) * -2;
			const targetCenterY = (activeHotspot.y + activeHotspot.h / 2 - 50) * -2;
			setPan({ x: targetCenterX, y: targetCenterY });
			setZoom(1.3);
			setCustomSelection(null);
		}
	}, [targetPortion, activeHotspot]);

	const handleHotspotClick = (hotspot: BlueprintHotspot, e: React.MouseEvent) => {
		e.stopPropagation();
		setCustomSelection(null);
		if (onSelectPortion) {
			const preset = CAD_PORTION_PRESETS.find(p => p.id === hotspot.portionId) || {
				id: hotspot.portionId,
				name: hotspot.name,
				category: hotspot.category,
				description: hotspot.description,
				quickPrompts: [hotspot.quickPrompt]
			};
			onSelectPortion({
				...preset,
				name: hotspot.name,
				cropBox: {
					x: hotspot.x,
					y: hotspot.y,
					w: hotspot.w,
					h: hotspot.h
				},
				quickPrompts: [hotspot.quickPrompt, ...(preset.quickPrompts || [])]
			});
		}
	};

	const handleClearCustomSelection = () => {
		setCustomSelection(null);
	};

	return (
		<div 
			ref={containerRef}
			className={`relative overflow-hidden bg-zinc-950 flex flex-col select-none border border-border/80 shadow-2xl rounded-xl ${className}`}
			onWheel={handleWheel}
			onMouseDown={handleMouseDown}
			onMouseMove={handleMouseMove}
			onMouseUp={handleMouseUp}
			onMouseLeave={handleMouseUp}
		>
			{/* Top Floating Control Bar */}
			<div className="absolute top-3 left-3 right-3 z-30 flex items-center justify-between pointer-events-auto gap-2">
				{/* Active Target Banner */}
				<div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-zinc-900/90 backdrop-blur-md border border-blue-500/30 shadow-lg">
					<div className={`size-2 rounded-full ${customSelection ? 'bg-cyan-400' : 'bg-blue-500'} animate-pulse shadow-[0_0_8px_rgba(6,182,212,0.8)]`} />
					<span className="text-[10px] font-mono font-bold uppercase tracking-wider text-blue-400">
						Blueprint Inspector
					</span>
					{targetPortion && (
						<>
							<ChevronRight className="size-3 text-muted-foreground" />
							<span className="text-[10px] font-bold text-foreground truncate max-w-[130px]">
								{targetPortion.name}
							</span>
						</>
					)}
				</div>

				{/* Tool Mode Switch (Select / Crop vs Pan) & Zoom Controls */}
				<div className="flex items-center gap-1 px-1.5 py-1 rounded-lg bg-zinc-900/90 backdrop-blur-md border border-border/60 shadow-lg">
					{/* Free Select Tool Button */}
					<button
						type="button"
						onClick={() => setToolMode('select')}
						className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] font-semibold transition-all ${
							toolMode === 'select' 
								? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-[0_0_8px_rgba(6,182,212,0.3)]' 
								: 'text-muted-foreground hover:text-foreground hover:bg-white/5'
						}`}
						title="Free Target: Click or drag on blueprint to select any position"
					>
						<Crosshair className="size-3.5 text-cyan-400" />
						<span>Free Target</span>
					</button>

					{/* Pan / Hand Tool Button */}
					<button
						type="button"
						onClick={() => setToolMode('pan')}
						className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] font-semibold transition-all ${
							toolMode === 'pan' 
								? 'bg-blue-500/20 text-blue-300 border border-blue-500/40' 
								: 'text-muted-foreground hover:text-foreground hover:bg-white/5'
						}`}
						title="Pan: Click and drag to move blueprint view"
					>
						<Hand className="size-3.5" />
						<span>Pan</span>
					</button>

					<div className="w-px h-3.5 bg-border/60 mx-0.5" />

					{/* Zoom Controls */}
					<button
						type="button"
						onClick={() => setZoom(z => Math.min(z + 0.25, 4.0))}
						className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-white/10 transition-colors"
						title="Zoom In (+)"
					>
						<ZoomIn className="size-3.5" />
					</button>
					<button
						type="button"
						onClick={() => setZoom(z => Math.max(z - 0.25, 0.6))}
						className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-white/10 transition-colors"
						title="Zoom Out (-)"
					>
						<ZoomOut className="size-3.5" />
					</button>
					<button
						type="button"
						onClick={handleResetView}
						className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-white/10 transition-colors"
						title="Reset View"
					>
						<RotateCcw className="size-3.5" />
					</button>

					<div className="w-px h-3.5 bg-border/60 mx-0.5" />

					<button
						type="button"
						onClick={() => setShowHotspots(s => !s)}
						className={`p-1 rounded transition-colors ${showHotspots ? 'text-blue-400 bg-blue-500/10' : 'text-muted-foreground hover:text-foreground'}`}
						title="Toggle Preset Hotspots"
					>
						<Target className="size-3.5" />
					</button>
					{onClose && (
						<>
							<div className="w-px h-3.5 bg-border/60 mx-0.5" />
							<button
								type="button"
								onClick={onClose}
								className="p-1 rounded text-muted-foreground hover:text-red-400 hover:bg-white/10 transition-colors"
								title="Close Blueprint View"
							>
								<X className="size-3.5" />
							</button>
						</>
					)}
				</div>
			</div>

			{/* Drawing Canvas Area */}
			<div 
				className={`flex-1 w-full h-full relative flex items-center justify-center overflow-hidden ${
					toolMode === 'select' ? 'cursor-crosshair' : isDragging ? 'cursor-grabbing' : 'cursor-grab'
				}`}
			>
				{blueprintUrl && !imageError ? (
					<div
						className="relative transition-transform duration-75 origin-center will-change-transform"
						style={{
							transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
						}}
					>
						{/* Base Blueprint Drawing Image */}
						<img
							ref={imgRef}
							src={blueprintUrl}
							alt="Technical Blueprint"
							className="max-w-none w-auto h-auto max-h-[85vh] rounded shadow-2xl pointer-events-none select-none"
							draggable={false}
							onError={() => {
								setImageError(true);
							}}
						/>

						{/* Interactive SVG Spotlight, Presets & Free Custom Selection Layer */}
						<svg 
							className="absolute inset-0 w-full h-full pointer-events-none"
							viewBox="0 0 100 100"
							preserveAspectRatio="none"
						>
							<defs>
								{/* Glowing Spotlight Filter */}
								<filter id="blueprint-glow" x="-20%" y="-20%" width="140%" height="140%">
									<feGaussianBlur stdDeviation="1.5" result="blur" />
									<feComposite in="SourceGraphic" in2="blur" operator="over" />
								</filter>
								<filter id="custom-target-glow" x="-30%" y="-30%" width="160%" height="160%">
									<feGaussianBlur stdDeviation="2" result="blur" />
									<feComposite in="SourceGraphic" in2="blur" operator="over" />
								</filter>
							</defs>

							{/* Render Preset Hotspots */}
							{showHotspots && hotspots.map((hotspot) => {
								const isSelected = activeHotspot?.id === hotspot.id && !customSelection;
								const isHovered = hoveredHotspot?.id === hotspot.id;

								return (
									<g key={hotspot.id} className="pointer-events-auto cursor-pointer">
										{/* Bounding Box Highlight */}
										<rect
											x={hotspot.x}
											y={hotspot.y}
											width={hotspot.w}
											height={hotspot.h}
											rx="1.5"
											fill={isSelected ? 'rgba(59, 130, 246, 0.18)' : isHovered ? 'rgba(6, 182, 212, 0.12)' : 'rgba(255, 255, 255, 0.03)'}
											stroke={isSelected ? '#3b82f6' : isHovered ? '#06b6d4' : 'rgba(255, 255, 255, 0.2)'}
											strokeWidth={isSelected ? '0.8' : '0.4'}
											strokeDasharray={isSelected ? 'none' : '1.5 1'}
											filter={isSelected ? 'url(#blueprint-glow)' : undefined}
											onClick={(e) => handleHotspotClick(hotspot, e)}
											onMouseEnter={() => setHoveredHotspot(hotspot)}
											onMouseLeave={() => setHoveredHotspot(null)}
										/>

										{/* Active Pulsing Corner Reticles */}
										{isSelected && (
											<>
												<path
													d={`M ${hotspot.x - 1} ${hotspot.y + 3} L ${hotspot.x - 1} ${hotspot.y - 1} L ${hotspot.x + 3} ${hotspot.y - 1}`}
													fill="none"
													stroke="#60a5fa"
													strokeWidth="0.8"
												/>
												<path
													d={`M ${hotspot.x + hotspot.w + 1} ${hotspot.y + hotspot.h - 3} L ${hotspot.x + hotspot.w + 1} ${hotspot.y + hotspot.h + 1} L ${hotspot.x + hotspot.w - 3} ${hotspot.y + hotspot.h + 1}`}
													fill="none"
													stroke="#60a5fa"
													strokeWidth="0.8"
												/>
											</>
										)}
									</g>
								);
							})}

							{/* Render Custom User Free Selection Box */}
							{customSelection && (
								<g className="pointer-events-none">
									{/* Shaded Target Area */}
									<rect
										x={customSelection.x}
										y={customSelection.y}
										width={customSelection.w}
										height={customSelection.h}
										rx="1"
										fill="rgba(6, 182, 212, 0.2)"
										stroke="#06b6d4"
										strokeWidth="0.9"
										strokeDasharray="2 1"
										filter="url(#custom-target-glow)"
									/>

									{/* Crosshair Target Center Reticle */}
									<circle
										cx={customSelection.x + customSelection.w / 2}
										cy={customSelection.y + customSelection.h / 2}
										r="1.2"
										fill="#22d3ee"
										stroke="#083344"
										strokeWidth="0.3"
									/>
									<line
										x1={customSelection.x + customSelection.w / 2 - 3}
										y1={customSelection.y + customSelection.h / 2}
										x2={customSelection.x + customSelection.w / 2 + 3}
										y2={customSelection.y + customSelection.h / 2}
										stroke="#22d3ee"
										strokeWidth="0.4"
									/>
									<line
										x1={customSelection.x + customSelection.w / 2}
										y1={customSelection.y + customSelection.h / 2 - 3}
										x2={customSelection.x + customSelection.w / 2}
										y2={customSelection.y + customSelection.h / 2 + 3}
										stroke="#22d3ee"
										strokeWidth="0.4"
									/>

									{/* 4 Precision Corner Brackets */}
									{/* Top-Left */}
									<path
										d={`M ${customSelection.x - 0.8} ${customSelection.y + 2.5} L ${customSelection.x - 0.8} ${customSelection.y - 0.8} L ${customSelection.x + 2.5} ${customSelection.y - 0.8}`}
										fill="none"
										stroke="#22d3ee"
										strokeWidth="0.8"
									/>
									{/* Top-Right */}
									<path
										d={`M ${customSelection.x + customSelection.w - 2.5} ${customSelection.y - 0.8} L ${customSelection.x + customSelection.w + 0.8} ${customSelection.y - 0.8} L ${customSelection.x + customSelection.w + 0.8} ${customSelection.y + 2.5}`}
										fill="none"
										stroke="#22d3ee"
										strokeWidth="0.8"
									/>
									{/* Bottom-Left */}
									<path
										d={`M ${customSelection.x - 0.8} ${customSelection.y + customSelection.h - 2.5} L ${customSelection.x - 0.8} ${customSelection.y + customSelection.h + 0.8} L ${customSelection.x + 2.5} ${customSelection.y + customSelection.h + 0.8}`}
										fill="none"
										stroke="#22d3ee"
										strokeWidth="0.8"
									/>
									{/* Bottom-Right */}
									<path
										d={`M ${customSelection.x + customSelection.w - 2.5} ${customSelection.y + customSelection.h + 0.8} L ${customSelection.x + customSelection.w + 0.8} ${customSelection.y + customSelection.h + 0.8} L ${customSelection.x + customSelection.w + 0.8} ${customSelection.y + customSelection.h - 2.5}`}
										fill="none"
										stroke="#22d3ee"
										strokeWidth="0.8"
									/>
								</g>
							)}
						</svg>

						{/* Hotspot Floating Callout Badges */}
						{showHotspots && !customSelection && hotspots.map((hotspot) => {
							const isSelected = activeHotspot?.id === hotspot.id;
							const isHovered = hoveredHotspot?.id === hotspot.id;

							return (
								<div
									key={`badge_${hotspot.id}`}
									className="absolute pointer-events-auto"
									style={{
										left: `${hotspot.x}%`,
										top: `${hotspot.y - 3}%`,
										transform: 'translate(0, -100%)',
									}}
								>
									<button
										type="button"
										onClick={(e) => handleHotspotClick(hotspot, e)}
										onMouseEnter={() => setHoveredHotspot(hotspot)}
										onMouseLeave={() => setHoveredHotspot(null)}
										className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-[9px] font-mono font-bold tracking-tight shadow-xl transition-all ${
											isSelected 
												? 'bg-blue-600 text-white ring-2 ring-blue-400 scale-105 shadow-blue-500/30' 
												: isHovered
													? 'bg-cyan-600 text-white scale-100'
													: 'bg-zinc-900/90 text-zinc-300 border border-white/20 hover:border-blue-400'
										}`}
									>
										<Target className={`size-2.5 ${isSelected ? 'animate-spin' : ''}`} style={{ animationDuration: '6s' }} />
										<span>{hotspot.callout}</span>
									</button>
								</div>
							);
						})}

						{/* Custom Selection Callout Badge */}
						{customSelection && (
							<div
								className="absolute pointer-events-auto animate-in fade-in zoom-in-95"
								style={{
									left: `${customSelection.x}%`,
									top: `${Math.max(0, customSelection.y - 2)}%`,
									transform: 'translate(0, -100%)',
								}}
							>
								<div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-cyan-950/95 border border-cyan-400 text-cyan-200 text-[9px] font-mono font-bold shadow-2xl backdrop-blur-md">
									<Crosshair className="size-3 text-cyan-400 animate-spin" style={{ animationDuration: '10s' }} />
									<span>Custom Target ({Math.round(customSelection.x + customSelection.w/2)}%, {Math.round(customSelection.y + customSelection.h/2)}%)</span>
								</div>
							</div>
						)}
					</div>
				) : (
					/* Fallback Empty State / Missing Blueprint State */
					<div className="flex flex-col items-center justify-center gap-3 p-6 text-center max-w-xs animate-in fade-in zoom-in-95">
						<div className="size-12 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400 shadow-inner">
							<FileImage className="size-6" />
						</div>
						<div className="space-y-1">
							<h4 className="text-xs font-bold uppercase tracking-wider text-foreground">
								{imageError ? 'Blueprint Not Cached' : 'No Blueprint Loaded'}
							</h4>
							<p className="text-[11px] text-muted-foreground leading-snug">
								{imageError
									? 'The drawing file for this restored session is not in local storage. Attach it below to inspect callouts & target regions.'
									: 'Upload a technical blueprint to inspect drawing details and targeted features.'}
							</p>
						</div>

						<input
							ref={fileInputRef}
							type="file"
							accept="image/png,image/jpeg,application/pdf"
							className="hidden"
							onChange={(e) => {
								const file = e.target.files?.[0];
								if (file && onAttachBlueprint) {
									onAttachBlueprint(file);
								}
							}}
						/>

						<button
							type="button"
							onClick={() => fileInputRef.current?.click()}
							className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-blue-500/20 hover:bg-blue-500/30 text-blue-300 border border-blue-500/30 text-[11px] font-bold transition-all shadow-sm active:scale-95 cursor-pointer mt-1"
						>
							<Upload className="size-3" />
							<span>Attach Blueprint File</span>
						</button>
					</div>
				)}
			</div>

			{/* Bottom Targeted Feature Info Footer */}
			<div className="p-2.5 bg-zinc-900/95 border-t border-border/80 flex items-center justify-between text-xs z-30 gap-2">
				<div className="flex items-center gap-2 min-w-0">
					<div className={`size-6 rounded ${customSelection ? 'bg-cyan-500/10 border-cyan-500/30 text-cyan-400' : 'bg-blue-500/10 border-blue-500/20 text-blue-400'} border flex items-center justify-center shrink-0`}>
						{customSelection ? <Crosshair className="size-3" /> : <Target className="size-3" />}
					</div>
					<div className="min-w-0">
						<div className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
							<span>Selected Target:</span>
							{customSelection ? (
								<span className="text-cyan-400 font-bold">Custom Free Selection</span>
							) : (
								activeHotspot && <span className="text-blue-400 font-bold">{activeHotspot.category}</span>
							)}
						</div>
						<div className="text-[11px] font-bold text-foreground truncate">
							{targetPortion?.name || (customSelection ? `Region (${Math.round(customSelection.x)}%, ${Math.round(customSelection.y)}%)` : (activeHotspot ? activeHotspot.name : 'Click anywhere on drawing to target a custom position'))}
						</div>
					</div>
				</div>

				<div className="flex items-center gap-2 shrink-0">
					{customSelection && (
						<button
							type="button"
							onClick={handleClearCustomSelection}
							className="px-2 py-0.5 rounded text-[10px] font-semibold text-zinc-400 hover:text-white bg-zinc-800/80 hover:bg-zinc-700 transition-colors border border-border"
						>
							Clear Target
						</button>
					)}
					<span className="text-[9px] font-mono text-muted-foreground">
						Zoom: {Math.round(zoom * 100)}%
					</span>
				</div>
			</div>
		</div>
	);
}
