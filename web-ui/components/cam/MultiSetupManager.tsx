'use client';

import React from 'react';
import { Layers, Zap, Plus, RotateCcw, Compass, ArrowRight, ShieldCheck, Check } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { CamSetupPlan, CamOperation } from '@/types/cam';
import { cn } from '@/lib/utils';

interface MultiSetupManagerProps {
    camSetups?: CamSetupPlan[] | any[];
    activeSetupId?: string | null;
    onSelectSetup?: (setupId: string) => void;
    onAddSetup?: (preset: string) => void;
    operations?: CamOperation[];
    activeFilter?: string; // 'all' or setupId
    onFilterChange?: (setupId: string) => void;
    viewMode?: 'table' | 'tree';
    onViewModeChange?: (mode: 'table' | 'tree') => void;
    compact?: boolean;
}

export function MultiSetupManager({
    camSetups = [],
    activeSetupId,
    onSelectSetup,
    onAddSetup,
    operations = [],
    activeFilter = 'all',
    onFilterChange,
    viewMode,
    onViewModeChange,
    compact = false,
}: MultiSetupManagerProps) {
    const baseSetups = camSetups && camSetups.length > 0 ? [...camSetups] : [
        {
            setupId: 'setup_001',
            setupName: 'Setup 1 - Top Milling',
            wcs: 'G54',
            workCoordinateSystem: 'G54',
            toolAxis: [0, 0, 1],
            rotation_deg: [0, 0, 0],
            requiresManualReclamp: false,
        }
    ];

    const knownIds = new Set(baseSetups.map(s => s.setupId || s.id));
    operations.forEach(op => {
        const sid = op.setup_id || (op as any).setupId;
        if (sid && !knownIds.has(sid)) {
            knownIds.add(sid);
            const isFlip = sid === 'setup_002' || String(sid).toLowerCase().includes('flip');
            baseSetups.push({
                setupId: sid,
                setupName: (op as any).setup_name || (op as any).notes?.setup_name || (isFlip ? `Setup ${baseSetups.length + 1} - Bottom Flip` : `Setup ${baseSetups.length + 1}`),
                wcs: (op as any).work_offset || (op as any).notes?.work_offset || (isFlip ? 'G55' : `G${54 + baseSetups.length}`),
                workCoordinateSystem: (op as any).work_offset || (op as any).notes?.work_offset || (isFlip ? 'G55' : `G${54 + baseSetups.length}`),
                toolAxis: isFlip ? [0, 0, -1] : [0, 0, 1],
                rotation_deg: isFlip ? [180, 0, 0] : [0, 0, 0],
                requiresManualReclamp: isFlip,
            });
        }
    });

    const getOpCountForSetup = (sid: string) => {
        return operations.filter(op => {
            const s = op.setup_id || (op as any).setupId;
            return s === sid || (!s && sid === 'setup_001');
        }).length;
    };

    // Before operations are generated, show only primary Setup 1.
    // When operations are generated, only show setups with actual operations.
    const setups = operations.length > 0
        ? baseSetups.filter((s, idx) => {
            const sid = s.setupId || s.id || `setup_${idx + 1}`;
            return getOpCountForSetup(sid) > 0 || sid === 'setup_001';
        })
        : [baseSetups[0] || {
            setupId: 'setup_001',
            setupName: 'Setup 1 - Top Milling',
            wcs: 'G54',
            workCoordinateSystem: 'G54',
            toolAxis: [0, 0, 1],
            rotation_deg: [0, 0, 0],
            requiresManualReclamp: false,
        }];

    const currentActiveId = activeSetupId || setups[0]?.setupId || 'setup_001';

    return (
        <div className="flex flex-col gap-3 p-3.5 rounded-2xl bg-card/60 border border-border/60 shadow-sm backdrop-blur-md">
            {/* Top Bar: Title & Action Buttons */}
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                    <div className="p-2 rounded-xl bg-cyan-500/10 border border-cyan-500/20 text-cyan-400">
                        <Layers className="size-4" />
                    </div>
                    <div>
                        <div className="flex items-center gap-2">
                            <h4 className="text-xs font-bold uppercase tracking-wider text-foreground">
                                Operations Planning
                            </h4>
                            <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                                {operations.length} Ops &bull; {setups.length} Setup{setups.length === 1 ? '' : 's'}
                            </span>
                        </div>
                        <p className="text-[11px] text-muted-foreground mt-0.5">
                            Manage multi-axis fixture orientations, verify cutter sequences, and configure toolpaths
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-2">

                    {onAddSetup && (
                        <Select onValueChange={(val: any) => { if (typeof val === 'string' && val) onAddSetup(val); }}>
                            <SelectTrigger className="h-8 px-3 bg-muted/40 hover:bg-muted/80 border-border/60 rounded-xl text-[11px] font-semibold text-foreground transition-all cursor-pointer">
                                <div className="flex items-center gap-1.5">
                                    <Plus className="size-3.5 text-blue-400" />
                                    <span>+ Add Orientation</span>
                                </div>
                            </SelectTrigger>
                            <SelectContent className="z-50">
                                <SelectItem value="flip_180">Bottom Flip 180° (OP20 / G55)</SelectItem>
                                <SelectItem value="side_pos_x">Side Milling Right (+X / G56)</SelectItem>
                                <SelectItem value="side_neg_x">Side Milling Left (-X / G57)</SelectItem>
                                <SelectItem value="end_pos_y">End Face Front (+Y / G58)</SelectItem>
                                <SelectItem value="end_neg_y">End Face Back (-Y / G59)</SelectItem>
                            </SelectContent>
                        </Select>
                    )}

                    {viewMode && onViewModeChange && (
                        <>
                            <div className="h-4 w-px bg-border/60 mx-1" />
                            <div className="flex items-center gap-1 bg-white/5 rounded-lg p-0.5 border border-white/10">
                                <button
                                    type="button"
                                    onClick={() => onViewModeChange('table')}
                                    className={cn(
                                        "px-2.5 py-1 rounded text-[10px] font-bold uppercase tracking-wider transition-all cursor-pointer",
                                        viewMode === 'table' ? "bg-primary text-white shadow-sm" : "text-muted-foreground hover:text-white"
                                    )}
                                >
                                    Table View
                                </button>
                                <button
                                    type="button"
                                    onClick={() => onViewModeChange('tree')}
                                    className={cn(
                                        "px-2.5 py-1 rounded text-[10px] font-bold uppercase tracking-wider transition-all cursor-pointer",
                                        viewMode === 'tree' ? "bg-primary text-white shadow-sm" : "text-muted-foreground hover:text-white"
                                    )}
                                >
                                    Tree View
                                </button>
                            </div>
                        </>
                    )}
                </div>
            </div>

            {/* Setups Filter Bar / Selector Pills */}
            <div className="flex items-center gap-2 overflow-x-auto custom-scrollbar pt-2 border-t border-border/40">
                {/* ALL Setups Pill */}
                {onFilterChange && (
                    <button
                        type="button"
                        onClick={() => onFilterChange('all')}
                        className={cn(
                            "flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-bold transition-all shrink-0 cursor-pointer border",
                            activeFilter === 'all'
                                ? "bg-primary text-primary-foreground border-primary shadow-[0_0_10px_rgba(6,182,212,0.3)]"
                                : "bg-muted/30 text-muted-foreground border-border/50 hover:bg-muted/60 hover:text-foreground"
                        )}
                    >
                        <span>ALL SETUPS</span>
                        <span className="text-[10px] font-mono px-1.5 py-0.2 rounded-full bg-black/20 text-inherit">
                            {operations.length}
                        </span>
                    </button>
                )}

                {/* Individual Setup Cards / Tabs */}
                {setups.map((s, idx) => {
                    const sid = s.setupId || s.id || `setup_${idx + 1}`;
                    const isSelected = onFilterChange ? activeFilter === sid : currentActiveId === sid;
                    const opCount = getOpCountForSetup(sid);
                    const wcs = s.workCoordinateSystem || s.wcs || `G${54 + idx}`;
                    const toolAxis = s.toolAxis || [0, 0, 1];
                    const isFlip = Boolean(s.requiresManualReclamp || (Array.isArray(toolAxis) && toolAxis[2] < 0));
                    const rot = s.rotation_deg || (idx === 0 ? [0, 0, 0] : [180, 0, 0]);
                    const rotStr = Array.isArray(rot) ? `${rot[0]}°, ${rot[1]}°, ${rot[2]}°` : '0°';

                    return (
                        <div
                            key={sid}
                            onClick={() => {
                                onSelectSetup?.(sid);
                                onFilterChange?.(sid);
                            }}
                            className={cn(
                                "flex items-center gap-2.5 px-3 py-1.5 rounded-xl text-xs transition-all shrink-0 cursor-pointer border select-none",
                                isSelected
                                    ? "bg-blue-600/15 border-blue-500/60 shadow-[0_0_12px_rgba(59,130,246,0.25)] ring-1 ring-blue-500/30"
                                    : "bg-muted/30 border-border/40 hover:bg-muted/60 hover:border-border/80 text-foreground"
                            )}
                        >
                            <span className="font-mono text-[10px] font-black px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400 border border-blue-500/30">
                                {wcs}
                            </span>

                            <div className="flex flex-col">
                                <div className="flex items-center gap-1.5">
                                    <span className="font-bold text-foreground truncate max-w-[140px]">
                                        {s.setupName || s.name || `Setup ${idx + 1}`}
                                    </span>
                                    {isFlip && (
                                        <span className="text-[9px] font-bold text-amber-400 bg-amber-500/15 border border-amber-500/30 rounded px-1 flex items-center gap-0.5">
                                            <RotateCcw className="size-2.5" />
                                            Flip
                                        </span>
                                    )}
                                </div>
                                {!compact && (
                                    <span className="text-[10px] text-muted-foreground font-mono">
                                        [{rotStr}] &bull; {opCount} op{opCount === 1 ? '' : 's'}
                                    </span>
                                )}
                            </div>

                            <span className={cn(
                                "text-[10px] font-mono px-1.5 py-0.5 rounded-full font-bold ml-1",
                                isSelected ? "bg-blue-500/20 text-blue-300" : "bg-muted text-muted-foreground"
                            )}>
                                {opCount}
                            </span>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
