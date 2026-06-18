'use client';

import { useState, useEffect } from 'react';
import Editor, { loader } from '@monaco-editor/react';
import { 
	ChevronLeft, 
	ChevronRight, 
	Wrench, 
	Loader2, 
	Code2, 
	Sliders, 
	History,
	Copy,
	Check,
	ChevronDown
} from 'lucide-react';
import type { SetupSettings, Tool, CamOperation, SimulationState, ViewportSettings, OperationType, CamFeature } from '@/types/cam';
import { SetupSection } from './cam/SetupSection';
import { ToolLibrarySection } from './cam/ToolLibrarySection';
import { FeatureOverviewSection } from './cam/FeatureOverviewSection';
import { OperationTreeSection } from './cam/OperationTreeSection';
import { CuttingParametersSection } from './cam/CuttingParametersSection';
import { SimulationControls } from './cam/SimulationControls';

type DrawerTab = 'parameters' | 'code' | 'cam';

type EditorDrawerProps = {
	isOpen: boolean;
	setIsOpen: (v: boolean) => void;
	activeTab: DrawerTab;
	setActiveTab: (v: DrawerTab) => void;
	pythonScript: string;
	onScriptChange: (v: string) => void;
	onRenderSync: () => void;
	isRecompiling: boolean;
	hasSession: boolean;
	onHistoryClick: () => void;
	isDeveloper: boolean;
	developerUsername: string;
	developerPassword: string;
	developerAuthError: string | null;
	onDeveloperUsernameChange: (value: string) => void;
	onDeveloperPasswordChange: (value: string) => void;
	onDeveloperLogin: () => void;
	onDeveloperLogout: () => void;

	// CAM Props
	camSetup: SetupSettings;
	setCamSetup: (v: SetupSettings) => void;
	camFeatures: CamFeature[];
	setCamFeatures: (v: CamFeature[]) => void;
	activeFeatureId: string | null;
	setActiveFeatureId: (v: string | null) => void;
	onAutoGenerateOperations: () => void;
	camTools: Tool[];
	setCamTools: (v: Tool[]) => void;
	camOperations: CamOperation[];
	setCamOperations: (v: CamOperation[]) => void;
	activeOperationId: string;
	setActiveOperationId: (v: string) => void;
	camSimulation: SimulationState;
	setCamSimulation: (v: SimulationState) => void;
	camViewport: ViewportSettings;
	setCamViewport: (v: ViewportSettings) => void;
	controller: string;
	setController: (v: string) => void;
	gcodeUrl: string | null;
	onDownloadGcode: () => void;
	isDownloadingGcode: boolean;
	onOpenAuthModal?: () => void;

	camStats?: {
		estimated_time_mins?: number;
		gcode_lines?: number;
		cutting_distance_mm?: number;
	} | null;

	children?: React.ReactNode; // For ParameterInputs
};

const build123dCompletions = [
	{
		label: 'BuildPart',
		kind: 'Class',
		detail: 'build123d.BuildPart context manager',
		documentation: 'Context manager for building 3D parts. Automatically fuses overlapping shapes unless specified otherwise.',
		insertText: 'with BuildPart() as ${1:part}:\n\t$0'
	},
	{
		label: 'BuildSketch',
		kind: 'Class',
		detail: 'build123d.BuildSketch context manager',
		documentation: 'Context manager for building 2D sketches (faces). Ideal for creating complex 2D shapes that can be extruded or revolved.',
		insertText: 'with BuildSketch() as ${1:sketch}:\n\t$0'
	},
	{
		label: 'BuildLine',
		kind: 'Class',
		detail: 'build123d.BuildLine context manager',
		documentation: 'Context manager for building 1D lines and curves. Perfect for defining paths for sweep operations or complex custom boundaries.',
		insertText: 'with BuildLine() as ${1:line}:\n\t$0'
	},
	{
		label: 'Box',
		kind: 'Class',
		detail: '3D Primitives: Box(width, depth, height, rotation, mode)',
		documentation: 'Create a solid box aligned with the current coordinate system. Width is along X, depth is along Y, and height is along Z.',
		insertText: 'Box(width=${1:10}, depth=${2:10}, height=${3:10}$0)'
	},
	{
		label: 'Cylinder',
		kind: 'Class',
		detail: '3D Primitives: Cylinder(radius, height, rotation, mode)',
		documentation: 'Create a solid cylinder along the Z axis (by default).',
		insertText: 'Cylinder(radius=${1:5}, height=${2:10}$0)'
	},
	{
		label: 'Sphere',
		kind: 'Class',
		detail: '3D Primitives: Sphere(radius, rotation, mode)',
		documentation: 'Create a solid sphere centered at the origin.',
		insertText: 'Sphere(radius=${1:5}$0)'
	},
	{
		label: 'Cone',
		kind: 'Class',
		detail: '3D Primitives: Cone(radius1, radius2, height, rotation, mode)',
		documentation: 'Create a solid cone or truncated cone along the Z axis.',
		insertText: 'Cone(radius1=${1:5}, radius2=${2:0}, height=${3:10}$0)'
	},
	{
		label: 'Wedge',
		kind: 'Class',
		detail: '3D Primitives: Wedge(x, y, z, xmin, xmax, zmin, zmax, rotation, mode)',
		documentation: 'Create a wedge shape.',
		insertText: 'Wedge(x=${1:10}, y=${2:10}, z=${3:10}, xmin=${4:0}, xmax=${5:5}, zmin=${6:0}, zmax=${7:5}$0)'
	},
	{
		label: 'Rectangle',
		kind: 'Class',
		detail: '2D Primitives: Rectangle(width, height, rotation, mode)',
		documentation: 'Create a flat rectangle centered at the current origin.',
		insertText: 'Rectangle(width=${1:10}, height=${2:10}$0)'
	},
	{
		label: 'Square',
		kind: 'Class',
		detail: '2D Primitives: Square(size, rotation, mode)',
		documentation: 'Create a flat square centered at the current origin.',
		insertText: 'Square(size=${1:10}$0)'
	},
	{
		label: 'Circle',
		kind: 'Class',
		detail: '2D Primitives: Circle(radius, rotation, mode)',
		documentation: 'Create a flat circle centered at the current origin.',
		insertText: 'Circle(radius=${1:5}$0)'
	},
	{
		label: 'Polygon',
		kind: 'Class',
		detail: '2D Primitives: Polygon(pts, rotation, mode)',
		documentation: 'Create a flat polygon from a list of 2D/3D points.',
		insertText: 'Polygon([(${1:0}, ${2:0}), (${3:10}, ${4:0}), (${5:5}, ${6:5})]$0)'
	},
	{
		label: 'RegularPolygon',
		kind: 'Class',
		detail: '2D Primitives: RegularPolygon(radius, side_count, rotation, mode)',
		documentation: 'Create a regular polygon centered at origin.',
		insertText: 'RegularPolygon(radius=${1:5}, side_count=${2:6}$0)'
	},
	{
		label: 'SlotOverall',
		kind: 'Class',
		detail: '2D Primitives: SlotOverall(width, height, rotation, mode)',
		documentation: 'Create an overall slot shape.',
		insertText: 'SlotOverall(width=${1:20}, height=${2:5}$0)'
	},
	{
		label: 'SlotCenterToCenter',
		kind: 'Class',
		detail: '2D Primitives: SlotCenterToCenter(center_distance, height, rotation, mode)',
		documentation: 'Create a center-to-center slot shape.',
		insertText: 'SlotCenterToCenter(center_distance=${1:15}, height=${2:5}$0)'
	},
	{
		label: 'Line',
		kind: 'Class',
		detail: '1D Primitives: Line(pts)',
		documentation: 'Create a line segment between two coordinates.',
		insertText: 'Line((${1:0}, ${2:0}), (${3:10}, ${4:0})$0)'
	},
	{
		label: 'Polyline',
		kind: 'Class',
		detail: '1D Primitives: Polyline(pts)',
		documentation: 'Create a continuous sequence of line segments from points.',
		insertText: 'Polyline([(${1:0}, ${2:0}), (${3:10}, ${4:0}), (${5:10}, ${6:10})$0])'
	},
	{
		label: 'Spline',
		kind: 'Class',
		detail: '1D Primitives: Spline(pts, tangents)',
		documentation: 'Create a smooth spline curve passing through specified points.',
		insertText: 'Spline([(${1:0}, ${2:0}), (${3:10}, ${4:0}), (${5:10}, ${6:10})$0])'
	},
	{
		label: 'RadiusArc',
		kind: 'Class',
		detail: '1D Primitives: RadiusArc(start, end, radius)',
		documentation: '**WARNING:** Do NOT use keyword arguments for start/end parameters (e.g. `start=(0,0)`) to prevent standard OpenCascade coordinate crashes. Always specify start and end as positional tuples.\n\nCreates a circular arc from start to end with the given radius.',
		insertText: 'RadiusArc((${1:0}, ${2:0}), (${3:10}, ${4:0}), radius=${5:10}$0)'
	},
	{
		label: 'TangentArc',
		kind: 'Class',
		detail: '1D Primitives: TangentArc(start, end, tangent)',
		documentation: '**WARNING:** Do NOT use keyword arguments for start/end parameters (e.g. `start=(0,0)`) to prevent standard OpenCascade coordinate crashes. Always specify start and end as positional tuples.\n\nCreates a circular arc from start to end with the specified tangent at start.',
		insertText: 'TangentArc((${1:0}, ${2:0}), (${3:10}, ${4:0}), tangent=(${5:1, 0})$0)'
	},
	{
		label: 'CenterArc',
		kind: 'Class',
		detail: '1D Primitives: CenterArc(center, radius, start_angle, arc_angle)',
		documentation: 'Creates a circular arc centered at center with the given radius from start_angle to arc_angle.',
		insertText: 'CenterArc(center=(${1:0}, ${2:0}), radius=${3:5}, start_angle=${4:0}, arc_angle=${5:90}$0)'
	},
	{
		label: 'extrude',
		kind: 'Function',
		detail: 'Operations: extrude(to_extrude, amount, dir, both, mode)',
		documentation: 'Extrude 2D sketch or faces into a 3D solid by a given amount.',
		insertText: 'extrude(to_extrude=${1:sketch}, amount=${2:10}$0)'
	},
	{
		label: 'revolve',
		kind: 'Function',
		detail: 'Operations: revolve(to_revolve, angle, axis, mode)',
		documentation: 'Revolve 2D sketch/faces around a 3D axis by a given angle.',
		insertText: 'revolve(to_revolve=${1:sketch}, angle=${2:360}, axis=${3:Axis.Z}$0)'
	},
	{
		label: 'loft',
		kind: 'Function',
		detail: 'Operations: loft(sections, ruled, mode)',
		documentation: 'Create a lofted solid passing through multiple 2D sketch sections.',
		insertText: 'loft(sections=${1:[section1, section2]}$0)'
	},
	{
		label: 'sweep',
		kind: 'Function',
		detail: 'Operations: sweep(sections, path, transition, mode)',
		documentation: 'Sweep 2D sketch/faces along a 1D path to create a 3D solid.',
		insertText: 'sweep(sections=${1:sketch}, path=${2:path}$0)'
	},
	{
		label: 'fillet',
		kind: 'Function',
		detail: 'Operations: fillet(objects, radius)',
		documentation: 'Round sharp edges or vertices with a specified radius. Best practice: use inside a try/except block to catch topological issues.',
		insertText: 'fillet(${1:part.edges()}, radius=${2:1.0}$0)'
	},
	{
		label: 'chamfer',
		kind: 'Function',
		detail: 'Operations: chamfer(objects, length, length2)',
		documentation: 'Bevel sharp edges or vertices with specified lengths.',
		insertText: 'chamfer(${1:part.edges()}, length=${2:1.0}$0)'
	},
	{
		label: 'offset',
		kind: 'Function',
		detail: 'Operations: offset(objects, amount, kind)',
		documentation: 'Offset boundaries of wires, faces, or solids.',
		insertText: 'offset(${1:objects}, amount=${2:1.0}$0)'
	},
	{
		label: 'shell',
		kind: 'Function',
		detail: 'Operations: shell(solids, face_to_remove, thickness)',
		documentation: 'Hollow out a solid leaving only a shell with given thickness.',
		insertText: 'shell(${1:solid}, face_to_remove=${2:face}, thickness=${3:1.0}$0)'
	},
	{
		label: 'make_face',
		kind: 'Function',
		detail: 'Operations: make_face(objects)',
		documentation: 'Convert closed 1D wires/lines into a solid 2D face.',
		insertText: 'make_face(${1:line}$0)'
	},
	{
		label: 'Location',
		kind: 'Class',
		detail: 'Placement: Location(position, rotation)',
		documentation: 'Defines a placement coordinate with optional position translation and orientation rotation.',
		insertText: 'Location((${1:0}, ${2:0}, ${3:0})$0)'
	},
	{
		label: 'Locations',
		kind: 'Class',
		detail: 'Placement: Locations(*args)',
		documentation: 'Context manager to position sub-items. Translates child coordinate frame to the defined locations.',
		insertText: 'with Locations((${1:0}, ${2:0}, ${3:0})):\n\t$0'
	},
	{
		label: 'GridLocations',
		kind: 'Class',
		detail: 'Placement: GridLocations(x_spacing, y_spacing, x_count, y_count)',
		documentation: 'Context manager to position child elements in a 2D rectangular grid pattern.',
		insertText: 'with GridLocations(x_spacing=${1:10}, y_spacing=${2:10}, x_count=${3:2}, y_count=${4:2}):\n\t$0'
	},
	{
		label: 'PolarLocations',
		kind: 'Class',
		detail: 'Placement: PolarLocations(radius, count, start_angle, angular_range)',
		documentation: 'Context manager to position child elements in a circular/polar pattern.',
		insertText: 'with PolarLocations(radius=${1:10}, count=${2:4}):\n\t$0'
	},
	{
		label: 'Mode.ADD',
		kind: 'EnumMember',
		detail: 'Mode: Fuse geometry with the active parent',
		documentation: 'Fuses/unions the current geometry element to the parent shape (default).',
		insertText: 'mode=Mode.ADD'
	},
	{
		label: 'Mode.SUBTRACT',
		kind: 'EnumMember',
		detail: 'Mode: Cut geometry from the active parent',
		documentation: 'Subtracts/cuts the current geometry element from the parent shape.',
		insertText: 'mode=Mode.SUBTRACT'
	},
	{
		label: 'Mode.INTERSECT',
		kind: 'EnumMember',
		detail: 'Mode: Intersect geometry with the active parent',
		documentation: 'Keeps only the overlapping intersection of the current geometry element and the parent shape.',
		insertText: 'mode=Mode.INTERSECT'
	},
	{
		label: 'Mode.PRIVATE',
		kind: 'EnumMember',
		detail: 'Mode: Keep geometry separate',
		documentation: 'Keeps the geometry as a separate shape without modifying the active parent.',
		insertText: 'mode=Mode.PRIVATE'
	},
	{
		label: 'Axis.X',
		kind: 'EnumMember',
		detail: 'Coordinates: X Axis',
		documentation: 'X axis unit vector (1, 0, 0) used for directions, rotations, or projections.',
		insertText: 'Axis.X'
	},
	{
		label: 'Axis.Y',
		kind: 'EnumMember',
		detail: 'Coordinates: Y Axis',
		documentation: 'Y axis unit vector (0, 1, 0) used for directions, rotations, or projections.',
		insertText: 'Axis.Y'
	},
	{
		label: 'Axis.Z',
		kind: 'EnumMember',
		detail: 'Coordinates: Z Axis',
		documentation: 'Z axis unit vector (0, 0, 1) used for directions, rotations, or projections.',
		insertText: 'Axis.Z'
	},
	{
		label: 'Plane.XY',
		kind: 'EnumMember',
		detail: 'Coordinates: XY Plane',
		documentation: 'Standard horizontal XY plane (normal Z).',
		insertText: 'Plane.XY'
	},
	{
		label: 'Plane.YZ',
		kind: 'EnumMember',
		detail: 'Coordinates: YZ Plane',
		documentation: 'Standard vertical YZ plane (normal X).',
		insertText: 'Plane.YZ'
	},
	{
		label: 'Plane.XZ',
		kind: 'EnumMember',
		detail: 'Coordinates: XZ Plane',
		documentation: 'Standard vertical XZ plane (normal Y).',
		insertText: 'Plane.XZ'
	},
	{
		label: 'faces',
		kind: 'Function',
		detail: 'Selectors: Get faces of a shape',
		documentation: 'Returns a list of faces belonging to the current shape or parent context.',
		insertText: 'faces()'
	},
	{
		label: 'edges',
		kind: 'Function',
		detail: 'Selectors: Get edges of a shape',
		documentation: 'Returns a list of edges belonging to the current shape or parent context.',
		insertText: 'edges()'
	},
	{
		label: 'vertices',
		kind: 'Function',
		detail: 'Selectors: Get vertices of a shape',
		documentation: 'Returns a list of vertices belonging to the current shape or parent context.',
		insertText: 'vertices()'
	},
	{
		label: 'sort_by',
		kind: 'Function',
		detail: 'Selectors: Sort objects',
		documentation: 'Sorts a list of geometrical objects (faces/edges/vertices) by coordinate values along an axis.',
		insertText: 'sort_by(${1:Axis.Z})'
	},
	{
		label: 'Select.LAST',
		kind: 'EnumMember',
		detail: 'Selectors: Select last item',
		documentation: 'Filters and retrieves the last created item from a list or shape context.',
		insertText: 'Select.LAST'
	},
	{
		label: 'Select.FIRST',
		kind: 'EnumMember',
		detail: 'Selectors: Select first item',
		documentation: 'Filters and retrieves the first created item from a list or shape context.',
		insertText: 'Select.FIRST'
	},
	{
		label: 'Select.ALL',
		kind: 'EnumMember',
		detail: 'Selectors: Select all items',
		documentation: 'Retrieves all matching items in the selection context (default).',
		insertText: 'Select.ALL'
	},
	{
		label: 'build_model template',
		kind: 'Snippet',
		detail: 'build123d.build_model signature template',
		documentation: 'The standard template/contract for defining CAD models using parameterized variables inside CAD Copilot.',
		insertText: 'PARAMETERS = {\n\t"${1:width}": ${2:50.0},\n\t"${3:height}": ${4:30.0}\n}\n\ndef build_model(params: dict):\n\twidth = params["$1"]\n\theight = params["$3"]\n\twith BuildPart() as part:\n\t\t$0\n\treturn part'
	}
];

function registerBuild123dCompletions(monaco: any) {
	if (!monaco || !monaco.languages) return null;
	
	const suggestions = build123dCompletions.map((item) => ({
		label: item.label,
		kind: typeof item.kind === 'string' ? monaco.languages.CompletionItemKind[item.kind] : item.kind,
		detail: item.detail,
		documentation: {
			value: item.documentation,
			isTrusted: true
		},
		insertText: item.insertText,
		insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
	}));

	return monaco.languages.registerCompletionItemProvider('python', {
		provideCompletionItems: () => {
			return { suggestions };
		}
	});
}

export function EditorDrawer({
	isOpen,
	setIsOpen,
	activeTab,
	setActiveTab,
	pythonScript,
	onScriptChange,
	onRenderSync,
	isRecompiling,
	hasSession,
	onHistoryClick,
	isDeveloper,
	developerUsername,
	developerPassword,
	developerAuthError,
	onDeveloperUsernameChange,
	onDeveloperPasswordChange,
	onDeveloperLogin,
	onDeveloperLogout,

	// CAM Props
	camSetup,
	setCamSetup,
	camFeatures,
	setCamFeatures,
	activeFeatureId,
	setActiveFeatureId,
	onAutoGenerateOperations,
	camTools,
	setCamTools,
	camOperations,
	setCamOperations,
	activeOperationId,
	setActiveOperationId,
	camSimulation,
	setCamSimulation,
	camViewport,
	setCamViewport,
	controller,
	setController,
	gcodeUrl,
	onDownloadGcode,
	isDownloadingGcode,
	onOpenAuthModal,
	camStats,
	children
}: EditorDrawerProps) {
	const [copied, setCopied] = useState(false);
	const [monacoFailed, setMonacoFailed] = useState(false);

	useEffect(() => {
		let completionDisposable: any = null;
		loader.init()
			.then((monaco) => {
				completionDisposable = registerBuild123dCompletions(monaco);
			})
			.catch((err) => {
				console.warn('Monaco failed to load dynamically, activating offline textarea fallback:', err);
				setMonacoFailed(true);
			});
		return () => {
			if (completionDisposable) {
				completionDisposable.dispose();
			}
		};
	}, []);

	const handleCopy = () => {
		navigator.clipboard.writeText(pythonScript);
		setCopied(true);
		setTimeout(() => setCopied(false), 2000);
	}; 

	const parametersTabClassName = `flex items-center gap-2 rounded-lg px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.12em] transition-all duration-300 ${
		activeTab === 'parameters'
			? 'bg-blue-600 text-white shadow-sm'
			: 'text-gray-500 hover:text-gray-300 hover:bg-white/5'
	}`;

	const codeTabClassName = `flex items-center gap-2 rounded-lg px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.12em] transition-all duration-300 ${
		activeTab === 'code'
			? 'bg-blue-600 text-white shadow-sm'
			: 'text-gray-500 hover:text-gray-300 hover:bg-white/5'
	}`;

	const camTabClassName = `flex items-center gap-2 rounded-lg px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.12em] transition-all duration-300 ${
		activeTab === 'cam'
			? 'bg-blue-600 text-white shadow-sm'
			: 'text-gray-500 hover:text-gray-300 hover:bg-white/5'
	}`;

	return (
		<aside className="relative flex flex-col h-full w-full border-l border-border bg-zinc-50/90 dark:bg-background/80 font-sans overflow-hidden">


			<div className={`flex h-full flex-col ${!isOpen ? 'opacity-0' : 'opacity-100'} transition-opacity duration-500`}>
				<header className="flex h-16 items-center justify-between border-b border-border bg-transparent px-6">
					<div className="flex p-1 bg-black/5 dark:bg-white/5 rounded-xl border border-border dark:border-white/5 shadow-inner">
						<button
							onClick={() => setActiveTab('parameters')}
							className={parametersTabClassName}
						>
							<Sliders className={`size-3.5 ${activeTab === 'parameters' ? 'animate-pulse' : ''}`} />
							Params
						</button>
						<button
							onClick={() => setActiveTab('code')}
							className={codeTabClassName}
						>
							<Code2 className={`size-3.5 ${activeTab === 'code' ? 'animate-pulse' : ''}`} />
							Engine
						</button>
						<button
							onClick={() => setActiveTab('cam')}
							className={camTabClassName}
						>
							<Wrench className={`size-3.5 ${activeTab === 'cam' ? 'animate-pulse' : ''}`} />
							CAM
						</button>
					</div>

					<div className="flex items-center gap-1.5">
						<button
							onClick={onHistoryClick}
							className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border dark:border-white/10 bg-black/5 dark:bg-white/5 text-muted-foreground transition-all hover:border-blue-500/50 hover:bg-blue-500/10 hover:text-blue-500"
							title="View History"
						>
							<History className="size-3.5" />
						</button>
						{isDeveloper ? (
							<button
								onClick={onDeveloperLogout}
								className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border dark:border-white/10 bg-black/5 dark:bg-white/5 text-muted-foreground transition-all hover:border-rose-500/50 hover:bg-rose-500/10 hover:text-rose-500"
								title="Revoke Admin Access"
							>
								<svg className="size-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
									<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013 3v1" />
								</svg>
							</button>
						) : null}
					</div>
				</header>

				<div className="flex-1 overflow-y-auto px-6 py-6 custom-scrollbar">
					{activeTab === 'parameters' ? (
						<div className="space-y-8">
							<div className="flex items-center gap-4">
								<div className="size-1.5 rounded-full bg-blue-500" />
								<h2 className="text-[12px] font-bold uppercase tracking-wider text-foreground">Dynamic Props</h2>
								<div className="h-px flex-1 bg-gradient-to-r from-border to-transparent" />
							</div>
							<div className="space-y-2">
								{children}
							</div>
						</div>
					) : activeTab === 'cam' ? (
						<div className="space-y-8 animate-message">
							<div className="flex items-center gap-4">
								<div className="size-1.5 rounded-full bg-blue-500" />
								<h2 className="text-[12px] font-bold uppercase tracking-wider text-foreground">CAM Operations</h2>
								<div className="h-px flex-1 bg-gradient-to-r from-border to-transparent" />
							</div>
							
							<div className="space-y-6">
								<div className="flex flex-col gap-2">
									<label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Setup & Stock</label>
									<SetupSection setup={camSetup} onChange={setCamSetup} />
								</div>
								
								<div className="flex flex-col gap-2">
									<label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground flex justify-between items-center">
										<span>Feature Overview</span>
										{camFeatures.length > 0 && (
											<button onClick={onAutoGenerateOperations} className="text-blue-500 hover:text-blue-400 capitalize bg-blue-500/10 px-2 py-0.5 rounded text-[10px]">
												Auto Generate Operations
											</button>
										)}
									</label>
									<FeatureOverviewSection 
										features={camFeatures}
										activeFeatureId={activeFeatureId}
										onFeatureSelect={setActiveFeatureId}
									/>
								</div>

								<hr className="border-border dark:border-white/5" />
								
								<div className="flex flex-col gap-2">
									<label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Tool Library</label>
									<ToolLibrarySection 
										tool={camTools[0]} 
										onChange={(t) => setCamTools([t])} 
										workpieceMaterial={camSetup.material}
									/>
								</div>
								<hr className="border-border dark:border-white/5" />

								<div className="flex flex-col gap-2">
									<label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Operations Tree</label>
									<OperationTreeSection 
										operations={camOperations}
										activeOperationId={activeOperationId}
										onSelect={setActiveOperationId}
										onAdd={(type: OperationType) => {
											const id = 'op' + Date.now();
											setCamOperations([...camOperations, {
												id,
												name: `New ${type}`,
												type,
												toolId: camTools[0].id,
												parameters: { feedRate: 800, plungeRate: 200, maxStepdown: 1.0, totalDepth: 5.0, spindleSpeed: 12000, stepoverPercentage: 40, tolerance: 0.01, coolant: 'off' }
											}]);
											setActiveOperationId(id);
										}}
										onDelete={(id: string) => {
											if (camOperations.length <= 1) return;
											const newOps = camOperations.filter(op => op.id !== id);
											setCamOperations(newOps);
											if (activeOperationId === id) setActiveOperationId(newOps[0].id);
										}}
									/>
								</div>
								<hr className="border-border dark:border-white/5" />

								{camOperations.find(op => op.id === activeOperationId) && (
									<div className="flex flex-col gap-2">
										<label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Cutting Parameters</label>
										<CuttingParametersSection 
											parameters={camOperations.find(op => op.id === activeOperationId)!.parameters} 
											onChange={(p) => {
												setCamOperations(camOperations.map(op => op.id === activeOperationId ? { ...op, parameters: p } : op));
											}} 
										/>
									</div>
								)}
								<hr className="border-border dark:border-white/5" />

								<div className="flex flex-col gap-2">
									<label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Controller Dialect</label>
									<select
										value={controller}
										onChange={(e) => setController(e.target.value)}
										className="w-full rounded-2xl border border-border dark:border-white/10 bg-accent dark:bg-black/60 px-4 py-3 text-sm text-foreground focus:border-blue-500 focus:outline-none"
									>
										<option value="iso">Standard ISO (RS-274)</option>
										<option value="fanuc">Fanuc</option>
										<option value="haas">Haas</option>
										<option value="siemens">Siemens Sinumerik</option>
										<option value="heidenhain">Heidenhain</option>
										<option value="grbl">GRBL</option>
									</select>
								</div>
								
								<hr className="border-border dark:border-white/5" />

								<div className="flex flex-col gap-2">
									<label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Simulation</label>
									<SimulationControls 
										state={camSimulation} 
										onChange={setCamSimulation} 
										onGenerateToolpath={onRenderSync}
										isGenerating={isRecompiling}
									/>
								</div>

								{/* Show Toolpaths Toggle */}
								<div className="flex items-center justify-between p-4 rounded-2xl border border-border dark:border-white/5 bg-accent/40 dark:bg-black/20">
									<span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Render Toolpath Lines</span>
									<button
										onClick={() => setCamViewport({ ...camViewport, showToolpath: !camViewport.showToolpath })}
										className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
											camViewport.showToolpath ? 'bg-blue-600' : 'bg-zinc-700'
										}`}
									>
										<span
											className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out ${
												camViewport.showToolpath ? 'translate-x-5' : 'translate-x-0'
											}`}
										/>
									</button>
								</div>

								{/* G-code Download Section */}
								{gcodeUrl && (
									<div className="pt-4 border-t border-border dark:border-white/5">
										<button
											onClick={() => {
												if (!isDeveloper) {
													onOpenAuthModal?.();
												} else if (activeTab === 'cam') {
													onDownloadGcode();
												}
											}}
											disabled={isDownloadingGcode}	
											title={!isDeveloper ? 'Login as admin to download' : undefined}
											className="flex w-full items-center justify-center gap-2 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/20 py-3.5 text-[11px] font-black uppercase tracking-widest text-emerald-400 shadow-[0_0_20px_rgba(16,185,129,0.1)] transition hover:scale-[1.02] active:scale-[0.98] disabled:opacity-40"
										>
											{isDownloadingGcode ? (
												<Loader2 className="size-4 animate-spin" />
											) : (
												<svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
													<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
												</svg>
											)}
											<span>Download G-code (.nc)</span>
										</button>
									</div>
								)}
							</div>
						</div>
					) : !isDeveloper && activeTab === 'code' ? (
						<div className="flex h-full flex-col items-center justify-center rounded-3xl border border-blue-500/20 bg-background dark:bg-zinc-950/90 p-8 text-center shadow-2xl">
							<div className="mb-6 flex items-center justify-center gap-3">
								<div className="size-2 rounded-full bg-blue-500 shadow-[0_0_12px_rgba(59,130,246,0.5)]" />
								<div>
									<h2 className="text-sm font-black uppercase tracking-[0.35em] text-blue-600 dark:text-blue-400">Admin Area Locked</h2>
									<p className="mt-2 text-[11px] leading-6 text-muted-foreground">The CAD engine script is restricted to developers.</p>
								</div>
							</div>
							<button
								onClick={onOpenAuthModal}
								className="w-full rounded-2xl bg-blue-600 px-4 py-3 text-sm font-bold uppercase tracking-wider text-white hover:bg-blue-500 transition-colors"
							>
								Login as Admin
							</button>
						</div>
					) : (
						<div className="h-full flex flex-col">
							<div className="mb-6 flex items-center justify-between">
								<div className="flex items-center gap-4">
									<div className="size-1.5 rounded-full bg-blue-500" />
									<h2 className="text-[12px] font-bold uppercase tracking-wider text-foreground">Core Script</h2>
								</div>
								<div className="flex items-center gap-2 px-3 py-1 rounded-full bg-accent dark:bg-black/40 border border-border">
									<div className={`size-1 rounded-full ${monacoFailed ? 'bg-blue-500' : 'bg-blue-500 animate-pulse'}`} />
									<span className="text-[10px] font-mono font-bold text-muted-foreground uppercase tracking-wider">
										{monacoFailed ? 'PY 3.13 // STANDARD' : 'PY 3.13 // BUILD123D'}
									</span>
								</div>
							</div>
							
							<div className="flex-1 overflow-hidden rounded-2xl border border-border dark:border-white/5 bg-background dark:bg-black/20 backdrop-blur-sm shadow-2xl relative group/editor">
								<button
									onClick={handleCopy}
									className={`absolute right-4 top-4 z-10 flex items-center gap-2 rounded-lg border px-3 py-2 text-[9px] font-black uppercase tracking-widest transition-all duration-300 ${
										copied
											? 'border-cyan-500/50 bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 shadow-[0_0_10px_rgba(6,182,212,0.2)]'
											: 'border-border dark:border-white/10 bg-background dark:bg-zinc-900/80 text-muted-foreground hover:border-blue-500/50 hover:text-blue-500 dark:hover:text-blue-400 opacity-0 group-hover/editor:opacity-100 translate-y-2 group-hover/editor:translate-y-0'
									}`}
								>
									{copied ? <Check className="size-3" /> : <Copy className="size-3" />}
									{copied ? 'Copied' : 'Copy'}
								</button>
								
								<div className="absolute inset-0 bg-linear-to-b from-blue-500/5 to-transparent opacity-0 group-hover/editor:opacity-100 transition-opacity duration-700 pointer-events-none" />
								
								{monacoFailed ? (
									<textarea
										value={pythonScript}
										onChange={(e) => onScriptChange(e.target.value)}
										className="w-full h-full p-6 bg-accent dark:bg-zinc-950/40 text-foreground font-mono text-sm border-0 focus:ring-0 focus:outline-hidden resize-none scrollbar-thin rounded-2xl"
										style={{ fontFamily: "'JetBrains Mono', 'Fira Code', monospace" }}
										placeholder="# Write your build123d script here..."
									/>
								) : (
									<Editor
										height="100%"
										language="python"
										theme="vs-dark"
										value={pythonScript}
										onChange={(v) => onScriptChange(v || '')}
										options={{
											minimap: { enabled: false },
											fontSize: 13,
											fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
											lineNumbers: 'on',
											lineNumbersMinChars: 3,
											glyphMargin: false,
											folding: true,
											wordWrap: 'on',
											scrollBeyondLastLine: false,
											padding: { top: 20, bottom: 20 },
											renderLineHighlight: 'all',
											cursorBlinking: 'smooth',
											cursorSmoothCaretAnimation: 'on',
											mouseWheelZoom: true,
										}}
									/>
								)}
							</div>
						</div>
					)}
				</div>

				<div className="border-t border-border dark:border-white/5 p-6 bg-transparent">
					<button
						onClick={onRenderSync}
						disabled={isRecompiling || !hasSession || !pythonScript}
						className="group relative flex w-full items-center justify-center gap-4 overflow-hidden rounded-2xl bg-gradient-to-b from-cyan-500 to-cyan-700 border border-cyan-400/30 py-4 text-[12px] font-bold uppercase tracking-[0.2em] text-white shadow-[0_0_30px_rgba(6,182,212,0.4)] hover:from-cyan-400 hover:to-cyan-600 hover:shadow-[0_0_40px_rgba(6,182,212,0.6)] hover:scale-[1.02] active:scale-[0.98] transition-all duration-300 disabled:opacity-40 disabled:dark:opacity-20 disabled:grayscale disabled:scale-100 disabled:shadow-none"
					>
						<div className="absolute inset-0 bg-linear-to-r from-transparent via-white/30 to-transparent -translate-x-full group-hover:animate-[shimmer_1.5s_infinite] pointer-events-none" />
						
						{isRecompiling ? (
							<Loader2 className="size-5 animate-spin" />
						) : (
							<Wrench className="size-5 group-hover:rotate-45 transition-transform duration-500" />
						)}
						
						<span>{isRecompiling ? 'System Syncing...' : 'Sync to Engine'}</span>
					</button>
					
					<div className="mt-4 flex items-center justify-center gap-4 opacity-30">
						<div className="h-px w-8 bg-foreground/20 dark:bg-white/20" />
						<span className="text-[8px] font-bold uppercase tracking-[0.3em] text-muted-foreground">Authorized Access Only</span>
						<div className="h-px w-8 bg-foreground/20 dark:bg-white/20" />
					</div>
				</div>
			</div>

			{!isOpen && (
				<div className="absolute top-0 left-0 right-0 h-1/2 flex flex-col items-center justify-center gap-8 pointer-events-none animate-in fade-in duration-300">
					<div className="rotate-90 whitespace-nowrap text-[9px] font-black uppercase tracking-[0.5em] text-muted-foreground/50">
						Logic & System Params
					</div>
					<div className="w-px h-12 bg-linear-to-b from-border dark:from-zinc-800 to-transparent" />
				</div>
			)}
		</aside>
	);
}
