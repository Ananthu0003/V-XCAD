'use client';

import { Suspense, useState, useRef, useEffect, useMemo } from 'react';
import { Canvas } from '@react-three/fiber';
import * as THREE from 'three';
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
	fileName?: string | null;
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
	activeFeatureId?: string | null;
	onValidationResult?: (isValid: boolean) => void;
	
	simulationState?: import('@/types/cam').SimulationState | null;
	camTools?: import('@/types/cam').Tool[];

	children?: React.ReactNode; // For StlMesh
};

export function CadViewport({
	stlUrl,
	statusText,
	fileName,
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
	onValidationResult,
	simulationState = null,
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
		return () => document.removeEventListener('mousedown', handleClickOutside);
	}, []);

	const isSolidVisible = viewMode === 'both' || viewMode === 'solid';
	const isWireframeVisible = (viewMode === 'both' || viewMode === 'wireframe') && showToolpaths;
	const isWireframeVisible = (viewMode === 'both' || viewMode === 'wireframe') && showToolpaths;

	// Validation Logic
	const [toolpathError, setToolpathError] = useState<string | null>(null);
	const [toolpathBbox, setToolpathBbox] = useState<{min: [number, number, number], max: [number, number, number]} | null>(null);

	useEffect(() => {
		let minX = Infinity, minY = Infinity, minZ = Infinity;
		let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

		if (simulationState?.segments && simulationState.segments.length > 0) {
			simulationState.segments.forEach(seg => {
				minX = Math.min(minX, seg.start_x, seg.end_x);
				minY = Math.min(minY, seg.start_y, seg.end_y);
				minZ = Math.min(minZ, seg.start_z, seg.end_z);
				maxX = Math.max(maxX, seg.start_x, seg.end_x);
				maxY = Math.max(maxY, seg.start_y, seg.end_y);
				maxZ = Math.max(maxZ, seg.start_z, seg.end_z);
			});
		} else if (toolpaths && toolpaths.length > 0) {
			toolpaths.forEach(path => {
				path.forEach(pt => {
					minX = Math.min(minX, pt[0]);
					minY = Math.min(minY, pt[1]);
					minZ = Math.min(minZ, pt[2]);
					maxX = Math.max(maxX, pt[0]);
					maxY = Math.max(maxY, pt[1]);
					maxZ = Math.max(maxZ, pt[2]);
				});
			});
		} else {
			setToolpathError(null);
			setToolpathBbox(null);
			onValidationResult?.(true);
			return;
		}

		if (!geometryInfo?.bounding_box) {
			onValidationResult?.(true);
			return;
		}

		const mMin = geometryInfo.bounding_box.min;
		const mMax = geometryInfo.bounding_box.max;

		if (minX === Infinity) return;

		setToolpathBbox({ min: [minX, minY, minZ], max: [maxX, maxY, maxZ] });

		// 1. Check for normalized coordinates (e.
			onValidationResult?.(false);
			return;
		}

		// 2. Check if it's completely disconnected (e.g. 500mm away) - WCS mismatch
		const margin = Math.max(100, mSizeX * 2);
		if (
			maxX < mMin[0] - margin || minX > mMax[0] + margin ||
			maxY < mMin[1] - margin || minY > mMax[1] + margin ||
			maxZ < mMin[2] - margin || minZ > mMax[2] + margin
		) {
// MISSING LINE 166
// MISSING LINE 167
// MISSING LINE 168
// MISSING LINE 169
// MISSING LINE 170
// MISSING LINE 171
// MISSING LINE 172
// MISSING LINE 173
// MISSING LINE 174
// MISSING LINE 175
// MISSING LINE 176
// MISSING LINE 177
// MISSING LINE 178
// MISSING LINE 179
// MISSING LINE 180
// MISSING LINE 181
// MISSING LINE 182
// MISSING LINE 183
// MISSING LINE 184
// MISSING LINE 185
// MISSING LINE 186
// MISSING LINE 187
// MISSING LINE 188
// MISSING LINE 189
// MISSING LINE 190
// MISSING LINE 191
// MISSING LINE 192
// MISSING LINE 193
// MISSING LINE 194
// MISSING LINE 195
// MISSING LINE 196
// MISSING LINE 197
// MISSING LINE 198
// MISSING LINE 199
// MISSING LINE 200
// MISSING LINE 201
// MISSING LINE 202
// MISSING LINE 203
// MISSING LINE 204
// MISSING LINE 205
// MISSING LINE 206
// MISSING LINE 207
// MISSING LINE 208
// MISSING LINE 209
			return paths.map((path, idx) => (
				<Line
					key={`sim-${idx}`}
					points={path.points}
					color={path.type === 'rapid' ? '#fbbf24' : '#22c55e'}
					lineWidth={path.type === 'rapid' ? 1 : 1.5}
					dashed={path.type === 'rapid'}
				/>
			));
		}
		
		if (toolpaths && toolpaths.length > 0) {
			return toolpaths.map((path, idx) => (
				<Line
					key={`flat-${idx}`}
					points={path as [number, number, number][]}
					color="#3b82f6"
					lineWidth={1.5}
					dashed={false}
				/>
			));
		}
		
		return null;
	}, [showToolpaths, simulationState?.segments, toolpaths]);

	return (
		<section className="relative flex h-full w-full flex-col overflow-hidden bg-transparent font-sans">
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
						{fileName && <span className="text-muted-foreground font-normal ml-2">({fileName})</span>}
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
							className={`p-3 r
// MISSING LINE 279
// MISSING LINE 280
// MISSING LINE 281
// MISSING LINE 282
// MISSING LINE 283
// MISSING LINE 284
// MISSING LINE 285
// MISSING LINE 286
// MISSING LINE 287
// MISSING LINE 288
// MISSING LINE 289
// MISSING LINE 290
// MISSING LINE 291
// MISSING LINE 292
// MISSING LINE 293
// MISSING LINE 294
// MISSING LINE 295
// MISSING LINE 296
// MISSING LINE 297
// MISSING LINE 298
// MISSING LINE 299
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
										if (!showToolpaths) return null;
										
										if (simulationState?.segments && simulationState.segments.length > 0) {
											const paths: { type: string, points: [number, number, number][] }[] = [];
											let currentPath: [number, 
													[seg.end_x, seg.end_y, seg.end_z]
			
// MISSING LINE 329
// MISSING LINE 330
// MISSING LINE 331
// MISSING LINE 332
// MISSING LINE 333
// MISSING LINE 334
// MISSING LINE 335
// MISSING LINE 336
// MISSING LINE 337
// MISSING LINE 338
// MISSING LINE 339
// MISSING LINE 340
// MISSING LINE 341
// MISSING LINE 342
// MISSING LINE 343
// MISSING LINE 344
// MISSING LINE 345
// MISSING LINE 346
// MISSING LINE 347
// MISSING LINE 348
// MISSING LINE 349
// MISSING LINE 350
// MISSING LINE 351
// MISSING LINE 352
// MISSING LINE 353
// MISSING LINE 354
// MISSING LINE 355
// MISSING LINE 356
// MISSING LINE 357
// MISSING LINE 358
// MISSING LINE 359
				<div className="absolute inset-0 z-0 pointer-events-none">
					<div className="absolute top-1/4 left-1/4 w-96 h-96 bg-gradient-primary opacity-15 rounded-full blur-[128px]" />
					<div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-gradient-secondary opacity-15 rounded-full blur-[128px]" />
					<div className="absolute inset-0 bg-[url('/grid.svg')] bg-center [mask-image:radial-gradient(ellipse_at_center,white,rgba(255,255,255,0))] opacity-10" />
				</div>

				<Canvas shadows dpr={[1, 2]} className="relative z-10">
					<PerspectiveCamera makeDefault position={[5, 5, 5]} fov={40} />
					
					<Suspense fallback={null}>
						<Environment preset="city" />
						<Grid infiniteGrid fadeDistance={50} sectionColor="#1e3a8a" cellColor="#0f172a" cellSize={1} sectionSize={10} position={[0, -0.01, 0]} />
						<Stage intensity={0.8} adjustCamera={!(simulationState?.segments && simulationState.segments.length > 0)} shadows="contact">
							{isSolidVisible && children}
							{isWireframeVisible && (
								<group scale={1} position={[0, 0, 0]}>
									{/* Render CAM Toolpaths / Segments efficiently using useMemo and grouped lines */}
									{groupedToolpaths}
								</group>
							)}

							{/* Render Active Tool for Simulation */}
							{showToolpaths && simulationState?.showTool !== false && simulationState?.segments && simulationState.activeSegmentIndex !== undefined && camTools && (
								(() => {
									co
									if (!activeSegment) return null;
									const activeTool = camTools.find(t => t.id === activeSegment.tool_id);
									if (!activeTool) return null;
									
									// Use typical defaults if some properties are missing
									const stickout = activeTool.stickout || 40;
									const radius = (activeTool.diameter || 6) / 2;

									// Calculate orientation based on IJK vector (default points down: 0, 0, -1)
									// Tool body extends opposite to IJK direction
									let i = activeSegment.end_i ?? 0;
									let j = activeSegment.end_j ?? 0;
									let k = activeSegment.end_k ?? -1;
									if (i === 0 && j === 0 && k === 0) k = -1;
									
									// Target vector points opposite to cutting direction
									const targetVec = new THREE.Vector3(-i, -j, -k).normalize();
									// Default Three.js Cylinder goes along +Y
									const upVec = new THREE.Vector3(0, 1, 0);
									const quaternion = new THREE.Quaternion().setFromUnitVectors(upVec, targetVec);

									return (
										<group position={[activeSegment.end_x, activeSegment.end_y, activeSegment.end_z]} qu
											<mesh position={[0, stickout / 2, 0]}>
												<cylinderGeometry 
													args={[radius, radius, stickout, 32]} 
													ref={(geom) => {
														if (geom) {
															geom.computeBoundingBox = () => { geom.boundingBox = new THREE.Box3(); };
															geom.boundingBox = new THREE.Box3();
														}
													}}
												/>
												<meshStandardMaterial color="#cbd5e1" metalness={0.8} roughness={0.2} transparent opacity={0.9} />
											</mesh>
											
											{/* Highlight the exact tool tip point */}
											<mesh position={[0, 0, 0]}>
												<sphereGeometry 
													args={[Math.max(0.5, radius * 0.2), 16, 16]} 
													ref={(geom) => {
														if (geom) {
															geom.computeBoundingBox = () => { geom.boundingBox = new THREE.Box3(); };
															geom.boundingBox = new THREE.Box3();
														}
													}}
												/>
												<meshBasicMaterial color="#ef4444" depthTest={false} />
											</mesh>
										</group>
									);
								})()
							)}

							{/* Render Active Feature Indicator independently of toolpaths */}
							{activeFeatureId && camFeatures && (
								<group scale={1} position={[0, 0, 0]}>
									{camFeatures.filter(f => f.id === activeFeatureId).map(f => {
											const positions = f.sub_positions || [{ center: f.position?.center || f.location, normal: f.position?.normal, bounding_box: f.position?.bounding_box }];
											const bSizeX = geometryInfo?.bounding_box ? (geometryInfo.bounding_box.max[0] - geometryInfo.bounding_box.min[0]) : 80;
											const markerRadius = Math.max(3.0, bSizeX * 0.04) / (geometryInfo?.scale || 1);
											
											return (
												<group key={`feature-${f.id}`}>
													{positions.map((posObj: any, idx: number) => {
														const pos = posObj.center || f.location;
// MISSING LINE 451
// MISSING LINE 452
// MISSING LINE 453
// MISSING LINE 454
// MISSING LINE 455
// MISSING LINE 456
// MISSING LINE 457
// MISSING LINE 458
// MISSING LINE 459
// MISSING LINE 460
// MISSING LINE 461
// MISSING LINE 462
// MISSING LINE 463
// MISSING LINE 464
// MISSING LINE 465
// MISSING LINE 466
// MISSING LINE 467
// MISSING LINE 468
// MISSING LINE 469
// MISSING LINE 470
// MISSING LINE 471
// MISSING LINE 472
// MISSING LINE 473
// MISSING LINE 474
// MISSING LINE 475
// MISSING LINE 476
// MISSING LINE 477
// MISSING LINE 478
// MISSING LINE 479
// MISSING LINE 480
// MISSING LINE 481
// MISSING LINE 482
// MISSING LINE 483
// MISSING LINE 484
// MISSING LINE 485
// MISSING LINE 486
// MISSING LINE 487
						
						<div className="flex justify-between">
							<span className="text-muted-foreground">Model Size:</span>
							<span className="font-mono text-[10px]">
								{geometryInfo.bounding_box ? 
									`${(geometryInfo.bounding_box.max[0] - geometryInfo.bounding_box.min[0]).toFixed(1)} x ` +
									`${(geometryInfo.bounding_box.max[1] - geometryInfo.bounding_box.min[1]).toFixed(1)} x ` +
									`${(geometryInfo.bounding_box.max[2] - geometryInfo.bounding_box.min[2]).toFixed(1)} mm`
								: 'N/A'}
							</span>
						</div>
						
						<div className="flex justify-between">
							<span className="text-muted-foreground">Toolpath Size:</span>
							<span className="font-mono text-[10px]">
								{toolpathBbox ? 
									`${(toolpathBbox.max[0] - toolpathBbox.min[0]).toFixed(1)} x ` +
									`${(toolpathBbox.max[1] - toolpathBbox.min[1]).toFixed(1)} x ` +
									`${(toolpathBbox.max[2] - toolpathBbox.min[2]).toFixed(1)} mm`
								: 'N/A'}
							</span>
						</div>

						{toolpathError ? (
							<div className="mt-1 rounded border border-red-500/30 bg-red-500/10 px-2 py-1.5 text-red-500">
								<span className="font-bold uppercase tracking-wider text-[10px]">Error:</span> {toolpathError}
							</div>
						) : toolpaths && toolpaths.length > 0 ? (
							<div className="mt-1 rounded border border-green-500/30 bg-green-500/10 px-2 py-1.5 text-green-500 flex items-center gap-1.5">
								<CheckCircle2 className="size-3" />
								<span className="font-bold uppercase tracking-wider text-[10px]">Toolpath aligned with model</span>
							</div>
						) : null}
					</div>
				)}
			</div>
		</section>
	);
}

// MISSING LINE 528
// MISSING LINE 529
// MISSING LINE 530
// MISSING LINE 531
// MISSING LINE 532
// MISSING LINE 533
// MISSING LINE 534
// MISSING LINE 535
// MISSING LINE 536
// MISSING LINE 537
// MISSING LINE 538
// MISSING LINE 539
// MISSING LINE 540
// MISSING LINE 541
// MISSING LINE 542
// MISSING LINE 543
// MISSING LINE 544
// MISSING LINE 545
// MISSING LINE 546
// MISSING LINE 547
// MISSING LINE 548
// MISSING LINE 549
// MISSING LINE 550
// MISSING LINE 551
// MISSING LINE 552
// MISSING LINE 553
// MISSING LINE 554
// MISSING LINE 555
// MISSING LINE 556
// MISSING LINE 557
// MISSING LINE 558
// MISSING LINE 559
// MISSING LINE 560
// MISSING LINE 561
// MISSING LINE 562
// MISSING LINE 563
// MISSING LINE 564
// MISSING LINE 565
// MISSING LINE 566
// MISSING LINE 567
// MISSING LINE 568
// MISSING LINE 569
// MISSING LINE 570
// MISSING LINE 571
								</div>
								<div className="flex flex-col">
									<span className="text-[11px] font-black uppercase tracking-[0.05em] text-foreground">Engine Active</span>
									<span className="mt-0.5 text-[10px] text-muted-foreground">Recomputing Geometry Topology…</span>
								</div>
							</div>
						</div>
					</div>
				)}

				{/* Feature Missing Face Mapping Overlay (Removed) */}

				{/* Global Safety Note */}
				<div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-10 flex items-center gap-3 rounded-full border border-transparent bg-background/80 px-5 py-2.5 backdrop-blur-xl transition-all hover:border-blue-500/30 whitespace-nowrap shadow-sm">
					<svg className="size-3 text-blue-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
						<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
					</svg>
					<p className="text-[9px] font-bold uppercase tracking-wide text-muted-foreground">
						AI can make mistakes. Verify critical dimensions against original blueprints.
					</p>
				</div>

				{/* Debug Overlay */}
				{showToolpaths && geometryInfo && (
					<div className="absolute bottom-20 right-6 z-10 flex flex-col gap-2 rounded-xl border border-border bg-background/90 px-4 py-3 backdrop-blur-md shadow-lg w-72 text-xs">
						<h4 className="font-semibold text-foreground border-b border-border pb-1">Geometry Validation</h4>
						
						<div className="flex justify-between">
							<span className="text-muted-foreground">Model Size:</span>
