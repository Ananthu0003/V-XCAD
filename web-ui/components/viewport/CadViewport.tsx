'use client';

import React, { Suspense, useState, useRef, useEffect, useMemo, Component, type ErrorInfo, type ReactNode } from 'react';
import { useTheme } from 'next-themes';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { OrbitControls, Stage, PerspectiveCamera, Line, GizmoHelper, GizmoViewcube, Grid, Environment, ContactShadows } from '@react-three/drei';
import { ViewportController } from '@/components/viewport/ViewportController';
import { Loader2, Share2, Download, ChevronDown, Layers, Box, Activity, ChevronRight, CheckCircle2, Camera, Maximize, RotateCcw, Home, Eye, FileImage, Folder, Upload, AlertTriangle } from 'lucide-react';
import { DimensionOverlay } from '@/components/viewport/DimensionOverlay';
import { FeatureHighlight } from '@/components/viewport/FeatureHighlight';
import { CameraRig } from '@/components/viewport/CameraRig';
import { VolumetricStock } from '@/components/cam/VolumetricStock';
import { BlueprintViewer } from '@/components/blueprint/BlueprintViewer';
import { TargetPortion3DHighlight } from '@/components/viewport/TargetPortion3DHighlight';
import { ThreeErrorBoundary, CanvasRootErrorBoundary } from '@/components/viewport/ThreeErrorBoundary';
import type { TargetPortion } from '@/components/chat/ChatPanel';
import type { StlGeometryInfo } from '@/components/viewport/StlMesh';

type AnnotationEntry = {
	p1: [number, number, number];
	p2: [number, number, number];
	text?: string;
	type?: 'distance' | 'diameter' | 'radius' | 'angle';
};

class CanvasErrorBoundary extends React.Component<
	{ children: React.ReactNode; onReset?: () => void },
	{ hasError: boolean; error: Error | null; retryCount: number }
> {
	private retryTimeout: ReturnType<typeof setTimeout> | null = null;

	constructor(props: { children: React.ReactNode; onReset?: () => void }) {
		super(props);
		this.state = { hasError: false, error: null, retryCount: 0 };
	}
	static getDerivedStateFromError(error: Error) {
		return { hasError: true, error };
	}
	componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
		console.warn('CanvasErrorBoundary caught 3D/WebGL render error:', error, errorInfo);
		// Auto-recover immediately once/twice if it was a transient context switch
		if (this.state.retryCount < 2) {
			this.retryTimeout = setTimeout(() => {
				this.setState((prev) => ({ hasError: false, error: null, retryCount: prev.retryCount + 1 }));
				this.props.onReset?.();
			}, 150);
		}
	}
	componentWillUnmount() {
		if (this.retryTimeout) {
			clearTimeout(this.retryTimeout);
		}
	}
	render() {
		if (this.state.hasError && this.state.retryCount >= 2) {
			return (
				<div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-background/80 backdrop-blur-md p-6 text-center">
					<div className="max-w-md w-full rounded-2xl border border-border/60 bg-card p-6 shadow-2xl flex flex-col items-center gap-3">
						<div className="size-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-500">
							<Box className="size-5" />
						</div>
						<h3 className="text-sm font-bold text-foreground">3D Viewport Resetting</h3>
						<p className="text-xs text-muted-foreground leading-relaxed">
							The 3D graphics context encountered an issue or reload event.
						</p>
						<button
							type="button"
							onClick={() => {
								this.setState({ hasError: false, error: null, retryCount: 0 });
								this.props.onReset?.();
							}}
							className="mt-2 px-4 py-2 rounded-xl bg-primary text-primary-foreground font-semibold text-xs hover:bg-primary/90 transition-all cursor-pointer"
						>
							Restore 3D Viewport
						</button>
					</div>
				</div>
			);
		}
		return this.props.children;
	}
}

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
	workflowStage?: 'blueprint' | 'extraction' | 'cad' | 'manual_cad' | 'cam' | 'gcode';
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
	onImportStep?: (file: File) => void;
	onImportStl?: (file: File) => void;
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
	onImportStep,
	onImportStl,
}: CadViewportProps) {
	const { resolvedTheme } = useTheme();
	const isDark = resolvedTheme !== 'light';
	const handleImport = onImportStep || onImportStl;
	const groupRef = useRef<THREE.Group>(null);
	const exportRef = useRef<HTMLDivElement>(null);
	const stepInputRef = useRef<HTMLInputElement>(null);
	const [isDraggingStep, setIsDraggingStep] = useState(false);
	const [exportOpen, setExportOpen] = useState(false);
	const [viewMode, setViewMode] = useState<'both' | 'solid' | 'wireframe'>('both');
	const [localShowPIP, setLocalShowPIP] = useState(false);
	const [meshLoadError, setMeshLoadError] = useState<string | null>(null);
	const [modelRotation, setModelRotation] = useState<{ x: number; y: number; z: number }>({ x: 0, y: 0, z: 0 });
	const [isAutoRotating, setIsAutoRotating] = useState(false);
	const isPIPOpen = showBlueprintPIP !== undefined ? showBlueprintPIP : localShowPIP;
	const togglePIP = onToggleBlueprintPIP || (() => setLocalShowPIP(prev => !prev));

	const [canvasKey, setCanvasKey] = useState(0);

	useEffect(() => {
		setMeshLoadError(null);
		setModelRotation({ x: 0, y: 0, z: 0 });
	}, [stlUrl]);

	useEffect(() => {
		const handleModelRotate = (e: CustomEvent<{ axis: 'x' | 'y' | 'z'; degrees: number }>) => {
			const { axis, degrees } = e.detail;
			const rad = (degrees * Math.PI) / 180;
			setModelRotation((prev) => ({
				...prev,
				[axis]: (prev[axis] + rad) % (Math.PI * 2),
			}));
		};
		const handleAction = (e: CustomEvent) => {
			if (e.detail === 'reset' || e.detail === 'reset-model') {
				setModelRotation({ x: 0, y: 0, z: 0 });
			}
			if (e.detail === 'auto-rotate' || e.detail === 'rotate') {
				setIsAutoRotating((prev) => !prev);
			}
			if (e.detail === 'stop-auto-rotate') {
				setIsAutoRotating(false);
			}
		};
		window.addEventListener('model-rotate', handleModelRotate as EventListener);
		window.addEventListener('viewport-action', handleAction as EventListener);
		return () => {
			window.removeEventListener('model-rotate', handleModelRotate as EventListener);
			window.removeEventListener('viewport-action', handleAction as EventListener);
		};
	}, []);

	const dispatchViewportAction = (action: string) => {
		window.dispatchEvent(new CustomEvent('viewport-action', { detail: action }));
	};

	useEffect(() => {
		const handleKeyUp = (e: KeyboardEvent) => {
			// Don't trigger shortcuts when typing in inputs
			if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement || (e.target as HTMLElement).isContentEditable) return;

			if (workflowStage === 'manual_cad') {
				if (e.shiftKey) {
					switch (e.key) {
						case '1': dispatchViewportAction('top'); break;
						case '2': dispatchViewportAction('front'); break;
						case '3': dispatchViewportAction('right'); break;
						case '4': dispatchViewportAction('left'); break;
						case '5': dispatchViewportAction('bottom'); break;
						case '6': dispatchViewportAction('iso'); break;
						case 'H':
						case 'h': dispatchViewportAction('home'); break;
					}
				}
				// Skip single-letter camera shortcuts in manual_cad to prevent collision with CAD tool shortcuts
				return;
			}
			
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
	}, [workflowStage]);

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
            'plunge', 'cut', 'linear', 'feed', 'cutting', 'contour', 'arc_cw', 'arc_ccw', 'drill_cycle',
            'rapid', 'arc', 'retract', 'helix'
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
			} else if (['feed', 'cut', 'linear', 'cutting', 'contour', 'arc', 'arc_cw', 'arc_ccw'].includes(type)) {
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
			const sx = seg.start?.x ?? seg.start_x;
			const sy = seg.start?.y ?? seg.start_y;
			const sz = seg.start?.z ?? seg.start_z;
			const ex = seg.end?.x ?? seg.end_x;
			const ey = seg.end?.y ?? seg.end_y;
			const ez = seg.end?.z ?? seg.end_z;

			if (sx !== undefined && ex !== undefined && sy !== undefined && ey !== undefined && sz !== undefined && ez !== undefined) {
				const isArc = ['arc', 'arc_cw', 'arc_ccw'].includes(type) || seg.center || seg.center_x !== undefined;
				const cx = seg.center?.x ?? seg.center_x;
				const cy = seg.center?.y ?? seg.center_y;

				if (isArc && cx !== undefined && cy !== undefined) {
					const r = seg.radius ?? Math.hypot(sx - cx, sy - cy);
					if (r > 0.0001) {
						const startAngle = Math.atan2(sy - cy, sx - cx);
						const endAngle = Math.atan2(ey - cy, ex - cx);
						const isCW = type === 'arc_cw' || seg.clockwise === true;
						let sweep = endAngle - startAngle;
						if (isCW) {
							if (sweep >= -1e-6) sweep -= 2 * Math.PI;
						} else {
							if (sweep <= 1e-6) sweep += 2 * Math.PI;
						}

						const steps = Math.max(16, Math.min(64, Math.ceil(Math.abs(sweep) / (Math.PI / 16))));
						let prevX = sx;
						let prevY = sy;
						let prevZ = sz;
						for (let s = 1; s <= steps; s++) {
							const frac = s / steps;
							const curAngle = startAngle + frac * sweep;
							const curX = s === steps ? ex : (cx + r * Math.cos(curAngle));
							const curY = s === steps ? ey : (cy + r * Math.sin(curAngle));
							const curZ = sz + frac * (ez - sz);

							targetGroup.push(new THREE.Vector3(prevX, prevY, prevZ));
							targetGroup.push(new THREE.Vector3(curX, curY, curZ));

							prevX = curX;
							prevY = curY;
							prevZ = curZ;
						}
					} else {
						targetGroup.push(new THREE.Vector3(sx, sy, sz));
						targetGroup.push(new THREE.Vector3(ex, ey, ez));
					}
				} else {
					targetGroup.push(new THREE.Vector3(sx, sy, sz));
					targetGroup.push(new THREE.Vector3(ex, ey, ez));
				}
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
		<section className={`relative flex h-full w-full flex-col overflow-hidden font-sans ${workflowStage === 'manual_cad' ? 'bg-transparent' : 'bg-background'}`}>
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

			{workflowStage !== 'manual_cad' && (
				<header className="flex h-12 items-center justify-between px-3 sm:px-4 z-30 gap-2 border-b border-border/40 bg-background/50 backdrop-blur-2xl">
				<div className="flex items-center gap-2 sm:gap-2.5 min-w-0 flex-1">
					{projectName && (
						<button
							type="button"
							onClick={onOpenProjects}
							className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-card border border-border hover:border-primary/50 text-foreground dark:text-slate-200 hover:text-primary text-[11px] font-semibold transition-all shadow-sm group cursor-pointer shrink-0"
							title={`Current Project: ${projectName}\nClick to view sessions & switch projects`}
						>
							<Folder className="size-3 text-primary group-hover:scale-110 transition-transform shrink-0" />
							<span className="max-w-[110px] sm:max-w-[150px] truncate font-medium text-foreground dark:text-slate-200 group-hover:text-primary transition-colors">
								{projectName.replace(/^#\d+_/, '')}
							</span>
							<ChevronDown className="size-2.5 text-muted-foreground group-hover:text-primary shrink-0" />
						</button>
					)}

					{/* Live Compilation Status (Compact dot with expandable text when busy) */}
					<div 
						className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground dark:text-slate-300 min-w-0"
						title={statusText}
					>
						{isRecompiling || statusText.includes('Extracting') || statusText.includes('Generating') || statusText.includes('Syncing') ? (
							<>
								<Loader2 className="size-3 animate-spin text-primary shrink-0" />
								<span className="text-primary font-mono text-[11px] font-medium truncate animate-pulse">
									{statusText.replace('Geometry ', '')}
								</span>
							</>
						) : (
							<div className="flex items-center gap-1.5 text-muted-foreground dark:text-slate-400">
								<span className={`size-1.5 rounded-full shrink-0 ${hasStl ? 'bg-primary shadow-[0_0_8px_rgba(6,182,212,0.8)]' : 'bg-muted-foreground/40'}`} />
								<span className="text-[10px] font-mono uppercase tracking-wider hidden md:inline text-muted-foreground dark:text-slate-400 font-semibold">
									Ready
								</span>
							</div>
						)}
					</div>
				</div>

				<div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
					{headerActions}

					{handleImport && (
						<>
							<input
								ref={stepInputRef}
								type="file"
								accept=".step,.stp,model/step,application/step"
								className="hidden"
								onChange={(e) => {
									const file = e.target.files?.[0];
									if (file) {
										handleImport(file);
										e.target.value = '';
									}
								}}
							/>
							<button
								type="button"
								onClick={() => stepInputRef.current?.click()}
								className="flex h-8 items-center gap-1.5 rounded-xl border border-white/10 bg-black/30 hover:bg-white/10 hover:border-white/20 px-3 text-[11px] font-semibold text-muted-foreground hover:text-foreground transition-all cursor-pointer"
								title="Import 3D STEP solid model from local disk"
							>
								<Upload className="size-3 text-primary" />
								<span className="hidden sm:inline">Import STEP</span>
							</button>
						</>
					)}

					{onShare && (
						<button
							onClick={onShare}
							disabled={isSharing}
							className="flex h-8 items-center gap-1.5 rounded-xl border border-white/10 bg-black/30 hover:bg-white/10 px-3 text-[11px] font-semibold text-muted-foreground hover:text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
							title="Share 3D Model link"
						>
							{isSharing ? <Loader2 className="size-3 animate-spin text-primary" /> : <Share2 className="size-3" />}
							<span className="hidden sm:inline">Share</span>
						</button>
					)}

					{(hasDxf || hasStl || hasGcode || hasStep) && (
						<div className="relative" ref={exportRef}>
							<button
								onClick={() => setExportOpen(!exportOpen)}
								className="flex h-8 items-center gap-1.5 rounded-xl bg-primary hover:brightness-110 px-3 text-[11px] font-bold text-white transition-all cursor-pointer"
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
											{isDownloadingDxf ? <Loader2 className="size-4 animate-spin mt-0.5 text-foreground" /> : <Layers className="size-4 mt-0.5 text-foreground group-hover:text-primary transition-colors" />}
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
			)}

			<div 
				className="relative flex-1"
				onContextMenu={(e) => {
					e.preventDefault();
					setContextMenu({ x: e.clientX, y: e.clientY });
				}}
				onClick={() => {
					if (contextMenu) setContextMenu(null);
				}}
				onDragOver={(e) => {
					if (handleImport && Array.from(e.dataTransfer.types).includes('Files')) {
						e.preventDefault();
						setIsDraggingStep(true);
					}
				}}
				onDragLeave={(e) => {
					if (e.currentTarget.contains(e.relatedTarget as Node)) return;
					setIsDraggingStep(false);
				}}
				onDrop={(e) => {
					if (handleImport) {
						e.preventDefault();
						setIsDraggingStep(false);
						const file = e.dataTransfer.files?.[0];
						if (file) {
							handleImport(file);
						}
					}
				}}
			>
				{isDraggingStep && (
					<div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-background/85 backdrop-blur-md border-2 border-dashed border-primary/80 rounded-xl pointer-events-none transition-all">
						<div className="size-16 rounded-2xl bg-primary/15 border border-primary/30 flex items-center justify-center mb-3 text-primary animate-pulse">
							<Box className="size-8" />
						</div>
						<h3 className="text-sm font-bold text-foreground">Drop STEP file to import</h3>
						<p className="text-[11px] text-muted-foreground font-mono mt-1">Instant 3D rendering, B-Rep analysis & CAM toolpath generation</p>
					</div>
				)}
				{/* View Mode Controls - Floating Toolbar */}
				{(hasStl || (toolpaths && toolpaths.length > 0)) && (
					<div 
						style={{
							left:
								workflowStage === 'manual_cad'
									? 'calc((100% - 280px) / 2)'
									: workflowStage === 'cam' || workflowStage === 'gcode'
									? 'calc((100% - 336px) / 2)'
									: 'calc((100% + 36px) / 2)',
							transform: 'translateX(-50%)',
						}}
						className={`absolute z-20 flex items-center gap-2 bg-background/90 backdrop-blur-xl border border-border/60 rounded-full px-4 py-2 shadow-2xl ring-1 ring-white/5 transition-all ${
							workflowStage === 'manual_cad'
								? 'bottom-6'
								: workflowStage === 'cam' || workflowStage === 'gcode'
								? 'bottom-28'
								: 'bottom-16'
						}`}
					>
						<button
							onClick={() => setViewMode('both')}
							className={`p-2.5 rounded-full transition-all ${viewMode === 'both' ? 'bg-primary/20 text-primary shadow-sm' : 'text-muted-foreground hover:bg-accent hover:text-foreground'}`}
							title="Show Solid & Toolpaths"
						>
							<Layers className="size-4" />
						</button>
						<div className="w-px h-5 bg-border/60 mx-1" />
						<button
							onClick={() => setViewMode('solid')}
							className={`p-2.5 rounded-full transition-all ${viewMode === 'solid' ? 'bg-primary/20 text-primary shadow-sm' : 'text-muted-foreground hover:bg-accent hover:text-foreground'}`}
							title="Solid Model Only"
						>
							<Box className="size-4" />
						</button>
						{toolpaths && toolpaths.length > 0 && (
							<>
								<div className="w-px h-5 bg-border/60 mx-1" />
								<button
									onClick={() => setViewMode('wireframe')}
									className={`p-2.5 rounded-full transition-all ${viewMode === 'wireframe' ? 'bg-primary/20 text-primary shadow-sm' : 'text-muted-foreground hover:bg-accent hover:text-foreground'}`}
									title="Toolpaths/Wireframe Only"
								>
									<Activity className="size-4" />
								</button>
							</>
						)}
						<div className="w-px h-5 bg-border/60 mx-1" />
						<button
							onClick={onToggleXRay}
							className={`p-2.5 rounded-full transition-all ${xRayMode ? 'bg-primary/20 text-primary shadow-sm' : 'text-muted-foreground hover:bg-accent hover:text-foreground'}`}
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
									className={`p-2.5 rounded-full transition-all ${isPIPOpen ? 'bg-primary/20 text-primary shadow-sm' : 'text-muted-foreground hover:bg-accent hover:text-foreground'}`}
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
						{(modelRotation.x !== 0 || modelRotation.y !== 0 || modelRotation.z !== 0) && (
							<button onClick={() => { setModelRotation({ x: 0, y: 0, z: 0 }); window.dispatchEvent(new CustomEvent('viewport-action', { detail: 'reset-model' })); setContextMenu(null); }} className="px-4 py-1.5 text-left text-xs font-semibold text-amber-400 hover:bg-accent transition-colors flex items-center justify-between">Reset Model Rotation <RotateCcw className="size-3 text-amber-400" /></button>
						)}
						<div className="h-px bg-border/60 my-1.5 mx-3" />
						<button onClick={() => { dispatchViewportAction('iso'); setContextMenu(null); }} className="px-4 py-2 text-left text-sm font-bold text-primary hover:bg-accent hover:text-primary transition-colors flex items-center justify-between">Isometric <span className="text-[10px] opacity-70 font-mono font-normal">I</span></button>
						<button onClick={() => { dispatchViewportAction('home'); setContextMenu(null); }} className="px-4 py-2 text-left text-sm text-foreground hover:bg-accent transition-colors flex items-center justify-between">Home View <span className="text-[10px] text-muted-foreground font-mono">H</span></button>
						<button onClick={() => { dispatchViewportAction('auto-rotate'); setContextMenu(null); }} className={`px-4 py-2 text-left text-sm hover:bg-accent transition-colors flex items-center justify-between ${isAutoRotating ? 'text-cyan-400 font-semibold' : 'text-foreground'}`}>
							<span>Auto Rotate {isAutoRotating && <span className="text-[10px] text-cyan-400 font-mono ml-1.5">(Active)</span>}</span>
							<span className="text-[10px] text-muted-foreground font-mono">A</span>
						</button>
						<button onClick={() => { dispatchViewportAction('fit'); setContextMenu(null); }} className="px-4 py-2 text-left text-sm text-foreground hover:bg-accent transition-colors">Fit to Screen</button>
					</div>
				)}

				{allRejected && isWireframeVisible && (
					<div className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none">
						<div className="bg-black/60 backdrop-blur-md px-6 py-4 rounded-2xl border border-rose-500/30 flex flex-col items-center gap-2">
							<Activity className="size-6 text-rose-500 mb-1" />
							<p className="text-sm font-semibold text-rose-100">No valid machining toolpaths to display</p>
							<p className="text-xs text-rose-300">Toolpaths may have been rejected by the engine.</p>
						</div>
					</div>
				)}

				{meshLoadError && (
					<div className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none p-4">
						<div className="bg-slate-950/85 backdrop-blur-md px-6 py-5 rounded-2xl border border-amber-500/30 flex flex-col items-center gap-3 max-w-md text-center pointer-events-auto shadow-2xl">
							<div className="p-3 bg-amber-500/10 rounded-full border border-amber-500/20 text-amber-400">
								<AlertTriangle className="size-6" />
							</div>
							<div>
								<p className="text-sm font-semibold text-slate-100">3D Model File Not Available</p>
								<p className="text-xs text-slate-400 mt-1">
									The CAD artifact for this session is not present on disk. Please create a new session or re-run CAD generation to create fresh geometry.
								</p>
							</div>
							<button
								onClick={() => setMeshLoadError(null)}
								className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded-lg border border-slate-700 transition-colors"
							>
								Dismiss
							</button>
						</div>
					</div>
				)}

				<CanvasErrorBoundary onReset={() => setCanvasKey((prev) => prev + 1)}>
					<Canvas
						key={canvasKey}
						id={workflowStage === 'manual_cad' ? 'cad-three-canvas-mcad' : 'cad-three-canvas'}
						shadows
						dpr={[1, 2]}
						gl={{ preserveDrawingBuffer: true, powerPreference: 'high-performance' }}
						onCreated={({ gl }) => {
							const handleContextLost = (e: Event) => {
								e.preventDefault();
								console.warn('CadViewport: WebGL Context Lost event intercepted.');
							};
							gl.domElement.addEventListener('webglcontextlost', handleContextLost, false);
						}}
						className="relative z-10"
						onPointerMissed={onClearSelection}
					>
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
						<hemisphereLight intensity={isDark ? 0.4 : 0.75} groundColor={isDark ? "#1e293b" : "#cbd5e1"} color={isDark ? "#f8fafc" : "#ffffff"} />
						<directionalLight castShadow intensity={0.8} position={[10, 20, 10]} shadow-mapSize={[2048, 2048]}>
							<orthographicCamera attach="shadow-camera" args={[-20, 20, 20, -20, 0.1, 100]} />
						</directionalLight>
						<directionalLight intensity={0.3} position={[-10, -10, -10]} color="#94a3b8" />
						
						<DynamicFloor targetRef={groupRef}>
							{/* Contact Shadows at bounding box bottom */}
							<ContactShadows resolution={1024} scale={50} blur={2} opacity={isDark ? 0.4 : 0.25} far={10} color="#000000" />
							
							<Grid infiniteGrid fadeDistance={gridFade} sectionColor={isDark ? "#3a4658" : "#94a3b8"} cellColor={isDark ? "#2c3644" : "#cbd5e1"} cellSize={gridCell} sectionSize={gridSection} />
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

										// Combine setup transformation with user model rotation around part center
										const rotEuler = new THREE.Euler(modelRotation.x, modelRotation.y, modelRotation.z, 'XYZ');
										const rotQuat = new THREE.Quaternion().setFromEuler(rotEuler);

										const modelCenter = geometryInfo?.center
											? new THREE.Vector3(geometryInfo.center[0], geometryInfo.center[1], geometryInfo.center[2])
											: new THREE.Vector3(0, 0, 0);

										const isCamStage = (workflowStage === 'cam' || workflowStage === 'gcode') && hasValidToolpaths;

										let simOffsetX = 0;
										let simOffsetY = 0;

										const simOffset = new THREE.Vector3(simOffsetX, simOffsetY, 0);
										const cadOffset = new THREE.Vector3(0, 0, 0);
										const combinedPos = new THREE.Vector3().copy(pos).add(cadOffset);

										return (
											<>
												<group position={combinedPos} quaternion={quat} scale={scale}>
													<group position={modelCenter}>
														<group quaternion={rotQuat}>
															<group position={modelCenter.clone().negate()}>
																<ThreeErrorBoundary resetKey={stlUrl} onError={(err) => setMeshLoadError(err.message)}>
																	{isSolidVisible && children}
																</ThreeErrorBoundary>

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
														</group>
													</group>
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
																const cleanId = (id: any) => String(id || '').trim().toLowerCase().replace(/^t0*/, 't');
																const segToolClean = cleanId(toolId);
																const activeTool = camTools.find(t => {
																	if (!t) return false;
																	const tId = cleanId(t.id);
																	const tName = cleanId(t.name);
																	const tToolName = cleanId((t as any).tool_name);
																	const tNum = (t as any).tool_number !== undefined ? `t${(t as any).tool_number}` : '';
																	return tId === segToolClean || tName === segToolClean || tToolName === segToolClean || (tNum && tNum === segToolClean);
																}) || camTools[0];
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
								color={isDark ? "#121720" : "#ffffff"} 
								strokeColor={isDark ? "#273144" : "#cbd5e1"} 
								hoverColor={isDark ? "#4c7bf4" : "#3b6cf0"} 
								textColor={isDark ? "#f1f5f9" : "#1e293b"}
								opacity={0.85} 
							/>
						</GizmoHelper>
					</Suspense>

					{/* Dimension overlay was moved inside Stage */}

				</Canvas>
			</CanvasErrorBoundary>

				{!stlUrl && !isRecompiling && (
					<div className="pointer-events-none absolute inset-0 flex items-center justify-center p-12 z-20">
						<div className="relative max-w-md w-full">
							{/* Outer glow aura */}
							<div className="absolute inset-0 rounded-3xl bg-primary/5 blur-3xl scale-110" />

							{/* Main card */}
							<div className="relative rounded-2xl border border-border/80 dark:border-white/[0.08] bg-card/85 p-10 text-center shadow-2xl backdrop-blur-2xl">

								{/* Top accent line */}
								<div className="absolute inset-x-0 top-0 h-px rounded-t-2xl bg-gradient-to-r from-transparent via-primary/50 to-transparent" />

								{/* Rotating wireframe icon */}
								<div className="mx-auto mb-6 relative flex size-18 items-center justify-center">
									{/* Orbit ring */}
									<div className="absolute inset-0 rounded-full border border-primary/20 animate-spin" style={{ animationDuration: '8s' }} />
									<div className="absolute inset-2 rounded-full border border-dashed border-primary/15 animate-spin" style={{ animationDuration: '12s', animationDirection: 'reverse' }} />
									{/* Center glow */}
									<div className="absolute size-9 rounded-full bg-primary/10 blur-md" />
									{/* Isometric 3D wireframe cube SVG */}
									<svg
										viewBox="0 0 48 48"
										fill="none"
										className="size-8.5 animate-spin"
										style={{ animationDuration: '20s', animationTimingFunction: 'linear' }}
									>
										<polygon points="24,4 40,14 24,24 8,14" stroke="var(--primary)" strokeWidth="1.2" strokeLinejoin="round" fill="rgba(76,123,244,0.05)" />
										<polygon points="8,14 24,24 24,44 8,34" stroke="var(--primary)" strokeWidth="1.2" strokeLinejoin="round" fill="rgba(76,123,244,0.03)" />
										<polygon points="40,14 24,24 24,44 40,34" stroke="var(--primary)" strokeWidth="1.2" strokeLinejoin="round" fill="rgba(76,123,244,0.06)" />
										<line x1="24" y1="24" x2="24" y2="4" stroke="var(--primary)" strokeWidth="0.5" strokeDasharray="2,3" strokeOpacity="0.4" />
										<line x1="24" y1="24" x2="8" y2="14" stroke="var(--primary)" strokeWidth="0.5" strokeDasharray="2,3" strokeOpacity="0.4" />
										<line x1="24" y1="24" x2="40" y2="14" stroke="var(--primary)" strokeWidth="0.5" strokeDasharray="2,3" strokeOpacity="0.4" />
									</svg>
								</div>

								{/* Status badge */}
								<div className="mx-auto mb-5 flex w-fit items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3.5 py-1 shadow-sm">
									<div className="size-1.5 rounded-full bg-primary animate-pulse shadow-[0_0_6px_rgba(76,123,244,0.8)]" />
									<span className="text-[10px] font-bold uppercase tracking-[0.08em] text-primary">Geometry Engine — Standby</span>
								</div>

								<h3 className="text-lg font-bold tracking-tight text-foreground">Awaiting Model Parameters</h3>
							</div>
						</div>
					</div>
				)}

				{isRecompiling && (
					<div className="absolute inset-0 flex items-center justify-center bg-background/70 backdrop-blur-md z-20">
						<div className="relative">
							{/* Glow behind card */}
							<div className="absolute inset-0 rounded-2xl bg-primary/10 blur-xl scale-150" />
							<div className="relative flex items-center gap-4 rounded-xl border border-primary/30 bg-card/95 px-6 py-4.5 shadow-2xl">
								<div className="relative shrink-0">
									<div className="absolute inset-0 animate-ping rounded-full bg-primary/20" />
									<div className="relative flex size-8 items-center justify-center rounded-full border border-primary/30 bg-primary/10">
										<Loader2 className="size-4 animate-spin text-primary" />
									</div>
								</div>
								<div className="flex flex-col">
									<span className="text-[11px] font-black uppercase tracking-[0.06em] text-foreground">Engine Processing</span>
									<span className="mt-0.5 text-[10px] text-muted-foreground">Recomputing Geometry Topology…</span>
								</div>
							</div>
						</div>
					</div>
				)}

				{/* Global Safety Note */}
				{workflowStage !== 'manual_cad' && (
					<div 
						style={{
							left:
								workflowStage === 'cam' || workflowStage === 'gcode'
									? 'calc((100% - 336px) / 2)'
									: 'calc((100% + 36px) / 2)',
							transform: 'translateX(-50%)',
						}}
						className={`absolute z-10 flex flex-col items-center gap-2 transition-all pointer-events-none ${(workflowStage === 'cam' || workflowStage === 'gcode') ? 'bottom-20' : 'bottom-1'}`}
					>
						{toolpaths && toolpaths.length > 0 && !hasValidToolpaths && (
							<div className="flex items-center gap-2 rounded-full border border-amber-500/30 bg-card/90 px-4 py-1.5 backdrop-blur-md shadow-xl shadow-black/40">
								<svg className="size-3 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
									<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
								</svg>
								<span className="text-[10px] font-bold uppercase tracking-wider text-amber-400">
									No valid machining toolpaths to display
								</span>
							</div>
						)}
						{hasBlockedOperations && (
							<div className="flex items-center gap-2 rounded-full border border-destructive/30 bg-card/90 px-4 py-1.5 backdrop-blur-md shadow-xl shadow-black/40">
								<svg className="size-3 text-destructive" fill="none" viewBox="0 0 24 24" stroke="currentColor">
									<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
								</svg>
								<span className="text-[10px] font-bold uppercase tracking-wider text-destructive">
									Some features require turning, mill-turn, or secondary setup
								</span>
							</div>
						)}
						<div className="flex items-center gap-2.5 rounded-full border border-border/70 bg-card/75 px-4 py-1.5 backdrop-blur-xl transition-all hover:border-primary/40 whitespace-nowrap">
							<svg className="size-3 text-primary shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
								<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
							</svg>
							<p className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
								AI can make mistakes. Verify critical dimensions against original blueprints.
							</p>
						</div>
					</div>
				)}
			</div>
		</section>
	);
}
