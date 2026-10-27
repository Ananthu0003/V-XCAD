import type { CamOperation, OperationType, CamSetupPlan } from '@/types/cam';
import { 
    Plus, Trash2, Settings2, MoreVertical, Copy, ArrowUp, ArrowDown, 
    Power, PowerOff, RefreshCw, AlertTriangle, CheckCircle2, XCircle, 
    ChevronDown, ChevronRight, Layers, RotateCw, Compass
} from 'lucide-react';
import { useState } from 'react';

type OperationTreeSectionProps = {
    operations: CamOperation[];
    activeOperationId: string | null;
    onSelect: (id: string) => void;
    onAdd: (type: OperationType, setupId?: string) => void;
    onDelete: (id: string) => void;
    onDuplicate?: (id: string) => void;
    onMove?: (id: string, direction: 'up' | 'down') => void;
    onToggleEnable?: (id: string) => void;
    onRegenerate?: (id: string) => void;
    onReorder?: (sourceIndex: number, destIndex: number, setupId?: string) => void;
    setups?: CamSetupPlan[] | any[];
    activeSetupId?: string | null;
    onSelectSetup?: (setupId: string) => void;
};

const opTypeLabels: Record<string, string> = {
    'facing': 'Facing',
    'pocket': '2D Pocket',
    '2d_contour': '2D Contour',
    'drilling': 'Drilling',
    'chamfer': 'Chamfer',
    'roughing': 'Roughing',
    'finishing': 'Finishing',
    'semi_finishing': 'Semi-Finishing',
    'rest_machining': 'Rest Machining',
    'boring': 'Boring',
    'spot_drilling': 'Spot Drilling',
    'reaming': 'Reaming',
    'tapping': 'Tapping',
    'countersinking': 'Countersinking',
    'chamfering': 'Chamfering',
    'filleting': 'Filleting',
    'thread_milling': 'Thread Milling',
    'grooving': 'Grooving',
    'boss_clearing': 'Boss Clearing',
    'od_turning': 'OD Turning',
};

export function OperationTreeSection({ 
    operations, activeOperationId, onSelect, onAdd, onDelete, 
    onDuplicate, onMove, onToggleEnable, onRegenerate, onReorder,
    setups = [], activeSetupId, onSelectSetup
}: OperationTreeSectionProps) {
    const [draggedOpId, setDraggedOpId] = useState<string | null>(null);
    const [draggedSetupId, setDraggedSetupId] = useState<string | null>(null);
    const [contextMenuOpId, setContextMenuOpId] = useState<string | null>(null);
    const [openAddDropdownSetupId, setOpenAddDropdownSetupId] = useState<string | null>(null);
    const [collapsedSetups, setCollapsedSetups] = useState<Record<string, boolean>>({});

    const toggleCollapse = (setupId: string) => {
        setCollapsedSetups(prev => ({
            ...prev,
            [setupId]: !prev[setupId]
        }));
    };

    // Determine normalized setups list
    const effectiveSetups: any[] = (setups && setups.length > 0) ? [...setups] : [
        {
            setupId: 'setup_001',
            setupName: 'Setup 1 - Top Milling',
            workCoordinateSystem: 'G54',
            toolAxis: [0, 0, 1],
            requiresManualReclamp: false,
        }
    ];

    // Check if any operations belong to setups not in effectiveSetups
    const knownSetupIds = new Set(effectiveSetups.map(s => s.setupId || s.id));
    const extraSetupIds = new Set<string>();
    operations.forEach(op => {
        const sid = op.setup_id || (op as any).setupId;
        if (sid && !knownSetupIds.has(sid)) {
            extraSetupIds.add(sid);
        }
    });

    extraSetupIds.forEach((sid, idx) => {
        effectiveSetups.push({
            setupId: sid,
            setupName: `Setup ${effectiveSetups.length + idx + 1}`,
            workCoordinateSystem: `G${54 + effectiveSetups.length}`,
            toolAxis: [0, 0, 1],
            requiresManualReclamp: false,
        });
    });

    const handleDragStart = (e: React.DragEvent, opId: string, setupId: string) => {
        setDraggedOpId(opId);
        setDraggedSetupId(setupId);
        e.dataTransfer.effectAllowed = 'move';
    };

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
    };

    const handleDrop = (e: React.DragEvent, destIndex: number, targetSetupOps: CamOperation[], setupId: string) => {
        e.preventDefault();
        if (draggedOpId && onReorder) {
            const srcIndex = targetSetupOps.findIndex(o => o.id === draggedOpId);
            if (srcIndex !== -1 && srcIndex !== destIndex) {
                onReorder(srcIndex, destIndex, setupId);
            }
        }
        setDraggedOpId(null);
        setDraggedSetupId(null);
    };

    const renderStatus = (status?: string, reason?: string) => {
        switch (status) {
            case 'ready': 
            case 'generated':
                return <span title="Ready / Toolpath Generated"><CheckCircle2 className="size-3 text-emerald-500" /></span>;
            case 'requires_regeneration': 
                return <span title="Requires Regeneration"><RefreshCw className="size-3 text-amber-500" /></span>;
            case 'missing_tool': 
                return <span title="Missing Tool"><XCircle className="size-3 text-rose-500" /></span>;
            case 'missing_geometry': 
                return <span title="Geometry Missing"><AlertTriangle className="size-3 text-rose-500" /></span>;
            case 'blocked': 
            case 'unsupported':
            case 'error':
                return <span title={reason || "Blocked by capability or clearance constraints"}><XCircle className="size-3 text-red-500" /></span>;
            default: 
                return <span title="Configured"><CheckCircle2 className="size-3 text-emerald-500/80" /></span>;
        }
    };

    return (
        <div className="flex flex-col gap-3 h-full select-none" onClick={() => { setContextMenuOpId(null); setOpenAddDropdownSetupId(null); }}>
            <div className="flex items-center justify-between px-1">
                <div className="flex items-center gap-2">
                    <Layers className="size-4 text-cyan-400" />
                    <span className="text-xs font-bold uppercase tracking-wider text-foreground">
                        Manufacturing Setups ({effectiveSetups.length})
                    </span>
                </div>
                <span className="text-[11px] font-mono text-muted-foreground">
                    {operations.length} Total Ops
                </span>
            </div>

            <div className="flex flex-col gap-3 overflow-y-auto pr-1 flex-1 custom-scrollbar pb-16">
                {effectiveSetups.map((s, setupIdx) => {
                    const currentSetupId = s.setupId || s.id || `setup_${setupIdx + 1}`;
                    const setupOps = operations.filter(op => {
                        const opSetupId = op.setup_id || (op as any).setupId;
                        return opSetupId === currentSetupId || (!opSetupId && setupIdx === 0);
                    });

                    const isCurrentActive = activeSetupId === currentSetupId || (!activeSetupId && setupIdx === 0);
                    const isCollapsed = Boolean(collapsedSetups[currentSetupId]);
                    const isAddMenuOpen = openAddDropdownSetupId === currentSetupId;

                    const wcs = s.workCoordinateSystem || (s as any).wcs || `G${54 + setupIdx}`;
                    const toolAxis = s.toolAxis || (s as any).tool_axis || [0, 0, 1];
                    const isPartFlip = Boolean(s.requiresManualReclamp || (Array.isArray(toolAxis) && toolAxis[2] < 0));

                    return (
                        <div 
                            key={currentSetupId}
                            className={`flex flex-col rounded-2xl border transition-all duration-200 overflow-hidden ${
                                isCurrentActive 
                                    ? 'border-blue-500/40 bg-blue-500/[0.03] shadow-[0_0_15px_rgba(59,130,246,0.12)]' 
                                    : 'border-border/60 bg-accent/20 hover:border-border'
                            }`}
                        >
                            {/* Setup Header */}
                            <div 
                                onClick={() => onSelectSetup?.(currentSetupId)}
                                className="px-3 py-2.5 flex items-center justify-between bg-accent/40 hover:bg-accent/60 cursor-pointer transition-colors border-b border-border/40"
                            >
                                <div className="flex items-center gap-2 min-w-0">
                                    <button 
                                        type="button"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            toggleCollapse(currentSetupId);
                                        }}
                                        className="p-0.5 rounded text-muted-foreground hover:text-foreground transition-transform"
                                        title={isCollapsed ? "Expand Setup" : "Collapse Setup"}
                                    >
                                        {isCollapsed ? <ChevronRight className="size-3.5" /> : <ChevronDown className="size-3.5" />}
                                    </button>

                                    <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                                        <span className="text-xs font-bold text-foreground truncate">
                                            {s.setupName || `Setup ${setupIdx + 1}`}
                                        </span>

                                        {/* WCS Badge */}
                                        <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-black bg-blue-500/20 text-blue-400 border border-blue-500/30">
                                            {wcs}
                                        </span>

                                        {/* Tool Axis Badge */}
                                        <span className="px-1.5 py-0.5 rounded text-[9px] font-mono text-muted-foreground bg-white/5 border border-white/10 hidden sm:inline-flex items-center gap-0.5">
                                            <Compass className="size-2.5" />
                                            [{Array.isArray(toolAxis) ? toolAxis.join(',') : '0,0,1'}]
                                        </span>

                                        {/* Flip / Reclamp Indicator */}
                                        {isPartFlip && (
                                            <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-amber-500/20 text-amber-400 border border-amber-500/30 flex items-center gap-1">
                                                <RotateCw className="size-2.5" />
                                                M00 Flip
                                            </span>
                                        )}

                                        {/* Active Badge */}
                                        {isCurrentActive && (
                                            <span className="px-1.5 py-0.5 rounded text-[8.5px] font-black uppercase tracking-wider bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                                                Active
                                            </span>
                                        )}
                                    </div>
                                </div>

                                <div className="flex items-center gap-2 shrink-0">
                                    <span className="text-[10px] font-mono text-muted-foreground bg-background/50 px-2 py-0.5 rounded-full border border-border/40">
                                        {setupOps.length} ops
                                    </span>

                                    {/* Per-Setup Add Operation Button */}
                                    <div className="relative">
                                        <button 
                                            type="button"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                setOpenAddDropdownSetupId(isAddMenuOpen ? null : currentSetupId);
                                            }}
                                            className="flex items-center justify-center p-1.5 hover:bg-blue-500/20 hover:text-blue-400 rounded-lg text-muted-foreground transition-colors border border-transparent hover:border-blue-500/30"
                                            title={`Add Operation to ${s.setupName || wcs}`}
                                        >
                                            <Plus className="size-3.5" />
                                        </button>

                                        {isAddMenuOpen && (
                                            <div 
                                                onClick={(e) => e.stopPropagation()}
                                                className="absolute right-0 top-full mt-1.5 w-44 flex flex-col rounded-xl border border-border bg-popover shadow-2xl z-50 py-1 max-h-64 overflow-y-auto custom-scrollbar animate-in fade-in zoom-in-95 duration-150"
                                            >
                                                <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground border-b border-border/40">
                                                    Add to {wcs}
                                                </div>
                                                {(Object.keys(opTypeLabels) as OperationType[]).map(type => (
                                                    <button
                                                        key={type}
                                                        type="button"
                                                        onClick={() => {
                                                            onAdd(type, currentSetupId);
                                                            setOpenAddDropdownSetupId(null);
                                                        }}
                                                        className="px-3 py-1.5 text-left text-xs hover:bg-accent text-foreground transition-colors flex items-center justify-between"
                                                    >
                                                        <span>{opTypeLabels[type]}</span>
                                                        <Plus className="size-3 opacity-40" />
                                                    </button>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>

                            {/* Operations List in this Setup */}
                            {!isCollapsed && (
                                <div className="flex flex-col gap-1 p-2">
                                    {setupOps.length === 0 ? (
                                        <div className="py-6 px-4 text-center rounded-xl border border-dashed border-border/40 bg-accent/10 text-muted-foreground text-xs flex flex-col items-center gap-1.5">
                                            <span>No operations planned for this setup</span>
                                            <button
                                                type="button"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    setOpenAddDropdownSetupId(currentSetupId);
                                                }}
                                                className="text-[11px] font-bold text-blue-400 hover:underline flex items-center gap-1"
                                            >
                                                <Plus className="size-3" /> Add Operation
                                            </button>
                                        </div>
                                    ) : (
                                        setupOps.map((op, opIndex) => {
                                            const isActive = op.id === activeOperationId;
                                            const isDisabled = op.enabled === false;
                                            const showMenu = contextMenuOpId === op.id;

                                            const toolName = op.tool?.name || (op as any).tool_name || op.toolId;
                                            const cycleTime = op.estimated_time_s || (op as any).statistics?.cycleTimeSeconds;

                                            return (
                                                <div
                                                    key={op.id}
                                                    draggable
                                                    onDragStart={(e) => handleDragStart(e, op.id, currentSetupId)}
                                                    onDragOver={handleDragOver}
                                                    onDrop={(e) => handleDrop(e, opIndex, setupOps, currentSetupId)}
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        onSelect(op.id);
                                                        if (onSelectSetup) onSelectSetup(currentSetupId);
                                                        setContextMenuOpId(null);
                                                    }}
                                                    className={`group relative flex flex-col rounded-xl px-3 py-2 transition-all cursor-grab active:cursor-grabbing border ${
                                                        isActive 
                                                            ? 'bg-blue-500/10 border-blue-500/40 text-blue-500 shadow-sm' 
                                                            : 'hover:bg-accent/40 text-foreground border-transparent'
                                                    } ${isDisabled ? 'opacity-50 grayscale' : ''}`}
                                                >
                                                    <div className="flex items-center justify-between w-full">
                                                        <div className="flex items-center gap-2 min-w-0">
                                                            <Settings2 className="size-3.5 opacity-50 shrink-0" />
                                                            <div className="flex flex-col min-w-0">
                                                                <span className="text-xs font-semibold truncate">
                                                                    {opIndex + 1}. {op.name || `${op.type} Operation`}
                                                                </span>
                                                                <div className="flex items-center gap-2 text-[10px] text-muted-foreground font-mono">
                                                                    {toolName && <span className="truncate">{toolName}</span>}
                                                                    {cycleTime ? <span>• {Math.round(cycleTime)}s</span> : null}
                                                                </div>
                                                            </div>
                                                        </div>

                                                        <div className="flex items-center gap-1.5 shrink-0">
                                                            {renderStatus(
                                                                op.status, 
                                                                (op as any).blocked_reason || (op as any).errorReason || op.parameters?.error || (op as any).reason
                                                            )}
                                                            <button
                                                                type="button"
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    setContextMenuOpId(showMenu ? null : op.id);
                                                                }}
                                                                className="opacity-0 group-hover:opacity-100 p-1 hover:text-foreground rounded transition-opacity"
                                                                title="Operation Options"
                                                            >
                                                                <MoreVertical className="size-3.5" />
                                                            </button>
                                                        </div>
                                                    </div>

                                                    {/* Context menu for operation */}
                                                    {showMenu && (
                                                        <div 
                                                            onClick={(e) => e.stopPropagation()}
                                                            className="absolute right-6 top-8 w-44 flex flex-col rounded-xl border border-border bg-popover shadow-2xl z-50 overflow-hidden py-1 animate-in fade-in zoom-in-95 duration-150"
                                                        >
                                                            {onRegenerate && (
                                                                <button 
                                                                    type="button"
                                                                    onClick={(e) => { e.stopPropagation(); onRegenerate(op.id); setContextMenuOpId(null); }} 
                                                                    className="flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-accent text-foreground transition-colors"
                                                                >
                                                                    <RefreshCw className="size-3" /> Regenerate
                                                                </button>
                                                            )}
                                                            {onDuplicate && (
                                                                <button 
                                                                    type="button"
                                                                    onClick={(e) => { e.stopPropagation(); onDuplicate(op.id); setContextMenuOpId(null); }} 
                                                                    className="flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-accent text-foreground transition-colors"
                                                                >
                                                                    <Copy className="size-3" /> Duplicate
                                                                </button>
                                                            )}
                                                            {onMove && (
                                                                <button 
                                                                    type="button"
                                                                    onClick={(e) => { e.stopPropagation(); onMove(op.id, 'up'); setContextMenuOpId(null); }} 
                                                                    disabled={opIndex === 0} 
                                                                    className="flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-accent disabled:opacity-40 text-foreground transition-colors"
                                                                >
                                                                    <ArrowUp className="size-3" /> Move Up
                                                                </button>
                                                            )}
                                                            {onMove && (
                                                                <button 
                                                                    type="button"
                                                                    onClick={(e) => { e.stopPropagation(); onMove(op.id, 'down'); setContextMenuOpId(null); }} 
                                                                    disabled={opIndex === setupOps.length - 1} 
                                                                    className="flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-accent disabled:opacity-40 text-foreground transition-colors"
                                                                >
                                                                    <ArrowDown className="size-3" /> Move Down
                                                                </button>
                                                            )}
                                                            {onToggleEnable && (
                                                                <button 
                                                                    type="button"
                                                                    onClick={(e) => { e.stopPropagation(); onToggleEnable(op.id); setContextMenuOpId(null); }} 
                                                                    className="flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-accent text-foreground transition-colors"
                                                                >
                                                                    {isDisabled ? <><Power className="size-3" /> Enable</> : <><PowerOff className="size-3" /> Disable</>}
                                                                </button>
                                                            )}
                                                            <div className="border-t border-border/40 my-1" />
                                                            <button 
                                                                type="button"
                                                                onClick={(e) => { e.stopPropagation(); onDelete(op.id); setContextMenuOpId(null); }} 
                                                                className="flex items-center gap-2 px-3 py-1.5 text-xs text-rose-500 hover:bg-rose-500/10 transition-colors"
                                                            >
                                                                <Trash2 className="size-3" /> Delete
                                                            </button>
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })
                                    )}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
