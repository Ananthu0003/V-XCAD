'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { 
	ZoomIn, ZoomOut, RotateCcw, Maximize2, Minimize2, Target, 
	Layers, Eye, Sparkles, Check, X, FileImage, Crosshair, ChevronRight 
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

export const BLUEPRINT_DEFAULT_HOTSPOTS: BlueprintHotspot[] = [
	{
		id: 'hotspot_detail_d',
		portionId: 'groove',
		name: 'DETAIL-D: Dual Seal Grooves',
		callout: 'DETAIL-D (2:1)',
		description: 'Two seal grooves on collar with R0.2 fillets and 15° rear draft angle',
		x: 74,
		y: 65,
		w: 22,
		h: 24,
		category: 'Groove / Undercut',
		quickPrompt: 'The blueprint shows two seal grooves on the collar with R0.2 fillets and a 15° rear taper that were missed in Detail-D.'
	},
	{
		id: 'hotspot_detail_e',
		portionId: 'chamfer',
		name: 'DETAIL-E: Nose Cone & Chamfer',
		callout: 'DETAIL-E (4:1)',
		description: '30° conical lead-in tip with 0.2mm corner blends at shaft end',
		x: 75,
		y: 28,
		w: 21,
		h: 22,
		category: 'Chamfer & Lead-In',
		quickPrompt: 'The shaft tip has a 30-degree lead-in cone with 0.2mm corner blends as shown in Detail-E.'
	},
	{
		id: 'hotspot_section_aa',
		portionId: 'stepped_bore',
		name: 'SECTION A-A: Stepped Bore',
		callout: 'SECTION A-A',
		description: 'Multi-stage internal bore with concentric steps and bottom taper',
		x: 32,
		y: 25,
		w: 38,
		h: 42,
		category: 'Stepped Bore',
		quickPrompt: 'The internal stepped bore has concentric steps with specified diameters and depths as shown in Section A-A.'
	},
	{
		id: 'hotspot_detail_b',
		portionId: 'step',
		name: 'DETAIL-B: Collar Transition',
		callout: 'DETAIL-B',
		description: 'Collar step shoulder with R0.4 transition blend',
		x: 18,
		y: 65,
		w: 18,
		h: 20,
		category: 'Step & Shoulder',
		quickPrompt: 'The transition shoulder at the collar has an R0.4 fillet blend that was missed.'
	},
	{
		id: 'hotspot_detail_c',
		portionId: 'chamfer',
		name: 'DETAIL-C: Outer Chamfer',
		callout: 'DETAIL-C',
		description: '0.2 x 45° outer lead-in chamfer on collar face',
		x: 8,
		y: 68,
		w: 16,
		h: 18,
		category: 'Chamfer',
		quickPrompt: 'Add a 0.2 x 45° chamfer to the outer collar corner as shown in Detail-C.'
	}
];

type BlueprintViewerProps = {
	blueprintUrl: string | null;
	targetPortion: TargetPortion | null;
	onSelectPortion?: (portion: TargetPortion) => void;
	activeParameter?: string | null;
	onClose?: () => void;
	isFloating?: boolean;
	isSplitView?: boolean;
	className?: string;
};

export function BlueprintViewer({
	blueprintUrl,
	targetPortion,
	onSelectPortion,
	activeParameter,
	onClose,
	isFloating = false,
	isSplitView = false,
	className = ''
}: BlueprintViewerProps) {
	const [zoom, setZoom] = useState(1);
	const [pan, setPan] = useState({ x: 0, y: 0 });
	const [isDragging, setIsDragging] = useState(false);
	const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
	const [hoveredHotspot, setHoveredHotspot] = useState<BlueprintHotspot | null>(null);
	const [showHotspots, setShowHotspots] = useState(true);
	const containerRef = useRef<HTMLDivElement>(null);

	// Find the active hotspot based on selected targetPortion
	const activeHotspot = targetPortion
		? BLUEPRINT_DEFAULT_HOTSPOTS.find(h => 
			h.portionId === targetPortion.id || 
			targetPortion.name.toLowerCase().includes(h.portionId) ||
			h.name.toLowerCase().includes(targetPortion.name.toLowerCase())
		) || BLUEPRINT_DEFAULT_HOTSPOTS[0]
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

	// Handle drag / pan
	const handleMouseDown = (e: React.MouseEvent) => {
		if (e.button !== 0) return; // only left click
		setIsDragging(true);
		setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
	};

	const handleMouseMove = (e: React.MouseEvent) => {
		if (!isDragging) return;
		setPan({
			x: e.clientX - dragStart.x,
			y: e.clientY - dragStart.y
		});
	};

	const handleMouseUp = () => {
		setIsDragging(false);
	};

	// Auto-focus on active hotspot when targetPortion changes
	useEffect(() => {
		if (activeHotspot && containerRef.current) {
			// Center pan near the target hotspot
			const targetCenterX = (activeHotspot.x + activeHotspot.w / 2 - 50) * -2;
			const targetCenterY = (activeHotspot.y + activeHotspot.h / 2 - 50) * -2;
			setPan({ x: targetCenterX, y: targetCenterY });
			setZoom(1.3);
		}
	}, [targetPortion?.id]);

	const handleHotspotClick = (hotspot: BlueprintHotspot, e: React.MouseEvent) => {
		e.stopPropagation();
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
				quickPrompts: [hotspot.quickPrompt, ...(preset.quickPrompts || [])]
			});
		}
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
			<div className="absolute top-3 left-3 right-3 z-30 flex items-center justify-between pointer-events-auto">
				{/* Active Target Banner */}
				<div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-zinc-900/90 backdrop-blur-md border border-blue-500/30 shadow-lg">
					<div className="size-2 rounded-full bg-blue-500 animate-pulse shadow-[0_0_8px_rgba(59,130,246,0.8)]" />
					<span className="text-[10px] font-mono font-bold uppercase tracking-wider text-blue-400">
						Blueprint Inspector
					</span>
					{targetPortion && (
						<>
							<ChevronRight className="size-3 text-muted-foreground" />
							<span className="text-[10px] font-bold text-foreground truncate max-w-[150px]">
								{targetPortion.name}
							</span>
						</>
					)}
				</div>

				{/* Zoom & View Controls */}
				<div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-zinc-900/90 backdrop-blur-md border border-border/60 shadow-lg">
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
						title="Toggle Feature Spotlights"
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
			<div className="flex-1 w-full h-full relative cursor-grab active:cursor-grabbing flex items-center justify-center overflow-hidden">
				{blueprintUrl ? (
					<div
						className="relative transition-transform duration-75 origin-center will-change-transform"
						style={{
							transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
						}}
					>
						{/* Base Blueprint Drawing Image */}
						<img
							src={blueprintUrl}
							alt="Technical Blueprint"
							className="max-w-none w-auto h-auto max-h-[85vh] rounded shadow-2xl pointer-events-none select-none"
							draggable={false}
							onError={(e) => {
								console.warn('Blueprint image load failed, showing fallback placeholder', e);
							}}
						/>

						{/* Interactive SVG Spotlight & Hotspot Layer */}
						{showHotspots && (
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
								</defs>

								{/* Render All Detail Hotspots */}
								{BLUEPRINT_DEFAULT_HOTSPOTS.map((hotspot) => {
									const isSelected = activeHotspot?.id === hotspot.id;
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
													{/* Top-Left Reticle */}
													<path
														d={`M ${hotspot.x - 1} ${hotspot.y + 3} L ${hotspot.x - 1} ${hotspot.y - 1} L ${hotspot.x + 3} ${hotspot.y - 1}`}
														fill="none"
														stroke="#60a5fa"
														strokeWidth="0.8"
													/>
													{/* Bottom-Right Reticle */}
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
							</svg>
						)}

						{/* Hotspot Floating Callout Badges */}
						{showHotspots && BLUEPRINT_DEFAULT_HOTSPOTS.map((hotspot) => {
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
					</div>
				) : (
					/* Fallback Empty State */
					<div className="flex flex-col items-center justify-center gap-3 p-8 text-center">
						<div className="size-12 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400">
							<FileImage className="size-6" />
						</div>
						<div>
							<h4 className="text-xs font-bold uppercase tracking-wider text-foreground">No Blueprint Loaded</h4>
							<p className="text-[10px] text-muted-foreground mt-1 max-w-[200px]">
								Upload a technical blueprint in chat to inspect drawing details and targeted features.
							</p>
						</div>
					</div>
				)}
			</div>

			{/* Bottom Targeted Feature Info Footer */}
			<div className="p-2.5 bg-zinc-900/95 border-t border-border/80 flex items-center justify-between text-xs z-30">
				<div className="flex items-center gap-2 min-w-0">
					<div className="size-6 rounded bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400 shrink-0">
						<Target className="size-3" />
					</div>
					<div className="min-w-0">
						<div className="text-[9px] font-mono uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
							<span>Selected Inspection Portion:</span>
							{activeHotspot && <span className="text-blue-400 font-bold">{activeHotspot.category}</span>}
						</div>
						<div className="text-[11px] font-bold text-foreground truncate">
							{targetPortion?.name || (activeHotspot ? activeHotspot.name : 'Select a detail view above')}
						</div>
					</div>
				</div>

				<div className="flex items-center gap-2 shrink-0">
					<span className="text-[9px] font-mono text-muted-foreground">
						Zoom: {Math.round(zoom * 100)}%
					</span>
				</div>
			</div>
		</div>
	);
}
