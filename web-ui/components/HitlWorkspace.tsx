'use client';

import JSON5 from 'json5';
import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { AuthModal } from './AuthModal';
import { toast } from 'sonner';

import { CamSummaryPanel } from './cam/CamSummaryPanel';
import { CadViewport } from './CadViewport';
import { StlMesh, type StlGeometryInfo } from './StlMesh';
import { HistoryDrawer } from './HistoryDrawer';
import { WorkflowNav } from './WorkflowNav';
import { WorkspaceSettings } from './WorkspaceSettings';
import { EngineeringConsole } from './EngineeringConsole';
import { ChatPanel } from './ChatPanel';
import { SessionBrowserModal } from './SessionBrowserModal';
import { Group as PanelGroup, Panel, Separator as PanelResizeHandle } from 'react-resizable-panels';
import { History } from 'lucide-react';
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

const DEFAULT_PROMPT = 'generate a 3D model of the attached file.';
const DEFAULT_MODEL = 'gemini-3.1-flash-lite';
const MODEL_OPTIONS = [
	{ value: 'gemini-3.1-flash-lite', label: 'gemini-3.1-flash-lite' },
	{ value: 'gemini-3.5-flash', label: 'gemini-3.5-flash' },
];

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
		.replace(/\bNone\b/g, 'null');

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
	const stepUploadRef = useRef<HTMLInputElement>(null);
	const [messages, setMessages] = useState<ChatMessage[]>([
		{
			id: 'system_welcome',
			role: 'system',
			content: 'Upload a blueprint, pick a model, and hit Generate.',
		},
	]);
	const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
	const [selectedModel, setSelectedModel] = useState(DEFAULT_MODEL);
	const [selectedFile, setSelectedFile] = useState<File | null>(null);
	const [isGenerating, setIsGenerating] = useState(false);
	const [isRecompiling, setIsRecompiling] = useState(false);
	const [isDrawerOpen, setIsDrawerOpen] = useState(true);
	const [sessionId, setSessionId] = useState<string | null>(null);
	const [pythonScript, setPythonScript] = useState('');
	const [activeDrawerTab, setActiveDrawerTab] = useState<DrawerTab>('parameters');
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

	// CAM Parameters State
	const [camSetup, setCamSetup] = useState<SetupSettings>({
		units: 'mm',
		machine: 'Haas VF-2 (3-Axis)',
		stockType: 'box',
		material: 'aluminum_6061',
		stockDimensions: [100, 100, 20],
		wcs: 'G54',
		originPosition: 'top_center',
		tolerance: 0.01,
		stockOffset: 2,
	});
	const [camSetups, setCamSetups] = useState<CamSetupPlan[]>([]);
	const [activeSetupId, setActiveSetupId] = useState<string | null>(null);
	const [camTools, setCamTools] = useState<Tool[]>([
		{ id: 't1', number: 'T1', type: 'flat_end_mill', diameter: 3.175, flutes: 2, stickout: 15, material: 'carbide' }
	]);
	const [camOperations, setCamOperations] = useState<CamOperation[]>([]);
	const [activeOperationId, setActiveOperationId] = useState<string | null>(null);
	const [camFeatures, setCamFeatures] = useState<CamFeature[]>([]);
	const [activeFeatureId, setActiveFeatureId] = useState<string | null>(null);
	const [coordValidation, setCoordValidation] = useState<any>(null);
	const [camSimulation, setCamSimulation] = useState<SimulationState>({ isPlaying: false, progress: 0, speed: 1 });
	const [camViewport, setCamViewport] = useState<ViewportSettings>({ showStock: false, showTool: true, showToolpath: true, showOrigin: true, showAxes: true });
	const [controller, setController] = useState<string>('grbl');
	const [gcodeContent, setGcodeContent] = useState<string | null>(null);
	const [isGeneratingGcode, setIsGeneratingGcode] = useState(false);

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
	const [activeParameter, setActiveParameter] = useState<string | null>(null);
	const [geometryInfo, setGeometryInfo] = useState<StlGeometryInfo | null>(null);
	const [mousePos, setMousePos] = useState({ x: 0, y: 0 });

	const parameterEntries = Object.entries(parameters).filter(([_, v]) => typeof v === 'number' || typeof v === 'string');

	const handleShare = async () => {
		if (!sessionId) return;
		setIsSharing(true);
		try {
			const res = await fetch(`/api/sessions/${sessionId}/share`, { method: 'POST' });
			if (!res.ok) throw new Error('Failed to create share link');
			const data = await res.json();
			const url = `${window.location.origin}/share/${data.id}`;
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
			setCamSimulation(prev => ({
				...prev,
				segments: toolpaths,
				progress: 0,
				activeSegmentIndex: 0,
				isPlaying: false
			}));
		}
	}, [toolpaths]);

	const handleStepUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
		const file = event.target.files?.[0];
		if (!file) return;

		setStatusText('Importing STEP File...');
		setWorkflowStage('cad');
		setIsRecompiling(true);
		
		const formData = new FormData();
		formData.append('file', file);

		try {
			// Proxy the request through our Next.js API route to save to DB
			const response = await fetch('/api/import_step', {
				method: 'POST',
				body: formData
			});

			if (!response.ok) throw new Error('Failed to import STEP file');
			
			const data = await response.json();
			if (data.session_id) setSessionId(data.session_id);
			if (data.script) updatePythonScript(data.script);
			
			if (data.artifacts) {
				const backendUrl = 'http://localhost:8001';
				if (data.artifacts.stl_url) setStlUrl(backendUrl + data.artifacts.stl_url);
				if (data.artifacts.step_url) setStepUrl(backendUrl + data.artifacts.step_url);
				if (data.artifacts.dxf_url) setDxfUrl(backendUrl + data.artifacts.dxf_url);
				if (data.artifacts.gcode_url) setGcodeUrl(backendUrl + data.artifacts.gcode_url);
				if (data.artifacts.annotations) {
					setAnnotations(data.artifacts.annotations);
					const annotationsAny = data.artifacts.annotations as any;
					const featuresUrl = annotationsAny.cam_features_url as string | undefined;
					if (featuresUrl) {
						try {
							const resolvedUrl = backendUrl + featuresUrl;
							const featuresRes = await fetch(resolvedUrl);
							if (featuresRes.ok) {
								const featuresData = await featuresRes.json();
								setCamFeatures(featuresData || []);
							} else {
								setCamFeatures([]);
							}
						} catch (e) {
							console.error("Failed to load CAM features:", e);
							setCamFeatures([]);
						}
					} else {
						setCamFeatures(data.artifacts.features || []);
					}
				} else {
					setCamFeatures(data.artifacts.features || []);
				}
				
				const features = data.artifacts.features || [];
				if (features.length > 0) {
					setCamOperations([
						{
							id: 'op1',
							name: 'Profile',
							type: '2d_contour',
							toolId: 't1',
							featureId: features[0].id,
							parameters: { feedRate: 800, plungeRate: 200, maxStepdown: 1.0, totalDepth: 5.0, spindleSpeed: 12000, stepoverPercentage: 40, tolerance: 0.01, coolant: 'off' }
						}
					]);
					setActiveOperationId('op1');
				} else {
					setCamOperations([]);
					setActiveOperationId(null);
				}
				setGcodeContent(null);
			}
			
			toast.success('STEP file imported successfully');
			setStatusText('Ready');
		} catch (error: any) {
			toast.error('Failed to import STEP', { description: error.message });
			setStatusText('Failed to import STEP');
		} finally {
			setIsRecompiling(false);
			if (stepUploadRef.current) stepUploadRef.current.value = '';
		}
	};

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
		formData.append('model_name', selectedModel);

		// Clear input fields after securing the payload
		setPrompt('');
		setSelectedFile(null);

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
						controller: controller,
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
			if (payload.artifacts?.stl_url) {
				setStlUrl(resolveModelUrl(payload.artifacts.stl_url, Date.now().toString()));
				setWorkflowStage(prev => (prev === 'blueprint' || prev === 'extraction' ? 'cad' : prev));
				
				// Clear CAM state on new CAD model
				setCamModelHash(null);
				setCadModelHash(payload.artifacts?.model_hash || null);
				setToolpaths(null);
				setCamFeatures(payload.artifacts?.features || []);
				setCamOperations([]);
				setGcodeContent(null);
				setGcodeUrl(null);
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
				}),
			});

			if (!response.ok) {
				const errorMsg = await readErrorFromResponse(response, 'G-Code generation failed.');
				throw new Error(errorMsg);
			}

			const payload = await response.json();

			if (payload.gcode) {
				setGcodeContent(payload.gcode);
			}

			setWorkflowStage('gcode');
			setStatusText('G-Code generated successfully.');
			toast.success('G-Code generated with full CAM configuration');
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
			const res = await fetch(`${backendUrl}/api/v1/cam/toolpaths`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					session_id: sessionId,
					job_id: sessionId,
					cam_run_id: runId,
					setup: camSetup,
					tools: camTools,
					operations: camOperations,
					modelHash: cadModelHash || ""
				})
			});

			if (!res.ok) {
				const errorMsg = await readErrorFromResponse(res, 'Toolpath generation failed.');
				throw new Error(errorMsg);
			}

			const data = await res.json();
			if (latestCamRunId.current === runId) {
				setToolpaths(data.toolpaths || []);
				if (data.operations) {
					setCamOperations(data.operations);
				}
				if (data.coordinate_validation) {
					setCoordValidation(data.coordinate_validation);
				}
				if (data.camModelHash) {
					setCamModelHash(data.camModelHash);
				}
				setStatusText('Toolpaths generated successfully.');
				toast.success('Toolpaths generated');
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
				body: JSON.stringify({ session_id: sessionId })
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
			toast.error('No session active. Please import a STEP file first.');
			return;
		}

		setIsGenerating(true);
		setStatusText('Auto Planning CAM...');

		try {
			const backendUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8001';
			const res = await fetch(`${backendUrl}/api/v1/cam/auto_plan`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					session_id: sessionId,
					job_id: sessionId,
					machine_config: {
						machine_capability: {
							turning: false,
							milling_3axis: true,
							drilling: true,
							pocketing: true,
							indexed_4axis: false,
							continuous_4axis: false,
							milling_5axis: false,
							mill_turn: false
						}
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
			
			if (data.tools) {
				// Map backend tools to frontend Tools
				const newTools = data.tools.map((t: any, i: number) => ({
					id: t.id,
					dbId: t.id,
					name: t.name || `Auto Tool ${i+1}`,
					number: `T${camTools.length + i + 1}`,
					type: t.type as ToolType,
					diameter: t.diameter || 3.175,
					flutes: t.flutes || 2,
					stickout: t.stickout || 20,
					material: (t.material?.material_code || 'carbide') as ToolMaterial,
					coating: t.coating?.coating_name
				}));
				setCamTools(prev => {
					// Add only tools that don't exist yet
					const existingIds = new Set(prev.map(p => p.dbId));
					const toAdd = newTools.filter((nt: any) => !existingIds.has(nt.dbId));
					return [...prev, ...toAdd];
				});
			}

			if (data.operations && data.operations.length > 0) {
				// Map operations
				const newOps: CamOperation[] = data.operations.map((op: any, i: number) => ({
					id: op.id || `op_auto_${Date.now()}_${i}`,
					name: op.name || `${op.type || op.operation_type} Operation`,
					type: (op.type || op.operation_type) as OperationType,
					toolId: op.tool_id || 't1', // fallback
					feature_id: op.feature_id,
					setup_id: op.setup_id,
					status: op.status,
					parameters: op.parameters || {
						feedRate: 1000,
						plungeRate: 300,
						maxStepdown: 2.0,
						spindleSpeed: 10000,
						stepoverPercentage: 40,
						tolerance: 0.01,
						coolant: 'flood'
					}
				}));
				setCamOperations(newOps);
				setActiveOperationId(newOps[0].id);
				toast.success(`Generated ${newOps.length} operations across ${data.setups?.length || 0} setups`);
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
			const filename = url.split('/').pop()?.split('?')[0] || `model.${label}`;
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
			{ id: makeId('system'), role: 'system', content: `Restoring session: ${session.prompt}` }
		]);

		setIsHistoryOpen(false);
		setActiveDrawerTab('parameters');
		setIsDrawerOpen(true);
		setStatusText('Restoring session and rebuilding geometry...');

		// Always trigger a sync to ensure the environment matches the script
		await performSync(session.pythonScript, session.parameters || {}, session.id);

		toast.success('Session restored');
	};

	const hasStl = Boolean(stlUrl);
	const hasStep = Boolean(stepUrl);
	const hasDxf = Boolean(dxfUrl);


	const handleClear = () => {
		setMessages([
			{
				id: 'system_welcome',
				role: 'system',
				content: 'Upload a blueprint, pick a model, and hit Generate.',
			},
		]);
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
		setActiveParameter(null);
		setStatusText('Ready');
		setWorkflowStage('blueprint');
		toast.info('Session cleared');
	};

	return (
		<div className="h-screen w-full bg-[#050814] text-foreground overflow-hidden flex flex-col p-3">
			<main className="flex-1 flex overflow-hidden w-full gap-0 relative">
				<PanelGroup id="workspace-layout-v5" orientation="vertical">
					{/* Top: Navigation + Viewport + Settings */}
					<Panel defaultSize={70} minSize={40}>
						<div className="h-full w-full flex">

							{/* 1. Left Navigation (Fixed Width) */}
							<div className="w-[260px] shrink-0 h-full overflow-hidden flex flex-col z-10 border-r border-white/5 bg-[#050814]">
								<WorkflowNav
									workflowStage={workflowStage}
									setWorkflowStage={setWorkflowStage}
								/>
							</div>

							{/* 2. Resizable Viewport and Settings */}
							<div className="flex-1 h-full overflow-hidden pl-3">
								<PanelGroup id="top-horizontal-v4" orientation="horizontal">

									{/* Center: CAD/CAM Viewport */}
									<Panel defaultSize={70} minSize={40}>
										<div className="h-full w-full bg-[#0a0f1c] rounded-xl border border-[#1e293b] shadow-2xl overflow-hidden relative">
											{workflowStage === 'blueprint' ? (
												<div
													className="h-full flex flex-col items-center justify-center bg-[#070b14] relative overflow-hidden"
													onMouseMove={(e) => {
														const rect = e.currentTarget.getBoundingClientRect();
														const x = (e.clientX - rect.left) / rect.width - 0.5;
														const y = (e.clientY - rect.top) / rect.height - 0.5;
														setMousePos({ x, y });
													}}
												>
													<div className="absolute inset-0 bg-[url('/grid.svg')] opacity-5" />

													{/* AI Assistant Button in Empty State */}
													<div className="absolute top-4 right-4 z-50">
														<button
															onClick={() => setIsChatOpen(true)}
															className="flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600/90 hover:bg-blue-500 text-white shadow-[0_0_15px_rgba(37,99,235,0.3)] transition-all pointer-events-auto"
														>
															<svg className="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor">
																<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
															</svg>
															<span className="text-[10px] font-bold uppercase tracking-widest">AI Assistant</span>
														</button>
													</div>

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
																className="flex items-center gap-4 p-4 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 hover:border-blue-500/30 transition-all text-left group"
															>
																<div className="size-8 rounded-lg bg-black/50 border border-white/5 flex items-center justify-center shrink-0">
																	<svg className="size-4 text-muted-foreground group-hover:text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
																		<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
																	</svg>
																</div>
																<div>
																	<div className="text-sm font-bold text-white group-hover:text-blue-400 transition-colors">Upload Blueprint</div>
																	<div className="text-[10px] text-muted-foreground">PDF, PNG, JPG</div>
																</div>
															</button>
															<button
																onClick={() => stepUploadRef.current?.click()}
																className="flex items-center gap-4 p-4 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 hover:border-blue-500/30 transition-all text-left group"
															>
																<div className="size-8 rounded-lg bg-black/50 border border-white/5 flex items-center justify-center shrink-0">
																	<svg className="size-4 text-muted-foreground group-hover:text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
																		<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 13h6m-3-3v6m-9 1V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
																	</svg>
																</div>
																<div>
																	<div className="text-sm font-bold text-white group-hover:text-blue-400 transition-colors">Import STEP File</div>
																	<div className="text-[10px] text-muted-foreground">Direct 3D import</div>
																</div>
															</button>
															<button
																onClick={() => setIsSessionBrowserOpen(true)}
																className="flex items-center gap-4 p-4 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 hover:border-blue-500/30 transition-all text-left group"
															>
																<div className="size-8 rounded-lg bg-black/50 border border-white/5 flex items-center justify-center shrink-0">
																	<History className="size-4 text-muted-foreground group-hover:text-blue-400" />
																</div>
																<div>
																	<div className="text-sm font-bold text-white group-hover:text-blue-400 transition-colors">Recent Projects</div>
																	<div className="text-[10px] text-muted-foreground">Resume work</div>
																</div>
															</button>
														</div>
													</div>
													
												</div>
											) : (
												<CadViewport
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
													activeParameter={null}
													geometryInfo={null}
													hasGcode={Boolean(false)}
													isDownloadingGcode={isDownloadingGcode}
													onDownloadGcode={() => handleDownloadArtifact(null, 'gcode')}
													isSharing={isSharing}
													onShare={handleShare}
													toolpaths={toolpaths?.filter(t => t.setupId === (activeSetupId || camSetups[0]?.setupId)) as any}
													showToolpaths={camViewport.showToolpath}
													camFeatures={camFeatures}
													hasBlockedOperations={camOperations.some(op => op.status === 'blocked' || op.status === 'error')}
													activeFeatureId={activeFeatureId}
													simulationState={camSimulation}
													camTools={camTools}
													debugMode={debugMode}
													headerActions={
														<div className="flex items-center gap-2">
															{/* Debug Mode Toggle */}
															<button
																onClick={() => setDebugMode(!debugMode)}
																className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border transition-all pointer-events-auto text-[10px] font-bold uppercase tracking-widest ${
																	debugMode
																		? 'bg-orange-500/20 border-orange-500/40 text-orange-400 hover:bg-orange-500/30'
																		: 'bg-white/5 border-white/10 text-white/50 hover:bg-white/10 hover:text-white'
																}`}
																title={debugMode ? 'Debug mode ON — showing all geometry' : 'Debug mode OFF — showing clean toolpaths only'}
															>
																<svg className="size-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
																	<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
																</svg>
																Debug
															</button>
															{/* Setup Selector */}
															{camSetups.length > 1 && (
																<select
																	value={activeSetupId || ''}
																	onChange={(e) => setActiveSetupId(e.target.value)}
																	className="px-3 py-1.5 rounded-lg border border-white/10 bg-white/5 text-white text-[10px] font-bold uppercase tracking-widest hover:bg-white/10 transition-all pointer-events-auto appearance-none cursor-pointer"
																	title="Switch active setup to view its toolpaths"
																>
																	{camSetups.map((s, idx) => (
																		<option key={s.setupId} value={s.setupId} className="bg-[#0a0f1c] text-white">
																			{s.setupName || `Setup ${idx + 1}`}
																		</option>
																	))}
																</select>
															)}
															<div className="relative">
																<button
																	onClick={() => setIsWorkspaceMenuOpen(!isWorkspaceMenuOpen)}
																	className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 text-white transition-all pointer-events-auto"
																>
																	<svg className="size-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
																		<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
																	</svg>
																	<span className="text-[10px] font-bold uppercase tracking-widest">Project</span>
																</button>
																{isWorkspaceMenuOpen && (
																	<div className="absolute right-0 mt-2 w-56 rounded-xl border border-white/10 bg-[#0a0f1c]/95 backdrop-blur-md shadow-xl overflow-hidden z-50 py-1 pointer-events-auto">
																		<button
																			onClick={() => {
																				setIsWorkspaceMenuOpen(false);
																				setIsChatOpen(true);
																				setTimeout(() => fileUploadRef.current?.click(), 100);
																			}}
																			className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-white/10 transition-colors"
																		>
																			<svg className="size-4 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
																				<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
																			</svg>
																			<div className="flex flex-col">
																				<span className="text-[11px] font-bold uppercase tracking-wider text-white">Upload Blueprint</span>
																			</div>
																		</button>
																		<button
																			onClick={() => {
																				setIsWorkspaceMenuOpen(false);
																				stepUploadRef.current?.click();
																			}}
																			className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-white/10 transition-colors"
																		>
																			<svg className="size-4 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
																				<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 13h6m-3-3v6m-9 1V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
																			</svg>
																			<div className="flex flex-col">
																				<span className="text-[11px] font-bold uppercase tracking-wider text-white">Import STEP File</span>
																			</div>
																		</button>
																		<button
																			onClick={() => {
																				setIsWorkspaceMenuOpen(false);
																				setIsSessionBrowserOpen(true);
																			}}
																			className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-white/10 transition-colors border-t border-white/5 mt-1 pt-2"
																		>
																			<History className="size-4 text-muted-foreground" />
																			<div className="flex flex-col">
																				<span className="text-[11px] font-bold uppercase tracking-wider text-white">Recent Projects</span>
																			</div>
																		</button>
																	</div>
																)}
															</div>
															<button
																onClick={() => setIsChatOpen(true)}
																className="flex items-center gap-2 px-4 py-2 mr-2 rounded-lg bg-blue-600/90 hover:bg-blue-500 text-white shadow-[0_0_15px_rgba(37,99,235,0.3)] transition-all pointer-events-auto"
															>
																<svg className="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor">
																	<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
																</svg>
																<span className="text-[10px] font-bold uppercase tracking-widest">AI Assistant</span>
															</button>
														</div>
													}
												>
													{stlUrl ? <StlMesh url={stlUrl} onGeometryReady={() => { }} /> : null}
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

															<div className="flex items-center gap-8 bg-[#030408]/40 backdrop-blur-md border border-[#1e293b]/50 px-8 py-3 rounded-xl shadow-2xl relative z-0">

																<div className="flex flex-col gap-1 items-start min-w-[80px]">
																	<span className="text-[9px] uppercase tracking-[0.1em] text-muted-foreground font-bold flex items-center gap-1">
																		Material
																	</span>
																	<span className="text-[11px] font-bold text-blue-500 uppercase">{camSetup.material.replace('_', ' ')}</span>
																</div>

																<div className="w-px h-8 bg-white/5" />

																<div className="flex flex-col gap-1 items-start min-w-[80px]">
																	<span className="text-[9px] uppercase tracking-[0.1em] text-muted-foreground font-bold flex items-center gap-1">
																		<svg className="size-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" /></svg>
																		Machine
																	</span>
																	<span className="text-[11px] font-bold text-white uppercase">{camSetup.machine}</span>
																</div>

																<div className="w-px h-8 bg-white/5" />

																<div className="flex flex-col gap-1 items-start min-w-[80px]">
																	<span className="text-[9px] uppercase tracking-[0.1em] text-muted-foreground font-bold flex items-center gap-1">
																		<svg className="size-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><rect x="2" y="3" width="20" height="14" rx="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" /></svg>
																		Controller
																	</span>
																	<span className="text-[11px] font-bold text-white uppercase">{controller}</span>
																</div>

																<div className="w-px h-8 bg-white/5" />

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

																<div className="w-px h-8 bg-white/5" />

																<div className="flex flex-col gap-1 items-start min-w-[80px]">
																	<span className="text-[9px] uppercase tracking-[0.1em] text-muted-foreground font-bold flex items-center gap-1">
																		<svg className="size-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
																		Cycle Time
																	</span>
																	<span className="text-[11px] font-bold text-yellow-500 uppercase">06:24</span>
																</div>

																<div className="flex flex-col gap-1 items-start min-w-[80px]">
																	<span className="text-[9px] uppercase tracking-[0.1em] text-muted-foreground font-bold flex items-center gap-1">
																		<svg className="size-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" /></svg>
																		Removal
																	</span>
																	<span className="text-[11px] font-bold text-white uppercase">82%</span>
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
											<input
												type="file"
												ref={stepUploadRef}
												accept=".step,.stp"
												className="hidden"
												onChange={handleStepUpload}
											/>
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
												onClear={() => {
													setMessages([{ id: makeId('system'), role: 'system', content: 'Upload a blueprint, pick a model, and hit Generate.' }]);
													setPrompt(DEFAULT_PROMPT);
													setSelectedFile(null);
													setWorkflowStage('blueprint');
												}}
												width={chatWidth}
												isOpen={isChatOpen}
												setIsOpen={setIsChatOpen}
												fileInputRef={fileUploadRef}
												onOpenAuthModal={() => setIsAuthModalOpen(true)}
											/>
										</div>
									</Panel>

									<PanelResizeHandle className="w-3 relative group flex items-center justify-center cursor-col-resize z-50">
										<div className="w-1 h-8 rounded-full bg-transparent group-hover:bg-blue-500/50 transition-colors" />
									</PanelResizeHandle>

									{/* Right: Workspace Settings */}
									<Panel defaultSize={30} minSize={20}>
										<div className="h-full w-full bg-[#0a0f1c] rounded-xl border border-white/5 overflow-hidden relative">
											<WorkspaceSettings
												workflowStage={workflowStage}
												parameters={parameters}
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
												controller={controller}
												setController={setController}
												pythonScript={pythonScript}
												camSummaryElement={
													(workflowStage === 'cad' || workflowStage === 'cam' || workflowStage === 'gcode') ? (
														<CamSummaryPanel 
															setup={camSetup as any} 
															setups={camSetups}
															tools={camTools} 
															operations={camOperations}
															features={camFeatures}
															coordValidation={coordValidation}
															onClickSection={() => {}}
														/>
													) : undefined
												}
											/>
										</div>
									</Panel>
								</PanelGroup>
							</div>
						</div>
					</Panel>

					<PanelResizeHandle className="h-3 relative group flex items-center justify-center cursor-row-resize z-50">
						<div className="h-1 w-8 rounded-full bg-white/10 group-hover:bg-blue-500/50 transition-colors" />
					</PanelResizeHandle>

					{/* Bottom: Engineering Console */}
					<Panel defaultSize={25} minSize={10}>
						<div className="h-full w-full bg-[#0a0f1c] rounded-xl border border-[#1e293b] overflow-hidden relative">
							<EngineeringConsole
								workflowStage={workflowStage}
								camSetup={camSetup}
								setCamSetup={setCamSetup}
								controller={controller}
								setController={setController}
								camTools={camTools}
								setCamTools={setCamTools}
								onGenerateGCode={handleGenerateGCode}
								onGenerateToolpaths={handleGenerateToolpaths}
								isGeneratingGcode={isGeneratingGcode}
								gcodeContent={gcodeContent}
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
								camSimulation={camSimulation}
								setCamSimulation={setCamSimulation}
								coordValidation={coordValidation}
							/>
						</div>
					</Panel>
				</PanelGroup>

				<input
					type="file"
					ref={stepUploadRef}
					accept=".step,.stp"
					className="hidden"
					onChange={handleStepUpload}
				/>
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
