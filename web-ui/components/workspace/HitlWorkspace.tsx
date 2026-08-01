'use client';

import JSON5 from 'json5';
import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { AuthModal } from '@/components/auth/AuthModal';
import { toast } from 'sonner';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

import { CamSummaryPanel } from '../cam/CamSummaryPanel';
import { CadViewport } from '@/components/viewport/CadViewport';
import { StlMesh, type StlGeometryInfo } from '@/components/viewport/StlMesh';
import { HistoryDrawer } from '@/components/workspace/HistoryDrawer';
import { WorkflowNav } from '@/components/workspace/WorkflowNav';
import { WorkspaceSettings } from '@/components/workspace/WorkspaceSettings';
import { migrateLegacyCamSetup, validateMachineControllerPost } from '@/lib/cam/machineValidation';
import { MACHINE_MATRIX, ControllerId } from '@/lib/cam/machineProfiles';
import { EngineeringConsole } from '@/components/workspace/EngineeringConsole';
import { ChatPanel } from '@/components/chat/ChatPanel';
import { SessionBrowserModal } from '@/components/workspace/SessionBrowserModal';
import { Group as PanelGroup, Panel, Separator as PanelResizeHandle } from 'react-resizable-panels';
import { History, Cuboid } from 'lucide-react';
import Link from 'next/link';
import type { SetupSettings, Tool, CamOperation, SimulationState, ViewportSettings, CamFeature, PostProcessor, OperationType, ToolType, ToolMaterial, CoolantType, CamSetupPlan } from '@/types/cam';

type ChatRole = 'user' | 'assistant' | 'system';

type ChatMessage = {
	id: string;
	role: ChatRole;
	content: string;
	fileName?: string;
};

type RenderPayload = {
	stl_url?: string;
	step_url?: string;
	dxf_url?: string;
	gcode_url?: string;

	status?: string;
	job_id?: string;
    repaired_script?: string;
	error?: {
		message?: string;
		hint?: string;
	};
	artifacts?: {
		model_hash?: string;
		stl_url?: string;
		step_url?: string;
		dxf_url?: string;
		gcode_url?: string;
		gcode_content?: string;
		toolpaths?: number[][][];
		annotations?: Record<string, { p1: [number, number, number]; p2: [number, number, number] }>;
		features?: any[];
	};
};

type ApiErrorEnvelope = {
	error?: {
		message?: unknown;
		hint?: unknown;
	};
	message?: unknown;
	detail?: unknown;
};

type DrawerTab = 'parameters' | 'code' | 'cam';

import { MODEL_REGISTRY } from '@/lib/models-registry';

const DEFAULT_PROMPT = 'generate a 3D model of the attached file.';
const DEFAULT_MODEL = 'gemini-3.1-flash-lite';
const MODEL_OPTIONS = MODEL_REGISTRY.map(m => ({ value: m.id, label: m.name }));


function makeId(prefix: string): string {
	return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function stripApiSuffix(url: string): string {
	return url.replace(/\/api\/v1\/?$/, '');
}

function resolveModelUrl(rawUrl: string, cacheBust?: string): string {
	let resolvedUrl = rawUrl;

	if (!(rawUrl.startsWith('http://') || rawUrl.startsWith('https://'))) {
		const apiBase = process.env.NEXT_PUBLIC_FASTAPI_URL?.trim();
		if (apiBase && rawUrl.startsWith('/')) {
			resolvedUrl = `${stripApiSuffix(apiBase)}${rawUrl}`;
		}
	}

	if (!cacheBust) {
		return resolvedUrl;
	}

	const separator = resolvedUrl.includes('?') ? '&' : '?';
	return `${resolvedUrl}${separator}v=${encodeURIComponent(cacheBust)}`;
}

function findMatchingBrace(source: string, startIndex: number): number {
	let depth = 0;
	let inSingle = false;
	let inDouble = false;
	let escaping = false;

	for (let i = startIndex; i < source.length; i += 1) {
		const ch = source[i];

		if (escaping) {
			escaping = false;
			continue;
		}

		if (ch === '\\') {
			escaping = true;
			continue;
		}

		if (!inDouble && ch === "'") {
			inSingle = !inSingle;
			continue;
		}

		if (!inSingle && ch === '"') {
			inDouble = !inDouble;
			continue;
		}

		if (inSingle || inDouble) {
			continue;
		}

		if (ch === '{') {
			depth += 1;
			continue;
		}

		if (ch === '}') {
			depth -= 1;
			if (depth === 0) {
				return i;
			}
		}
	}

	return -1;
}

function getParametersBlock(script: string): { braceStart: number; braceEnd: number } | null {
	const regex = /^\s*PARAMETERS\s*(?::[^=\n]+)?\s*=\s*/m;
	const match = regex.exec(script);
	if (!match) return null;

	const startSearch = match.index + match[0].length;

	let braceStart = -1;
	for (let i = startSearch; i < script.length; i++) {
		const ch = script[i];
		if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') continue;
		if (ch === '{') {
			braceStart = i;
			break;
		} else {
			return null;
		}
	}

	if (braceStart === -1) return null;

	const braceEnd = findMatchingBrace(script, braceStart);
	if (braceEnd === -1) return null;

	return { braceStart, braceEnd };
}

function extractParameters(script: string): Record<string, unknown> {
	const block = getParametersBlock(script);
	if (!block) return {};

	const literal = script.slice(block.braceStart, block.braceEnd + 1);
	const normalized = literal
		.replace(/\bTrue\b/g, 'true')
		.replace(/\bFalse\b/g, 'false')
		.replace(/\bNone\b/g, 'null')
		.replace(/#[^\n]*/g, '');

	try {
		const parsed = JSON5.parse(normalized);
		if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
			return parsed as Record<string, unknown>;
		}
	} catch {
		return {};
	}

	return {};
}

function setParameterValue(params: Record<string, unknown>, key: string, value: unknown): Record<string, unknown> {
	return {
		...params,
		[key]: value,
	};
}

function injectParameters(script: string, parameters: Record<string, unknown>): string {
	const block = getParametersBlock(script);
	if (!block) return script;

	const pythonLiteral = JSON.stringify(parameters, null, 4)
		.replace(/: true\b/g, ': True')
		.replace(/: false\b/g, ': False')
		.replace(/: null\b/g, ': None');

	return script.slice(0, block.braceStart) + pythonLiteral + script.slice(block.braceEnd + 1);
}

function extractReadableError(payload: unknown, fallback: string): string {
	if (payload && typeof payload === 'object') {
		const candidate = payload as ApiErrorEnvelope;
		if (candidate.error && typeof candidate.error === 'object') {
			const message = typeof candidate.error.message === 'string' ? candidate.error.message.trim() : '';
			const hint = typeof candidate.error.hint === 'string' ? candidate.error.hint.trim() : '';
			if (message && hint) {
				return `${message} ${hint}`;
			}
			if (message) {
				return message;
			}
		}

		if (typeof candidate.message === 'string' && candidate.message.trim()) {
			return candidate.message.trim();
		}

		if (typeof candidate.detail === 'string' && candidate.detail.trim()) {
			return candidate.detail.trim();
		}
	}

	if (typeof payload === 'string' && payload.trim()) {
		return payload.trim();
	}

	return fallback;
}

async function readErrorFromResponse(response: Response, fallback: string): Promise<string> {
	const jsonPayload = await response
		.clone()
		.json()
		.catch(() => null);
	if (jsonPayload) {
		return extractReadableError(jsonPayload, fallback);
	}

	const textPayload = await response.text().catch(() => '');
	if (textPayload.trim()) {
		return extractReadableError(textPayload, fallback);
	}

	return fallback;
}

export default function HitlWorkspace() {
	const [chatWidth, setChatWidth] = useState(400);
	const [isSessionBrowserOpen, setIsSessionBrowserOpen] = useState(false);
	const [isWorkspaceMenuOpen, setIsWorkspaceMenuOpen] = useState(false);
	const isResizing = useRef(false);
	const fileUploadRef = useRef<HTMLInputElement>(null);

	const [messages, setMessages] = useState<ChatMessage[]>([]);
	const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
	const [selectedModel, setSelectedModel] = useState(DEFAULT_MODEL);
	const [selectedFile, setSelectedFile] = useState<File | null>(null);
	const [sourceFilename, setSourceFilename] = useState<string | null>(null);
	const [isGenerating, setIsGenerating] = useState(false);
	const [isRecompiling, setIsRecompiling] = useState(false);
	const [isDrawerOpen, setIsDrawerOpen] = useState(true);
	const [sessionId, setSessionId] = useState<string | null>(null);
	const [pythonScript, setPythonScript] = useState('');
	const [activeDrawerTab, setActiveDrawerTab] = useState<DrawerTab>('parameters');
	const [activeRightTab, setActiveRightTab] = useState<'cad' | 'cam'>('cad');
	const [parameters, setParameters] = useState<Record<string, unknown>>({});
	const [stlUrl, setStlUrl] = useState<string | null>(null);
	const [stepUrl, setStepUrl] = useState<string | null>(null);
	const [dxfUrl, setDxfUrl] = useState<string | null>(null);
	const [gcodeUrl, setGcodeUrl] = useState<string | null>(null);
	const [toolpaths, setToolpaths] = useState<any[] | null>(null);
	const [camModelHash, setCamModelHash] = useState<string | null>(null);
	const [cadModelHash, setCadModelHash] = useState<string | null>(null);
	const latestCamRunId = useRef<string | null>(null);
	const [isDownloadingStl, setIsDownloadingStl] = useState(false);
	const [isDownloadingStep, setIsDownloadingStep] = useState(false);
	const [isDownloadingDxf, setIsDownloadingDxf] = useState(false);
	const [isDownloadingGcode, setIsDownloadingGcode] = useState(false);
	const [hoveredFeatureId, setHoveredFeatureId] = useState<string | null>(null);

	// CAM Parameters State
	const [camSetup, setCamSetup] = useState<SetupSettings>(() => migrateLegacyCamSetup({
		units: undefined,
		machine: undefined,
		stockType: undefined,
		material: undefined,
		stockDimensions: [100, 100, 20],
		wcs: undefined,
		originPosition: undefined,
		tolerance: 0.01,
		stockOffset: 2,
	} as any));
	const [camSetups, setCamSetups] = useState<CamSetupPlan[]>([]);
	const [activeSetupId, setActiveSetupId] = useState<string | null>(null);
	const [camTools, setCamTools] = useState<Tool[]>([]);
	const [camOperations, setCamOperations] = useState<CamOperation[]>([]);
	const [selectedOperationIds, setSelectedOperationIds] = useState<Set<string>>(new Set());
	const [activeOperationId, setActiveOperationId] = useState<string | null>(null);
	const [camFeatures, setCamFeatures] = useState<CamFeature[]>([]);
	const [defaultSetupMetadata, setDefaultSetupMetadata] = useState<any>(undefined);
	const [activeFeatureId, setActiveFeatureId] = useState<string | null>(null);
	const [activeParameter, setActiveParameter] = useState<string | null>(null);
	const [coordValidation, setCoordValidation] = useState<any>(null);
	const [camSimulation, setCamSimulation] = useState<SimulationState>({ isPlaying: false, progress: 0, speed: 1 });
	const [camViewport, setCamViewport] = useState<ViewportSettings>({ showStock: false, showTool: true, showToolpath: true, showOrigin: true, showAxes: true });
	const [gcodeContent, setGcodeContent] = useState<string | null>(null);
	const [klartextContent, setKlartextContent] = useState<string | null>(null);
	const [isGeneratingGcode, setIsGeneratingGcode] = useState(false);
	const [gcodeErrors, setGcodeErrors] = useState<any[]>([]);
	const [camReadinessScore, setCamReadinessScore] = useState<number | null>(null);
	const [camStatus, setCamStatus] = useState<string | null>(null);
	const [canGenerateGcode, setCanGenerateGcode] = useState<boolean>(false);
	const [plannedCycleTimeSeconds, setPlannedCycleTimeSeconds] = useState<number>(0);

	const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
	const [isSharing, setIsSharing] = useState(false);


	const [isDeveloper, setIsDeveloper] = useState(false);
	const [developerUsername, setDeveloperUsername] = useState('');
	const [developerPassword, setDeveloperPassword] = useState('');
	const [developerAuthError, setDeveloperAuthError] = useState<string | null>(null);
	const [debugMode, setDebugMode] = useState(false);

	const handleDeveloperLogin = () => {
		if (developerUsername === 'admin' && developerPassword === 'admin') {
			setIsDeveloper(true);
			setDeveloperAuthError(null);
			setDeveloperUsername('');
			setDeveloperPassword('');
		} else {
			setDeveloperAuthError('Invalid credentials');
		}
	};

	const handleDeveloperLogout = () => {
		setIsDeveloper(false);
		setActiveDrawerTab('parameters');
	};

	const [isHistoryOpen, setIsHistoryOpen] = useState(false);
	const [isChatOpen, setIsChatOpen] = useState(false);

	const [statusText, setStatusText] = useState<string>('Ready');
	const [workflowStage, setWorkflowStage] = useState<'blueprint' | 'extraction' | 'cad' | 'cam' | 'gcode'>('blueprint');
	const [annotations, setAnnotations] = useState<Record<string, { p1: [number, number, number]; p2: [number, number, number] }>>({});
	const [parameterMetadata, setParameterMetadata] = useState<Record<string, any>>({});
	const [geometryInfo, setGeometryInfo] = useState<StlGeometryInfo | null>(null);
	const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
	const [selectionContext, setSelectionContext] = useState<[number, number, number] | null>(null);

	useEffect(() => {
		if (workflowStage === 'cam' || workflowStage === 'gcode') {
			setActiveRightTab('cam');
		} else if (workflowStage === 'cad') {
			setActiveRightTab('cad');
		}
	}, [workflowStage]);

	const parameterEntries = Object.entries(parameters).filter(([_, v]) => typeof v === 'number' || typeof v === 'string');

	const handleShare = async () => {
		if (!sessionId) return;
		setIsSharing(true);
		try {
			const res = await fetch(`/api/sessions/${sessionId}/share`, { method: 'POST' });
			if (!res.ok) throw new Error('Failed to create share link');
			const data = await res.json();
			const url = `${window.location.origin}/share/${sessionId}`;
			await navigator.clipboard.writeText(url);
			toast.success('Share link copied to clipboard!');
		} catch (error: any) {
			toast.error('Failed to share model', { description: error.message });
		} finally {
			setIsSharing(false);
		}
	};

	const handleGeometryReady = useCallback((info: StlGeometryInfo) => {
		setGeometryInfo(info);
	}, []);

	const pythonScriptRef = useRef('');

	const updatePythonScript = (nextScript: string) => {
		pythonScriptRef.current = nextScript;
		setPythonScript(nextScript);
	};

	useEffect(() => {
		const handleMouseMove = (e: MouseEvent) => {
			if (!isResizing.current) return;
			const newWidth = Math.max(300, Math.min(e.clientX, 800));
			setChatWidth(newWidth);
		};
		const handleMouseUp = () => {
			isResizing.current = false;
			document.body.style.cursor = 'default';
		};
		window.addEventListener('mousemove', handleMouseMove);
		window.addEventListener('mouseup', handleMouseUp);
		return () => {
			window.removeEventListener('mousemove', handleMouseMove);
			window.removeEventListener('mouseup', handleMouseUp);
		};
	}, []);

	useEffect(() => {
		if (!pythonScript) return;

		const timeout = setTimeout(() => {
			const extracted = extractParameters(pythonScript);
			if (Object.keys(extracted).length === 0) return;

			if (JSON.stringify(extracted) !== JSON.stringify(parameters)) {
				setParameters(extracted);
			}
		}, 800);

		return () => clearTimeout(timeout);
	}, [pythonScript]);

	useEffect(() => {
		if (toolpaths) {
			let filteredSegments = toolpaths;
			if (selectedOperationIds && selectedOperationIds.size > 0) {
				filteredSegments = toolpaths.filter(t => selectedOperationIds.has(t.operationId));
			} else {
				const currentSetupId = activeSetupId || camSetups[0]?.setupId;
				filteredSegments = toolpaths.filter(t => t.setupId === currentSetupId);
			}
			setCamSimulation(prev => ({
				...prev,
				segments: filteredSegments,
				progress: 0,
				activeSegmentIndex: 0,
				isPlaying: false
			}));
		}
	}, [toolpaths, activeSetupId, camSetups, selectedOperationIds]);


	async function handleGenerate(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (!prompt.trim()) {
			setStatusText('Please provide a prompt.');
			return;
		}

		const assistantMessageId = makeId('assistant');
		setMessages((prev) => [...prev, { id: makeId('user'), role: 'user', content: prompt, fileName: selectedFile?.name }, { id: assistantMessageId, role: 'assistant', content: '' }]);
		setIsGenerating(true);
		setWorkflowStage('extraction');

		const formData = new FormData();
		formData.append('prompt', prompt.trim());
		if (selectedFile) {
			formData.append('image', selectedFile);
		}
		if (selectionContext) {
			formData.append('selection_context', JSON.stringify(selectionContext));
		}
		formData.append('model_name', selectedModel);

		// Clear input fields after securing the payload
		setPrompt('');
		setSourceFilename(selectedFile?.name || null);
		setSelectedFile(null);
		setSelectionContext(null);

		try {
			const response = await fetch('/api/generate', { method: 'POST', body: formData });
			const nextSessionId = response.headers.get('x-session-id');
			if (nextSessionId) setSessionId(nextSessionId);

			if (!response.ok) {
				const errorMsg = await readErrorFromResponse(response, 'Failed to connect to backend.');
				throw new Error(errorMsg);
			}

			const reader = response.body?.getReader();
			if (!reader) throw new Error('Streaming failed. Please retry.');

			const decoder = new TextDecoder();
			let accumulated = '';
			let fullScript = '';
			let finalParams = parameters;

			while (true) {
				const { done, value } = await reader.read();
				if (done) break;

				const chunkText = decoder.decode(value);
				const lines = chunkText.split('\n');

				for (const line of lines) {
					if (!line.startsWith('data: ')) continue;
					try {
						const rawData = JSON.parse(line.slice(6));
						if (rawData.error) {
							const msg = rawData.error.message || 'Generation failed.';
							const hint = rawData.error.hint ? ` Hint: ${rawData.error.hint}` : '';
							throw new Error(`${msg}${hint}`);
						}

						if (rawData.status === 'generating_cad') {
							setStatusText('Generating CAD...');
							setWorkflowStage('cad');
						} else if (rawData.status === 'completed') {
							setWorkflowStage('cam');
						}

						if (rawData.chunk) {
							accumulated += rawData.chunk;
							setMessages((prev) => prev.map((m) => (m.id === assistantMessageId ? { ...m, content: accumulated } : m)));
						}
						if (rawData.script) fullScript = rawData.script;
						if (rawData.parameters) {
							finalParams = rawData.parameters;
							setParameters(rawData.parameters);
						}
						if (rawData.metadata) {
							setParameterMetadata(rawData.metadata);
						}
					} catch { }
				}
			}

			if (fullScript) {
				updatePythonScript(fullScript);
				setActiveDrawerTab('code');
				setIsDrawerOpen(true);
				setStatusText('Script generated. Compiling 3D model...');

				// Automatically trigger sync after generation
				const currentSession = nextSessionId || sessionId;
				if (currentSession) {
					await performSync(fullScript, finalParams, currentSession);
				}
			} else {
				throw new Error('No script returned from model.');
			}
		} catch (error) {
			const errorText = error instanceof Error ? error.message : String(error);
			setMessages((prev) => prev.map((m) => (m.id === assistantMessageId ? { ...m, content: `Error: ${errorText}` } : m)));
			setStatusText(`Generation failed: ${errorText}`);
		} finally {
			setIsGenerating(false);
		}
	}

	async function performSync(script: string, params: Record<string, any>, session: string) {
		setIsGenerating(true);
		setStatusText('Syncing to backend engine...');

		try {

			const response = await fetch('/api/render', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', 'x-session-id': session },
				body: JSON.stringify({
					python_script: script,
					parameters: params,
					session_id: session,
					cam_parameters: {
						controller: camSetup.controller || 'FANUC_0I_MF',
						post_processor: camSetup.postProcessor || 'AUTO',
						setup: camSetup,
						tools: camTools,
						operations: camOperations,
					}
				}),
			});

			if (!response.ok) {
				const errorMsg = await readErrorFromResponse(response, 'Render failed.');
				throw new Error(errorMsg);
			}

			const payload = (await response.json()) as RenderPayload;
            
            if (payload.repaired_script) {
                updatePythonScript(payload.repaired_script);
                toast.info('Script was auto-healed during rendering');
            }
            
			if (payload.artifacts?.stl_url) {
				setStlUrl(resolveModelUrl(payload.artifacts.stl_url, Date.now().toString()));
				setWorkflowStage(prev => (prev === 'blueprint' || prev === 'extraction' ? 'cad' : prev));
				
				// Clear CAM state on new CAD model
				setCamModelHash(null);
				setCadModelHash(payload.artifacts?.model_hash || null);
				setToolpaths(null);
				setCamFeatures(payload.artifacts?.features || []);
				setCamOperations([]);
				setPlannedCycleTimeSeconds(0);
				setGcodeContent(null);
				setGcodeUrl(null);
				
				// Extract Setup Metadata correctly from the artifacts
				const setupMeta = (payload.artifacts as any)?.setupMetadata || (payload.artifacts as any)?.setup_metadata;
				if (setupMeta) {
					setDefaultSetupMetadata(setupMeta);
				} else {
					setDefaultSetupMetadata(undefined);
				}
			}
			if (payload.artifacts?.step_url) setStepUrl(resolveModelUrl(payload.artifacts.step_url));
			if (payload.artifacts?.dxf_url) setDxfUrl(resolveModelUrl(payload.artifacts.dxf_url));
			if (payload.artifacts?.annotations) {
				setAnnotations(payload.artifacts.annotations);

				const annotationsAny = payload.artifacts.annotations as any;
				const featuresUrl = annotationsAny.cam_features_url as string | undefined;
				if (featuresUrl) {
					try {
						const resolvedUrl = resolveModelUrl(featuresUrl, Date.now().toString());
						const featuresRes = await fetch(resolvedUrl);
						if (featuresRes.ok) {
							const data = await featuresRes.json();
							setCamFeatures(data || []);
						}
					} catch (e) {
						console.error("Failed to load CAM features:", e);
					}
				}
			}
			setStatusText('Geometry recompiled successfully.');
			toast.success('Sync successful');
		} catch (error) {
			const errorText = error instanceof Error ? error.message : String(error);
			setStatusText(`Sync failed: ${errorText}`);
			toast.error('Sync failed', { description: errorText });
		} finally {
			setIsGenerating(false);
		}
	}

	async function handleRenderSync() {
		if (!sessionId || !pythonScript) return;
		await performSync(pythonScript, parameters, sessionId);
	}

	async function handleGenerateGCode() {
		if (!sessionId || !pythonScript) {
			toast.error('Generate a 3D model first before generating G-Code.');
			return;
		}
		if (!stepUrl) {
			toast.error('No STEP file available. Generate a 3D model first.');
			return;
		}

		const validation = validateMachineControllerPost(camSetup);
		if (!validation.valid) {
			toast.error('Invalid CAM Setup', { description: validation.error });
			return;
		}

		setIsGeneratingGcode(true);
		setWorkflowStage('cam');
		setStatusText('Generating G-Code with CAM parameters...');

		try {
			const backendUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8001';
			const response = await fetch(`${backendUrl}/api/v1/cam/gcode`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					session_id: sessionId,
					job_id: sessionId,
					cam_run_id: latestCamRunId.current || '',
					setup_id: selectedOperationIds.size > 0 ? null : (activeSetupId || null),
					selected_operation_ids: selectedOperationIds.size > 0 ? Array.from(selectedOperationIds) : undefined,
				}),
			});

			if (!response.ok) {
				const errorMsg = await readErrorFromResponse(response, 'G-Code generation failed.');
				throw new Error(errorMsg);
			}

			const payload = await response.json();

			if (payload.can_generate_gcode) {
				setGcodeContent(payload.gcode);
				setKlartextContent(payload.klartext || null);
				setGcodeErrors([]);
				setStatusText('G-Code generated successfully.');
				toast.success('G-Code generated with full CAM configuration');
				
				if (payload.planned_cycle_time_seconds) {
					setPlannedCycleTimeSeconds(payload.planned_cycle_time_seconds);
				}

				if (payload.toolpaths && payload.toolpaths.length > 0) {
					setToolpaths(payload.toolpaths);
					setCamSimulation(prev => ({
						...prev,
						segments: payload.toolpaths,
						progress: 0,
						activeSegmentIndex: 0,
						isPlaying: false
					}));
				}
			} else {
				setGcodeContent(null);
				setKlartextContent(null);
				setGcodeErrors(payload.errors || []);
				const errMsg = payload.errors && payload.errors.length > 0 
					? payload.errors.map((e: any) => e.message || e.code).join(' | ') 
					: 'Safety/validation errors.';
				setStatusText(`G-Code generation failed: ${errMsg}`);
				toast.error('G-Code generation failed', { description: errMsg });
			}

			if (payload.operation_statuses && Array.isArray(payload.operation_statuses)) {
			    setCamOperations((prevOps: any[]) => prevOps.map(op => {
			        const override = payload.operation_statuses.find((s: any) => s.operation_id === op.id);
			        if (override) {
			            return { 
							...op, 
							status: override.status, 
							errorReason: override.blocked_reason,
							parameters: { ...(op.parameters || {}), error: override.blocked_reason }
						};
			        }
			        return op;
			    }));
			}

			setWorkflowStage('gcode');
		} catch (error) {
			const errorText = error instanceof Error ? error.message : String(error);
			setStatusText(`G-Code generation failed: ${errorText}`);
			toast.error('G-Code generation failed', { description: errorText });
		} finally {
			setIsGeneratingGcode(false);
		}
	}


	async function handleGenerateToolpaths() {
		if (!sessionId) {
			toast.error('No session ID available.');
			return;
		}

		setIsGenerating(true);
		setStatusText('Generating toolpaths...');

		const runId = makeId('cam_run');
		latestCamRunId.current = runId;

		try {
			const backendUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8001';
			const opsToSend = selectedOperationIds.size > 0 
				? camOperations.filter(op => selectedOperationIds.has(op.id))
				: camOperations;

			// Scale parametric features and operations to match the internal mm units
			// Since AI extracts parameters in inches typically, and StlMesh auto-scales to mm.
			const geometryScale = geometryInfo?.scale || 1.0;
			let featuresToSend = camFeatures;
			let scaledOpsToSend = opsToSend;
			
			if (geometryScale !== 1.0) {
				featuresToSend = camFeatures.map(f => {
					if (!f || !f.dimensions) return f;
					const newDims = { ...f.dimensions };
					['width', 'length', 'depth', 'diameter', 'height', 'radius', 'dia'].forEach(key => {
						if (typeof newDims[key] === 'number') {
							newDims[key] = newDims[key] * geometryScale;
						}
					});
					return { ...f, dimensions: newDims };
				});
				
				scaledOpsToSend = opsToSend.map(op => {
					if (!op) return op;
					const newOp = { ...op };
					['stepdown', 'stepover', 'clearance_height', 'retract_height', 'stock_to_leave'].forEach(key => {
						if (typeof (newOp as any)[key] === 'number') {
							(newOp as any)[key] = (newOp as any)[key] * geometryScale;
						}
					});
					return newOp as any;
				});
			}

			const res = await fetch(`${backendUrl}/api/v1/cam/toolpaths`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					session_id: sessionId,
					job_id: sessionId,
					cam_run_id: runId,
					setup: camSetup,
					setups: camSetups,
					tools: camTools,
					operations: scaledOpsToSend,
					features: featuresToSend,
					modelHash: cadModelHash || "",
					parameters: parameters
				})
			});

			if (!res.ok) {
				const errorMsg = await readErrorFromResponse(res, 'Toolpath generation failed.');
				throw new Error(errorMsg);
			}

			const data = await res.json();
			if (latestCamRunId.current === runId) {
				// Clear old G-code state
				setGcodeErrors([]);
				setGcodeContent(null);
				// (Assuming validationErrors is cleared if applicable, we clear gcode errors here)
				
				const fetchedToolpaths = data.toolpaths || [];
				setToolpaths(fetchedToolpaths);
				setCamSimulation(prev => ({
					...prev,
					segments: fetchedToolpaths,
					progress: 0,
					activeSegmentIndex: 0,
					isPlaying: false
				}));
				if (data.operations) {
					setCamOperations(prevOps => prevOps.map(op => {
						const updatedOp = data.operations.find((o: any) => o.id === op.id);
						if (updatedOp) {
							if (data.operation_statuses && Array.isArray(data.operation_statuses)) {
								const override = data.operation_statuses.find((s: any) => s.operation_id === updatedOp.id);
								if (override) {
									return {
										...updatedOp,
										status: override.status,
										errorReason: override.blocked_reason,
										parameters: { ...(updatedOp.parameters || {}), error: override.blocked_reason }
									};
								}
							}
							return updatedOp;
						}
						return { ...op, toolpaths: [] };
					}));
				}
				if (data.coordinate_validation) {
					setCoordValidation(data.coordinate_validation);
				}
				if (data.camModelHash) {
					setCamModelHash(data.camModelHash);
				}
				
				if (data.cam_readiness_score !== undefined) setCamReadinessScore(data.cam_readiness_score);
				if (data.cam_status !== undefined) setCamStatus(data.cam_status);
				if (data.can_generate_gcode !== undefined) setCanGenerateGcode(data.can_generate_gcode);
				if (data.planned_cycle_time_seconds !== undefined) setPlannedCycleTimeSeconds(data.planned_cycle_time_seconds);
				
				if (!data.toolpaths || data.toolpaths.length === 0) {
					setStatusText('No toolpaths were generated.');
					toast.warning('No toolpath moves generated for these operations.');
				} else if (data.status === 'operations_blocked' || data.status === 'toolpaths_generated_with_blocks') {
					setStatusText('Toolpaths generated, but some operations need attention.');
					toast.warning('Toolpaths generated, but some operations need attention.');
				} else {
					setStatusText('Toolpaths generated successfully.');
					toast.success('Toolpaths generated');
				}
				setWorkflowStage('cam');
			}
		} catch (error) {
			if (latestCamRunId.current === runId) {
				const errorText = error instanceof Error ? error.message : String(error);
				setStatusText(`Toolpath generation failed: ${errorText}`);
				toast.error('Toolpath generation failed', { description: errorText });
				setToolpaths(null);
			}
		} finally {
			if (latestCamRunId.current === runId) {
				setIsGenerating(false);
			}
		}
	}

	async function handleAnalyzeFeatures() {
		if (!sessionId) {
			toast.error('No 3D model available to analyze.');
			return;
		}
		
		setIsGenerating(true);
		setStatusText('Analyzing 3D geometry for features...');
		
		try {
			const backendUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8001';
			const res = await fetch(`${backendUrl}/api/v1/cam/analyze`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ session_id: sessionId, parameters: parameters })
			});
			
			if (!res.ok) {
				const errorMsg = await readErrorFromResponse(res, 'Feature analysis failed.');
				throw new Error(errorMsg);
			}
			
			const data = await res.json();
			setCamFeatures(data.features || []);
			setStatusText('Feature analysis complete.');
			toast.success('Features analyzed successfully');
			setWorkflowStage('cam');
		} catch (error) {
			const errorText = error instanceof Error ? error.message : String(error);
			setStatusText(`Analysis failed: ${errorText}`);
			toast.error('Analysis failed', { description: errorText });
		} finally {
			setIsGenerating(false);
		}
	}

	async function handleAutoGenerateOperations() {
		if (!sessionId) {
			toast.error('No session active. Please generate a model first.');
			return;
		}

		// Ensure Machine and Material defaults if missing
		const effectiveSetup = {
			...camSetup,
			machine: camSetup.machine || camSetup.machineProfile || 'haas_umc750',
			material: camSetup.material || camSetup.workpieceMaterialId || 'aluminum_6061',
			workpieceMaterialId: camSetup.workpieceMaterialId || camSetup.material || 'aluminum_6061',
		};

		// If user hasn't explicitly set stock dimensions, inject the true CAD bounds so the backend generates perfectly sized toolpaths
		if (!camSetup.stockDimensions || (camSetup.stockDimensions as any).length === 0) {
			if (geometryInfo?.bounding_box) {
				const min = geometryInfo.bounding_box.min;
				const max = geometryInfo.bounding_box.max;
				effectiveSetup.stockDimensions = [
					max[0] - min[0],
					max[1] - min[1],
					max[2] - min[2]
				];
			}
		}

		setIsGenerating(true);
		setStatusText('Auto Planning CAM...');

		try {
			const machineType = effectiveSetup.machineType || 'MILL_5X_VMC';
			const is5Axis = machineType === 'MILL_5X_VMC';
			const is4Axis = machineType === 'MILL_4X_VMC' || is5Axis;
			const isLathe = machineType === 'CNC_LATHE' || machineType === 'CNC_LATHE_LIVE_TOOLING' || machineType === 'SWISS_LATHE';
			const isMillTurn = machineType === 'MILL_TURN';
			const hasLiveTooling = machineType === 'CNC_LATHE_LIVE_TOOLING' || machineType === 'SWISS_LATHE' || isMillTurn;

			const machine_capability = {
				turning: isLathe || isMillTurn,
				milling_3axis: !isLathe || hasLiveTooling,
				drilling: true,
				pocketing: !isLathe || hasLiveTooling,
				indexed_4axis: is4Axis || isMillTurn || hasLiveTooling,
				continuous_4axis: is4Axis || isMillTurn,
				milling_5axis: is5Axis,
				mill_turn: isMillTurn || hasLiveTooling
			};

			// Fetch the full global tool library so the AI picks from existing tools instead of inventing them.
			let globalTools = [...camTools];
			try {
				const toolsRes = await fetch('/api/cam/tools');
				if (toolsRes.ok) {
					const data = await toolsRes.json();
					if (data.tools && data.tools.length > 0) {
						// Merge local and remote tools, preferring local ones if there's a conflict
						const remoteTools = data.tools.filter((rt: any) => !globalTools.some(lt => lt.id === rt.id));
						globalTools = [...globalTools, ...remoteTools];
					}
				}
			} catch (e) {
				console.warn('Could not fetch global tool library for AI planning', e);
			}

			const backendUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8001';
			const res = await fetch(`${backendUrl}/api/v1/cam/auto_plan`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					session_id: sessionId,
					job_id: sessionId,
					parameters: parameters,
					machine_config: {
						machine_capability: machine_capability,
						tool_library: globalTools.map((t: any) => {
							let backendType = t.type as string;
							if (backendType === 'flat_end_mill') backendType = 'end_mill';
							if (backendType === 'ball_nose') backendType = 'ball_mill';
							return {
								tool_id: t.id,
								name: t.name || t.number || `Tool ${t.id}`,
								type: backendType,
								diameter: t.geometry?.diameter || t.diameter || 6.35,
								flute_count: t.geometry?.fluteCount || t.flutes || 2,
								cutting_length: t.geometry?.fluteLength || t.stickout || 20,
								stickout: t.assembly?.stickoutLength || t.stickout || 20,
								compatible_materials: ["all"]
							};
						}),
						setup: effectiveSetup
					}
				})
			});

			if (!res.ok) {
				throw new Error(await readErrorFromResponse(res, 'Auto plan failed'));
			}

			const data = await res.json();
			
			if (data.features) setCamFeatures(data.features);
			if (data.setups && data.setups.length > 0) {
				setCamSetups(data.setups);
				setActiveSetupId(data.setups[0].setupId);
			}
			
			if (data.planned_cycle_time_seconds !== undefined) {
				setPlannedCycleTimeSeconds(data.planned_cycle_time_seconds);
			}
			
			if (data.tools || data.operations) {
				// Gather all backend tools from data.tools AND inline op.tool / op.selected_tool
				const toolsMap = new Map<string, any>();
				(data.tools || []).forEach((t: any) => {
					const tid = t.tool_id || t.id;
					if (tid) toolsMap.set(tid, t);
				});

				(data.operations || []).forEach((op: any) => {
					const tid = op.tool_id || op.toolId;
					const toolObj = op.tool || op.selected_tool;
					if (tid && !toolsMap.has(tid) && toolObj && typeof toolObj === 'object') {
						toolsMap.set(tid, {
							tool_id: tid,
							id: tid,
							name: toolObj.name || `Tool ${tid}`,
							type: toolObj.type || 'drill',
							diameter: toolObj.diameter || 1.0,
							flute_count: toolObj.flute_count || toolObj.flutes || 2,
							cutting_length: toolObj.cutting_length || toolObj.stickout || 20,
							stickout: toolObj.stickout || 30
						});
					}
				});

				const allAssignedBackendTools = Array.from(toolsMap.values());

				// Map backend tools to frontend Tools
				const newTools = allAssignedBackendTools.map((t: any, i: number) => ({
					id: t.tool_id || t.id,
					dbId: t.tool_id || t.id,
					name: t.name || `Auto Tool ${i+1}`,
					number: `T`, // Will be assigned sequentially below
					type: (t.type === 'end_mill' ? 'flat_end_mill' : t.type === 'ball_mill' ? 'ball_nose' : t.type) as ToolType,
					diameter: t.diameter || 3.175,
					flutes: t.flute_count || t.flutes || 2,
					stickout: t.stickout || t.cutting_length || 20,
					material: (t.material?.material_code || t.material || 'carbide') as ToolMaterial,
					coating: t.coating?.coating_name || t.coating,
					cuttingData: t.cuttingData || (() => {
						const ops = data.operations || [];
						const op = ops.find((o: any) => o.tool_id === (t.tool_id || t.id) || o.toolId === (t.tool_id || t.id));
						if (op) {
							return {
								spindleRpm: op.parameters?.feeds_and_speeds?.spindleSpeed || op.parameters?.spindleSpeed || 10000,
								feedRate: op.parameters?.feeds_and_speeds?.feedRate || op.parameters?.feedRate || 1000,
								plungeRate: op.parameters?.feeds_and_speeds?.plungeRate || op.parameters?.plungeRate || 300,
								coolant: op.parameters?.coolant || 'flood'
							};
						}
						return {
							spindleRpm: 10000,
							feedRate: 1000,
							plungeRate: 300,
							coolant: 'flood'
						};
					})()
				}));
				
				setCamTools(prev => {
					// Add only tools that don't exist yet
					const existingIds = new Set(prev.map(p => p.id));
					const toAdd = newTools.filter((nt: any) => !existingIds.has(nt.id));
					
					// Assign sequential T-numbers to the newly added tools
					toAdd.forEach((nt: any, idx: number) => {
						nt.number = `T${prev.length + idx + 1}`;
					});
					
					return [...prev, ...toAdd];
				});
			}

			if (data.operations && data.operations.length > 0) {
				// Map operations
				const newOps: CamOperation[] = data.operations.map((op: any, i: number) => {
					const resolvedToolId = op.tool_id || op.toolId || op.tool?.tool_id || op.tool?.id || '';
					const isOpValid = Boolean(resolvedToolId);
					return {
						id: op.id || `op_auto_${Date.now()}_${i}`,
						name: op.name || `${op.type || op.operation_type} Operation`,
						type: (op.type || op.operation_type) as OperationType,
						toolId: resolvedToolId,
						tool: op.tool || op.selected_tool,
						feature_id: op.feature_id,
						setup_id: op.setup_id || 'setup_1',
						status: isOpValid ? (op.status === 'blocked' ? 'generated' : (op.status || 'generated')) : 'blocked',
						safe_heights: op.safe_heights,
						estimated_time_s: op.estimated_time_s || 0,
						parameters: {
							...op.parameters,
							feedRate: op.parameters?.feeds_and_speeds?.feedRate || op.parameters?.feedRate || 1000,
							plungeRate: op.parameters?.feeds_and_speeds?.plungeRate || op.parameters?.plungeRate || 300,
							maxStepdown: op.parameters?.feeds_and_speeds?.maxStepdown || op.parameters?.maxStepdown || 2.0,
							spindleSpeed: op.parameters?.feeds_and_speeds?.spindleSpeed || op.parameters?.spindleSpeed || 10000,
							stepoverPercentage: op.parameters?.stepoverPercentage || 40,
							tolerance: op.parameters?.tolerance || 0.01,
							coolant: op.parameters?.coolant || 'flood'
						}
					};
				});
				setCamOperations(newOps);
				
				if (data.setups && data.setups.length > 0) {
					setCamSetups(data.setups);
				}
				
				setSelectedOperationIds(new Set(newOps.filter(op => op.status !== 'unsupported' && op.status !== 'blocked').map(op => op.id)));
				if (newOps.length > 0) setActiveOperationId(newOps[0].id);
				toast.success(`Generated ${newOps.length} operations across ${data.setups?.length || 1} setup(s)`);
				setWorkflowStage('cam');
			} else {
				toast.warning('No operations could be planned for these features.');
			}
		} catch (error) {
			const errorText = error instanceof Error ? error.message : String(error);
			setStatusText(`Auto Plan failed: ${errorText}`);
			toast.error('Auto Plan failed', { description: errorText });
		} finally {
			setIsGenerating(false);
			setStatusText('Ready');
		}
	}

	async function handleDownloadArtifact(url: string | null, label: string) {
		if (!url) return;


		const setBusy = label === 'stl'
			? setIsDownloadingStl
			: label === 'step'
				? setIsDownloadingStep
				: label === 'gcode'
					? setIsDownloadingGcode
					: setIsDownloadingDxf;
		setBusy(true);

		try {
			const response = await fetch(url);
			if (!response.ok) throw new Error(`Server returned ${response.status}`);

			const blob = await response.blob();
			const objectUrl = URL.createObjectURL(blob);
			const link = document.createElement('a');
			link.href = objectUrl;
			let filename = url.split('/').pop()?.split('?')[0] || `model.${label}`;
			
			if (sourceFilename) {
				const baseName = sourceFilename.substring(0, sourceFilename.lastIndexOf('.')) || sourceFilename;
				filename = `${baseName}.${label}`;
			}
			
			link.download = filename;
			document.body.appendChild(link);
			link.click();
			document.body.removeChild(link);
			URL.revokeObjectURL(objectUrl);
			toast.success(`${label} downloaded`, { description: filename });
		} catch (error) {
			toast.error(`Failed to download ${label}`);
		} finally {
			setBusy(false);
		}
	}

	const handleRestoreSession = async (session: any) => {
		setSessionId(session.id);
		updatePythonScript(session.pythonScript);
		setParameters(session.parameters || {});

		setMessages((prev) => [
			...prev,
			{ 
				id: makeId('assistant'), 
				role: 'assistant', 
				content: `Restored session: **${session.prompt || 'Untitled project'}**`,
				fileName: session.fileName || undefined
			}
		]);

		setIsHistoryOpen(false);
		setActiveDrawerTab('parameters');
		setIsDrawerOpen(true);
		setStatusText('Restoring session and rebuilding geometry...');
		setWorkflowStage('cad');

		// Always trigger a sync to ensure the environment matches the script
		await performSync(session.pythonScript, session.parameters || {}, session.id);

		toast.success('Session restored');
	};

	const hasStl = Boolean(stlUrl);
	const hasStep = Boolean(stepUrl);
	const hasDxf = Boolean(dxfUrl);


	const handleClear = async () => {
		if (sessionId) {
			try {
				await fetch(`/api/sessions/${sessionId}`, { method: 'DELETE' });
			} catch (err) {
				console.error('Failed to delete session', err);
			}
		}
		setMessages([]);
		setPrompt(DEFAULT_PROMPT);
		setSelectedFile(null);
		setSessionId(null);
		updatePythonScript('');
		setParameters({});
		setStlUrl(null);
		setStepUrl(null);
		setDxfUrl(null);
		setGcodeUrl(null);
		setGcodeContent(null);
		setAnnotations({});
		setParameterMetadata({});
		setActiveParameter(null);
		setStatusText('Ready');
		setWorkflowStage('blueprint');
		toast.info('Session cleared');
	};

	return (
		<div className="h-screen w-full bg-background text-foreground overflow-hidden flex flex-col p-3">
			<main className="flex-1 flex overflow-hidden w-full gap-0 relative">
				<PanelGroup id="workspace-layout-v5" orientation="vertical">
					{/* Top: Navigation + Viewport + Settings */}
					<Panel defaultSize={70} minSize={40}>
						<div className="h-full w-full flex">

							{/* 1. Left Navigation (Fixed Width) */}
							<div className="w-[360px] shrink-0 h-full overflow-hidden flex flex-col z-10 border-r border-border bg-popover/95 backdrop-blur-xl relative">
								{/* Chat Panel */}
								<div className="flex-1 overflow-hidden relative">
									<ChatPanel
										messages={messages}
										prompt={prompt}
										setPrompt={setPrompt}
										selectedModel={selectedModel}
										setSelectedModel={setSelectedModel}
										modelOptions={MODEL_OPTIONS}
										selectedFile={selectedFile}
										handleFileChange={setSelectedFile}
										isGenerating={isGenerating}
										onSubmit={handleGenerate}
										onClear={handleClear}
										width={360}
										isOpen={true}
										setIsOpen={setIsChatOpen}
										fileInputRef={fileUploadRef}
										onOpenAuthModal={() => setIsAuthModalOpen(true)}
										selectionContext={selectionContext}
										onClearSelectionContext={() => setSelectionContext(null)}
									/>
								</div>
							</div>

							{/* 2. Resizable Viewport and Settings */}
							<div className="flex-1 h-full overflow-hidden pl-3">
								<PanelGroup id="top-horizontal-v4" orientation="horizontal">

									{/* Center: CAD/CAM Viewport */}
									<Panel defaultSize={70} minSize={40}>
										<div className="h-full w-full bg-card rounded-xl border border-border shadow-2xl overflow-hidden relative">
											{workflowStage === 'blueprint' ? (
												<div
													className="h-full flex flex-col items-center justify-center bg-background relative overflow-hidden"
													onMouseMove={(e) => {
														const rect = e.currentTarget.getBoundingClientRect();
														const x = (e.clientX - rect.left) / rect.width - 0.5;
														const y = (e.clientY - rect.top) / rect.height - 0.5;
														setMousePos({ x, y });
													}}
												>
													<div className="absolute inset-0 bg-[url('/grid.svg')] opacity-5" />

													{/* Faint Hexagon Watermark */}
													<div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none opacity-5 flex items-center justify-center">
														<svg width="600" height="600" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="0.5" strokeLinecap="round" strokeLinejoin="round">
															<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
															<polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline>
															<line x1="12" y1="22.08" x2="12" y2="12"></line>
														</svg>
													</div>

													<div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-blue-500/5 rounded-full blur-[120px] pointer-events-none" />

													<div className="z-10 flex flex-col items-center gap-6 animate-in fade-in zoom-in-95 duration-500">
														<div className="flex items-center gap-3 mb-4">
															<div className="size-2 rounded-full bg-blue-500 shadow-[0_0_12px_rgba(59,130,246,0.5)]" />
															<h2 className="text-[11px] font-bold uppercase tracking-[0.3em] text-blue-400">NO BLUEPRINT LOADED</h2>
														</div>

														<div className="flex flex-col gap-3 w-[320px]">
															<button
																onClick={() => {
																	setIsChatOpen(true);
																	setTimeout(() => fileUploadRef.current?.click(), 100);
																}}
																className="flex items-center gap-4 p-4 rounded-xl border border-border bg-muted/50 hover:bg-muted hover:border-blue-500/30 transition-all text-left group"
															>
																<div className="size-8 rounded-lg bg-black/50 dark:bg-black/50 border border-border flex items-center justify-center shrink-0">
																	<svg className="size-4 text-muted-foreground group-hover:text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
																		<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
																	</svg>
																</div>
																<div>
																	<div className="text-sm font-bold text-foreground group-hover:text-blue-400 transition-colors">Upload Blueprint</div>
																	<div className="text-[10px] text-muted-foreground">PDF, PNG, JPG</div>
																</div>
															</button>

															<button
																onClick={() => setIsSessionBrowserOpen(true)}
																className="flex items-center gap-4 p-4 rounded-xl border border-border bg-muted/50 hover:bg-muted hover:border-blue-500/30 transition-all text-left group"
															>
																<div className="size-8 rounded-lg bg-black/50 dark:bg-black/50 border border-border flex items-center justify-center shrink-0">
																	<History className="size-4 text-muted-foreground group-hover:text-blue-400" />
																</div>
																<div>
																	<div className="text-sm font-bold text-foreground group-hover:text-blue-400 transition-colors">Recent Projects</div>
																	<div className="text-[10px] text-muted-foreground">Resume work</div>
																</div>
															</button>
														</div>
													</div>
													
												</div>
											) : (
												<CadViewport
													hoveredFeatureId={hoveredFeatureId}
													onHoverFeature={setHoveredFeatureId}
													workpieceMaterial={camSetup.material}
													stlUrl={stlUrl}
													statusText={statusText}
													workflowStage={workflowStage}
													isRecompiling={isGenerating}
													hasStl={Boolean(stlUrl)}
													hasStep={Boolean(stepUrl)}
													hasDxf={Boolean(dxfUrl)}
													isDeveloper={false}
													isDownloadingStl={isDownloadingStl}
													isDownloadingStep={isDownloadingStep}
													isDownloadingDxf={isDownloadingDxf}
													onDownloadStl={() => handleDownloadArtifact(stlUrl, 'stl')}
													onDownloadStep={() => handleDownloadArtifact(stepUrl, 'step')}
													onDownloadDxf={() => handleDownloadArtifact(dxfUrl, 'dxf')}
													annotations={annotations}
													activeParameter={activeParameter}
													parameters={parameters}
													geometryInfo={geometryInfo}
													hasGcode={Boolean(false)}
													isDownloadingGcode={isDownloadingGcode}
													onDownloadGcode={() => handleDownloadArtifact(null, 'gcode')}
													isSharing={isSharing}
													onShare={handleShare}
													toolpaths={toolpaths?.filter(t => !t.setupId || t.setupId === (activeSetupId || camSetups[0]?.setupId)) as any}
													showToolpaths={camViewport.showToolpath}
													camFeatures={camFeatures}
													camOperations={camOperations}
													hasBlockedOperations={camOperations.some(op => op.status === 'blocked' || op.status === 'error')}
													activeFeatureId={activeFeatureId}
													simulationState={camSimulation}
													camTools={camTools}
													camSetup={camSetup}
													debugMode={debugMode}
													setupToolAxis={camSetups.find(s => s.setupId === (activeSetupId || camSetups[0]?.setupId))?.toolAxis}
													setupMetadata={{ ...(defaultSetupMetadata || {}), ...(camSetups.find(s => s.setupId === (activeSetupId || camSetups[0]?.setupId)) || {}) }}
													headerActions={
														<div className="flex items-center gap-2">

															{/* Setup Selector */}
															{camSetups.length > 1 && (
																<Select value={activeSetupId || ''} onValueChange={(val: string | null) => val && setActiveSetupId(val)}>
																	<SelectTrigger 
																		className="h-8 rounded-lg border-border bg-muted/50 text-foreground text-[10px] font-bold uppercase tracking-widest hover:bg-muted transition-all"
																		title="Switch active setup to view its toolpaths"
																	>
																		<SelectValue placeholder="Select setup" />
																	</SelectTrigger>
																	<SelectContent>
																		{camSetups.map((s, idx) => (
																			<SelectItem key={s.setupId} value={s.setupId} className="text-xs">
																				{s.setupName || `Setup ${idx + 1}`}
																			</SelectItem>
																		))}
																	</SelectContent>
																</Select>
															)}
															<div className="relative">
																<button
																	onClick={() => setIsWorkspaceMenuOpen(!isWorkspaceMenuOpen)}
																	className="flex items-center gap-2 px-4 py-2 rounded-lg bg-muted/50 border border-border hover:bg-muted text-foreground transition-all pointer-events-auto"
																>
																	<svg className="size-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
																		<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
																	</svg>
																	<span className="text-[10px] font-bold uppercase tracking-widest">Project</span>
																</button>
																{isWorkspaceMenuOpen && (
																	<div className="absolute right-0 mt-2 w-56 rounded-xl border border-border bg-card/95 backdrop-blur-md shadow-xl overflow-hidden z-50 py-1 pointer-events-auto">
																		<button
																			onClick={() => {
																				setIsWorkspaceMenuOpen(false);
																				setIsChatOpen(true);
																				setTimeout(() => fileUploadRef.current?.click(), 100);
																			}}
																			className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-muted transition-colors"
																		>
																			<svg className="size-4 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
																				<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
																			</svg>
																			<div className="flex flex-col">
																				<span className="text-[11px] font-bold uppercase tracking-wider text-foreground">Upload Blueprint</span>
																			</div>
																		</button>

																		<button
																			onClick={() => {
																				setIsWorkspaceMenuOpen(false);
																				setIsSessionBrowserOpen(true);
																			}}
																			className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-muted transition-colors border-t border-border mt-1 pt-2"
																		>
																			<History className="size-4 text-muted-foreground" />
																			<div className="flex flex-col">
																				<span className="text-[11px] font-bold uppercase tracking-wider text-foreground">Recent Projects</span>
																			</div>
																		</button>
																	</div>
																)}
															</div>
														</div>
													}
												>
													{stlUrl ? <StlMesh url={stlUrl} workpieceMaterial={camSetup.material} expectedSize={(() => {
														if (!parameters) return undefined;
														const vals = Object.values(parameters).filter(v => typeof v === 'number') as number[];
														return vals.length > 0 ? Math.max(...vals) : undefined;
													})()} onGeometryReady={setGeometryInfo} onMeshClick={(p) => setSelectionContext(p)} /> : null}
													{selectionContext && (
														<group position={selectionContext}>
															{/* Core dot */}
															<mesh>
																<sphereGeometry args={[0.05, 16, 16]} />
																<meshBasicMaterial color="#ef4444" depthTest={false} transparent opacity={1} />
															</mesh>
															{/* Targeting ring */}
															<mesh>
																<ringGeometry args={[0.1, 0.12, 32]} />
																<meshBasicMaterial color="#ef4444" depthTest={false} transparent opacity={0.6} side={2} />
															</mesh>
														</group>
													)}
												</CadViewport>
											)}
											{/* Bottom Overlay with CAM Metrics */}
											<div className="absolute bottom-4 left-0 right-0 pointer-events-none z-30 flex flex-col p-4 gap-4">
												{/* CAM Metrics Pill */}
												{(workflowStage === 'cam' || workflowStage === 'gcode') && (
													<div className="flex items-center justify-center pointer-events-auto mt-2">
														<div className="relative group">
															{/* Glowing blue underline */}
															<div className="absolute -bottom-[1px] left-8 right-8 h-[2px] bg-blue-500 shadow-[0_0_12px_rgba(59,130,246,1)] z-10" />

															<div className="flex items-center gap-8 bg-muted/40 backdrop-blur-md border border-border/50 px-8 py-3 rounded-xl shadow-2xl relative z-0">

																<div className="flex flex-col gap-1 items-start min-w-[80px]">
																	<span className="text-[9px] uppercase tracking-[0.1em] text-muted-foreground font-bold flex items-center gap-1">
																		Material
																	</span>
																	<span className="text-[11px] font-bold text-blue-500 uppercase">{camSetup.material?.replace(/_/g, ' ') || 'UNKNOWN MATERIAL'}</span>
																</div>

																<div className="w-px h-8 bg-muted/50" />

																<div className="flex flex-col gap-1 items-start min-w-[80px]">
																	<span className="text-[9px] uppercase tracking-[0.1em] text-muted-foreground font-bold flex items-center gap-1">
																		<svg className="size-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" /></svg>
																		Machine
																	</span>
																	<span className="text-[11px] font-bold text-foreground uppercase">{MACHINE_MATRIX.machineProfiles.find(p => p.id === camSetup.machineProfile)?.label || camSetup.machineProfile || 'Generic 3-Axis VMC'}</span>
																</div>

																<div className="w-px h-8 bg-muted/50" />

																<div className="flex flex-col gap-1 items-start min-w-[80px]">
																	<span className="text-[9px] uppercase tracking-[0.1em] text-muted-foreground font-bold flex items-center gap-1">
																		<svg className="size-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><rect x="2" y="3" width="20" height="14" rx="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" /></svg>
																		Controller
																	</span>
																	<span className="text-[11px] font-bold text-foreground uppercase">{MACHINE_MATRIX.controllers[(camSetup.controller as ControllerId) || 'FANUC_0I_MF']?.label || camSetup.controller || 'FANUC'}</span>
																</div>

																<div className="w-px h-8 bg-muted/50" />

																<div className="flex flex-col gap-1 items-center min-w-[60px]">
																	<span className="text-[9px] uppercase tracking-[0.1em] text-muted-foreground font-bold">Features</span>
																	<span className="text-[12px] font-bold text-cyan-400">{camFeatures.length}</span>
																</div>

																<div className="flex flex-col gap-1 items-center min-w-[60px]">
																	<span className="text-[9px] uppercase tracking-[0.1em] text-muted-foreground font-bold">Tools</span>
																	<span className="text-[12px] font-bold text-green-500">{camTools.length}</span>
																</div>

																<div className="flex flex-col gap-1 items-center min-w-[60px]">
																	<span className="text-[9px] uppercase tracking-[0.1em] text-muted-foreground font-bold">Ops</span>
																	<span className="text-[12px] font-bold text-purple-500">{camOperations.length}</span>
																</div>

																<div className="w-px h-8 bg-muted/50" />

																<div className="flex flex-col gap-1 items-start min-w-[80px]">
																	<span className="text-[9px] uppercase tracking-[0.1em] text-muted-foreground font-bold flex items-center gap-1">
																		<svg className="size-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
																		Cycle Time
																	</span>
																	<span className="text-[11px] font-bold text-yellow-500 uppercase">
																		{(() => {
																			const opsTime = camOperations.reduce((acc, op) => acc + (op.estimated_time_s || op.statistics?.cycleTimeSeconds || 0), 0);
																			const totalCycleTimeSeconds = plannedCycleTimeSeconds > opsTime ? plannedCycleTimeSeconds : (opsTime || plannedCycleTimeSeconds);
																			if (!totalCycleTimeSeconds) return '00:00';
																			const m = Math.floor(totalCycleTimeSeconds / 60);
																			const s = Math.floor(totalCycleTimeSeconds % 60);
																			return `${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`;
																		})()}
																	</span>
																</div>

																<div className="flex flex-col gap-1 items-start min-w-[80px]">
																	<span className="text-[9px] uppercase tracking-[0.1em] text-muted-foreground font-bold flex items-center gap-1">
																		<svg className="size-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" /></svg>
																		Removal
																	</span>
																	<span className="text-[11px] font-bold text-foreground uppercase">82%</span>
																</div>

																<div className="ml-4 flex items-center">
																	<button className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-green-500/30 bg-green-500/10 text-green-500 hover:bg-green-500/20 transition-colors">
																		<svg className="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
																			<polyline points="20 6 9 17 4 12" />
																		</svg>
																		<span className="text-[10px] font-bold uppercase tracking-widest">Ready</span>
																	</button>
																</div>
															</div>
														</div>
													</div>
												)}
											</div>

											{/* Modals & Overlays */}

										</div>
									</Panel>

									<PanelResizeHandle className="w-3 relative group flex items-center justify-center cursor-col-resize z-50">
										<div className="w-1 h-8 rounded-full bg-transparent group-hover:bg-blue-500/50 transition-colors" />
									</PanelResizeHandle>

									{/* Right: Workspace Settings */}
									<Panel defaultSize={30} minSize={20}>
										<div className="h-full w-full glass-panel bg-card/40 rounded-xl overflow-hidden relative flex flex-col">
											{/* Segmented Control Header */}
											<div className="flex h-14 shrink-0 items-center justify-center px-4 border-b border-border/50 bg-background/50 dark:bg-background/20 backdrop-blur-md">
												<div className="flex bg-black/5 dark:bg-black/40 p-1 rounded-lg border border-black/5 dark:border-white/5 w-full max-w-[280px]">
													<button
														onClick={() => setActiveRightTab('cad')}
														className={`flex-1 py-1.5 px-3 text-[11px] font-bold tracking-widest uppercase rounded-md transition-all duration-200 ${
															activeRightTab === 'cad'
																? 'bg-blue-100/50 dark:bg-blue-500/20 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-500/30 shadow-sm dark:shadow-[0_0_15px_rgba(59,130,246,0.15)]'
																: 'text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5 border border-transparent'
														}`}
													>
														📐 CAD Design
													</button>
													<button
														onClick={() => setActiveRightTab('cam')}
														className={`flex-1 py-1.5 px-3 text-[11px] font-bold tracking-widest uppercase rounded-md transition-all duration-200 ${
															activeRightTab === 'cam'
																? 'bg-amber-100/50 dark:bg-amber-500/20 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-500/30 shadow-sm dark:shadow-[0_0_15px_rgba(245,158,11,0.15)]'
																: 'text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5 border border-transparent'
														}`}
													>
														⚙️ CAM Setup
													</button>
												</div>
											</div>

											{/* Tab Content */}
											<div className="flex-1 overflow-y-auto">
												{activeRightTab === 'cad' && (
													<WorkspaceSettings
														workflowStage={workflowStage}
														parameters={parameters}
														activeParameter={activeParameter}
														onParameterSelect={setActiveParameter}
														onParameterChange={(key, val) => {
															const newParams = setParameterValue(parameters, key, val);
															setParameters(newParams);
															const newScript = injectParameters(pythonScript, newParams);
															updatePythonScript(newScript);
															void performSync(newScript, newParams, sessionId || '');
														}}
														parameterMetadata={parameterMetadata}
														camSetup={camSetup}
														setCamSetup={setCamSetup}
														pythonScript={pythonScript}
													/>
												)}

												{activeRightTab === 'cam' && (
													<div className="p-5">
														<CamSummaryPanel 
															setup={camSetup as any} 
															setups={camSetups}
															tools={camTools} 
															operations={camOperations}
															features={camFeatures}
															coordValidation={coordValidation}
															onClickSection={() => {}}
														/>
													</div>
												)}
											</div>
										</div>
									</Panel>
								</PanelGroup>
							</div>
						</div>
					</Panel>

					<PanelResizeHandle className="h-3 relative group flex items-center justify-center cursor-row-resize z-50">
						<div className="h-1 w-8 rounded-full bg-muted group-hover:bg-blue-500/50 transition-colors" />
					</PanelResizeHandle>

					{/* Bottom: Engineering Console */}
					<Panel defaultSize={25} minSize={10}>
						<div className="h-full w-full bg-card rounded-xl border border-border overflow-hidden relative">
							<EngineeringConsole
								sourceFilename={sourceFilename}
								workflowStage={workflowStage}
								camSetup={camSetup}
								camSetups={camSetups}
								activeSetupId={activeSetupId}
								setCamSetup={setCamSetup}
								camTools={camTools}
								setCamTools={setCamTools}
								onGenerateGCode={handleGenerateGCode}
								onGenerateToolpaths={handleGenerateToolpaths}
								isGeneratingGcode={isGeneratingGcode}
								gcodeContent={gcodeContent}
								klartextContent={klartextContent}
								gcodeErrors={gcodeErrors}
								camFeatures={camFeatures}
								setCamFeatures={setCamFeatures}
								activeFeatureId={activeFeatureId}
								setActiveFeatureId={setActiveFeatureId}
								onAutoGenerateOperations={handleAutoGenerateOperations}
								onRunFeatureRecognition={handleAnalyzeFeatures}
								camOperations={camOperations}
								setCamOperations={setCamOperations}
								activeOperationId={activeOperationId}
								setActiveOperationId={setActiveOperationId}
								selectedOperationIds={selectedOperationIds}
								setSelectedOperationIds={setSelectedOperationIds}
								camSimulation={camSimulation}
								setCamSimulation={setCamSimulation}
								toolpathValid={coordValidation?.status !== 'error'}
								toolpathsStale={false}
								camReadinessScore={camReadinessScore}
								camStatus={camStatus}
								canGenerateGcode={canGenerateGcode}
								parameters={parameters}
								setupMetadata={{
									...(defaultSetupMetadata || {}),
									topology: {
										...(defaultSetupMetadata?.topology || {}),
										bounds: geometryInfo?.bounding_box ? [
											geometryInfo.bounding_box.min[0],
											geometryInfo.bounding_box.min[1],
											geometryInfo.bounding_box.min[2],
											geometryInfo.bounding_box.max[0],
											geometryInfo.bounding_box.max[1],
											geometryInfo.bounding_box.max[2],
										] : defaultSetupMetadata?.topology?.bounds
									}
								}}
								camValidation={undefined}
							/>
						</div>
					</Panel>
				</PanelGroup>


				<SessionBrowserModal
					isOpen={isSessionBrowserOpen}
					onClose={() => setIsSessionBrowserOpen(false)}
					onSelectSession={handleRestoreSession}
				/>
				<HistoryDrawer
					isOpen={isHistoryOpen}
					onClose={() => setIsHistoryOpen(false)}
					onRestore={handleRestoreSession}
				/>
			</main>
			<AuthModal
				isOpen={isAuthModalOpen}
				onClose={() => setIsAuthModalOpen(false)}
				developerUsername={developerUsername}
				developerPassword={developerPassword}
				developerAuthError={developerAuthError}
				onDeveloperUsernameChange={setDeveloperUsername}
				onDeveloperPasswordChange={setDeveloperPassword}
				onDeveloperLogin={handleDeveloperLogin}
			/>
		</div>
	);
}




