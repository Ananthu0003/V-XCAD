import type { CamOperation, OperationType } from '@/types/cam';
import { Plus, Trash2, Settings2, MoreVertical, Copy, ArrowUp, ArrowDown, Power, PowerOff, RefreshCw, AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';
import { useState, useRef } from 'react';

type OperationTreeSectionProps = {
    operations: CamOperation[];
    activeOperationId: string;
    onSelect: (id: string) => void;
    onAdd: (type: OperationType) => void;
    onDelete: (id: string) => void;
    onDuplicate?: (id: string) => void;
    onMove?: (id: string, direction: 'up' | 'down') => void;
    onToggleEnable?: (id: string) => void;
    onRegenerate?: (id: string) => void;
    onReorder?: (sourceIndex: number, destIndex: number) => void;
};

const opTypeLabels: Record<OperationType, string> = {
    'facing': 'Facing',
    'pocket': '2D Pocket',
    '2d_contour': '2D Contour',
    'drilling': 'Drilling',
    'chamfer': 'Chamfer',
};

export function OperationTreeSection({ 
    operations, activeOperationId, onSelect, onAdd, onDelete, 
    onDuplicate, onMove, onToggleEnable, onRegenerate, onReorder 
}: OperationTreeSectionProps) {
    const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
    const [contextMenuOpId, setContextMenuOpId] = useState<string | null>(null);

    const handleDragStart = (e: React.DragEvent, index: number) => {
        setDraggedIndex(index);
        e.dataTransfer.effectAllowed = 'move';
    };

    const handleDragOver = (e: React.DragEvent, index: number) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
    };

    const handleDrop = (e: React.DragEvent, destIndex: number) => {
        e.preventDefault();
        if (draggedIndex !== null && draggedIndex !== destIndex && onReorder) {
            onReorder(draggedIndex, destIndex);
        }
        setDraggedIndex(null);
    };

    const renderStatus = (status?: string, reason?: string) => {
        switch (status) {
            case 'ready': return <span title="Ready"><CheckCircle2 className="size-3 text-emerald-500" /></span>;
            case 'requires_regeneration': return <span title="Requires Regeneration"><RefreshCw className="size-3 text-amber-500" /></span>;
            case 'missing_tool': return <span title="Missing Tool"><XCircle className="size-3 text-rose-500" /></span>;
            case 'missing_geometry': return <span title="Geometry Missing"><AlertTriangle className="size-3 text-rose-500" /></span>;
            case 'blocked': return <span title={reason || "Blocked by capability constraints"}><XCircle className="size-3 text-red-600" /></span>;
            default: return null;
        }
    };

    return (
        <div className="flex flex-col gap-3 h-full">
            <div className="flex flex-col gap-1 rounded-2xl border border-border dark:border-white/10 bg-accent/40 dark:bg-black/40 p-2 flex-1 overflow-hidden">
                <div className="px-3 py-1 flex items-center justify-between">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Setup 1</span>
                    <div className="group relative">
                        <button className="flex items-center justify-center p-1 hover:bg-blue-500/20 hover:text-blue-500 rounded text-muted-foreground transition-colors">
                            <Plus className="size-3.5" />
                        </button>
                        <div className="absolute right-0 top-full mt-1 hidden w-32 flex-col rounded-xl border border-border bg-background shadow-xl group-hover:flex z-50">
                            {(Object.keys(opTypeLabels) as OperationType[]).map(type => (
                                <button
                                    key={type}
                                    onClick={() => onAdd(type)}
                                    className="px-3 py-2 text-left text-xs hover:bg-accent first:rounded-t-xl last:rounded-b-xl"
                                >
                                    {opTypeLabels[type]}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
                
                <div className="flex flex-col gap-1 pl-2 overflow-y-auto pr-1 flex-1 pb-16">
                    {operations.map((op, index) => {
                        const isActive = op.id === activeOperationId;
                        const isDisabled = op.enabled === false;
                        const showMenu = contextMenuOpId === op.id;
                        
                        return (
                            <div
                                key={op.id}
                                draggable
                                onDragStart={(e) => handleDragStart(e, index)}
                                onDragOver={(e) => handleDragOver(e, index)}
                                onDrop={(e) => handleDrop(e, index)}
                                onClick={() => { onSelect(op.id); setContextMenuOpId(null); }}
                                className={`group relative flex flex-col rounded-xl px-3 py-2 transition-all cursor-grab active:cursor-grabbing border ${
                                    isActive 
                                        ? 'bg-blue-500/10 border-blue-500/30 text-blue-500' 
                                        : 'hover:bg-accent/50 text-foreground border-transparent'
                                } ${isDisabled ? 'opacity-50 grayscale' : ''}`}
                            >
                                <div className="flex items-center justify-between w-full">
                                    <div className="flex items-center gap-2">
                                        <Settings2 className="size-3.5 opacity-50" />
                                        <span className="text-xs font-semibold">{index + 1}. {op.name}</span>
                                    </div>
                                    <div className="flex items-center gap-1.5">
                                        {renderStatus(op.status, op.blocked_reason)}
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                setContextMenuOpId(showMenu ? null : op.id);
                                            }}
                                            className="opacity-0 group-hover:opacity-100 p-1 hover:text-foreground transition-colors"
                                        >
                                            <MoreVertical className="size-3.5" />
                                        </button>
                                    </div>
                                </div>

                                {showMenu && (
                                    <div className="absolute right-8 top-8 w-40 flex flex-col rounded-xl border border-border bg-background shadow-xl z-50 overflow-hidden">
                                        {onRegenerate && <button onClick={(e) => { e.stopPropagation(); onRegenerate(op.id); setContextMenuOpId(null); }} className="flex items-center gap-2 px-3 py-2 text-xs hover:bg-accent"><RefreshCw className="size-3" /> Regenerate</button>}
                                        {onDuplicate && <button onClick={(e) => { e.stopPropagation(); onDuplicate(op.id); setContextMenuOpId(null); }} className="flex items-center gap-2 px-3 py-2 text-xs hover:bg-accent"><Copy className="size-3" /> Duplicate</button>}
                                        {onMove && <button onClick={(e) => { e.stopPropagation(); onMove(op.id, 'up'); setContextMenuOpId(null); }} disabled={index === 0} className="flex items-center gap-2 px-3 py-2 text-xs hover:bg-accent disabled:opacity-50"><ArrowUp className="size-3" /> Move Up</button>}
                                        {onMove && <button onClick={(e) => { e.stopPropagation(); onMove(op.id, 'down'); setContextMenuOpId(null); }} disabled={index === operations.length - 1} className="flex items-center gap-2 px-3 py-2 text-xs hover:bg-accent disabled:opacity-50"><ArrowDown className="size-3" /> Move Down</button>}
                                        {onToggleEnable && <button onClick={(e) => { e.stopPropagation(); onToggleEnable(op.id); setContextMenuOpId(null); }} className="flex items-center gap-2 px-3 py-2 text-xs hover:bg-accent">{isDisabled ? <><Power className="size-3" /> Enable</> : <><PowerOff className="size-3" /> Disable</>}</button>}
                                        <button onClick={(e) => { e.stopPropagation(); onDelete(op.id); setContextMenuOpId(null); }} className="flex items-center gap-2 px-3 py-2 text-xs text-rose-500 hover:bg-rose-500/10"><Trash2 className="size-3" /> Delete</button>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}
