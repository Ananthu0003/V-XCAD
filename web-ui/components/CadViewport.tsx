'use client';

import { Suspense, useState, useRef, useEffect } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Stage, PerspectiveCamera, Line, GizmoHelper, GizmoViewport, Grid, Environment, ContactShadows } from '@react-three/drei';
import { Loader2, Share2, Download, ChevronDown, Layers, Box, Activity, ChevronRight, CheckCircle2 } from 'lucide-react';
import { DimensionOverlay } from './DimensionOverlay';
import type { StlGeometryInfo } from './StlMesh';

type AnnotationEntry = {
	p1: [number, number, number];
	p2: [number, number, number];
};

type CadViewportProps = {
	stlUrl: string | null;
	statusText: string;
	isRecompiling: boolean;
	hasStl: boolean;
	hasStep: boolean;
	hasDxf: boolean;
	hasGcode?: boolean;
	isDeveloper: boolean;
	isDownloadingStl: boolean;
	isDownloadingStep: boolean;
	isDownloadingDxf: boolean;
	isDownloadingGcode?: boolean;
	isSharing?: boolean;
	onShare?: () => void;
	onDownloadStl: () => void;
	onDownloadStep: () => void;
	onDownloadDxf: () => void;
	onDownloadGcode?: () => void;
	annotations?: Record<string, AnnotationEntry>;
	activeParameter?: string | null;
	geometryInfo?: StlGeometryInfo | null;
	
	// CAM/G-code
	toolpaths?: number[][][] | null;
	showToolpaths?: boolean;
	workflowStage?: 'blueprint' | 'extraction' | 'cad' | 'cam' | 'gcode';
	camFeatures?: { id: string; location: [number, number, number] }[];
	activeFeatureId?: string | null;

	children?: React.ReactNode; // For StlMesh
	headerActions?: React.ReactNode;
};

export function CadViewport({
	stlUrl,
	statusText,
	isRecompiling,
	hasStl,
	hasStep,
	hasDxf,
	hasGcode = false,
	isDeveloper,
	isDownloadingStl,
	isDownloadingStep,
	isDownloadingDxf,
	isDownloadingGcode = false,
	isSharing = false,
	onShare,
	onDownloadStl,
	onDownloadStep,
	onDownloadDxf,
	onDownloadGcode,
	annotations = {},
	activeParameter = null,
	geometryInfo = null,
	toolpaths = null,
	showToolpaths = true,
	workflowStage = 'blueprint',
	camFeatures = [],
	activeFeatureId = null,
	children,
	headerActions,
}: CadViewportProps) {
	const [exportOpen, setExportOpen] = useState(false);
	const exportRef = useRef<HTMLDivElement>(null);
	
	const [viewMode, setViewMode] = useState<'both' | 'solid' | 'wireframe'>('both');

	useEffect(() => {
		const handleClickOutside = (e: MouseEvent) => {
			if (exportRef.current && !exportRef.current.contains(e.target as Node)) {
				setExportOpen(false);
			}
		};
		document.addEventListener('mousedown', handleClickOutside);
		return () => document.removeEventListener('mousedown', handleClickOutside);
	}, []);

	const isSolidVisible = viewMode === 'both' || viewMode === 'solid';
	const isWireframeVisible = (viewMode === 'both' || viewMode === 'wireframe') && showToolpaths;

	return (
		<section className="relative flex h-full w-full flex-col overflow-hidden bg-background font-sans">
			<header className="flex h-16 items-center justify-between border-b border-transparent bg-background/60 backdrop-blur-xl px-6 z-50">
				<div className="flex flex-col gap-1.5">
					<div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
						{/* Workflow breadcrumb removed per user request */}
					</div>
					<p className="text-sm font-semibold text-foreground flex items-center gap-2">
						{isRecompiling || statusText.includes('Extracting') || statusText.includes('Generating') || statusText.includes('Syncing') ? (
							<Loader2 className="size-3.5 animate-spin text-blue-500" />
						) : (
							<span className={`size-1.5 rounded-full ${hasStl ? 'bg-cyan-500 shadow-[0_0_8px_rgba(6,182,212,0.8)]' : 'bg-muted'}`} />
						)}
						{statusText}
					</p>
				</div>
				
				<div className="flex items-center gap-2">
					{headerActions}
					
					{onShare && (
						<button
							onClick={onShare}
							disabled={isSharing}
							className="flex h-9 items-center gap-2 rounded-lg border border-transparent bg-background px-4 text-[11px] font-bold uppercase tracking-wider text-foreground hover:border-blue-500 hover:text-blue-500 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
						>
							{isSharing ? <Loader2 className="size-3 animate-spin" /> : <Share2 className="size-3" />}
							Share
						</button>
					)}
					
					{(hasDxf || hasStl || hasGcode || hasStep) && (
						<div className="relative" ref={exportRef}>
							<button
								onClick={() => setExportOpen(!exportOpen)}
								className="flex h-9 items-center gap-2 rounded-lg bg-blue-500 px-4 text-[11px] font-bold uppercase tracking-wider text-black hover:bg-blue-400 shadow-sm transition-all"
							>
								<Download className="size-3" />
								Export
								<ChevronDown className={`size-3 transition-transform ${exportOpen ? 'rotate-180' : ''}`} />
							</button>
							{exportOpen && (
								<div className="absolute right-0 mt-2 w-52 rounded-xl border border-transparent bg-background/95 backdrop-blur-md shadow-xl overflow-hidden z-50 py-1">
									{hasStl && (
										<button
											onClick={() => { setExportOpen(false); if (isDeveloper) onDownloadStl(); }}
											disabled={isDownloadingStl || !isDeveloper}
											title={!isDeveloper ? 'Export is restricted to admins' : undefined}
											className="flex w-full items-start gap-3 px-4 py-2.5 text-left hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed group transition-colors"
										>
											{isDownloadingStl ? <Loader2 className="size-4 animate-spin mt-0.5 text-foreground" /> : <Layers className="size-4 mt-0.5 text-foreground group-hover:text-blue-500 transition-colors" />}
											<div className="flex flex-col gap-0.5">
												<span className="text-[11px] font-bold uppercase tracking-wider text-foreground">STL Format</span>
												<span className="text-[10px] text-muted-foreground font-medium normal-case leading-snug">3D printing mesh</span>
											</div>
										</button>
									)}
									{hasStep && (
										<button
											onClick={() => { setExportOpen(false); if (isDeveloper) onDownloadStep(); }}
											disabled={isDownloadingStep || !isDeveloper}
											title={!isDeveloper ? 'Export is restricted to admins' : undefined}
											className="flex w-full items-start gap-3 px-4 py-2.5 text-left hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed group transition-colors"
										>
											{isDownloadingStep ? <Loader2 className="size-4 animate-spin mt-0.5 text-blue-500" /> : <Box className="size-4 mt-0.5 text-blue-500" />}
											<div className="flex flex-col gap-0.5">
												<span className="text-[11px] font-bold uppercase tracking-wider text-blue-500">STEP Format</span>
												<span className="text-[10px] text-muted-foreground font-medium normal-case leading-snug">Solid CAD model</span>
											</div>
										</button>
									)}
									{hasDxf && (
										<button
											onClick={() => { setExportOpen(false); if (isDeveloper) onDownloadDxf(); }}
											disabled={isDownloadingDxf || !isDeveloper}
											title={!isDeveloper ? 'Export is restricted to admins' : undefined}
											className="flex w-full items-start gap-3 px-4 py-2.5 text-left hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed group transition-colors"
										>
											{isDownloadingDxf ? <Loader2 className="size-4 animate-spin mt-0.5 text-foreground" /> : <Layers className="size-4 mt-0.5 text-foreground group-hover:text-cyan-400 transition-colors" />}
											<div className="flex flex-col gap-0.5">
												<span className="text-[11px] font-bold uppercase tracking-wider text-foreground">DXF Format</span>
												<span className="text-[10px] text-muted-foreground font-medium normal-case leading-snug">2D vector profiles</span>
											</div>
										</button>
									)}
								</div>
							)}
						</div>
					)}
				</div>
			</header>

			<div className="relative flex-1">
				{/* View Mode Controls */}
				{(hasStl || (toolpaths && toolpaths.length > 0)) && (
					<div className="absolute top-6 left-1/2 -translate-x-1/2 z-20 flex gap-1 bg-background/80 backdrop-blur-md border border-transparent rounded-xl p-1.5 shadow-xl">
						<button
							onClick={() => setViewMode('both')}
							className={`p-3 rounded-lg transition-colors ${viewMode === 'both' ? 'bg-blue-500/20 text-blue-500' : 'text-muted-foreground hover:bg-accent hover:text-foreground'}`}
							title="Show Both"
						>
							<Layers className="size-5" />
						</button>
						<button
							onClick={() => setViewMode('solid')}
							className={`p-3 rounded-lg transition-colors ${viewMode === 'solid' ? 'bg-blue-500/20 text-blue-500' : 'text-muted-foreground hover:bg-accent hover:text-foreground'}`}
							title="Solid Model Only"
						>
							<Box className="size-5" />
						</button>
						{toolpaths && toolpaths.length > 0 && (
							<button
								onClick={() => setViewMode('wireframe')}
								className={`p-3 rounded-lg transition-colors ${viewMode === 'wireframe' ? 'bg-cyan-500/20 text-cyan-400' : 'text-muted-foreground hover:bg-accent hover:text-foreground'}`}
								title="Toolpaths/Wireframe Only"
							>
								<Activity className="size-5" />
							</button>
						)}
					</div>
				)}

				{/* Ambient Background Effects */}
				<div className="absolute inset-0 z-0 pointer-events-none">
					<div className="absolute top-1/4 left-1/4 w-96 h-96 bg-blue-600/10 rounded-full blur-[128px]" />
					<div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-cyan-600/5 rounded-full blur-[128px]" />
					<div className="absolute inset-0 bg-[url('/grid.svg')] bg-center [mask-image:linear-gradient(180deg,white,rgba(255,255,255,0))] opacity-10" />
				</div>

				<Canvas shadows dpr={[1, 2]} className="relative z-10">
					<PerspectiveCamera makeDefault position={[5, 5, 5]} fov={40} />
					
					<Suspense fallback={null}>
						<Environment preset="city" />
						<Grid infiniteGrid fadeDistance={50} sectionColor="#1e3a8a" cellColor="#0f172a" cellSize={1} sectionSize={10} position={[0, -0.01, 0]} />
						<Stage intensity={0.8} adjustCamera={false} shadows="contact">
							{isSolidVisible && children}
							{isWireframeVisible && (
								<group
									scale={geometryInfo?.scale || 1}
									position={
										geometryInfo?.center
											? [
													-geometryInfo.center[0] * (geometryInfo.scale || 1),
													-geometryInfo.center[1] * (geometryInfo.scale || 1),
													-geometryInfo.center[2] * (geometryInfo.scale || 1),
											  ]
											: [0, 0, 0]
									}
								>
									{/* Render CAM Toolpaths */}
									{showToolpaths && toolpaths && toolpaths.map((path, idx) => (
										<Line
											key={idx}
											points={path as [number, number, number][]}
											color="#3b82f6"
											lineWidth={1.5}
											dashed={false}
										/>
									))}

									{/* Render Active Feature Indicator */}
									{activeFeatureId && camFeatures && (
										camFeatures.filter(f => f.id === activeFeatureId).map(f => {
											// If we have faceIds, we would highlight them here (requires STEP/glTF with face groups)
											// For now, if no faceIds are present, we just show a subtle center marker
											const hasFaceIds = (f as any).faceIds || (f as any).meshGroupIds;
											
											if (!hasFaceIds) {
												return (
													<mesh key={`feature-${f.id}`} position={f.location}>
														<sphereGeometry args={[0.2, 8, 8]} />
														<meshBasicMaterial color="#ef4444" wireframe opacity={0.5} transparent />
													</mesh>
												);
											}
											return null;
										})
									)}
								</group>
							)}
						</Stage>
						
						<GizmoHelper alignment="top-right" margin={[50, 50]}>
							<GizmoViewport axisColors={['#ef4444', '#22c55e', '#3b82f6']} labelColor="black" />
						</GizmoHelper>
					</Suspense>

					<OrbitControls makeDefault />

					{/* Dimension overlay */}
					{geometryInfo && activeParameter && Object.keys(annotations).length > 0 && (
						<DimensionOverlay
							annotations={annotations}
							activeParameter={activeParameter}
							geometryScale={geometryInfo.scale}
							geometryCenter={geometryInfo.center}
						/>
					)}

					<OrbitControls makeDefault enableDamping dampingFactor={0.05} minPolarAngle={0} maxPolarAngle={Math.PI / 1.75} />
				</Canvas>

				{!stlUrl && !isRecompiling && (
					<div className="pointer-events-none absolute inset-0 flex items-center justify-center p-12 z-20">
						<div className="relative max-w-md w-full">
							{/* Outer glow aura */}
							<div className="absolute inset-0 rounded-3xl bg-blue-500/5 dark:bg-blue-500/10 blur-2xl dark:blur-3xl scale-105 dark:scale-110" />
							
							{/* Main card */}
							<div className="relative rounded-3xl border border-transparent/50 dark:border-white/10 bg-background/90 dark:bg-black/60 p-12 text-center shadow-xl backdrop-blur-2xl">
								
								{/* Top accent line */}
								<div className="absolute inset-x-0 top-0 h-px rounded-t-3xl bg-gradient-to-r from-transparent via-blue-500/40 to-transparent" />
								
								{/* Rotating wireframe icon */}
								<div className="mx-auto mb-7 relative flex size-20 items-center justify-center">
									{/* Orbit ring */}
									<div className="absolute inset-0 rounded-full border border-blue-500/15 animate-spin" style={{ animationDuration: '8s' }} />
									<div className="absolute inset-2 rounded-full border border-dashed border-blue-500/10 animate-spin" style={{ animationDuration: '12s', animationDirection: 'reverse' }} />
									{/* Center glow */}
									<div className="absolute size-10 rounded-full bg-blue-500/8 blur-md" />
									{/* Isometric 3D wireframe cube SVG */}
									<svg
										viewBox="0 0 48 48"
										fill="none"
										className="size-9 animate-spin"
										style={{ animationDuration: '20s', animationTimingFunction: 'linear' }}
									>
										{/* Top face */}
										<polygon points="24,4 40,14 24,24 8,14" stroke="rgb(59,130,246)" strokeWidth="1.2" strokeLinejoin="round" fill="rgba(59,130,246,0.04)" />
										{/* Left face */}
										<polygon points="8,14 24,24 24,44 8,34" stroke="rgb(59,130,246)" strokeWidth="1.2" strokeLinejoin="round" fill="rgba(59,130,246,0.02)" />
										{/* Right face */}
										<polygon points="40,14 24,24 24,44 40,34" stroke="rgb(59,130,246)" strokeWidth="1.2" strokeLinejoin="round" fill="rgba(59,130,246,0.06)" />
										{/* Interior guide lines */}
										<line x1="24" y1="24" x2="24" y2="4" stroke="rgb(59,130,246)" strokeWidth="0.5" strokeDasharray="2,3" strokeOpacity="0.3" />
										<line x1="24" y1="24" x2="8" y2="14" stroke="rgb(59,130,246)" strokeWidth="0.5" strokeDasharray="2,3" strokeOpacity="0.3" />
										<line x1="24" y1="24" x2="40" y2="14" stroke="rgb(59,130,246)" strokeWidth="0.5" strokeDasharray="2,3" strokeOpacity="0.3" />
									</svg>
								</div>
								
								{/* Status badge */}
								<div className="mx-auto mb-6 flex w-fit items-center gap-2 rounded-full border border-blue-500/20 bg-blue-50/50 dark:bg-blue-500/5 px-4 py-1.5 shadow-sm">
									<div className="size-1.5 rounded-full bg-blue-500 animate-pulse shadow-sm" />
									<span className="text-[10px] font-bold uppercase tracking-[0.05em] text-blue-600 dark:text-blue-200">Geometry Engine — Idle</span>
								</div>
								
								<h3 className="text-xl font-bold tracking-tight text-foreground">Awaiting Parameters</h3>
							</div>
						</div>
					</div>
				)}

				{isRecompiling && (
					<div className="absolute inset-0 flex items-center justify-center bg-black/70 backdrop-blur-md z-20">
						<div className="relative">
							{/* Glow behind card */}
							<div className="absolute inset-0 rounded-2xl bg-blue-500/10 blur-xl scale-150" />
							<div className="relative flex items-center gap-4 rounded-2xl border border-blue-500/25 bg-background/95 px-7 py-5 shadow-lg">
								<div className="relative shrink-0">
									<div className="absolute inset-0 animate-ping rounded-full bg-blue-500/20" />
									<div className="relative flex size-9 items-center justify-center rounded-full border border-blue-500/30 bg-blue-500/10">
										<Loader2 className="size-4 animate-spin text-blue-500" />
									</div>
								</div>
								<div className="flex flex-col">
									<span className="text-[11px] font-black uppercase tracking-[0.05em] text-foreground">Engine Active</span>
									<span className="mt-0.5 text-[10px] text-muted-foreground">Recomputing Geometry Topology…</span>
								</div>
							</div>
						</div>
					</div>
				)}

				{/* Feature Missing Face Mapping Overlay */}
				{activeFeatureId && camFeatures && (
					(() => {
						const activeFeat = camFeatures.find(f => f.id === activeFeatureId);
						const hasFaceIds = activeFeat && ((activeFeat as any).faceIds || (activeFeat as any).meshGroupIds);
						if (activeFeat && !hasFaceIds) {
							return (
								<div className="absolute top-24 left-1/2 -translate-x-1/2 z-30 pointer-events-none">
									<div className="flex items-center gap-2 rounded-lg border border-orange-500/30 bg-[#050814]/90 px-4 py-2 backdrop-blur-md shadow-xl shadow-black/50">
										<svg className="size-3 text-orange-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
											<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
										</svg>
										<span className="text-[11px] font-bold uppercase tracking-wider text-orange-400">
											Exact face mapping unavailable
										</span>
									</div>
								</div>
							);
						}
						return null;
					})()
				)}

				{/* Global Safety Note */}
				<div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-10 flex items-center gap-3 rounded-full border border-transparent bg-background/80 px-5 py-2.5 backdrop-blur-xl transition-all hover:border-blue-500/30 whitespace-nowrap">
					<svg className="size-3 text-blue-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
						<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
					</svg>
					<p className="text-[9px] font-bold uppercase tracking-wide text-muted-foreground">
						AI can make mistakes. Verify critical dimensions against original blueprints.
					</p>
				</div>
			</div>
		</section>
	);
}
