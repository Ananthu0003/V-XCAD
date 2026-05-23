'use client';

import { Suspense } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Stage, PerspectiveCamera } from '@react-three/drei';
import { Loader2 } from 'lucide-react';
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
	isDeveloper: boolean;
	isDownloadingStl: boolean;
	isDownloadingStep: boolean;
	isDownloadingDxf: boolean;
	onDownloadStl: () => void;
	onDownloadStep: () => void;
	onDownloadDxf: () => void;
	annotations?: Record<string, AnnotationEntry>;
	activeParameter?: string | null;
	geometryInfo?: StlGeometryInfo | null;

	children?: React.ReactNode; // For StlMesh
};

export function CadViewport({
	stlUrl,
	statusText,
	isRecompiling,
	hasStl,
	hasStep,
	hasDxf,
	isDeveloper,
	isDownloadingStl,
	isDownloadingStep,
	isDownloadingDxf,
	onDownloadStl,
	onDownloadStep,
	onDownloadDxf,
	annotations = {},
	activeParameter = null,
	geometryInfo = null,

	children,
}: CadViewportProps) {
	return (
		<section className="relative flex flex-1 flex-col overflow-hidden bg-background font-sans">
			<header className="flex h-16 items-center justify-between border-b border-border bg-background/60 backdrop-blur-xl px-6 z-10">
				<div>
					<p className="text-[11px] font-bold uppercase tracking-[0.2em] text-muted-foreground">Geometry Stream</p>
					<p className="text-sm font-semibold text-foreground flex items-center gap-2">
						<span className={`size-1.5 rounded-full ${stlUrl ? 'bg-cyan-500 animate-pulse' : 'bg-blue-500'}`} />
						{statusText}
					</p>
				</div>
				
				<div className="flex items-center gap-2">
					{hasDxf && (
						<button
							onClick={isDeveloper ? onDownloadDxf : undefined}
							disabled={isDownloadingDxf || !isDeveloper}
							title={!isDeveloper ? 'Export is restricted to admins' : undefined}
							className="flex h-9 items-center gap-2 rounded-lg border border-border bg-background px-4 text-[11px] font-bold uppercase tracking-wider text-foreground hover:border-muted-foreground hover:bg-accent transition-all disabled:opacity-40 disabled:cursor-not-allowed"
						>
							{isDownloadingDxf ? <Loader2 className="size-3 animate-spin" /> : 'DXF'}
						</button>
					)}

					{hasStl && (
						<button
							onClick={isDeveloper ? onDownloadStl : undefined}
							disabled={isDownloadingStl || !isDeveloper}
							title={!isDeveloper ? 'Export is restricted to admins' : undefined}
							className="flex h-9 items-center gap-2 rounded-lg border border-border bg-background px-4 text-[11px] font-bold uppercase tracking-wider text-foreground hover:border-muted-foreground hover:bg-accent transition-all disabled:opacity-40 disabled:cursor-not-allowed"
						>
							{isDownloadingStl ? <Loader2 className="size-3 animate-spin" /> : 'STL'}
						</button>
					)}
					{hasStep && (
						<button
							onClick={isDeveloper ? onDownloadStep : undefined}
							disabled={isDownloadingStep || !isDeveloper}
							title={!isDeveloper ? 'Export is restricted to admins' : undefined}
							className="flex h-9 items-center gap-2 rounded-lg bg-blue-500 px-4 text-[11px] font-bold uppercase tracking-wider text-black hover:bg-blue-400 shadow-[0_0_15px_rgba(59,130,246,0.2)] transition-all disabled:opacity-40 disabled:cursor-not-allowed"
						>
							{isDownloadingStep ? <Loader2 className="size-3 animate-spin" /> : 'STEP'}
						</button>
					)}
				</div>
			</header>

			<div className="relative flex-1">
				{/* Ambient Background Effects (visible when Canvas is transparent or not covering everything) */}
				<div className="absolute inset-0 z-0 pointer-events-none">
					<div className="absolute top-1/4 left-1/4 w-96 h-96 bg-blue-600/10 rounded-full blur-[128px]" />
					<div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-cyan-600/5 rounded-full blur-[128px]" />
					<div className="absolute inset-0 bg-[url('/grid.svg')] bg-center [mask-image:linear-gradient(180deg,white,rgba(255,255,255,0))] opacity-10" />
				</div>

				<Canvas shadows dpr={[1, 2]} className="relative z-10">
					<PerspectiveCamera makeDefault position={[5, 5, 5]} fov={40} />
					{/* Removed solid black background to let ambient effects bleed through slightly, or keep very dark transparent */}
					
					<Suspense fallback={null}>
						<Stage intensity={0.8} adjustCamera={false} shadows="contact">
							{children}
						</Stage>
					</Suspense>

					{/* Dimension overlay - rendered at Canvas root level */}
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
							<div className="relative rounded-3xl border border-border/50 dark:border-white/10 bg-background/90 dark:bg-black/60 p-12 text-center shadow-xl dark:shadow-[0_32px_80px_rgba(0,0,0,0.8),0_0_0_1px_rgba(255,255,255,0.05)] backdrop-blur-2xl">
								
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
										className="size-9 animate-spin drop-shadow-[0_0_8px_rgba(59,130,246,0.5)]"
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
								<div className="mx-auto mb-6 flex w-fit items-center gap-2 rounded-full border border-blue-500/20 bg-blue-50/50 dark:bg-blue-500/5 px-4 py-1.5 shadow-sm dark:shadow-[0_0_15px_rgba(59,130,246,0.1)]">
									<div className="size-1.5 rounded-full bg-blue-500 animate-pulse shadow-[0_0_8px_rgba(59,130,246,0.5)] dark:shadow-[0_0_8px_rgba(59,130,246,0.8)]" />
									<span className="text-[10px] font-bold uppercase tracking-[0.2em] text-blue-600 dark:text-blue-200">Geometry Engine — Idle</span>
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
							<div className="relative flex items-center gap-4 rounded-2xl border border-blue-500/25 bg-background/95 px-7 py-5 shadow-[0_0_40px_rgba(59,130,246,0.12)]">
								<div className="relative shrink-0">
									<div className="absolute inset-0 animate-ping rounded-full bg-blue-500/20" />
									<div className="relative flex size-9 items-center justify-center rounded-full border border-blue-500/30 bg-blue-500/10">
										<Loader2 className="size-4 animate-spin text-blue-500" />
									</div>
								</div>
								<div className="flex flex-col">
									<span className="text-[11px] font-black uppercase tracking-[0.2em] text-foreground">Engine Active</span>
									<span className="mt-0.5 text-[10px] text-muted-foreground">Recomputing Geometry Topology…</span>
								</div>
							</div>
						</div>
					</div>
				)}

				{/* Global Safety Note */}
				<div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-10 flex items-center gap-3 rounded-full border border-border bg-background/80 px-5 py-2.5 backdrop-blur-xl transition-all hover:border-blue-500/30 whitespace-nowrap">
					<svg className="size-3 text-blue-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
						<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
					</svg>
					<p className="text-[9px] font-bold uppercase tracking-[0.15em] text-muted-foreground">
						AI can make mistakes. Verify critical dimensions against original blueprints.
					</p>
				</div>
			</div>
		</section>
	);
}
