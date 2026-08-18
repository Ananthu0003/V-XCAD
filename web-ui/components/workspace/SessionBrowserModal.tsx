import { useEffect, useState } from 'react';
import { X, Clock, Box, Layers, Play, Loader2, Trash2, FileImage, FileText } from 'lucide-react';

interface Session {
	id: string;
	title: string;
	fileName: string | null;
	createdAt: string;
	stlUrl: string | null;
	stepUrl: string | null;
	prompt: string | null;
	pythonScript?: string;
	parameters?: any;
}

interface SessionBrowserModalProps {
	isOpen: boolean;
	onClose: () => void;
	onSelectSession: (session: Session) => void;
}

export function SessionBrowserModal({ isOpen, onClose, onSelectSession }: SessionBrowserModalProps) {
	const [sessions, setSessions] = useState<Session[]>([]);
	const [isLoading, setIsLoading] = useState(true);
	const [isClearing, setIsClearing] = useState(false);
	const [deletingId, setDeletingId] = useState<string | null>(null);

	useEffect(() => {
		if (isOpen) {
			setIsLoading(true);
			fetch(`/api/sessions?t=${Date.now()}`)
				.then((res) => res.json())
				.then((data) => {
					setSessions(Array.isArray(data) ? data : []);
					setIsLoading(false);
				})
				.catch((err) => {
					console.error('Failed to fetch sessions:', err);
					setIsLoading(false);
				});
		}
	}, [isOpen]);

	const handleClearHistory = async () => {
		if (!confirm('Are you sure you want to clear your entire project history?')) return;
		setIsClearing(true);
		try {
			const res = await fetch('/api/sessions', { method: 'DELETE' });
			if (res.ok) {
				setSessions([]);
			} else {
				console.error('Failed to clear sessions', await res.text());
			}
		} catch (err) {
			console.error(err);
		} finally {
			setIsClearing(false);
		}
	};

	const handleDeleteSession = async (e: React.MouseEvent, id: string) => {
		e.stopPropagation();
		setDeletingId(id);
		try {
			const res = await fetch(`/api/sessions/${id}`, { method: 'DELETE' });
			if (res.ok) {
				setSessions((prev) => prev.filter((s) => s.id !== id));
			}
		} catch (err) {
			console.error(err);
		} finally {
			setDeletingId(null);
		}
	};

	const getFileIcon = (session: Session) => {
		if (session.fileName) {
			const name = session.fileName.toLowerCase();
			if (name.endsWith('.pdf')) return <FileText className="w-5 h-5 text-red-400 opacity-80" />;
			if (name.endsWith('.png') || name.endsWith('.jpg') || name.endsWith('.jpeg')) return <FileImage className="w-5 h-5 text-green-400 opacity-80" />;
			if (name.endsWith('.step') || name.endsWith('.stp')) return <Box className="w-5 h-5 text-blue-500 opacity-80" />;
		}
		if (session.stepUrl) return <Box className="w-5 h-5 text-blue-500 opacity-80" />;
		if (session.stlUrl) return <Layers className="w-5 h-5 text-blue-400 opacity-80" />;
		return <Box className="w-5 h-5 text-muted-foreground" />;
	};

	if (!isOpen) return null;

	return (
		<div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
			<div className="flex flex-col w-full max-w-2xl bg-popover border border-border rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
				
				{/* Header */}
				<div className="flex items-center justify-between px-6 py-4 border-b border-border bg-muted/50">
					<div className="flex items-center gap-3">
						<div className="p-2 rounded-lg bg-blue-500/10 text-blue-400">
							<Clock className="w-5 h-5" />
						</div>
						<div>
							<h2 className="text-sm font-bold text-foreground uppercase tracking-widest">Recent Projects</h2>
							<p className="text-[11px] text-muted-foreground mt-0.5">Resume your previous CAD sessions</p>
						</div>
					</div>
					<button
						onClick={onClose}
						className="p-2 text-muted-foreground hover:bg-muted hover:text-foreground rounded-lg transition-colors"
					>
						<X className="w-5 h-5" />
					</button>
				</div>

				{/* Content */}
				<div className="flex-1 overflow-y-auto max-h-[60vh] p-4 space-y-3">
					{isLoading ? (
						<div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
							<Loader2 className="w-6 h-6 animate-spin text-blue-500" />
							<span className="text-[11px] uppercase tracking-widest font-bold">Loading History...</span>
						</div>
					) : sessions.length === 0 ? (
						<div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
							<Box className="w-8 h-8 opacity-20" />
							<span className="text-[11px] uppercase tracking-widest font-bold">No Projects Found</span>
						</div>
					) : (
						sessions.map((session) => (
							<button
								key={session.id}
								onClick={() => {
									onSelectSession(session);
									onClose();
								}}
								className="w-full flex items-center gap-4 p-4 rounded-xl border border-border bg-muted/50 hover:bg-muted hover:border-blue-500/30 transition-all group text-left"
							>
								<div className="flex-shrink-0 w-12 h-12 rounded-lg bg-black/50 dark:bg-black/50 border border-border flex items-center justify-center relative overflow-hidden">
									{getFileIcon(session)}
								</div>
								
								<div className="flex-1 min-w-0">
									<h3 className="text-sm font-bold text-foreground truncate group-hover:text-blue-400 transition-colors">
										{session.fileName || session.title || 'Untitled Project'}
									</h3>
									<p className="text-[11px] text-muted-foreground truncate mt-1">
										{session.prompt || 'No prompt provided'}
									</p>
								</div>

								<div className="flex flex-col items-end gap-1 flex-shrink-0">
									<div className="flex items-center gap-1.5 text-[11px] font-bold text-foreground font-mono">
										<Clock className="w-3 h-3 text-blue-400" />
										<span>
											{new Date(session.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
										</span>
									</div>
									<span className="text-[10px] text-muted-foreground font-mono">
										{new Date(session.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}
									</span>
									<div className="flex items-center gap-2 mt-0.5">
										<div className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-blue-400 opacity-0 group-hover:opacity-100 transition-opacity translate-x-2 group-hover:translate-x-0">
											Resume <Play className="w-2.5 h-2.5" />
										</div>
										<div
											onClick={(e) => handleDeleteSession(e, session.id)}
											className="p-1 rounded-md hover:bg-red-500/10 text-muted-foreground hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100"
											title="Delete session"
										>
											{deletingId === session.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
										</div>
									</div>
								</div>
							</button>
						))
					)}
				</div>

				{/* Footer */}
				{!isLoading && sessions.length > 0 && (
					<div className="flex items-center justify-between px-6 py-4 border-t border-border bg-black/20">
						<button
							onClick={handleClearHistory}
							disabled={isClearing}
							className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-red-500/70 hover:text-red-400 transition-colors disabled:opacity-50"
						>
							{isClearing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
							Clear History
						</button>
					</div>
				)}
			</div>
		</div>
	);
}
