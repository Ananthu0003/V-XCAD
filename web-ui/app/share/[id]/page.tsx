'use client';

import { useEffect, useState, use, Suspense, Component } from 'react';
import type { ReactNode } from 'react';
import { Loader2, Layers, AlertCircle, Cuboid } from 'lucide-react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Stage, PerspectiveCamera } from '@react-three/drei';
import { StlMesh, type StlGeometryInfo } from '@/components/viewport/StlMesh';
import { ThemeToggle } from '@/components/shared/theme-toggle';

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
				<Stage intensity={0.8} adjustCamera={1.5} shadows="contact">
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
			<div className="h-screen w-full flex flex-col items-center justify-center bg-zinc-950 text-white gap-6">
				<div className="relative">
					<div className="absolute inset-0 rounded-full bg-blue-500/30 blur-2xl animate-pulse" />
					<div className="relative flex size-16 items-center justify-center rounded-full bg-blue-500/10 border border-blue-500/30 backdrop-blur-xl">
						<Loader2 className="size-8 animate-spin text-blue-400" />
					</div>
				</div>
				<p className="text-xs font-bold tracking-[0.2em] text-blue-400/80 animate-pulse uppercase">Initializing Environment...</p>
			</div>
		);
	}

	if (error || !session) {
		return (
			<div className="h-screen w-full flex flex-col items-center justify-center bg-zinc-950 text-white gap-6">
				<div className="relative size-20 flex items-center justify-center">
					<div className="absolute inset-0 rounded-full bg-red-500/20 blur-2xl" />
					<div className="relative flex size-full items-center justify-center rounded-full bg-red-500/10 border border-red-500/30 backdrop-blur-xl">
						<AlertCircle className="size-10 text-red-400" />
					</div>
				</div>
				<div className="text-center space-y-2">
					<h2 className="text-2xl font-bold tracking-tight text-red-50">{error || 'Unknown error'}</h2>
					<p className="text-sm text-zinc-400">The link might be invalid or the owner has disabled sharing.</p>
				</div>
			</div>
		);
	}

	const parameters = session.parameters || {};
	const paramEntries = Object.entries(parameters);

	return (
		<div className="relative h-screen w-full bg-zinc-950 overflow-hidden text-zinc-50 font-sans">
			
			{/* ── Background Gradients ── */}
			<div className="absolute inset-0 z-0 pointer-events-none">
				<div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-blue-900/10 via-zinc-950 to-zinc-950" />
				<div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-blue-500/20 to-transparent" />
			</div>

			{/* ── 3D Viewport ── */}
			<div className="absolute inset-0 z-0">
				{session.stlUrl ? (
					<CanvasErrorBoundary
						fallback={
							<div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-zinc-500">
								<AlertCircle className="size-10 text-amber-500/50" />
								<p className="text-sm font-semibold tracking-wide">Failed to render 3D geometry</p>
							</div>
						}
					>
						<div className="absolute inset-0">
							<Viewer3D stlUrl={session.stlUrl} onGeometryReady={setGeometryInfo} />
						</div>
					</CanvasErrorBoundary>
				) : (
					<div className="absolute inset-0 flex flex-col items-center justify-center gap-4 text-zinc-600">
						<div className="p-6 rounded-3xl bg-white/5 border border-white/5 backdrop-blur-xl">
							<Cuboid className="size-12 opacity-50" />
						</div>
						<p className="text-sm font-medium tracking-wide">No 3D model generated yet</p>
					</div>
				)}
			</div>

			{/* ── Overlay UI ── */}
			<div className="pointer-events-none absolute inset-0 z-10 flex flex-col justify-between p-6 md:p-8">
				
				{/* Top Section */}
				<div className="flex items-start justify-between w-full">
					{/* Brand & Prompt Floating Card */}
					<div className="pointer-events-auto flex items-center gap-5 rounded-[24px] border border-white/10 bg-black/40 backdrop-blur-2xl p-3 shadow-[0_8px_32px_rgba(0,0,0,0.5)] max-w-xl transition-all hover:bg-black/50 hover:border-white/20 animate-in fade-in slide-in-from-top-4 duration-700">
						<div className="relative size-14 flex items-center justify-center shrink-0 rounded-[18px] bg-gradient-to-br from-blue-500/20 to-blue-600/10 border border-blue-500/30 overflow-hidden group cursor-pointer">
							<div className="absolute inset-0 bg-blue-500 opacity-0 group-hover:opacity-20 transition-opacity duration-500" />
							<Cuboid className="size-6 text-blue-400 relative z-10 drop-shadow-[0_0_10px_rgba(96,165,250,0.8)]" />
						</div>
						<div className="min-w-0 pr-4">
							<div className="flex items-center gap-3 mb-1">
								<span className="text-xl font-bold tracking-[0.25em] text-white">
									VEXCAD
								</span>
								<div className="h-4 w-px bg-white/20" />
								<span className="text-[9px] font-bold uppercase tracking-[0.15em] text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded-full border border-blue-500/20">
									Shared View
								</span>
							</div>
							<p className="text-xs font-medium text-zinc-300 truncate leading-relaxed max-w-md">{session.prompt}</p>
						</div>
					</div>
				</div>

				{/* Parameters Floating Panel (Left Side) */}
				<div className="pointer-events-auto flex flex-col self-start rounded-[32px] border border-white/10 bg-black/40 backdrop-blur-2xl shadow-[0_16px_40px_rgba(0,0,0,0.6)] max-h-[65vh] w-80 overflow-hidden transition-all animate-in fade-in slide-in-from-left-8 duration-700 delay-200 fill-mode-both mt-auto mb-12">
					<div className="flex items-center gap-3 p-6 border-b border-white/5 bg-gradient-to-b from-white/[0.02] to-transparent">
						<div className="flex size-8 items-center justify-center rounded-xl bg-violet-500/20 border border-violet-500/30">
							<Layers className="size-4 text-violet-400" />
						</div>
						<span className="text-xs font-bold uppercase tracking-[0.2em] text-zinc-100">Design Parameters</span>
					</div>
					
					<div className="flex-1 overflow-y-auto p-4 space-y-2.5 custom-scrollbar">
						{paramEntries.length > 0 ? (
							paramEntries.map(([key, value]) => (
								<div key={key} className="group relative overflow-hidden p-4 rounded-[20px] bg-white/5 border border-white/5 hover:border-blue-500/40 hover:bg-blue-500/10 transition-all duration-300">
									<div className="absolute inset-0 bg-gradient-to-r from-blue-500/0 via-blue-500/0 to-blue-500/5 opacity-0 group-hover:opacity-100 transition-opacity" />
									<p className="text-[9px] font-bold text-zinc-400 uppercase tracking-[0.15em] mb-2 flex items-center gap-2">
										<span className="block w-1.5 h-1.5 rounded-full bg-blue-500/40 group-hover:bg-blue-400 group-hover:shadow-[0_0_10px_rgba(96,165,250,1)] transition-all duration-300" />
										{key.replace(/_/g, ' ')}
									</p>
									<p className="text-[15px] font-mono font-medium text-zinc-100 pl-3.5 tracking-tight">{String(value)}</p>
								</div>
							))
						) : (
							<div className="rounded-[20px] border border-dashed border-white/10 p-8 flex flex-col items-center justify-center text-center gap-3 opacity-60">
								<Layers className="size-6 text-zinc-500" />
								<p className="text-xs font-medium tracking-wide text-zinc-400">No parameters<br/>extracted</p>
							</div>
						)}
					</div>
				</div>

			</div>

			{/* Bottom Center Hint & Theme Toggle placeholder */}
			<div className="pointer-events-none absolute bottom-8 left-1/2 -translate-x-1/2 z-20 flex items-center gap-4 rounded-full border border-white/10 bg-black/50 backdrop-blur-2xl px-6 py-2.5 shadow-2xl animate-in fade-in slide-in-from-bottom-6 duration-700 delay-500 fill-mode-both">
				<div className={`relative flex size-2.5 items-center justify-center`}>
					<div className={`absolute inset-0 rounded-full ${session.stlUrl ? 'bg-blue-500 animate-ping opacity-75' : 'bg-zinc-600'}`} />
					<div className={`relative size-1.5 rounded-full ${session.stlUrl ? 'bg-blue-400' : 'bg-zinc-500'}`} />
				</div>
				<p className="text-[10px] font-bold uppercase tracking-[0.25em] text-zinc-300">
					Drag to rotate <span className="mx-2 text-zinc-600">|</span> Scroll to zoom
				</p>
			</div>
		</div>
	);
}
