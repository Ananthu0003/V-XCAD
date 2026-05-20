'use client';

import JSON5 from 'json5';
import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { ChatPanel } from './ChatPanel';
import { CadViewport } from './CadViewport';
import { EditorDrawer } from './EditorDrawer';
import { ParameterInput } from './ParameterInput';
import { StlMesh, type StlGeometryInfo } from './StlMesh';
import { HistoryDrawer } from './HistoryDrawer';
import { History } from 'lucide-react';

type ChatRole = 'user' | 'assistant' | 'system';

type ChatMessage = {
	id: string;
	role: ChatRole;
	content: string;
};

type RenderPayload = {
	stl_url?: string;
	step_url?: string;
	dxf_url?: string;

	status?: string;
	job_id?: string;
	error?: {
		message?: string;
		hint?: string;
	};
	artifacts?: {
		stl_url?: string;
		step_url?: string;
		dxf_url?: string;
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

type DrawerTab = 'parameters' | 'code';

const DEFAULT_PROMPT = 'generate a 3D model of the attached file.';
const DEFAULT_MODEL = 'gemini-3.1-flash-lite-preview';
const MODEL_OPTIONS = [
	{ value: 'gemini-3.1-flash-lite-preview', label: 'gemini-3.1-flash-lite (Default / Recommended)' },
	{ value: 'gemini-3-flash-preview', label: 'gemini-3-flash' },
	{ value: 'gemini-2.5-flash-lite', label: 'gemini-2.5-flash-lite' },
	{ value: 'gemini-2.5-flash', label: 'gemini-2.5-flash' },
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
	const isResizing = useRef(false);
	const [messages, setMessages] = useState<ChatMessage[]>([
		{
			id: 'system_welcome',
			role: 'system',
			content: 'Upload a reference image or PDF, choose a model, and generate a parameterized build123d script.',
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
	const [isDownloadingStl, setIsDownloadingStl] = useState(false);
	const [isDownloadingStep, setIsDownloadingStep] = useState(false);
	const [isDownloadingDxf, setIsDownloadingDxf] = useState(false);

	const [isDeveloper, setIsDeveloper] = useState(false);
	const [developerUsername, setDeveloperUsername] = useState('');
	const [developerPassword, setDeveloperPassword] = useState('');
	const [developerAuthError, setDeveloperAuthError] = useState<string | null>(null);

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
	const [isChatOpen, setIsChatOpen] = useState(true);

	const [statusText, setStatusText] = useState<string>('Ready');
	const [annotations, setAnnotations] = useState<Record<string, { p1: [number, number, number]; p2: [number, number, number] }>>({});
	const [activeParameter, setActiveParameter] = useState<string | null>(null);
	const [geometryInfo, setGeometryInfo] = useState<StlGeometryInfo | null>(null);

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

	async function handleGenerate(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (!prompt.trim() || !selectedFile) {
			setStatusText('Please provide a prompt and file.');
			return;
		}

		const assistantMessageId = makeId('assistant');
		setMessages((prev) => [...prev, { id: makeId('user'), role: 'user', content: prompt }, { id: assistantMessageId, role: 'assistant', content: '' }]);
		setIsGenerating(true);

		const formData = new FormData();
		formData.append('prompt', prompt.trim());
		formData.append('image', selectedFile);
		formData.append('model_name', selectedModel);

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

						if (rawData.chunk) {
							accumulated += rawData.chunk;
							setMessages((prev) => prev.map((m) => (m.id === assistantMessageId ? { ...m, content: accumulated } : m)));
						}
						if (rawData.script) fullScript = rawData.script;
						if (rawData.parameters) {
							finalParams = rawData.parameters;
							setParameters(rawData.parameters);
						}
					} catch {}
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
		setIsRecompiling(true);
		setStatusText('Syncing to backend engine...');

		try {
			const response = await fetch('/api/render', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', 'x-session-id': session },
				body: JSON.stringify({ python_script: script, parameters: params, session_id: session }),
			});

			if (!response.ok) {
				const errorMsg = await readErrorFromResponse(response, 'Render failed.');
				throw new Error(errorMsg);
			}

			const payload = (await response.json()) as RenderPayload;
			if (payload.artifacts?.stl_url) setStlUrl(resolveModelUrl(payload.artifacts.stl_url, Date.now().toString()));
			if (payload.artifacts?.step_url) setStepUrl(resolveModelUrl(payload.artifacts.step_url));
			if (payload.artifacts?.dxf_url) setDxfUrl(resolveModelUrl(payload.artifacts.dxf_url));
			if (payload.artifacts?.annotations) setAnnotations(payload.artifacts.annotations);


			setStatusText('Geometry recompiled successfully.');
			toast.success('Sync successful');
		} catch (error) {
			const errorText = error instanceof Error ? error.message : String(error);
			setStatusText(`Sync failed: ${errorText}`);
			toast.error('Sync failed', { description: errorText });
		} finally {
			setIsRecompiling(false);
		}
	}

	async function handleRenderSync() {
		if (!sessionId || !pythonScript) return;
		await performSync(pythonScript, parameters, sessionId);
	}

	async function handleDownloadArtifact(url: string | null, label: string) {
		if (!url) return;


		const setBusy = label === 'stl' ? setIsDownloadingStl : label === 'step' ? setIsDownloadingStep : setIsDownloadingDxf;
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

	const parameterEntries = Object.entries(parameters);
	const hasStl = Boolean(stlUrl);
	const hasStep = Boolean(stepUrl);
	const hasDxf = Boolean(dxfUrl);


	const handleClear = () => {
		setMessages([
			{
				id: 'system_welcome',
				role: 'system',
				content: 'Upload a reference image or PDF, choose a model, and generate a parameterized build123d script.',
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
		setAnnotations({});
		setActiveParameter(null);
		setStatusText('Ready');
		toast.info('Session cleared');
	};

	return (
		<div className="dark h-screen w-full bg-black text-zinc-100 overflow-hidden">
			<main className="flex h-full w-full gap-0">
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
					width={chatWidth}
					isOpen={isChatOpen}
					setIsOpen={setIsChatOpen}
				/>

				{isChatOpen && (
					<div
						className="group relative w-1 cursor-col-resize bg-zinc-900 transition-colors hover:bg-amber-500/50"
						onMouseDown={() => {
							isResizing.current = true;
							document.body.style.cursor = 'col-resize';
						}}
					>
						<div className="absolute inset-y-0 -left-1 w-3 opacity-0 group-hover:opacity-100" />
					</div>
				)}

				<CadViewport
					stlUrl={stlUrl}
					statusText={statusText}
					isRecompiling={isRecompiling}
					hasStl={hasStl}
					hasStep={hasStep}
					hasDxf={hasDxf}
					isDownloadingStl={isDownloadingStl}
					isDownloadingStep={isDownloadingStep}
					isDownloadingDxf={isDownloadingDxf}
					onDownloadStl={() => void handleDownloadArtifact(stlUrl, 'stl')}
					onDownloadStep={() => void handleDownloadArtifact(stepUrl, 'step')}
					onDownloadDxf={() => void handleDownloadArtifact(dxfUrl, 'dxf')}
					annotations={annotations}
					activeParameter={activeParameter}
					geometryInfo={geometryInfo}
				>
					{stlUrl ? <StlMesh url={stlUrl} onGeometryReady={handleGeometryReady} /> : null}
				</CadViewport>

				<EditorDrawer
					isOpen={isDrawerOpen}
					setIsOpen={setIsDrawerOpen}
					activeTab={activeDrawerTab}
					setActiveTab={setActiveDrawerTab}
					pythonScript={pythonScript}
					onScriptChange={updatePythonScript}
					onRenderSync={handleRenderSync}
					isRecompiling={isRecompiling}
					hasSession={Boolean(sessionId)}
					onHistoryClick={() => setIsHistoryOpen(true)}
					isDeveloper={isDeveloper}
					developerUsername={developerUsername}
					developerPassword={developerPassword}
					developerAuthError={developerAuthError}
					onDeveloperUsernameChange={setDeveloperUsername}
					onDeveloperPasswordChange={setDeveloperPassword}
					onDeveloperLogin={handleDeveloperLogin}
					onDeveloperLogout={handleDeveloperLogout}
				>
					{parameterEntries.length === 0 ? (
						<div className="flex flex-col items-center justify-center py-6 px-2 text-center animate-message">
							{/* Dashed bounding box */}
							<div className="w-full rounded-2xl border border-dashed border-zinc-800 bg-zinc-950/50 p-7 flex flex-col items-center gap-5">
								{/* Icon container */}
								<div className="relative flex size-14 items-center justify-center">
									<div className="absolute inset-0 rounded-full bg-amber-500/5 blur-lg" />
									<div className="relative flex size-14 items-center justify-center rounded-2xl border border-zinc-800 bg-zinc-900/80">
										<svg className="size-6 text-zinc-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
											<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
										</svg>
									</div>
								</div>

								{/* Text */}
								<div>
									<p className="text-[11px] font-bold uppercase tracking-[0.2em] text-zinc-600">No Parameters Yet</p>
									<p className="mt-2 text-[10px] leading-relaxed text-zinc-700">
										Generate a script from a blueprint to auto-extract dynamic variables.
									</p>
								</div>

								{/* Micro-steps */}
								<div className="w-full space-y-2">
									{[
										{ step: '01', text: 'Upload a technical drawing or PDF' },
										{ step: '02', text: 'Generate a parameterized build123d script' },
										{ step: '03', text: 'Adjust dimensions here in real time' },
									].map(({ step, text }) => (
										<div key={step} className="flex items-start gap-3 rounded-xl border border-zinc-800/60 bg-zinc-900/40 px-3 py-2.5 text-left">
											<span className="mt-px shrink-0 text-[8px] font-black uppercase tracking-[0.2em] text-zinc-700">{step}</span>
											<span className="text-[10px] leading-snug text-zinc-600">{text}</span>
										</div>
									))}
								</div>
							</div>
						</div>
					) : (
						<div className="space-y-4">
							{parameterEntries.map(([key, value]) => (
								<div key={key} className="cursor-pointer" onClick={() => setActiveParameter(key)} onFocus={() => setActiveParameter(key)}>
									<ParameterInput
										label={key}
										value={value}
										isActive={activeParameter === key}
										onChange={(nextValue) => {
											const nextParams = setParameterValue(parameters, key, nextValue);
											setParameters(nextParams);
											const nextScript = injectParameters(pythonScript, nextParams);
											if (nextScript !== pythonScript) {
												updatePythonScript(nextScript);
											}
										}}
									/>
								</div>
							))}
						</div>
					)}
				</EditorDrawer>

				<HistoryDrawer 
					isOpen={isHistoryOpen}
					onClose={() => setIsHistoryOpen(false)}
					onRestore={handleRestoreSession}
				/>
			</main>
		</div>
	);
}
