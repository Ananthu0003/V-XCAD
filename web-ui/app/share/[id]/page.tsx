'use client';

import { useEffect, useState, use, Suspense, Component } from 'react';
import type { ReactNode } from 'react';
import { Loader2, Layers, AlertCircle, Cuboid } from 'lucide-react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Stage, PerspectiveCamera } from '@react-three/drei';
import { StlMesh, type StlGeometryInfo } from '@/components/StlMesh';
import { ThemeToggle } from '@/components/theme-toggle';

// --- Error Boundary for 3D canvas failures ---
class CanvasErrorBoundary extends Component<
	{ children: ReactNode; fallback: ReactNode },
	{ hasError: boolean }
> {
	constructor(props: any) {
		super(props);
		this.state = { hasError: false };
	}
	static getDerivedStateFromError() {
		return { hasError: true };
	}
	render() {
		if (this.state.hasError) return this.props.fallback;
		return this.props.children;
	}
}

// --- 3D Viewer ---
function Viewer3D({ stlUrl, onGeometryReady }: { stlUrl: string; onGeometryReady: (info: StlGeometryInfo) => void }) {
	return (
		<Canvas shadows dpr={[1, 2]} className="w-full h-full">
			<PerspectiveCamera makeDefault position={[5, 5, 5]} fov={40} />
			<Suspense fallback={null}>
				<Stage intensity={0.8} adjustCamera={false} shadows="contact">
					<StlMesh url={stlUrl} onGeometryReady={onGeometryReady} />
				</Stage>
			</Suspense>
			<OrbitControls makeDefault enableDamping dampingFactor={0.05} />
		</Canvas>
	);
}

// --- Main Page ---
export default function SharedModelPage({ params }: { params: Promise<{ id: string }> }) 
	{
	const resolvedParams = use(params);
	const id = resolvedParams.id;

	const [session, setSession] = useState<any>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [geometryInfo, setGeometryInfo] = useState<StlGeometryInfo | null>(null);

	useEffect(() => {
		fetch(`/api/sessions/${id}`)
			.then(res => {
				if (res.status === 404) throw new Error('Model not found');
				if (res.status === 403 || res.status === 401) throw new Error('This model is not shared publicly');
				if (!res.ok) throw new Error('Failed to load model');
				return res.json();
			})
			.then(data => {
				setSession(data);
				setLoading(false);
			})
			.catch(err => {
				setError(err.message);
				setLoading(false);
			});
	}, [id]);

	if (loading) {
		return (
			<div className="h-screen w-full flex flex-col items-center justify-center bg-background text-foreground gap-4">
				<div className="relative">
					<div className="absolute inset-0 rounded-full bg-blue-500/20 blur-xl animate-pulse" />
					<Loader2 className="size-10 animate-spin text-blue-500 relative" />
				</div>
				<p className="text-sm font-semibold tracking-widest text-muted-foreground animate-pulse uppercase">Loading CAD Model...</p>
			</div>
		);
	}

	if (error || !session) {
		return (
			<div className="h-screen w-full flex flex-col items-center justify-center bg-background text-foreground gap-4">
				<div className="size-16 rounded-full bg-red-500/10 flex items-center justify-center border border-red-500/20">
					<AlertCircle className="size-8 text-red-500" />
				</div>
				<h2 className="text-xl font-bold tracking-tight">{error || 'Unknown error'}</h2>
				<p className="text-sm text-muted-foreground">The link might be invalid or the owner has disabled sharing.</p>
			</div>
		);
	}

	const parameters = session.parameters || {};
	const paramEntries = Object.entries(parameters);

	return (
		<div className="relative h-screen w-full bg-background overflow-hidden text-foreground">
			
			{/* ── 3D Viewport Background ── */}
			<div className="absolute inset-0 z-0">
				{/* Ambient background glows (adaptable to light/dark via opacity) */}
				<div className="absolute inset-0 pointer-events-none opacity-50 dark:opacity-100">
					<div className="absolute top-1/4 left-1/4 w-96 h-96 bg-blue-500/10 dark:bg-blue-600/10 rounded-full blur-[128px]" />
					<div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-cyan-500/10 dark:bg-cyan-600/5 rounded-full blur-[128px]" />
				</div>

				{session.stlUrl ? (
					<CanvasErrorBoundary
						fallback={
							<div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-muted-foreground">
								<AlertCircle className="size-8 text-amber-500" />
								<p className="text-sm font-semibold">Could not render 3D model</p>
							</div>
						}
					>
						<div className="absolute inset-0">
							<Viewer3D stlUrl={session.stlUrl} onGeometryReady={setGeometryInfo} />
						</div>
					</CanvasErrorBoundary>
				) : (
					<div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-muted-foreground/50">
						<Cuboid className="size-10 opacity-20" />
						<p className="text-sm">No 3D model available</p>
					</div>
				)}
			</div>

			{/* ── Overlay UI ── */}
			<div className="pointer-events-none absolute inset-0 z-10 flex flex-col justify-between p-6">
				
				{/* Top Section */}
				<div className="flex items-start justify-between w-full">
					{/* Brand & Prompt Floating Card - Clean, glassmorphic design */}
					<div className="pointer-events-auto flex items-center gap-3 rounded-2xl border border-border/50 bg-background/60 dark:bg-black/40 backdrop-blur-xl p-3 shadow-lg max-w-lg transition-all">
						<div className="relative size-10 flex items-center justify-center shrink-0 rounded-xl bg-blue-500/10 border border-blue-500/20">
							<div className="absolute inset-0 bg-blue-500 rounded-xl transform rotate-45 opacity-20" />
							<Cuboid className="size-5 text-blue-500 relative z-10" />
						</div>
						<div className="min-w-0 pr-2">
							<div className="flex items-baseline gap-2">
								<span className="text-lg font-bold tracking-widest bg-clip-text text-transparent bg-gradient-to-r from-gray-900 to-gray-500 dark:from-gray-100 dark:to-gray-500">
									VΞXCAD
								</span>
								<span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
									Shared Model
								</span>
							</div>
							<p className="text-sm font-medium text-foreground/90 truncate leading-tight mt-0.5">{session.prompt}</p>
						</div>
					</div>
				</div>

				{/* Parameters Floating Panel (Bottom Left) */}
				<div className="pointer-events-auto flex flex-col self-start rounded-2xl border border-border/50 bg-background/60 dark:bg-black/40 backdrop-blur-xl shadow-lg max-h-[60vh] w-72 overflow-hidden transition-all">
					<div className="flex items-center gap-2 p-4 border-b border-border/30 bg-muted/30">
						<Layers className="size-4 text-violet-500" />
						<span className="text-[11px] font-bold uppercase tracking-widest text-foreground/80">Parameters</span>
					</div>
					
					<div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar">
						{paramEntries.length > 0 ? (
							paramEntries.map(([key, value]) => (
								<div key={key} className="group p-3 rounded-xl bg-background/50 border border-border/40 hover:border-blue-500/30 transition-colors">
									<p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1">{key}</p>
									<p className="text-sm font-mono font-semibold text-foreground">{String(value)}</p>
								</div>
							))
						) : (
							<div className="rounded-xl border border-dashed border-border/40 p-6 text-center">
								<p className="text-xs text-muted-foreground">No parameters recorded</p>
							</div>
						)}
					</div>
				</div>

			</div>

			{/* Bottom Center Hint */}
			<div className="pointer-events-none absolute bottom-6 left-1/2 -translate-x-1/2 z-20 flex items-center gap-3 rounded-full border border-border/50 bg-background/60 dark:bg-black/40 backdrop-blur-xl px-5 py-2 shadow-lg transition-all">
				<div className={`size-2 rounded-full ${session.stlUrl ? 'bg-cyan-500 shadow-[0_0_8px_rgba(6,182,212,0.6)] animate-pulse' : 'bg-muted-foreground'}`} />
				<p className="text-[10px] font-bold uppercase tracking-widest text-foreground/80">
					Drag to rotate · Scroll to zoom
				</p>
			</div>
		</div>
	);
}
