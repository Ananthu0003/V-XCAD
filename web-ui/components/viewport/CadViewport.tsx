'use client';

import { Suspense, useState, useRef, useEffect, useMemo } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { OrbitControls, Stage, PerspectiveCamera, Line, GizmoHelper, GizmoViewcube, Grid, Environment, ContactShadows } from '@react-three/drei';
import { ViewportController } from '@/components/viewport/ViewportController';
import { Loader2, Share2, Download, ChevronDown, Layers, Box, Activity, ChevronRight, CheckCircle2, Camera, Maximize, RotateCcw, Home, Eye, FileImage, Folder } from 'lucide-react';
import { DimensionOverlay } from '@/components/viewport/DimensionOverlay';
import { FeatureHighlight } from '@/components/viewport/FeatureHighlight';
import { CameraRig } from '@/components/viewport/CameraRig';
import { VolumetricStock } from '@/components/cam/VolumetricStock';
import { BlueprintViewer } from '@/components/blueprint/BlueprintViewer';
import { TargetPortion3DHighlight } from '@/components/viewport/TargetPortion3DHighlight';
import type { TargetPortion } from '@/components/chat/ChatPanel';
import type { StlGeometryInfo } from '@/components/viewport/StlMesh';

type AnnotationEntry = {
	p1: [number, number, number];
	p2: [number, number, number];
	text?: string;
	type?: 'distance' | 'diameter' | 'radius' | 'angle';
};

function CanvasBridge() {
	const { gl } = useThree();
	useEffect(() => {
		if (gl?.domElement) {
			(window as any).__VEXCAD_CANVAS__ = gl.domElement;
		}
	}, [gl]);
	return null;
}

function DynamicFloor({ targetRef, children }: { targetRef: React.RefObject<THREE.Group | null>, children: React.ReactNode }) {
	const floorRef = useRef<THREE.Group>(null);
	useFrame(() => {
		if (targetRef.current && floorRef.current) {
			const box = new THREE.Box3().setFromObject(targetRef.current);
			if (!box.isEmpty() && isFinite(box.min.y) && box.min.y > -10000) {
				const targetY = box.min.y - 0.05;
				// instantly snap if very far, else lerp
				if (Math.abs(floorRef.current.position.y - targetY) > 50) {
					floorRef.current.position.y = targetY;
				} else {
					floorRef.current.position.y = THREE.MathUtils.lerp(floorRef.current.position.y, targetY, 0.1);
				}
			}
		}
	});
	return <group ref={floorRef}>{children}</group>;
}

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
	hoveredParameter?: string | null;
	onSelectParameter?: (key: string | null) => void;
	onHoverParameter?: (key: string | null) => void;
	geometryInfo?: StlGeometryInfo | null;

	// CAM/G-code
	toolpaths?: RenderToolpathSegment[] | null;
	showToolpaths?: boolean;
	workflowStage?: 'blueprint' | 'extraction' | 'cad' | 'cam' | 'gcode';
	camFeatures?: any[];
	parameters?: Record<string, unknown>;
	hasBlockedOperations?: boolean;
	activeFeatureId?: string | null;
	hoveredFeatureId?: string | null;
	onHoverFeature?: (id: string | null) => void;
	workpieceMaterial?: string;

	simulationState?: any;
	camTools?: any[];
	camSetup?: any;
	debugMode?: boolean;
	setupMetadata?: any;
	camViewport?: any;
	camOperations?: any[];

	children?: React.ReactNode; // For StlMesh
	headerActions?: React.ReactNode;
	projectName?: string | null;
	onOpenProjects?: () => void;
	setupToolAxis?: [number, number, number];
	onMeshClick?: (point: [number, number, number]) => void;
	onClearSelection?: () => void;
	xRayMode?: boolean;
	onToggleXRay?: () => void;
	blueprintUrl?: string | null;
	targetPortion?: TargetPortion | null;
	onSelectPortion?: (portion: TargetPortion | null) => void;
	showBlueprintPIP?: boolean;
	onToggleBlueprintPIP?: () => void;
	onAttachBlueprint?: (file: File) => void;
};

function AnimatedSetupGroup({ setupToolAxis, children, isSetup, hasToolpaths }: { setupToolAxis?: [number, number, number], children: React.ReactNode, isSetup?: boolean, hasToolpaths?: boolean }) {
	const groupRef = useRef<THREE.Group>(null);
	const targetQuaternion = useMemo(() => {
		// By default, map CAD Z (0,0,1) to Three.js Y (0,1,0) so the spindle is always UP
		// If setupToolAxis is provided, map that axis to Three.js Y.
		const axis = setupToolAxis ? new THREE.Vector3(...setupToolAxis).normalize() : new THREE.Vector3(0, 0, 1);
		const defaultUp = new THREE.Vector3(0, 1, 0);
		const q = new THREE.Quaternion().setFromUnitVectors(axis, defaultUp);
		return q;
	}, [setupToolAxis]);

	useFrame((_, delta) => {
		if (groupRef.current) {
			groupRef.current.quaternion.slerp(targetQuaternion, Math.min(delta * 4, 0.2));
		}
	});

	return (
		<group ref={groupRef}>
			{children}
		</group>
	);
}

export function CadViewport({
	stlUrl,
	statusText,
	isRecompiling = false,
	hasStl = false,
	hasStep = false,
	hasDxf = false,
	hasGcode = false,
	isDeveloper,
	isDownloadingStl = false,
	isDownloadingStep = false,
	isDownloadingDxf = false,
	isDownloadingGcode = false,
	isSharing = false,
	onShare,
	onDownloadStl,
	onDownloadStep,
	onDownloadDxf,
	onDownloadGcode,
	annotations = {},
	activeParameter = null,
	hoveredParameter = null,
	onSelectParameter,
	onHoverParameter,
	geometryInfo = null,
	toolpaths = null,
	showToolpaths = true,
	workflowStage = 'cad',
	camFeatures = [],
	parameters = {},
	hasBlockedOperations = false,
	activeFeatureId = null,
	hoveredFeatureId = null,
	onHoverFeature,
	workpieceMaterial,
	simulationState,
	camTools,
	camSetup,
	debugMode = false,
	setupMetadata,
	camViewport = { showStock: true },
	camOperations = [],
	setupToolAxis,
	children,
	headerActions,
	projectName,
	onOpenProjects,
	onMeshClick,
	onClearSelection,
	xRayMode = false,
	onToggleXRay,
	blueprintUrl = null,
	targetPortion = null,
	onSelectPortion,
	showBlueprintPIP,
	onToggleBlueprintPIP,
	onAttachBlueprint,
}: CadViewportProps) {
	const groupRef = useRef<THREE.Group>(null);
	const exportRef = useRef<HTMLDivElement>(null);
	const [exportOpen, setExportOpen] = useState(false);
	const [viewMode, setViewMode] = useState<'both' | 'solid' | 'wireframe'>('both');
	const [localShowPIP, setLocalShowPIP] = useState(false);
	const isPIPOpen = showBlueprintPIP !== undefined ? showBlueprintPIP : localShowPIP;
	const togglePIP = onToggleBlueprintPIP || (() => setLocalShowPIP(prev => !prev));

	const dispatchViewportAction = (action: string) => {
		window.dispatchEvent(new CustomEvent('viewport-action', { detail: action }));
	};

	useEffect(() => {
		const handleKeyUp = (e: KeyboardEvent) => {
			// Don't trigger shortcuts when typing in inputs
			if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement || (e.target as HTMLElement).isContentEditable) return;
			
			const key = e.key.toLowerCase();
			switch (key) {
				case 't': dispatchViewportAction('top'); break;
				case 'f': dispatchViewportAction('front'); break;
				case 'r': dispatchViewportAction('right'); break;
				case 'l': dispatchViewportAction('left'); break;
				case 'b': dispatchViewportAction('bottom'); break;
				case 'i': dispatchViewportAction('iso'); break;
				case 'h': dispatchViewportAction('home'); break;
				case 'a': 
					e.preventDefault();
					e.stopPropagation();
					dispatchViewportAction('auto-rotate'); 
					break;
				case 'x':
					e.preventDefault();
					onToggleXRay?.();
					break;
			}
		};
		window.addEventListener('keyup', handleKeyUp, { capture: true });
		return () => window.removeEventListener('keyup', handleKeyUp, { capture: true });
	}, []);

	useEffect(() => {
		const handleClickOutside = (e: MouseEvent) => {
			if (exportRef.current && !exportRef.current.contains(e.target as Node)) {
				setExportOpen(false);
			}
		};
		document.addEventListener('mousedown', handleClickOutside);
		return () => document.removeEventListener('mousedown', handleClickOutside);
	}, []);

	const { actualStock, isStockCenterInSetupSpace } = useMemo(() => {
		let center: [number, number, number] = [0, 0, 0];
		let defaultBoxSize: [number, number, number] = [10, 10, 10];
		let inSetupSpace = false;

		if (setupMetadata?.resolvedStock?.center) {
			center = setupMetadata.resolvedStock.center as [number, number, number];
			inSetupSpace = true;
		} else if (geometryInfo?.bounding_box) {
			const min = geometryInfo.bounding_box.min;
			const max = geometryInfo.bounding_box.max;
			const cx = (min[0] + max[0]) / 2;
			const cy = (min[1] + max[1]) / 2;
			const cz = (min[2] + max[2]) / 2;
			center = [cx, cy, cz];
			defaultBoxSize = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
		}

		const currentStockType = String(camSetup?.stockType || setupMetadata?.stockType || setupMetadata?.resolvedStock?.type || 'box').toLowerCase();
		const isCyl = currentStockType.includes('cylin') || currentStockType.includes('bar');

		if (isCyl) {
			let dia = camSetup?.cylinderDiameter;
			let len = camSetup?.cylinderLength;

			if ((!dia || dia <= 0) && camSetup?.stockDimensions && Array.isArray(camSetup.stockDimensions) && camSetup.stockDimensions.length >= 2) {
				dia = Math.max(camSetup.stockDimensions[0], camSetup.stockDimensions[1]);
			}
			if ((!len || len <= 0) && camSetup?.stockDimensions && Array.isArray(camSetup.stockDimensions) && camSetup.stockDimensions.length >= 3) {
				len = camSetup.stockDimensions[2];
			}

			if (!dia || dia <= 0) dia = Math.max(defaultBoxSize[0], defaultBoxSize[1]);
			if (!len || len <= 0) len = defaultBoxSize[2];

			return {
				actualStock: {
					center,
					dimensions: [dia, dia, len],
					stockType: currentStockType
				},
				isStockCenterInSetupSpace: inSetupSpace
			};
		} else {
			let dims: [number, number, number] = [10, 10, 10];

			if (camSetup?.stockDimensions && Array.isArray(camSetup.stockDimensions) && camSetup.stockDimensions.length >= 3) {
				dims = [
					Number(camSetup.stockDimensions[0]) || 10,
					Number(camSetup.stockDimensions[1]) || 10,
					Number(camSetup.stockDimensions[2]) || 10
				];
			} else if (setupMetadata?.resolvedStock?.dimensions) {
				dims = setupMetadata.resolvedStock.dimensions as [number, number, number];
			} else {
				dims = [defaultBoxSize[0] + 2, defaultBoxSize[1] + 2, defaultBoxSize[2] + 2];
			}

			return {
				actualStock: {
					center,
					dimensions: dims,
					stockType: currentStockType
				},
				isStockCenterInSetupSpace: inSetupSpace
			};
		}
	}, [geometryInfo, setupMetadata, camSetup]);

	const dynamicSize = useMemo(() => {
		let size = 50; 
		if (geometryInfo?.bounding_box) {
			const dx = geometryInfo.bounding_box.max[0] - geometryInfo.bounding_box.min[0];
			const dy = geometryInfo.bounding_box.max[1] - geometryInfo.bounding_box.min[1];
			const dz = geometryInfo.bounding_box.max[2] - geometryInfo.bounding_box.min[2];
			size = Math.max(dx, dy, dz);
		} else if (camSetup?.stockDimensions) {
			size = Math.max(camSetup.stockDimensions.width || 0, camSetup.stockDimensions.length || 0, camSetup.stockDimensions.height || 0);
		}
		return Math.max(size, 1);
	}, [geometryInfo, camSetup]);
	
	const gridFade = dynamicSize * 2.5;
	const gridCell = Math.pow(10, Math.floor(Math.log10(dynamicSize / 5)));
	const gridSection = gridCell * 10;

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

		const allowedSources = ['drill', 'drilling', 'contour', '2d_contour', 'pocket', 'pocket_milling', 'boss', 'boss_clearing', 'face', 'facing', 'turning', 'od_turning', 'facing_turning', 'slot_milling', 'chamfer_milling', 'tapping', 'strategy'];
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
	const [contextMenu, setContextMenu] = useState<{x: number, y: number} | null>(null);

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

			<header className="flex h-12 items-center justify-between border-b border-border/40 bg-background/50 backdrop-blur-2xl px-3 sm:px-4 z-30 gap-2">
				<div className="flex items-center gap-2 sm:gap-2.5 min-w-0 flex-1">
					{projectName && (
						<button
							type="button"
							onClick={onOpenProjects}
							className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-black/40 border border-white/10 hover:border-cyan-500/40 text-muted-foreground hover:text-cyan-300 text-[11px] font-semibold transition-all shadow-sm group cursor-pointer shrink-0"
							title={`Current Project: ${projectName}\nClick to view sessions & switch projects`}
						>
							<Folder className="size-3 text-cyan-400 group-hover:scale-110 transition-transform shrink-0" />
							<span className="max-w-[110px] sm:max-w-[150px] truncate font-medium text-white/90">
								{projectName.replace(/^#\d+_/, '')}
							</span>
							<ChevronDown className="size-2.5 text-muted-foreground group-hover:text-cyan-300 shrink-0" />
						</button>
					)}

					{/* Live Compilation Status (Compact dot with expandable text when busy) */}
					<div 
						className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground min-w-0"
						title={statusText}
					>
						{isRecompiling || statusText.includes('Extracting') || statusText.includes('Generating') || statusText.includes('Syncing') ? (
							<>
								<Loader2 className="size-3 animate-spin text-cyan-400 shrink-0" />
								<span className="text-cyan-300 font-mono text-[10.5px] truncate animate-pulse">
									{statusText.replace('Geometry ', '')}
								</span>
							</>
						) : (
							<div className="flex items-center gap-1.5 text-muted-foreground/70">
								<span className={`size-1.5 rounded-full shrink-0 ${hasStl ? 'bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.8)]' : 'bg-muted-foreground/40'}`} />
								<span className="text-[10px] font-mono uppercase tracking-wider hidden md:inline text-muted-foreground/60">
									Ready
								</span>
							</div>
						)}
					</div>
				</div>

				<div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
					{headerActions}

					{onShare && (
						<button
							onClick={onShare}
							disabled={isSharing}
							className="flex h-8 items-center gap-1.5 rounded-xl border border-white/10 bg-black/30 hover:bg-white/10 px-3 text-[11px] font-semibold text-muted-foreground hover:text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
							title="Share 3D Model link"
						>
							{isSharing ? <Loader2 className="size-3 animate-spin text-cyan-400" /> : <Share2 className="size-3" />}
							<span className="hidden sm:inline">Share</span>
						</button>
					)}

					{(hasDxf || hasStl || hasGcode || hasStep) && (
						<div className="relative" ref={exportRef}>
							<button
								onClick={() => setExportOpen(!exportOpen)}
								className="flex h-8 items-center gap-1.5 rounded-xl bg-gradient-to-r from-cyan-400 to-blue-500 hover:from-cyan-300 hover:to-blue-400 px-3 text-[11px] font-extrabold text-black transition-all shadow-[0_0_12px_rgba(34,211,238,0.25)] cursor-pointer"
							>
								<Download className="size-3" />
								<span>Export</span>
								<ChevronDown className={`size-2.5 transition-transform ${exportOpen ? 'rotate-180' : ''}`} />
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

			<div 
				className="relative flex-1"
				onContextMenu={(e) => {
					e.preventDefault();
					setContextMenu({ x: e.clientX, y: e.clientY });
				}}
				onClick={() => {
					if (contextMenu) setContextMenu(null);
				}}
			>
				{/* View Mode Controls - Floating Toolbar */}
				{(hasStl || (toolpaths && toolpaths.length > 0)) && (
					<div className={`absolute left-1/2 -translate-x-1/2 z-20 flex items-center gap-2 bg-background/90 backdrop-blur-xl border border-border/60 rounded-full px-4 py-2 shadow-2xl ring-1 ring-white/5 transition-all ${(workflowStage === 'cam' || workflowStage === 'gcode') ? 'bottom-32' : 'bottom-24'}`}>
						<button
							onClick={() => setViewMode('both')}
							className={`p-2.5 rounded-full transition-all ${viewMode === 'both' ? 'bg-blue-500/20 text-blue-400 shadow-sm' : 'text-muted-foreground hover:bg-accent hover:text-foreground'}`}
							title="Show Solid & Toolpaths"
						>
							<Layers className="size-4" />
						</button>
						<div className="w-px h-5 bg-border/60 mx-1" />
						<button
							onClick={() => setViewMode('solid')}
							className={`p-2.5 rounded-full transition-all ${viewMode === 'solid' ? 'bg-blue-500/20 text-blue-400 shadow-sm' : 'text-muted-foreground hover:bg-accent hover:text-foreground'}`}
							title="Solid Model Only"
						>
							<Box className="size-4" />
						</button>
						{toolpaths && toolpaths.length > 0 && (
							<>
								<div className="w-px h-5 bg-border/60 mx-1" />
								<button
									onClick={() => setViewMode('wireframe')}
									className={`p-2.5 rounded-full transition-all ${viewMode === 'wireframe' ? 'bg-cyan-500/20 text-cyan-400 shadow-sm' : 'text-muted-foreground hover:bg-accent hover:text-foreground'}`}
									title="Toolpaths/Wireframe Only"
								>
									<Activity className="size-4" />
								</button>
							</>
						)}
						<div className="w-px h-5 bg-border/60 mx-1" />
						<button
							onClick={onToggleXRay}
							className={`p-2.5 rounded-full transition-all ${xRayMode ? 'bg-cyan-500/20 text-cyan-400 shadow-[0_0_12px_rgba(6,182,212,0.3)]' : 'text-muted-foreground hover:bg-accent hover:text-foreground'}`}
							title="X-Ray / Transparency Mode (X)"
						>
							<Eye className="size-4" />
						</button>
						<div className="w-px h-5 bg-border/60 mx-1" />
						<button onClick={() => dispatchViewportAction('fit')} className="p-2.5 rounded-full text-muted-foreground hover:bg-accent hover:text-foreground transition-all" title="Fit to Screen"><Maximize className="size-4" /></button>
						<button onClick={() => dispatchViewportAction('reset')} className="p-2.5 rounded-full text-muted-foreground hover:bg-accent hover:text-foreground transition-all" title="Reset Camera"><RotateCcw className="size-4" /></button>
						{blueprintUrl && (
							<>
								<div className="w-px h-5 bg-border/60 mx-1" />
								<button
									onClick={togglePIP}
									className={`p-2.5 rounded-full transition-all ${isPIPOpen ? 'bg-blue-500/20 text-blue-400 shadow-[0_0_12px_rgba(59,130,246,0.3)]' : 'text-muted-foreground hover:bg-accent hover:text-foreground'}`}
									title="Toggle Blueprint Drawing Inspector (2D / PIP)"
								>
									<FileImage className="size-4" />
								</button>
							</>
						)}
					</div>
				)}

				{/* Floating Blueprint PIP Overlay */}
				{isPIPOpen && blueprintUrl && !isRecompiling && (
					<div className="absolute top-4 right-4 z-40 w-[420px] h-[340px] shadow-2xl rounded-xl border border-border/80 overflow-hidden animate-in fade-in zoom-in-95 duration-200 pointer-events-auto">
						<BlueprintViewer
							blueprintUrl={blueprintUrl}
							targetPortion={targetPortion || null}
							onSelectPortion={onSelectPortion}
							activeParameter={activeParameter}
							onClose={togglePIP}
							isFloating={true}
							className="w-full h-full"
							onAttachBlueprint={onAttachBlueprint}
						/>
					</div>
				)}

				{/* Right-Click Context Menu */}
				{contextMenu && (
					<div 
						className="fixed z-[100] bg-background/95 backdrop-blur-xl border border-border/60 rounded-xl shadow-2xl py-1.5 w-48 flex flex-col overflow-hidden ring-1 ring-white/5"
						style={{ top: contextMenu.y, left: contextMenu.x }}
					>
						<button onClick={() => { dispatchViewportAction('top'); setContextMenu(null); }} className="px-4 py-2 text-left text-sm text-foreground hover:bg-accent transition-colors flex items-center justify-between">Top View <span className="text-[10px] text-muted-foreground font-mono">T</span></button>
						<button onClick={() => { dispatchViewportAction('front'); setContextMenu(null); }} className="px-4 py-2 text-left text-sm text-foreground hover:bg-accent transition-colors flex items-center justify-between">Front View <span className="text-[10px] text-muted-foreground font-mono">F</span></button>
						<button onClick={() => { dispatchViewportAction('right'); setContextMenu(null); }} className="px-4 py-2 text-left text-sm text-foreground hover:bg-accent transition-colors flex items-center justify-between">Right View <span className="text-[10px] text-muted-foreground font-mono">R</span></button>
						<button onClick={() => { dispatchViewportAction('left'); setContextMenu(null); }} className="px-4 py-2 text-left text-sm text-foreground hover:bg-accent transition-colors flex items-center justify-between">Left View <span className="text-[10px] text-muted-foreground font-mono">L</span></button>
						<button onClick={() => { dispatchViewportAction('bottom'); setContextMenu(null); }} className="px-4 py-2 text-left text-sm text-foreground hover:bg-accent transition-colors flex items-center justify-between">Bottom View <span className="text-[10px] text-muted-foreground font-mono">B</span></button>
						<div className="h-px bg-border/60 my-1.5 mx-3" />
						<button onClick={() => { window.dispatchEvent(new CustomEvent('model-rotate', { detail: { axis: 'x', degrees: 90 } })); setContextMenu(null); }} className="px-4 py-2 text-left text-sm text-foreground hover:bg-accent transition-colors flex items-center justify-between">Rotate X +90° <RotateCcw className="size-3 text-muted-foreground" /></button>
						<button onClick={() => { window.dispatchEvent(new CustomEvent('model-rotate', { detail: { axis: 'y', degrees: 90 } })); setContextMenu(null); }} className="px-4 py-2 text-left text-sm text-foreground hover:bg-accent transition-colors flex items-center justify-between">Rotate Y +90° <RotateCcw className="size-3 text-muted-foreground" /></button>
						<button onClick={() => { window.dispatchEvent(new CustomEvent('model-rotate', { detail: { axis: 'z', degrees: 90 } })); setContextMenu(null); }} className="px-4 py-2 text-left text-sm text-foreground hover:bg-accent transition-colors flex items-center justify-between">Rotate Z +90° <RotateCcw className="size-3 text-muted-foreground" /></button>
						<div className="h-px bg-border/60 my-1.5 mx-3" />
						<button onClick={() => { dispatchViewportAction('iso'); setContextMenu(null); }} className="px-4 py-2 text-left text-sm font-bold text-blue-400 hover:bg-accent hover:text-blue-300 transition-colors flex items-center justify-between">Isometric <span className="text-[10px] opacity-70 font-mono font-normal">I</span></button>
						<button onClick={() => { dispatchViewportAction('home'); setContextMenu(null); }} className="px-4 py-2 text-left text-sm text-foreground hover:bg-accent transition-colors flex items-center justify-between">Home View <span className="text-[10px] text-muted-foreground font-mono">H</span></button>
						<button onClick={() => { dispatchViewportAction('auto-rotate'); setContextMenu(null); }} className="px-4 py-2 text-left text-sm text-foreground hover:bg-accent transition-colors flex items-center justify-between">Auto Rotate <span className="text-[10px] text-muted-foreground font-mono">A</span></button>
						<button onClick={() => { dispatchViewportAction('fit'); setContextMenu(null); }} className="px-4 py-2 text-left text-sm text-foreground hover:bg-accent transition-colors">Fit to Screen</button>
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

				<Canvas id="cad-three-canvas" shadows dpr={[1, 2]} gl={{ preserveDrawingBuffer: true }} className="relative z-10" onPointerMissed={onClearSelection}>
					<CanvasBridge />
					<ViewportController 
						modelGroupRef={groupRef}
						geometryInfo={geometryInfo} 
						activeFeatureId={activeFeatureId} 
						camFeatures={camFeatures} 
						hasStl={hasStl} 
						workflowStage={workflowStage}
					/>
					
					<CameraRig
						activeParameter={activeParameter}
						activeFeatureId={activeFeatureId}
						annotations={annotations}
						geometryInfo={geometryInfo}
						modelToSetupTransform={setupMetadata?.modelToSetupTransform}
					/>
					
					<Suspense fallback={null}>
						<Environment files="/potsdamer_platz_1k.hdr" />
						
						{/* Professional CAD Lighting */}
						<hemisphereLight intensity={0.4} groundColor="#1e293b" color="#f8fafc" />
						<directionalLight castShadow intensity={0.8} position={[10, 20, 10]} shadow-mapSize={[2048, 2048]}>
							<orthographicCamera attach="shadow-camera" args={[-20, 20, 20, -20, 0.1, 100]} />
						</directionalLight>
						<directionalLight intensity={0.3} position={[-10, -10, -10]} color="#94a3b8" />
						
						<DynamicFloor targetRef={groupRef}>
							{/* Contact Shadows at bounding box bottom */}
							<ContactShadows resolution={1024} scale={50} blur={2} opacity={0.4} far={10} color="#000000" />
							
							<Grid infiniteGrid fadeDistance={gridFade} sectionColor="#1e3a8a" cellColor="#0f172a" cellSize={gridCell} sectionSize={gridSection} />
						</DynamicFloor>
						
						<AnimatedSetupGroup setupToolAxis={setupToolAxis} isSetup={workflowStage === 'cam' || workflowStage === 'gcode'} hasToolpaths={hasValidToolpaths}>
							<group ref={groupRef}>
								{/* The CAD model MUST be transformed to setup space using modelToSetupTransform */}
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

										const isCamStage = (workflowStage === 'cam' || workflowStage === 'gcode') && hasValidToolpaths;
										
										let simOffsetX = 0;
										let simOffsetY = 0;
										
										const simOffset = new THREE.Vector3(simOffsetX, simOffsetY, 0);
										const cadOffset = new THREE.Vector3(0, 0, 0);
										const combinedPos = new THREE.Vector3().copy(pos).add(cadOffset);
										
										return (
											<>
												<group position={combinedPos} quaternion={quat} scale={scale}>
													{isSolidVisible && children}
													
                                                    {/* Overlays - placed next to children so they inherit the exact same transforms */}
                                                    {geometryInfo && annotations && (
                                                        <DimensionOverlay
                                                            annotations={annotations}
                                                            activeParameter={(activeParameter || activeFeatureId) as string | null}
                                                            hoveredParameter={hoveredParameter}
                                                            targetPortion={targetPortion}
                                                            geometryScale={geometryInfo.scale}
                                                            geometryCenter={geometryInfo.center}
                                                            onSelectParameter={onSelectParameter}
                                                            onHoverParameter={onHoverParameter}
                                                        />
                                                    )}

                                                    {/* 3D Target Portion Highlight (Glowing halo + HUD Beacon) */}
                                                    {targetPortion && geometryInfo && (
                                                        <TargetPortion3DHighlight
                                                            targetPortion={targetPortion}
                                                            geometryInfo={geometryInfo}
                                                            annotations={annotations}
                                                            onClear={() => onSelectPortion?.(null)}
                                                        />
                                                    )}
                                                </group>

												{isWireframeVisible && (
													<group
														scale={1}
														position={simOffset}
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

																const internalUnits = setupMetadata?.internalUnits || 'mm';
																const rawDiameter = activeTool.diameter || activeTool.diameter_mm || 6;
																const toolDiameter = internalUnits === 'in' ? rawDiameter / 25.4 : rawDiameter;
																const radius = toolDiameter / 2;
																const isFaceMill = activeTool.type === 'face_mill';
																
																// Calculate purely proportional realistic proportions (no hardcoded absolute caps)
																const defaultCuttingLength = isFaceMill ? radius * 0.5 : radius * 3;
																const rawCuttingLength = activeTool.cutting_length || activeTool.flute_length || (defaultCuttingLength * (internalUnits === 'in' ? 25.4 : 1));
																const cuttingLength = internalUnits === 'in' ? rawCuttingLength / 25.4 : rawCuttingLength;
																const shaftRadius = isFaceMill ? radius * 0.4 : radius;
																const defaultStickout = isFaceMill ? cuttingLength + radius * 2 : radius * 5;
																const rawStickout = activeTool.length_mm || activeTool.stickout || (defaultStickout * (internalUnits === 'in' ? 25.4 : 1));
																const stickout = internalUnits === 'in' ? rawStickout / 25.4 : rawStickout;

																const colletRadiusBase = shaftRadius * 1.5;
																const holderTopRad = colletRadiusBase * 1.5;
																const holderBotRad = colletRadiusBase * 1.2;
																const holderHeight = shaftRadius * 4;

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

																let toolVisScale = 1;
																if (actualStock) {
																	const maxStockDim = Math.max(actualStock.dimensions[0], actualStock.dimensions[1]);
																	const maxToolVisualSize = maxStockDim * 1.5; 
																	const currentToolVisualSize = Math.max(toolDiameter, stickout);
																	
																	if (currentToolVisualSize > maxToolVisualSize && currentToolVisualSize > 0) {
																		toolVisScale = maxToolVisualSize / currentToolVisualSize;
																	}
																}

																return (
																	<group position={[x, y, z]} quaternion={quaternion} scale={toolVisScale}>
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

																		{/* CNC Spindle / Tool Holder (scaled dynamically) */}
																		<mesh position={[0, stickout + holderHeight / 2, 0]}>
																			<cylinderGeometry
																				args={[holderBotRad, holderTopRad, holderHeight, 32]}
																				ref={(geom) => {
																					if (geom) {
																						geom.computeBoundingBox = () => { geom.boundingBox = new THREE.Box3(); };
																						geom.boundingBox = new THREE.Box3();
																					}
																				}}
																			/>
																			<meshStandardMaterial color="#334155" metalness={0.9} roughness={0.3} />
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
								
								{/* Stock Boundaries and Machine Table */}
								{(() => {
									const isCamStage = (workflowStage === 'cam' || workflowStage === 'gcode') && hasValidToolpaths;
									if (!actualStock) return null;
									
									const m = setupMetadata?.modelToSetupTransform 
										? new THREE.Matrix4().fromArray(
											Array.isArray(setupMetadata.modelToSetupTransform[0]) 
												? setupMetadata.modelToSetupTransform.flat() 
												: setupMetadata.modelToSetupTransform
										).transpose() 
										: new THREE.Matrix4();
									
									const transformedCenter = isStockCenterInSetupSpace 
										? new THREE.Vector3(...(actualStock.center as [number, number, number]))
										: new THREE.Vector3(...(actualStock.center as [number, number, number])).applyMatrix4(m);
									const transformedCenterArr: [number, number, number] = [transformedCenter.x, transformedCenter.y, transformedCenter.z];

									const offsetAmount = 0;
									const simOffset = new THREE.Vector3(offsetAmount, 0, 0);

									return (
										<group position={simOffset}>
											{isCamStage && simulationState?.showStock !== false && simulationState && camTools && (
												<VolumetricStock 
													stockType={(camSetup?.stockType as any) || setupMetadata?.stockType || setupMetadata?.resolvedStock?.type || 'box'}
													stockCenter={transformedCenterArr}
													stockDimensions={actualStock.dimensions as [number, number, number]}
													simulationState={simulationState}
													camTools={camTools}
													resolution={128}
													setupUnits={setupMetadata?.internalUnits || 'mm'}
												/>
											)}
											
											{/* Machine Table / Vise Environment */}
											{isCamStage && simulationState?.showMachine !== false && (() => {
												// Determine scale factor based on stock size to prevent tiny models
												// Reference default stock is 100mm, so we scale relative to that
												const maxDim = Math.max(actualStock.dimensions[0], actualStock.dimensions[1], 10);
												const s = maxDim / 100;
												
												const axis = setupToolAxis ? new THREE.Vector3(...setupToolAxis).normalize() : new THREE.Vector3(0, 0, 1);
												const tableQuat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), axis);
												
												// We must dynamically pick the thickness of the stock along the tool axis
												let stockThickness = actualStock.dimensions[2];
												let stockGrip = actualStock.dimensions[1];
												if (Math.abs(axis.x) > 0.9) { stockThickness = actualStock.dimensions[0]; stockGrip = actualStock.dimensions[1]; }
												else if (Math.abs(axis.y) > 0.9) { stockThickness = actualStock.dimensions[1]; stockGrip = actualStock.dimensions[0]; }

												return (
												<group position={transformedCenterArr} quaternion={tableQuat}>
													<group position={[0, 0, -stockThickness / 2 - 30 * s]}>
														{/* Machine Table */}
														<mesh position={[0, 0, -25 * s]}>
															<boxGeometry args={[800 * s, 500 * s, 50 * s]} />
															<meshStandardMaterial color="#1e293b" metalness={0.7} roughness={0.4} />
														</mesh>
														{/* Vise Base */}
														<mesh position={[0, 0, 10 * s]}>
															<boxGeometry args={[150 * s, 250 * s, 20 * s]} />
															<meshStandardMaterial color="#475569" metalness={0.6} roughness={0.5} />
														</mesh>
														{/* Fixed Jaw */}
														<mesh position={[0, -stockGrip / 2 - 15 * s, 35 * s]}>
															<boxGeometry args={[140 * s, 30 * s, 30 * s]} />
															<meshStandardMaterial color="#94a3b8" metalness={0.5} roughness={0.4} />
														</mesh>
														{/* Moving Jaw */}
														<mesh position={[0, stockGrip / 2 + 15 * s, 35 * s]}>
															<boxGeometry args={[140 * s, 30 * s, 30 * s]} />
															<meshStandardMaterial color="#94a3b8" metalness={0.5} roughness={0.4} />
														</mesh>
													</group>
												</group>
												);
											})()}
										</group>
									);
								})()}
								</group>
						</AnimatedSetupGroup>

						<GizmoHelper alignment="top-right" margin={[60, 60]}>
							<GizmoViewcube 
								color="#1e293b" 
								strokeColor="#475569" 
								hoverColor="#3b82f6" 
								textColor="#f8fafc"
								opacity={0.75} 
							/>
						</GizmoHelper>
					</Suspense>

					{/* Dimension overlay was moved inside Stage */}

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
				<div className={`absolute left-1/2 -translate-x-1/2 z-10 flex flex-col items-center gap-2 transition-all ${(workflowStage === 'cam' || workflowStage === 'gcode') ? 'bottom-24' : 'bottom-6'}`}>
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
