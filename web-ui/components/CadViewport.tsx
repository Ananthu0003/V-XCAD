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
		<section className="relative flex flex-1 flex-col overflow-hidden bg-black">
			<header className="flex h-16 items-center justify-between border-b border-zinc-800 bg-[#09090b]/80 backdrop-blur-md px-6 z-10">
				<div>
					<p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Geometry Stream</p>
					<p className="text-sm font-medium text-zinc-100 flex items-center gap-2">
						<span className={`size-1.5 rounded-full ${stlUrl ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'}`} />
						{statusText}
					</p>
				</div>
				
				<div className="flex items-center gap-2">
					{hasDxf && (
						<button
							onClick={onDownloadDxf}
							disabled={isDownloadingDxf}
							className="flex h-9 items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-4 text-[11px] font-bold uppercase tracking-wider text-zinc-100 hover:border-zinc-500 hover:bg-zinc-800 transition-all disabled:opacity-50"
						>
							{isDownloadingDxf ? <Loader2 className="size-3 animate-spin" /> : 'DXF'}
						</button>
					)}

					{hasStl && (
						<button
							onClick={onDownloadStl}
							disabled={isDownloadingStl}
							className="flex h-9 items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-4 text-[11px] font-bold uppercase tracking-wider text-zinc-100 hover:border-zinc-500 hover:bg-zinc-800 transition-all disabled:opacity-50"
						>
							{isDownloadingStl ? <Loader2 className="size-3 animate-spin" /> : 'STL'}
						</button>
					)}
					{hasStep && (
						<button
							onClick={onDownloadStep}
							disabled={isDownloadingStep}
							className="flex h-9 items-center gap-2 rounded-lg bg-amber-500 px-4 text-[11px] font-bold uppercase tracking-wider text-black hover:bg-amber-400 shadow-[0_0_15px_rgba(245,158,11,0.2)] transition-all disabled:opacity-50"
						>
							{isDownloadingStep ? <Loader2 className="size-3 animate-spin" /> : 'STEP'}
						</button>
					)}
				</div>
			</header>

			<div className="relative flex-1">
				<Canvas shadows dpr={[1, 2]}>
					<PerspectiveCamera makeDefault position={[5, 5, 5]} fov={40} />
					<color attach="background" args={['#000000']} />
					
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
					<div className="pointer-events-none absolute inset-0 flex items-center justify-center p-12">
						<div className="relative max-w-sm w-full">
							{/* Outer glow aura */}
							<div className="absolute inset-0 rounded-3xl bg-amber-500/5 blur-2xl scale-110" />
							
							{/* Main card */}
							<div className="relative rounded-3xl border border-white/8 bg-gradient-to-b from-zinc-900/70 to-zinc-950/90 p-10 text-center shadow-[0_32px_80px_rgba(0,0,0,0.6),0_0_0_1px_rgba(255,255,255,0.04)] backdrop-blur-2xl">
								
								{/* Top accent line */}
								<div className="absolute inset-x-0 top-0 h-px rounded-t-3xl bg-gradient-to-r from-transparent via-amber-500/40 to-transparent" />
								
								{/* Rotating wireframe icon */}
								<div className="mx-auto mb-7 relative flex size-20 items-center justify-center">
									{/* Orbit ring */}
									<div className="absolute inset-0 rounded-full border border-amber-500/15 animate-spin" style={{ animationDuration: '8s' }} />
									<div className="absolute inset-2 rounded-full border border-dashed border-amber-500/10 animate-spin" style={{ animationDuration: '12s', animationDirection: 'reverse' }} />
									{/* Center glow */}
									<div className="absolute size-10 rounded-full bg-amber-500/8 blur-md" />
									{/* Isometric 3D wireframe cube SVG */}
									<svg
										viewBox="0 0 48 48"
										fill="none"
										className="size-9 animate-spin drop-shadow-[0_0_8px_rgba(245,158,11,0.5)]"
										style={{ animationDuration: '20s', animationTimingFunction: 'linear' }}
									>
										{/* Top face */}
										<polygon points="24,4 40,14 24,24 8,14" stroke="rgb(245,158,11)" strokeWidth="1.2" strokeLinejoin="round" fill="rgba(245,158,11,0.04)" />
										{/* Left face */}
										<polygon points="8,14 24,24 24,44 8,34" stroke="rgb(245,158,11)" strokeWidth="1.2" strokeLinejoin="round" fill="rgba(245,158,11,0.02)" />
										{/* Right face */}
										<polygon points="40,14 24,24 24,44 40,34" stroke="rgb(245,158,11)" strokeWidth="1.2" strokeLinejoin="round" fill="rgba(245,158,11,0.06)" />
										{/* Interior guide lines */}
										<line x1="24" y1="24" x2="24" y2="4" stroke="rgb(245,158,11)" strokeWidth="0.5" strokeDasharray="2,3" strokeOpacity="0.3" />
										<line x1="24" y1="24" x2="8" y2="14" stroke="rgb(245,158,11)" strokeWidth="0.5" strokeDasharray="2,3" strokeOpacity="0.3" />
										<line x1="24" y1="24" x2="40" y2="14" stroke="rgb(245,158,11)" strokeWidth="0.5" strokeDasharray="2,3" strokeOpacity="0.3" />
									</svg>
								</div>
								
								{/* Status badge */}
								<div className="mx-auto mb-5 flex w-fit items-center gap-2 rounded-full border border-zinc-700/50 bg-zinc-900/80 px-3 py-1">
									<div className="size-1.5 rounded-full bg-amber-500 animate-pulse" />
									<span className="text-[9px] font-mono font-bold uppercase tracking-[0.2em] text-zinc-500">Geometry Engine — Idle</span>
								</div>
								
								<h3 className="mb-3 text-base font-bold tracking-tight text-zinc-100">Awaiting Parameters</h3>
								<p className="mx-auto max-w-[220px] text-[11px] text-zinc-500 leading-relaxed">
									Upload a technical blueprint and generate a script to render your parametric 3D model here.
								</p>
								
								{/* Step indicators */}
								<div className="mt-7 flex items-center justify-center gap-3">
									{[['01', 'Upload'], ['02', 'Generate'], ['03', 'Render']].map(([num, label], i) => (
										<div key={num} className="flex items-center gap-3">
											<div className="flex flex-col items-center gap-1">
												<div className="flex size-6 items-center justify-center rounded-full border border-zinc-700/50 bg-zinc-900/80">
													<span className="text-[8px] font-black text-zinc-600">{num}</span>
												</div>
												<span className="text-[8px] font-bold uppercase tracking-wider text-zinc-700">{label}</span>
											</div>
											{i < 2 && <div className="h-px w-6 bg-zinc-800 mb-3" />}
										</div>
									))}
								</div>
							</div>
						</div>
					</div>
				)}

				{isRecompiling && (
					<div className="absolute inset-0 flex items-center justify-center bg-black/70 backdrop-blur-md z-20">
						<div className="relative">
							{/* Glow behind card */}
							<div className="absolute inset-0 rounded-2xl bg-amber-500/10 blur-xl scale-150" />
							<div className="relative flex items-center gap-4 rounded-2xl border border-amber-500/25 bg-zinc-950/95 px-7 py-5 shadow-[0_0_40px_rgba(245,158,11,0.12)]">
								<div className="relative shrink-0">
									<div className="absolute inset-0 animate-ping rounded-full bg-amber-500/20" />
									<div className="relative flex size-9 items-center justify-center rounded-full border border-amber-500/30 bg-amber-500/10">
										<Loader2 className="size-4 animate-spin text-amber-500" />
									</div>
								</div>
								<div className="flex flex-col">
									<span className="text-[11px] font-black uppercase tracking-[0.2em] text-zinc-100">Engine Active</span>
									<span className="mt-0.5 text-[10px] text-zinc-500">Recomputing Geometry Topology…</span>
								</div>
							</div>
						</div>
					</div>
				)}

				{/* Global Safety Note */}
				<div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-10 flex items-center gap-3 rounded-full border border-zinc-800/50 bg-[#09090b]/80 px-5 py-2.5 backdrop-blur-xl transition-all hover:border-amber-500/30 whitespace-nowrap">
					<svg className="size-3 text-amber-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
						<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
					</svg>
					<p className="text-[9px] font-bold uppercase tracking-[0.15em] text-zinc-500">
						AI can make mistakes. Verify critical dimensions against original blueprints.
					</p>
				</div>
			</div>
		</section>
	);
}
