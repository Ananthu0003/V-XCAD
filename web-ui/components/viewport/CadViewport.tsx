'use client';

import { Suspense, useState, useRef, useEffect, useMemo } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { OrbitControls, Stage, PerspectiveCamera, Line, GizmoHelper, GizmoViewport, Grid, Environment, ContactShadows } from '@react-three/drei';
import { Loader2, Share2, Download, ChevronDown, Layers, Box, Activity, ChevronRight, CheckCircle2 } from 'lucide-react';
import { DimensionOverlay } from '@/components/viewport/DimensionOverlay';
import { FeatureHighlight } from '@/components/viewport/FeatureHighlight';
import type { StlGeometryInfo } from '@/components/viewport/StlMesh';

type AnnotationEntry = {
	p1: [number, number, number];
	p2: [number, number, number];
};

type RenderToolpathSegment = {
	segmentId?: string;
	moveType?: 'rapid' | 'feed' | 'arc' | 'plunge' | 'retract' | 'helix' | 'cut' | 'lead_in' | 'lead_out';
	type?: 'rapid' | 'cut' | 'arc' | 'plunge' | 'retract' | 'lead_in' | 'lead_out';
	start: { x: number; y: number; z: number };
	end: { x: number; y: number; z: number };
	feedrate?: number;
	spindle?: number;
	toolId: string;
	operationId: string;
	featureId: string;
	coordinateMode?: 'mill_xyz' | 'lathe_xz';
	center?: { x: number; y: number; z: number };
	radius?: number;
	clockwise?: boolean;
	plane?: string;
	gcodeLineStart?: number;
	gcodeLineEnd?: number;
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
	toolpaths?: RenderToolpathSegment[] | null;
	showToolpaths?: boolean;
	workflowStage?: 'blueprint' | 'extraction' | 'cad' | 'cam' | 'gcode';
	camFeatures?: any[];
	parameters?: Record<string, unknown>;
	hasBlockedOperations?: boolean;
	activeFeatureId?: string | null;

	simulationState?: any;
	camTools?: any[];
	debugMode?: boolean;
	setupMetadata?: any;
	camViewport?: any;
	camOperations?: any[];

	children?: React.ReactNode; // For StlMesh
	headerActions?: React.ReactNode;
	setupToolAxis?: [number, number, number];
	onMeshClick?: (point: [number, number, number]) => void;
	onClearSelection?: () => void;
};

function AnimatedSetupGroup({ setupToolAxis, children }: { setupToolAxis?: [number, number, number], children: React.ReactNode }) {
	const groupRef = useRef<THREE.Group>(null);
	const targetQuaternion = useMemo(() => {
		return setupToolAxis 
			? new THREE.Quaternion().setFromUnitVectors(
					new THREE.Vector3(...setupToolAxis).normalize(),
					new THREE.Vector3(0, 1, 0)
			  )
			: new THREE.Quaternion();
	}, [setupToolAxis]);

	useFrame((state, delta) => {
		if (groupRef.current) {
			groupRef.current.quaternion.slerp(targetQuaternion, 8 * delta);
		}
	});

	return <group ref={groupRef}>{children}</group>;
}

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
	parameters = {},
	hasBlockedOperations = false,
	activeFeatureId = null,
	simulationState = null,
	camTools = [],
	debugMode = false,
	setupMetadata = null,
	camViewport = { showStock: true },
	camOperations = [],
	setupToolAxis,
	children,
	headerActions,
	onMeshClick,
	onClearSelection,
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

	const { groupedToolpaths, hasValidToolpaths, allRejected } = useMemo(() => {
		if (!toolpaths || toolpaths.length === 0) return { groupedToolpaths: null, hasValidToolpaths: false, allRejected: false };

		const groups: Record<string, THREE.Vector3[]> = {
			rapid: [],
			feed: [],
			arc: [],
			plunge: [],
			retract: [],
			helix: [],
			roughing: [],
			smoothing: [],
			other: []
		};

		const allowedSources = ['drill', 'contour', 'pocket', 'boss', 'face', 'turning'];
		const allowedMoveTypes = [
            'rapid_clearance', 'rapid_xy', 'approach_retract', 'retract_clearance',
            'plunge', 'cut', 'arc_cw', 'arc_ccw', 'drill_cycle',
            'rapid', 'feed', 'arc', 'retract', 'helix'
        ];
		let validCount = 0;
		let droppedCount = 0;
		const droppedReasons: Record<string, number> = {};
		
		toolpaths.forEach((seg: any) => {
			let isInvalid = false;
			let reason = '';
			const type = seg.moveType || seg.type || 'other';

			// In debug mode, render everything without filtering
			if (!debugMode) {
				if (!seg.source || !allowedSources.includes(seg.source)) {
					isInvalid = true;
					reason = `Invalid source: ${seg.source}`;
				} else if (seg.boundary || seg.wire || seg.bbox || seg.axis || seg.centerline || seg.regionType || seg.debug || seg.islands) {
					isInvalid = true;
					reason = 'Contains debug/region properties';
				} else if (!allowedMoveTypes.includes(type)) {
					console.warn(`Unknown toolpath segment type: "${type}". Regenerate toolpaths using semantic_v1.`);
				}
			}
			
			if (isInvalid) {
			    droppedCount++;
			    droppedReasons[reason] = (droppedReasons[reason] || 0) + 1;
			    return;
			}
			
			validCount++;

            // Map semantic types to rendering groups
            let targetGroupName = 'other';
			
            let isRoughing = false;
            let isSmoothing = false;
            if (camOperations && seg.operationId) {
                const op = camOperations.find(o => o.id === seg.operationId);
                if (op && op.type) {
                    const typeLower = op.type.toLowerCase();
                    const nameLower = (op.name || '').toLowerCase();
                    if (typeLower.includes('rough') || nameLower.includes('rough') || typeLower.includes('pocket') || nameLower.includes('pocket') || typeLower.includes('clear') || typeLower.includes('face') || nameLower.includes('face')) {
                        isRoughing = true;
                    } else if (typeLower.includes('finish') || typeLower.includes('smooth') || typeLower.includes('contour') || nameLower.includes('finish') || nameLower.includes('smooth')) {
                        isSmoothing = true;
                    }
                }
            }

            if (['rapid', 'rapid_clearance', 'rapid_xy', 'retract_clearance'].includes(type)) {
				targetGroupName = 'rapid';
			} else if (['feed', 'cut', 'arc', 'arc_cw', 'arc_ccw'].includes(type)) {
				if (isRoughing) targetGroupName = 'roughing';
				else if (isSmoothing) targetGroupName = 'smoothing';
				else targetGroupName = ['arc', 'arc_cw', 'arc_ccw'].includes(type) ? 'arc' : 'feed';
			} else if (['plunge', 'approach_retract', 'drill_cycle'].includes(type)) {
				targetGroupName = 'plunge';
			} else if (type === 'retract') {
				targetGroupName = 'retract';
			} else if (type === 'helix') {
				targetGroupName = 'helix';
			}

			const targetGroup = groups[targetGroupName] || groups.other;
			if (seg.start && seg.end) {
			    targetGroup.push(new THREE.Vector3(seg.start.x, seg.start.y, seg.start.z));
			    targetGroup.push(new THREE.Vector3(seg.end.x, seg.end.y, seg.end.z));
			}
		});

		const colors: Record<string, number> = {
			rapid: 0xf43f5e,    // rose-500
			feed: 0x3b82f6,      // blue-500
			arc: 0x0ea5e9,      // sky-500
			plunge: 0x10b981,   // emerald-500
			retract: 0xf59e0b,  // amber-500
			roughing: 0xa855f7, // purple-500
			smoothing: 0x2dd4bf, // teal-400
			other: 0x64748b     // slate-500
		};

		if (droppedCount > 0) {
			console.warn(`[CadViewport] Dropped ${droppedCount} invalid/debug toolpath segments:`, droppedReasons);
		}

		if (validCount === 0) {
			return { groupedToolpaths: null, hasValidToolpaths: false, allRejected: true };
		}

		return {
			groupedToolpaths: (
				<group>
					{Object.entries(groups).map(([type, points]) => {
						if (points.length === 0) return null;
						const geometry = new THREE.BufferGeometry().setFromPoints(points);
						const material = new THREE.LineBasicMaterial({
							color: colors[type] || colors.other,
							linewidth: ['feed', 'arc', 'roughing', 'smoothing'].includes(type) ? 2 : 1.5,
							opacity: type === 'rapid' ? 0.4 : 0.8,
							transparent: true,
							depthTest: true,
						});
						return <primitive key={type} object={new THREE.LineSegments(geometry, material)} />;
					})}
				</group>
			),
			hasValidToolpaths: true,
			allRejected: false
		};
	}, [toolpaths, debugMode, camOperations]);

	const [hasSimulated, setHasSimulated] = useState(false);
	const [featureDebug, setFeatureDebug] = useState<any>(null);

	useEffect(() => {
		if (simulationState?.isPlaying || (simulationState?.progress ?? 0) > 0 || simulationState?.activeSegmentIndex !== undefined) {
			setHasSimulated(true);
		}
	}, [simulationState]);

	return (
		<section className="relative flex h-full w-full flex-col overflow-hidden bg-background font-sans">
			{debugMode && featureDebug && (
				<div className="absolute top-20 right-4 bg-black/80 text-green-400 text-[10px] font-mono p-3 rounded border border-green-500/30 whitespace-nowrap backdrop-blur-sm shadow-xl pointer-events-none select-none max-w-[350px] overflow-hidden z-[100]">
					<div className="font-bold text-foreground mb-1 border-b border-green-500/30 pb-1">FEATURE DEBUG</div>
					<div className="grid grid-cols-[80px_1fr] gap-x-2 gap-y-1">
						<span className="opacity-70">ID:</span><span className="truncate">{featureDebug.id}</span>
						<span className="opacity-70">Type:</span><span>{featureDebug.type}</span>
						
						{featureDebug.center && (
							<>
								<span className="opacity-70">Center:</span>
								<span>[{featureDebug.center.map((n: number) => n.toFixed(2)).join(', ')}]</span>
							</>
						)}
						
						{featureDebug.axis && (
							<>
								<span className="opacity-70">Axis:</span>
								<span>[{featureDebug.axis.map((n: number) => n.toFixed(2)).join(', ')}]</span>
							</>
						)}
						
						{featureDebug.dimensions && Object.keys(featureDebug.dimensions).length > 0 && (
							<>
								<span className="opacity-70">Dims:</span>
								<span className="break-all whitespace-normal">
									{Object.entries(featureDebug.dimensions).map(([k, v]) => `${k}:${Number(v).toFixed(2)}`).join(' ')}
								</span>
							</>
						)}
						
						{featureDebug.p1 && featureDebug.p2 && (
							<>
								<span className="opacity-70">Box Min:</span>
								<span>[{featureDebug.p1.map((n: number) => n.toFixed(2)).join(', ')}]</span>
								<span className="opacity-70">Box Max:</span>
								<span>[{featureDebug.p2.map((n: number) => n.toFixed(2)).join(', ')}]</span>
							</>
						)}
					</div>
				</div>
			)}
			<header className="flex h-16 items-center justify-between border-b border-transparent bg-background/60 backdrop-blur-xl px-6 z-30">
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
											onClick={() => { setExportOpen(false); onDownloadStl(); }}
											disabled={isDownloadingStl}
											title={undefined}
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
											onClick={() => { setExportOpen(false); onDownloadStep(); }}
											disabled={isDownloadingStep}
											title={undefined}
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
											onClick={() => { setExportOpen(false); onDownloadDxf(); }}
											disabled={isDownloadingDxf}
											title={undefined}
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

				{allRejected && isWireframeVisible && (
					<div className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none">
						<div className="bg-black/60 backdrop-blur-md px-6 py-4 rounded-2xl border border-rose-500/30 flex flex-col items-center gap-2">
							<Activity className="size-6 text-rose-500 mb-1" />
							<p className="text-sm font-semibold text-rose-100">No valid machining toolpaths to display</p>
							<p className="text-xs text-rose-300">Toolpaths may have been rejected by the engine.</p>
						</div>
					</div>
				)}

				<Canvas shadows dpr={[1, 2]} className="relative z-10" onPointerMissed={onClearSelection}>
					<PerspectiveCamera makeDefault position={[5, 5, 5]} fov={40} />

					<Suspense fallback={null}>
						<Environment files="/potsdamer_platz_1k.hdr" />
						<Grid infiniteGrid fadeDistance={50} sectionColor="#1e3a8a" cellColor="#0f172a" cellSize={1} sectionSize={10} position={[0, -0.01, 0]} />
						<Stage intensity={0.8} adjustCamera={!hasSimulated} environment={null} shadows="contact">
							<AnimatedSetupGroup setupToolAxis={setupToolAxis}>
								<group>
									{/* The CAD model MUST be transformed to setup space using modelToSetupTransform */}
									{console.log("CAD VIEWPORT SETUP METADATA", setupMetadata)}
									{(() => {
										const m = setupMetadata?.modelToSetupTransform 
											? new THREE.Matrix4().fromArray(
												Array.isArray(setupMetadata.modelToSetupTransform[0]) 
													? setupMetadata.modelToSetupTransform.flat() 
													: setupMetadata.modelToSetupTransform
											).transpose() 
											: new THREE.Matrix4();
										
										const pos = new THREE.Vector3();
										const quat = new THREE.Quaternion();
										const scale = new THREE.Vector3();
										m.decompose(pos, quat, scale);
										
										return (
											<>
												<group position={pos} quaternion={quat} scale={scale}>
													{isSolidVisible && children}
													
													{/* Overlays - placed next to children so they inherit the exact same transforms */}
													{geometryInfo && (activeParameter || activeFeatureId) && (
														<>
															{activeParameter && (
																<DimensionOverlay 
																	annotations={annotations}
																	activeParameter={activeParameter}
																	geometryScale={geometryInfo.scale}
																	geometryCenter={geometryInfo.center}
																/>
															)}
														</>
													)}
												</group>

												{isWireframeVisible && (
													<group
														scale={1}
														position={[0, 0, 0]}
													>
														{/* Render CAM Toolpaths using optimized buffer geometry */}
														{groupedToolpaths}

														{/* Active feature indicators have been removed in favor of cam_debug_overlay.json */}

														{/* Render Active Tool for Simulation INSIDE the setup space group */}
														{showToolpaths && simulationState?.showTool !== false && simulationState?.segments && simulationState.activeSegmentIndex !== undefined && camTools && (
															(() => {
																const activeSegment = simulationState.segments[simulationState.activeSegmentIndex];
																if (!activeSegment) return null;
																const toolId = activeSegment.toolId || activeSegment.tool_id;
																const activeTool = camTools.find(t => t.id === toolId || t.tool_name === toolId);
																if (!activeTool) return null;

																const toolDiameter = activeTool.diameter_mm || activeTool.diameter || 6;
																const radius = toolDiameter / 2;
																const isFaceMill = activeTool.type === 'face_mill' || toolDiameter >= 30;
																
																// Calculate realistic proportions
																const cuttingLength = activeTool.cutting_length || activeTool.flute_length || (isFaceMill ? Math.min(radius * 0.5, 15) : Math.min(radius * 3, 40));
																const shaftRadius = isFaceMill ? Math.max(radius * 0.3, 8) : radius;
																const stickout = activeTool.length_mm || activeTool.stickout || (isFaceMill ? Math.max(cuttingLength + 40, 60) : Math.min(radius * 5, 80));

																const i = activeSegment.end_i ?? 0;
																const j = activeSegment.end_j ?? 0;
																let k = activeSegment.end_k ?? -1;
																if (i === 0 && j === 0 && k === 0) k = -1;

																const targetVec = new THREE.Vector3(-i, -j, -k).normalize();
																const upVec = new THREE.Vector3(0, 1, 0);
																const quaternion = new THREE.Quaternion().setFromUnitVectors(upVec, targetVec);

																const x = activeSegment.end?.x ?? activeSegment.end_x ?? 0;
																const y = activeSegment.end?.y ?? activeSegment.end_y ?? 0;
																const z = activeSegment.end?.z ?? activeSegment.end_z ?? 0;

																return (
																	<group position={[x, y, z]} quaternion={quaternion}>
																		{/* Cutting Tool / End Mill */}
																		<mesh position={[0, stickout / 2, 0]}>
																			<cylinderGeometry
																				args={[shaftRadius, shaftRadius, stickout, 32]}
																				ref={(geom) => {
																					if (geom) {
																						geom.computeBoundingBox = () => { geom.boundingBox = new THREE.Box3(); };
																						geom.boundingBox = new THREE.Box3();
																					}
																				}}
																			/>
																			<meshStandardMaterial color="#cbd5e1" metalness={0.8} roughness={0.2} transparent opacity={0.9} />
																		</mesh>

																		{/* CNC Spindle / Tool Holder (scaled to look like a small collet) */}
																		<mesh position={[0, stickout + 15, 0]}>
																			<cylinderGeometry
																				args={[Math.max(shaftRadius * 1.5, 15), Math.max(shaftRadius * 1.2, 10), 30, 32]}
																				ref={(geom) => {
																					if (geom) {
																						geom.computeBoundingBox = () => { geom.boundingBox = new THREE.Box3(); };
																						geom.boundingBox = new THREE.Box3();
																					}
																				}}
																			/>
																			<meshStandardMaterial color="#334155" metalness={0.5} roughness={0.6} />
																		</mesh>


																	</group>
																);
															})()
														)}
													</group>
												)}
											</>
										);
									})()
								}
								
								{/* Stock Boundaries - Rendered directly in Setup Space */}
								{setupMetadata?.resolvedStock && camViewport?.showStock !== false && (
									<mesh position={setupMetadata.resolvedStock.center}>
										<boxGeometry args={setupMetadata.resolvedStock.dimensions} />
										<meshBasicMaterial color="#3b82f6" wireframe transparent opacity={0.25} />
									</mesh>
								)}
								
								{/* FeatureHighlight is already in Setup Space from backend */}
								{geometryInfo && (activeParameter || activeFeatureId) && (
									<>
										<FeatureHighlight 
											annotations={annotations} 
											camFeatures={camFeatures}
											parameters={parameters}
											activeParameter={(activeParameter || activeFeatureId) as string}
											geometryScale={geometryInfo.scale}
											geometryCenter={geometryInfo.center}
											debugMode={debugMode}
											onDebugInfo={setFeatureDebug}
										/>
									</>
								)}
								</group>
							</AnimatedSetupGroup>
						</Stage>

						<GizmoHelper alignment="top-right" margin={[50, 50]}>
							<GizmoViewport axisColors={['#ef4444', '#22c55e', '#3b82f6']} labelColor="black" />
						</GizmoHelper>
					</Suspense>

					{/* Dimension overlay was moved inside Stage */}

					<OrbitControls makeDefault enableDamping dampingFactor={0.05} minPolarAngle={0} maxPolarAngle={Math.PI / 1.75} />
				</Canvas>

				{!stlUrl && !isRecompiling && (
					<div className="pointer-events-none absolute inset-0 flex items-center justify-center p-12 z-20">
						<div className="relative max-w-md w-full">
							{/* Outer glow aura */}
							<div className="absolute inset-0 rounded-3xl bg-blue-500/5 dark:bg-blue-500/10 blur-2xl dark:blur-3xl scale-105 dark:scale-110" />

							{/* Main card */}
							<div className="relative rounded-3xl border border-transparent/50 dark:border-border bg-background/90 dark:bg-black/60 p-12 text-center shadow-xl backdrop-blur-2xl">

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



				{/* Global Safety Note */}
				<div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-10 flex flex-col items-center gap-2">
					{toolpaths && toolpaths.length > 0 && !hasValidToolpaths && (
						<div className="flex items-center gap-2 rounded-full border border-orange-500/30 bg-background/90 px-4 py-2 backdrop-blur-md shadow-xl shadow-black/50">
							<svg className="size-3 text-orange-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
								<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
							</svg>
							<span className="text-[11px] font-bold uppercase tracking-wider text-orange-400">
								No valid machining toolpaths to display
							</span>
						</div>
					)}
					{hasBlockedOperations && (
						<div className="flex items-center gap-2 rounded-full border border-red-500/30 bg-background/90 px-4 py-2 backdrop-blur-md shadow-xl shadow-black/50">
							<svg className="size-3 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
								<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
							</svg>
							<span className="text-[11px] font-bold uppercase tracking-wider text-red-400">
								Some features require turning, mill-turn, or secondary setup
							</span>
						</div>
					)}
					<div className="flex items-center gap-3 rounded-full border border-transparent bg-background/80 px-5 py-2.5 backdrop-blur-xl transition-all hover:border-blue-500/30 whitespace-nowrap">
						<svg className="size-3 text-blue-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
							<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
						</svg>
						<p className="text-[9px] font-bold uppercase tracking-wide text-muted-foreground">
							AI can make mistakes. Verify critical dimensions against original blueprints.
						</p>
					</div>
				</div>
			</div>
		</section>
	);
}
