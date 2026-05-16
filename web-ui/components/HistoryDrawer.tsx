'use client';

import { useEffect, useState } from 'react';
import { History, RotateCcw, Clock, Trash2 } from 'lucide-react';

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
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
            <div className="relative w-full max-w-md bg-zinc-950 border-l border-zinc-800 shadow-2xl flex flex-col animate-in slide-in-from-right duration-300">
                <div className="p-6 border-b border-zinc-800 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <History className="w-5 h-5 text-amber-500" />
                        <h2 className="text-xl font-bold text-zinc-100">Generation History</h2>
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
                                className="text-xs text-zinc-500 hover:text-red-500 transition-colors flex items-center gap-1.5"
                            >
                                <Trash2 className="w-3.5 h-3.5" />
                                Clear All
                            </button>
                        )}
                        <button 
                            onClick={onClose}
                            className="text-zinc-400 hover:text-white transition-colors"
                        >
                            Close
                        </button>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto p-4 space-y-4">
                    {isLoading ? (
                        <div className="flex flex-col items-center justify-center h-64 gap-4">
                            <div className="w-8 h-8 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
                            <p className="text-zinc-500">Loading your past creations...</p>
                        </div>
                    ) : sessions.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-64 text-zinc-500 gap-2">
                            <Clock className="w-12 h-12 opacity-20" />
                            <p>No history found yet.</p>
                        </div>
                    ) : (
                        sessions.map((session) => (
                            <div 
                                key={session.id}
                                className="group p-4 bg-zinc-900/50 border border-zinc-800 rounded-xl hover:border-amber-500/50 transition-all cursor-pointer"
                                onClick={() => onRestore(session)}
                            >
                                <div className="flex justify-between items-start mb-2">
                                    <p className="text-xs text-zinc-500 font-mono">
                                        {new Date(session.createdAt).toLocaleString(undefined, { 
                                            month: 'short', 
                                            day: 'numeric', 
                                            year: 'numeric',
                                            hour: '2-digit',
                                            minute: '2-digit'
                                        })}
                                    </p>
                                    <RotateCcw className="w-4 h-4 text-zinc-600 group-hover:text-amber-500 transition-colors" />
                                </div>
                                <h3 className="text-sm font-bold text-zinc-100 line-clamp-1 mb-1">
                                    {session.fileName || 'Untitled Generation'}
                                </h3>
                                <p className="text-[11px] text-zinc-500 line-clamp-2 mb-3 leading-relaxed">
                                    {session.prompt}
                                </p>
                                <div className="flex gap-2">
                                    <span className="px-2 py-0.5 bg-zinc-800 rounded text-[10px] text-zinc-400 uppercase tracking-wider">
                                        {Object.keys(session.parameters || {}).length} Params
                                    </span>
                                    <span className="px-2 py-0.5 bg-zinc-800 rounded text-[10px] text-zinc-400 uppercase tracking-wider">
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
