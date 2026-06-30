'use client';

import { useEffect, useState } from 'react';
import { History, RotateCcw, Clock, Trash2, X } from 'lucide-react';

type CadSession = {
    id: string;
    prompt: string;
    fileName: string | null;
    pythonScript: string;
    parameters: any;
    stlUrl: string;
    stepUrl: string;
    createdAt: string;
};

interface HistoryDrawerProps {
    isOpen: boolean;
    onClose: () => void;
    onRestore: (session: CadSession) => void;
}

export function HistoryDrawer({ isOpen, onClose, onRestore }: HistoryDrawerProps) {
    const [sessions, setSessions] = useState<CadSession[]>([]);
    const [isLoading, setIsLoading] = useState(false);

    useEffect(() => {
        if (isOpen) {
            fetchSessions();
        }
    }, [isOpen]);

    const fetchSessions = async () => {
        setIsLoading(true);
        try {
            const res = await fetch('/api/sessions');
            if (res.ok) {
                const data = await res.json();
                setSessions(data);
            }
        } catch (error) {
            console.error('Failed to fetch history:', error);
        } finally {
            setIsLoading(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex justify-end">
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity duration-300" onClick={onClose} />
            <div className="relative w-full max-w-md bg-zinc-950/95 backdrop-blur-xl border-l border-white/10 shadow-2xl flex flex-col animate-in slide-in-from-right duration-500 ease-out">
                {/* Header */}
                <div className="p-6 border-b border-white/10 flex items-center justify-between bg-zinc-900/20">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-blue-500/10 rounded-lg border border-blue-500/20">
                            <History className="w-5 h-5 text-blue-400" />
                        </div>
                        <h2 className="text-xl font-bold bg-gradient-to-r from-white to-zinc-400 bg-clip-text text-transparent">History</h2>
                    </div>
                    <div className="flex items-center gap-4">
                        {sessions.length > 0 && (
                            <button
                                onClick={async () => {
                                    if (confirm('Are you sure you want to clear all history?')) {
                                        const res = await fetch('/api/sessions', { method: 'DELETE' });
                                        if (res.ok) {
                                            setSessions([]);
                                        }
                                    }
                                }}
                                className="text-xs text-zinc-400 hover:text-red-400 transition-colors flex items-center gap-1.5 px-2 py-1 rounded-md hover:bg-red-500/10"
                            >
                                <Trash2 className="w-3.5 h-3.5" />
                                Clear All
                            </button>
                        )}
                        <button
                            onClick={onClose}
                            className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-white/10 transition-all active:scale-95"
                            title="Close"
                        >
                            <X className="size-5" />
                        </button>
                    </div>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-6 space-y-4">
                    {isLoading ? (
                        <div className="flex flex-col items-center justify-center h-full gap-4">
                            <div className="relative w-12 h-12 flex items-center justify-center">
                                <div className="absolute inset-0 border-t-2 border-blue-500 rounded-full animate-spin"></div>
                                <div className="absolute inset-2 border-t-2 border-indigo-400 rounded-full animate-spin" style={{ animationDirection: 'reverse', animationDuration: '0.7s' }}></div>
                            </div>
                            <p className="text-sm font-medium bg-gradient-to-r from-blue-400 to-indigo-400 bg-clip-text text-transparent animate-pulse">Loading creations...</p>
                        </div>
                    ) : sessions.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-full text-zinc-500 gap-4">
                            <div className="p-6 bg-zinc-900/50 rounded-full border border-white/5 shadow-inner">
                                <Clock className="w-10 h-10 text-zinc-600" />
                            </div>
                            <p className="text-sm font-medium text-zinc-400">No history found yet.</p>
                        </div>
                    ) : (
                        sessions.map((session, index) => (
                            <div 
                                key={session.id}
                                className="group p-5 bg-white/[0.02] border border-white/5 rounded-2xl hover:bg-white/[0.04] hover:border-blue-500/30 hover:shadow-[0_0_30px_rgba(59,130,246,0.05)] transition-all duration-300 cursor-pointer transform hover:-translate-y-1 animate-in fade-in slide-in-from-bottom-4"
                                style={{ animationDelay: `${Math.min(index * 50, 500)}ms`, animationFillMode: 'both' }}
                                onClick={() => onRestore(session)}
                            >
                                <div className="flex justify-between items-start mb-3">
                                    <p className="text-[11px] text-zinc-400 font-medium tracking-wider uppercase flex items-center gap-2">
                                        <Clock className="w-3 h-3" />
                                        {new Date(session.createdAt).toLocaleString(undefined, { 
                                            month: 'short', 
                                            day: 'numeric', 
                                            hour: '2-digit',
                                            minute: '2-digit'
                                        })}
                                    </p>
                                    <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                                        <button 
                                            className="p-1.5 bg-zinc-800/50 hover:bg-red-500/10 rounded-full transition-all duration-300"
                                            onClick={async (e) => {
                                                e.stopPropagation();
                                                if (confirm('Are you sure you want to delete this session?')) {
                                                    const res = await fetch(`/api/sessions/${session.id}`, { method: 'DELETE' });
                                                    if (res.ok) {
                                                        setSessions(s => s.filter(x => x.id !== session.id));
                                                    }
                                                }
                                            }}
                                            title="Delete this session"
                                        >
                                            <Trash2 className="w-3.5 h-3.5 text-zinc-400 hover:text-red-400 transition-colors duration-300" />
                                        </button>
                                        <button className="p-1.5 bg-zinc-800/50 hover:bg-blue-500/10 rounded-full transition-all duration-300 group/restore" title="Restore this session">
                                            <RotateCcw className="w-3.5 h-3.5 text-zinc-400 group-hover/restore:text-blue-400 transition-colors transform group-hover/restore:-rotate-45 duration-300" />
                                        </button>
                                    </div>
                                </div>
                                <h3 className="text-base font-semibold text-zinc-100 line-clamp-1 mb-2 group-hover:text-blue-400 transition-colors">
                                    {session.fileName || 'Untitled Generation'}
                                </h3>
                                <p className="text-xs text-zinc-400 line-clamp-2 mb-4 leading-relaxed group-hover:text-zinc-300 transition-colors">
                                    {session.prompt}
                                </p>
                                <div className="flex flex-wrap gap-2">
                                    <span className="px-2.5 py-1 bg-white/5 border border-white/10 rounded-md text-[10px] text-zinc-300 font-medium tracking-wide flex items-center gap-1.5">
                                        <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse"></span>
                                        {Object.keys(session.parameters || {}).length} Params
                                    </span>
                                    <span className="px-2.5 py-1 bg-blue-500/10 border border-blue-500/20 rounded-md text-[10px] text-blue-300 font-medium tracking-wide">
                                        CAD Script
                                    </span>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </div>
        </div>
    );
}
