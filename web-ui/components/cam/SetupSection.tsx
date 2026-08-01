import React, { useState, useEffect } from 'react';
import type { SetupSettings, StockType, MaterialType, WorkCoordinateSystem, OriginPosition, PostProcessor } from '@/types/cam';
import { MACHINE_MATRIX, MachineType, ControllerId, PostProcessorId, MachineProfile } from '@/lib/cam/machineProfiles';
import { getProfilesForMachineType, getCompatibleControllers, getCompatiblePostProcessors } from '@/lib/cam/machineValidation';
import { MATERIAL_MATRIX, getMaterialProfile, getMaterialsByCategory } from '@/lib/cam/materialProfiles';
import { AlertTriangle, Info, Box, Cylinder, Layers, Upload, FileCheck } from 'lucide-react';
import { StockPreview } from './StockPreview';
import { MachineSelectionModal } from './MachineSelectionModal';
import { MaterialSelectionModal } from './MaterialSelectionModal';
import { PostProcessorSelectionModal } from './PostProcessorSelectionModal';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, SelectGroup, SelectLabel, SelectSeparator } from '@/components/ui/select';


const CATEGORIES = [
    { label: "Milling Centers", match: ["MILL_", "_VMC", "_HMC", "DRILL_TAP"] },
    { label: "Turning Centers", match: ["LATHE", "MILL_TURN"] },
    { label: "Routers", match: ["ROUTER"] },
    { label: "Waterjet & Plasma", match: ["WATERJET", "PLASMA"] },
    { label: "Lasers", match: ["LASER"] },
    { label: "EDM", match: ["EDM"] },
    { label: "Grinders", match: ["GRIND"] }
];

function getGroupForId(id: string) {
    for (const cat of CATEGORIES) {
        if (cat.match.some(m => id.includes(m))) return cat.label;
    }
    return "Other";
}

function groupItems(items: any[]) {
    const grouped = new Map<string, any[]>();
    for (const item of items) {
        const g = getGroupForId(item.id);
        if (!grouped.has(g)) grouped.set(g, []);
        grouped.get(g)!.push(item);
    }
    return Array.from(grouped.entries());
}

type SetupSectionProps = {
    setup: SetupSettings;
    onChange: (setup: SetupSettings) => void;
    parameters?: Record<string, any>;
    setupMetadata?: any;
};

function NumberInput({ value, onChange, step, className }: { value: number | string, onChange: (v: string) => void, step?: string, className?: string }) {
    const [localValue, setLocalValue] = useState(String(value));
    
    useEffect(() => {
        setLocalValue(String(value));
    }, [value]);

    return (
        <input
            type="number"
            step={step}
            value={localValue}
            onChange={(e) => setLocalValue(e.target.value)}
            onBlur={(e) => {
                if (e.target.value !== String(value)) {
                    onChange(e.target.value);
                }
            }}
            onKeyDown={(e) => {
                if (e.key === 'Enter') {
                    e.currentTarget.blur();
                }
            }}
            className={className}
        />
    );
}

export function SetupSection({ setup, onChange, parameters, setupMetadata }: SetupSectionProps) {
    const update = (field: keyof SetupSettings, value: any) => {
        onChange({ ...setup, internalUnits: 'mm', [field]: value });
    };

    const isInch = (setup.displayUnits || setup.units) === 'in';

    const fromDisplay = (val: number) => {
        const mult = isInch ? 25.4 : 1.0;
        return val * mult;
    };

    const toDisplay = (val: number | undefined) => {
        if (val === undefined || isNaN(val)) return 0;
        const mult = isInch ? (1 / 25.4) : 1.0;
        return Number((val * mult).toFixed(4));
    };

    const updateDimension = (index: number, value: number) => {
        const newDims = [...(setup.stockDimensions || [0,0,0])] as [number, number, number];
        newDims[index] = fromDisplay(value);
        onChange({ ...setup, internalUnits: 'mm', stockDimensions: newDims });
    };

    const getBasePartDims = () => {
        let x = 0, y = 0, z = 0, dia = 0;
        let source = "Defaults";

        if (setupMetadata?.resolvedStock?.dimensions) {
            const d = setupMetadata.resolvedStock.dimensions;
            x = Number(d[0]) || 0;
            y = Number(d[1]) || 0;
            z = Number(d[2]) || 0;
            source = "CAD Geometry Bounds";
        } else if (setupMetadata?.topology?.bounds && Array.isArray(setupMetadata.topology.bounds) && setupMetadata.topology.bounds.length >= 6) {
            const b = setupMetadata.topology.bounds;
            x = Math.abs(b[3] - b[0]);
            y = Math.abs(b[4] - b[1]);
            z = Math.abs(b[5] - b[2]);
            source = "CAD Topology";
        }

        if (parameters && typeof parameters === 'object') {
            const norm = Object.keys(parameters).reduce((acc, k) => {
                acc[k.toLowerCase().replace(/[\s_\-]/g, '')] = Number(parameters[k]) || 0;
                return acc;
            }, {} as Record<string, number>);

            const pX = norm['length'] || norm['totallength'] || norm['partlength'] || norm['xspan'] || norm['l'];
            const pY = norm['width'] || norm['totalwidth'] || norm['partwidth'] || norm['yspan'] || norm['w'];
            const pZ = norm['height'] || norm['totalheight'] || norm['partheight'] || norm['depth'] || norm['thickness'] || norm['zspan'] || norm['h'];
            const pD = norm['outerdiameter'] || norm['totaldiameter'] || norm['diameter'] || norm['partdiameter'] || norm['stockdiameter'] || norm['od'] || norm['dia'];

            if (pX && pX > 0) x = pX;
            if (pY && pY > 0) y = pY;
            if (pZ && pZ > 0) z = pZ;
            if (pD && pD > 0) dia = pD;

            // For cylindrical/turned parts or when total_length is specified as X/Length:
            if (!z && (pX || pY)) {
                z = pX || pY;
            }

            if (pD && (!x || !y)) {
                if (!x) x = pD;
                if (!y) y = pD;
            }

            if (x || y || z || dia) {
                source = "Extracted Model Parameters";
            }
        }

        const rawSetup = setup as any;
        if (rawSetup?.partDimensions && Array.isArray(rawSetup.partDimensions)) {
            if (!x) x = Number(rawSetup.partDimensions[0]) || 0;
            if (!y) y = Number(rawSetup.partDimensions[1]) || 0;
            if (!z) z = Number(rawSetup.partDimensions[2]) || 0;
        }

        if (!x && dia) x = dia;
        if (!y && dia) y = dia;

        if (!x) x = 100;
        if (!y) y = 100;
        if (!z) z = 20;
        if (!dia) dia = Math.max(x, y);

        return { x, y, z, dia, source };
    };

    
    
    
    const currentProfile = MACHINE_MATRIX.machineProfiles.find(p => p.id === setup.machineProfile);
    const availableProfiles = getProfilesForMachineType(setup.machineType || '');
    const availableControllers = getCompatibleControllers(setup.machineProfile || '');
    const availablePosts = getCompatiblePostProcessors(setup.machineProfile || '', setup.controller || '').filter(p => p !== 'AUTO');

    const controllerInfo = MACHINE_MATRIX.controllers[(setup.controller as ControllerId) || 'FANUC_0I_MF'];
    const showHobbyWarning = controllerInfo && !controllerInfo.industrial && currentProfile && currentProfile.machineType !== 'ROUTER_3X';
    const showUnsupportedWarning = currentProfile && !currentProfile.camSupport.gcodeGeneration;

    return (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 animate-in fade-in duration-300">
            {/* Left Column: Machine Configuration */}
            <div className="flex flex-col gap-6 bg-muted/5 border border-border/40 rounded-2xl p-6 shadow-sm relative overflow-hidden">
                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-500/50 to-cyan-500/50 opacity-50" />
                
                <h3 className="text-[11px] font-bold uppercase tracking-widest text-primary border-b border-border/40 pb-3 flex items-center gap-2">
                    Machine Configuration
                </h3>
                
                <div className="flex flex-col gap-5">
                                        <div className="flex flex-col gap-2 mb-2">
                        <label className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/80 pl-1">CNC Machine Selection</label>
                        <MachineSelectionModal 
                            currentProfileId={setup.machineProfile || ""}
                            onSelect={(machineType, profileId, controller, postProcessor) => {
                                onChange({
                                    ...setup,
                                    machineType,
                                    machineProfile: profileId,
                                    controller,
                                    postProcessor: 'AUTO'
                                });
                            }}
                        />
                    </div>

                                        <div className="flex flex-col gap-2 mb-2">
                        <label className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/80 pl-1">Controller & CNC Format</label>
                        <PostProcessorSelectionModal 
                            machineProfileId={setup.machineProfile || ""}
                            currentPostId={setup.postProcessor || "AUTO"}
                            currentControllerId={setup.controller || ""}
                            onSelect={(postId, controllerId) => {
                                onChange({
                                    ...setup,
                                    postProcessor: postId as PostProcessor,
                                    controller: controllerId
                                });
                            }}
                        />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div className="flex flex-col gap-2">
                            <label className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/80 pl-1">Measurement Units</label>
                            <Select
                                value={setup.displayUnits || setup.units || ""}
                                onValueChange={(val) => {
                                    update('displayUnits', val as 'mm' | 'in');
                                    update('units', val as 'mm' | 'in');
                                }}
                            >
                                <SelectTrigger className="w-full h-auto px-4 py-3 bg-background/50 border-border/50 rounded-xl text-xs text-foreground focus:border-primary/50 focus:ring-1 focus:ring-primary/20 shadow-sm data-[placeholder]:text-muted-foreground/70">
                                    <SelectValue placeholder="Select Units" />
                                </SelectTrigger>
                                <SelectContent className="z-50 max-h-64">
                                    <SelectItem value="mm">Millimeters (mm)</SelectItem>
                                    <SelectItem value="in">Inches (in)</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="flex flex-col gap-2">
                            <label className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/80 pl-1">Post Output Units</label>
                            <Select
                                value={setup.postOutputUnits || setup.units || ""}
                                onValueChange={(val) => update('postOutputUnits', val as 'mm' | 'in')}
                            >
                                <SelectTrigger className="w-full h-auto px-4 py-3 bg-background/50 border-border/50 rounded-xl text-xs text-foreground focus:border-primary/50 focus:ring-1 focus:ring-primary/20 shadow-sm data-[placeholder]:text-muted-foreground/70">
                                    <SelectValue placeholder="Select Output Units" />
                                </SelectTrigger>
                                <SelectContent className="z-50 max-h-64">
                                    <SelectItem value="mm">Millimeters (G21)</SelectItem>
                                    <SelectItem value="in">Inches (G20)</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                    
                    <div className="flex flex-col gap-2">
                        <label className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/80 pl-1">Toolpath Accuracy {isInch ? "(in)" : "(mm)"}</label>
                        <input
                            type="number"
                            step={isInch ? "0.0001" : "0.001"}
                            value={toDisplay(setup.tolerance)}
                            onChange={(e) => update('tolerance', fromDisplay(parseFloat(e.target.value) || 0))}
                            className="w-full bg-background/50 border border-border/50 rounded-xl px-4 py-3 text-xs font-mono text-foreground focus:border-primary/50 focus:ring-1 focus:ring-primary/20 outline-none transition-all shadow-sm"
                        />
                        <span className="text-[10px] text-muted-foreground/60 pl-1">Tighter accuracy takes longer to generate. Default (0.01) is fine for most jobs.</span>
                    </div>

                    {showHobbyWarning && (
                        <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4 text-amber-500/90 text-[11px] flex items-start gap-3 mt-2 shadow-sm">
                            <AlertTriangle className="size-4 shrink-0 mt-0.5" />
                            <div className="flex flex-col gap-1">
                                <strong className="font-bold uppercase tracking-wider text-[10px]">Warning: Hobby Controller</strong>
                                <span className="leading-relaxed">This controller is normally used for hobby/prototype machines. G-code generated may not be safe for industrial machining.</span>
                            </div>
                        </div>
                    )}
                    
                    {showUnsupportedWarning && (
                        <div className="bg-orange-500/10 border border-orange-500/20 rounded-xl p-4 text-orange-500/90 text-[11px] flex items-start gap-3 mt-2 shadow-sm">
                            <AlertTriangle className="size-4 shrink-0 mt-0.5" />
                            <div className="flex flex-col gap-1">
                                <strong className="font-bold uppercase tracking-wider text-[10px]">Warning: Unsupported Post</strong>
                                <span className="leading-relaxed">This machine type is available for setup configuration, but G-code generation is not supported yet.</span>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Right Column: Workpiece & Setup */}
            <div className="flex flex-col gap-5 bg-muted/5 border border-border/40 rounded-2xl p-5 shadow-sm relative overflow-hidden">
                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-emerald-500/50 to-green-500/50 opacity-50" />

                <h3 className="text-[11px] font-bold uppercase tracking-widest text-primary border-b border-border/40 pb-2.5 flex items-center gap-2">
                    Workpiece & Zero Location
                </h3>

                <div className="flex flex-col gap-4">
                    {/* Integrated Stock Shape Selection Cards with Real-Time Dimensions */}
                    <div className="grid grid-cols-2 gap-3">
                        {/* Card 1: Rectangular Box */}
                        {(() => {
                            const st = setup.stockType || 'relative_box';
                            const isSelected = st.includes('box') || !setup.stockType;
                            const { x: partX, y: partY, z: partZ } = getBasePartDims();
                            const xy = setup.stockOffsetXY ?? setup.stockOffset ?? 2;
                            const top = setup.stockOffsetTop ?? 1;
                            const bot = setup.clampingAllowance ?? setup.stockOffsetBottom ?? setup.axialOffsetBottom ?? 5.0;
                            const autoX = partX + (2 * xy);
                            const autoY = partY + (2 * xy);
                            const autoZ = partZ + top + bot;

                            const isRel = st.startsWith('relative') || !st;
                            const dims = (isRel || !setup.stockDimensions) 
                                ? [autoX, autoY, autoZ] 
                                : setup.stockDimensions;

                            const unitStr = isInch ? "in" : "mm";
                            const dimStr = `${toDisplay(dims[0])} × ${toDisplay(dims[1])} × ${toDisplay(dims[2])} ${unitStr}`;
                            return (
                                <button
                                    type="button"
                                    onClick={() => {
                                        const nextSt = isRel ? 'relative_box' : 'fixed_box';
                                        onChange({
                                            ...setup,
                                            stockType: nextSt,
                                            stockOffsetXY: xy,
                                            stockOffsetTop: top,
                                            stockOffsetBottom: bot,
                                            stockDimensions: [autoX, autoY, autoZ]
                                        });
                                    }}
                                    className={`flex flex-col p-3 rounded-xl border text-left transition-all ${
                                        isSelected 
                                            ? 'bg-blue-500/15 border-blue-500 shadow-md shadow-blue-500/20 text-foreground' 
                                            : 'bg-background/40 border-border/40 text-muted-foreground hover:bg-background/80 hover:border-border'
                                    }`}
                                >
                                    <div className="flex items-center justify-between w-full mb-1">
                                        <div className="flex items-center gap-2">
                                            <Box className={`size-4 ${isSelected ? 'text-blue-400' : 'text-muted-foreground'}`} />
                                            <span className="text-xs font-bold text-foreground">Rectangular Box</span>
                                        </div>
                                        {isSelected && <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />}
                                    </div>
                                    <span className="text-[10px] font-mono text-blue-400 font-bold mt-0.5">{dimStr}</span>
                                </button>
                            );
                        })()}

                        {/* Card 2: Cylindrical Bar */}
                        {(() => {
                            const st = setup.stockType || '';
                            const isSelected = st.includes('cylinder');
                            const { z: partZ, dia: partDia } = getBasePartDims();
                            const rOff = setup.radialOffset ?? 1;
                            const aTop = setup.axialOffsetTop ?? 1;
                            const aBot = setup.clampingAllowance ?? setup.axialOffsetBottom ?? setup.stockOffsetBottom ?? 5.0;
                            const autoDia = partDia + (2 * rOff);
                            const autoLen = partZ + aTop + aBot;

                            const isRel = st.startsWith('relative') || !st;
                            const dims = (isRel || !setup.stockDimensions) 
                                ? [autoDia, autoDia, autoLen] 
                                : (setup.stockDimensions || [autoDia, autoDia, autoLen]);

                            const unitStr = isInch ? "in" : "mm";
                            const dia = toDisplay(dims[0]);
                            const h = toDisplay(dims[2] || dims[1]);
                            const dimStr = `ø ${dia} × ${h} ${unitStr}`;
                            return (
                                <button
                                    type="button"
                                    onClick={() => {
                                        const nextSt = isRel ? 'relative_cylinder' : 'fixed_cylinder';
                                        onChange({
                                            ...setup,
                                            stockType: nextSt,
                                            radialOffset: rOff,
                                            axialOffsetTop: aTop,
                                            axialOffsetBottom: aBot,
                                            cylinderDiameter: autoDia,
                                            cylinderLength: autoLen,
                                            stockDimensions: [autoDia, autoDia, autoLen]
                                        });
                                    }}
                                    className={`flex flex-col p-3 rounded-xl border text-left transition-all ${
                                        isSelected 
                                            ? 'bg-cyan-500/15 border-cyan-500 shadow-md shadow-cyan-500/20 text-foreground' 
                                            : 'bg-background/40 border-border/40 text-muted-foreground hover:bg-background/80 hover:border-border'
                                    }`}
                                >
                                    <div className="flex items-center justify-between w-full mb-1">
                                        <div className="flex items-center gap-2">
                                            <Cylinder className={`size-4 ${isSelected ? 'text-cyan-400' : 'text-muted-foreground'}`} />
                                            <span className="text-xs font-bold text-foreground">Cylindrical Bar</span>
                                        </div>
                                        {isSelected && <span className="w-2 h-2 rounded-full bg-cyan-500 animate-pulse" />}
                                    </div>
                                    <span className="text-[10px] font-mono text-cyan-300 font-bold mt-0.5">{dimStr}</span>
                                </button>
                            );
                        })()}
                    </div>

                    {/* Unified Stock & Workholding Control Card */}
                    <div className="flex flex-col gap-4 p-4 rounded-xl bg-background/30 border border-border/40">
                        {/* Header Row: Sizing Mode Toggle + Workpiece Material Selection */}
                        <div className="grid grid-cols-2 gap-4 pb-3 border-b border-border/30">
                            <div className="flex flex-col gap-1.5">
                                <label className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/80">Sizing Mode</label>
                                <div className="flex items-center p-1 bg-background/50 rounded-xl border border-border/40">
                                    {(() => {
                                        const currentSt = setup.stockType || 'relative_box';
                                        const isCyl = currentSt.includes('cylinder');
                                        const isRelative = currentSt.startsWith('relative') || !setup.stockType;
                                        return (
                                            <>
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        const nextSt = isCyl ? 'relative_cylinder' : 'relative_box';
                                                        const { x: pX, y: pY, z: pZ, dia: pDia } = getBasePartDims();
                                                        const clampBot = setup.clampingAllowance ?? setup.stockOffsetBottom ?? setup.axialOffsetBottom ?? 5.0;
                                                        if (isCyl) {
                                                            const rOff = setup.radialOffset ?? 1;
                                                            const aTop = setup.axialOffsetTop ?? 1;
                                                            const cD = pDia + (2 * rOff);
                                                            const cZ = pZ + aTop + clampBot;
                                                            onChange({ ...setup, stockType: nextSt, stockDimensions: [cD, cD, cZ] });
                                                        } else {
                                                            const xy = setup.stockOffsetXY ?? setup.stockOffset ?? 2;
                                                            const top = setup.stockOffsetTop ?? 1;
                                                            const cX = pX + (2 * xy);
                                                            const cY = pY + (2 * xy);
                                                            const cZ = pZ + top + clampBot;
                                                            onChange({ ...setup, stockType: nextSt, stockDimensions: [cX, cY, cZ] });
                                                        }
                                                    }}
                                                    className={`flex-1 py-1.5 px-2 text-[10px] font-bold rounded-lg transition-all ${
                                                        isRelative 
                                                            ? 'bg-primary text-primary-foreground shadow-sm' 
                                                            : 'text-muted-foreground hover:text-foreground'
                                                    }`}
                                                >
                                                    Relative (+ Padding)
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => update('stockType', isCyl ? 'fixed_cylinder' : 'fixed_box')}
                                                    className={`flex-1 py-1.5 px-2 text-[10px] font-bold rounded-lg transition-all ${
                                                        !isRelative 
                                                            ? 'bg-primary text-primary-foreground shadow-sm' 
                                                            : 'text-muted-foreground hover:text-foreground'
                                                    }`}
                                                >
                                                    Fixed Size (Exact)
                                                </button>
                                            </>
                                        );
                                    })()}
                                </div>
                            </div>

                            <div className="flex flex-col gap-1.5">
                                <label className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/80">Workpiece Material</label>
                                <MaterialSelectionModal 
                                    currentMaterialId={setup.material}
                                    onSelect={(matId) => update('material', matId)}
                                />
                            </div>
                        </div>

                        {/* Stock Dimensions / Offsets Inputs */}
                        {(() => {
                            const st = setup.stockType || "relative_box";
                            const isRelativeBox = st === 'relative_box' || st === 'box' || !st;
                            const isFixedBox = st === 'fixed_box';
                            const isRelativeCyl = st === 'relative_cylinder' || st === 'cylinder';
                            const isFixedCyl = st === 'fixed_cylinder';
                            const { x: partX, y: partY, z: partZ, dia: partDia } = getBasePartDims();

                            const clampBot = setup.clampingAllowance ?? setup.stockOffsetBottom ?? setup.axialOffsetBottom ?? 5.0;

                            const updateRelativeBox = (xy: number, top: number) => {
                                const cX = partX + (2 * xy);
                                const cY = partY + (2 * xy);
                                const cZ = partZ + top + clampBot;
                                onChange({
                                    ...setup,
                                    internalUnits: 'mm',
                                    stockOffsetXY: xy,
                                    stockOffsetTop: top,
                                    stockOffsetBottom: clampBot,
                                    stockOffset: xy,
                                    stockDimensions: [cX, cY, cZ]
                                });
                            };

                            const updateRelativeCyl = (rad: number, top: number) => {
                                const cD = partDia + (2 * rad);
                                const cZ = partZ + top + clampBot;
                                onChange({
                                    ...setup,
                                    internalUnits: 'mm',
                                    radialOffset: rad,
                                    axialOffsetTop: top,
                                    axialOffsetBottom: clampBot,
                                    stockOffset: rad,
                                    cylinderDiameter: cD,
                                    cylinderLength: cZ,
                                    stockDimensions: [cD, cD, cZ]
                                });
                            };

                            return (
                                <div className="flex flex-col gap-3">
                                    {/* 1. Relative Box Fields — Auto-calculated Length, Width, Height */}
                                    {isRelativeBox && (() => {
                                        const xy = setup.stockOffsetXY ?? setup.stockOffset ?? 2;
                                        const top = setup.stockOffsetTop ?? 1;
                                        const autoX = partX + (2 * xy);
                                        const autoY = partY + (2 * xy);
                                        const autoZ = partZ + top + clampBot;
                                        return (
                                            <div className="grid grid-cols-3 gap-3">
                                                <div className="flex flex-col gap-1 bg-background/50 rounded-lg p-2 border border-border/30">
                                                    <span className="text-[9px] uppercase text-muted-foreground/80 font-bold">Length (X)</span>
                                                    <div className="flex items-center justify-between gap-1">
                                                        <NumberInput
                                                            step={isInch ? "0.01" : "0.1"}
                                                            value={toDisplay(autoX)}
                                                            onChange={(val) => {
                                                                const v = fromDisplay(parseFloat(val) || 0);
                                                                const newXY = (v - partX) / 2;
                                                                updateRelativeBox(Math.max(0, newXY), top);
                                                            }}
                                                            className="w-full bg-transparent border-none p-0 text-xs font-mono text-foreground outline-none font-bold"
                                                        />
                                                        <span className="text-[10px] font-mono text-muted-foreground/80 font-bold shrink-0">{isInch ? "in" : "mm"}</span>
                                                    </div>
                                                </div>
                                                <div className="flex flex-col gap-1 bg-background/50 rounded-lg p-2 border border-border/30">
                                                    <span className="text-[9px] uppercase text-muted-foreground/80 font-bold">Width (Y)</span>
                                                    <div className="flex items-center justify-between gap-1">
                                                        <NumberInput
                                                            step={isInch ? "0.01" : "0.1"}
                                                            value={toDisplay(autoY)}
                                                            onChange={(val) => {
                                                                const v = fromDisplay(parseFloat(val) || 0);
                                                                const newXY = (v - partY) / 2;
                                                                updateRelativeBox(Math.max(0, newXY), top);
                                                            }}
                                                            className="w-full bg-transparent border-none p-0 text-xs font-mono text-foreground outline-none font-bold"
                                                        />
                                                        <span className="text-[10px] font-mono text-muted-foreground/80 font-bold shrink-0">{isInch ? "in" : "mm"}</span>
                                                    </div>
                                                </div>
                                                <div className="flex flex-col gap-1 bg-background/50 rounded-lg p-2 border border-border/30">
                                                    <span className="text-[9px] uppercase text-muted-foreground/80 font-bold">Height (Z)</span>
                                                    <div className="flex items-center justify-between gap-1">
                                                        <NumberInput
                                                            step={isInch ? "0.01" : "0.1"}
                                                            value={toDisplay(autoZ)}
                                                            onChange={(val) => {
                                                                const v = fromDisplay(parseFloat(val) || 0);
                                                                const newTop = v - partZ - clampBot;
                                                                updateRelativeBox(xy, Math.max(0, newTop));
                                                            }}
                                                            className="w-full bg-transparent border-none p-0 text-xs font-mono text-foreground outline-none font-bold"
                                                        />
                                                        <span className="text-[10px] font-mono text-muted-foreground/80 font-bold shrink-0">{isInch ? "in" : "mm"}</span>
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })()}

                                    {/* 2. Fixed Box Fields */}
                                    {isFixedBox && (
                                        <div className="grid grid-cols-3 gap-3">
                                            <div className="flex flex-col gap-1 bg-background/50 rounded-lg p-2 border border-border/30">
                                                <span className="text-[9px] uppercase text-muted-foreground/80 font-bold">Length (X)</span>
                                                <div className="flex items-center justify-between gap-1">
                                                    <NumberInput
                                                        value={toDisplay(setup.stockDimensions?.[0])}
                                                        onChange={(val) => updateDimension(0, parseFloat(val) || 0)}
                                                        className="w-full bg-transparent border-none p-0 text-xs font-mono text-foreground outline-none font-bold"
                                                    />
                                                    <span className="text-[10px] font-mono text-muted-foreground/80 font-bold shrink-0">{isInch ? "in" : "mm"}</span>
                                                </div>
                                            </div>
                                            <div className="flex flex-col gap-1 bg-background/50 rounded-lg p-2 border border-border/30">
                                                <span className="text-[9px] uppercase text-muted-foreground/80 font-bold">Width (Y)</span>
                                                <div className="flex items-center justify-between gap-1">
                                                    <NumberInput
                                                        value={toDisplay(setup.stockDimensions?.[1])}
                                                        onChange={(val) => updateDimension(1, parseFloat(val) || 0)}
                                                        className="w-full bg-transparent border-none p-0 text-xs font-mono text-foreground outline-none font-bold"
                                                    />
                                                    <span className="text-[10px] font-mono text-muted-foreground/80 font-bold shrink-0">{isInch ? "in" : "mm"}</span>
                                                </div>
                                            </div>
                                            <div className="flex flex-col gap-1 bg-background/50 rounded-lg p-2 border border-border/30">
                                                <span className="text-[9px] uppercase text-muted-foreground/80 font-bold">Height (Z)</span>
                                                <div className="flex items-center justify-between gap-1">
                                                    <NumberInput
                                                        value={toDisplay(setup.stockDimensions?.[2])}
                                                        onChange={(val) => updateDimension(2, parseFloat(val) || 0)}
                                                        className="w-full bg-transparent border-none p-0 text-xs font-mono text-foreground outline-none font-bold"
                                                    />
                                                    <span className="text-[10px] font-mono text-muted-foreground/80 font-bold shrink-0">{isInch ? "in" : "mm"}</span>
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    {/* 3. Relative Cylinder Fields */}
                                    {isRelativeCyl && (() => {
                                        const rad = setup.radialOffset ?? 1;
                                        const top = setup.axialOffsetTop ?? 1;
                                        const autoDia = partDia + (2 * rad);
                                        const autoLen = partZ + top + clampBot;
                                        return (
                                            <div className="grid grid-cols-2 gap-3">
                                                <div className="flex flex-col gap-1 bg-background/50 rounded-lg p-2 border border-border/30">
                                                    <span className="text-[9px] uppercase text-muted-foreground/80 font-bold">Bar Diameter (D)</span>
                                                    <div className="flex items-center justify-between gap-1">
                                                        <NumberInput
                                                            step={isInch ? "0.01" : "0.1"}
                                                            value={toDisplay(autoDia)}
                                                            onChange={(val) => {
                                                                const v = fromDisplay(parseFloat(val) || 0);
                                                                const newRad = (v - partDia) / 2;
                                                                updateRelativeCyl(Math.max(0, newRad), top);
                                                            }}
                                                            className="w-full bg-transparent border-none p-0 text-xs font-mono text-foreground outline-none font-bold"
                                                        />
                                                        <span className="text-[10px] font-mono text-muted-foreground/80 font-bold shrink-0">{isInch ? "in" : "mm"}</span>
                                                    </div>
                                                </div>
                                                <div className="flex flex-col gap-1 bg-background/50 rounded-lg p-2 border border-border/30">
                                                    <span className="text-[9px] uppercase text-muted-foreground/80 font-bold">Bar Length (L)</span>
                                                    <div className="flex items-center justify-between gap-1">
                                                        <NumberInput
                                                            step={isInch ? "0.01" : "0.1"}
                                                            value={toDisplay(autoLen)}
                                                            onChange={(val) => {
                                                                const v = fromDisplay(parseFloat(val) || 0);
                                                                const newTop = v - partZ - clampBot;
                                                                updateRelativeCyl(rad, Math.max(0, newTop));
                                                            }}
                                                            className="w-full bg-transparent border-none p-0 text-xs font-mono text-foreground outline-none font-bold"
                                                        />
                                                        <span className="text-[10px] font-mono text-muted-foreground/80 font-bold shrink-0">{isInch ? "in" : "mm"}</span>
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })()}

                                    {/* 4. Fixed Cylinder Fields */}
                                    {isFixedCyl && (
                                        <div className="grid grid-cols-2 gap-3">
                                            <div className="flex flex-col gap-1 bg-background/50 rounded-lg p-2 border border-border/30">
                                                <span className="text-[9px] uppercase text-muted-foreground/80 font-bold">Bar Diameter (D)</span>
                                                <div className="flex items-center justify-between gap-1">
                                                    <NumberInput
                                                        value={toDisplay(setup.cylinderDiameter || setup.stockDimensions?.[0])}
                                                        onChange={(val) => {
                                                            const v = parseFloat(val) || 0;
                                                            const vMM = fromDisplay(v);
                                                            update('cylinderDiameter', vMM);
                                                            updateDimension(0, v);
                                                            updateDimension(1, v);
                                                        }}
                                                        className="w-full bg-transparent border-none p-0 text-xs font-mono text-foreground outline-none font-bold"
                                                    />
                                                    <span className="text-[10px] font-mono text-muted-foreground/80 font-bold shrink-0">{isInch ? "in" : "mm"}</span>
                                                </div>
                                            </div>
                                            <div className="flex flex-col gap-1 bg-background/50 rounded-lg p-2 border border-border/30">
                                                <span className="text-[9px] uppercase text-muted-foreground/80 font-bold">Bar Length (L)</span>
                                                <div className="flex items-center justify-between gap-1">
                                                    <NumberInput
                                                        value={toDisplay(setup.cylinderLength || setup.stockDimensions?.[2])}
                                                        onChange={(val) => {
                                                            const v = parseFloat(val) || 0;
                                                            const vMM = fromDisplay(v);
                                                            update('cylinderLength', vMM);
                                                            updateDimension(2, v);
                                                        }}
                                                        className="w-full bg-transparent border-none p-0 text-xs font-mono text-foreground outline-none font-bold"
                                                    />
                                                    <span className="text-[10px] font-mono text-muted-foreground/80 font-bold shrink-0">{isInch ? "in" : "mm"}</span>
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            );
                        })()}

                        {/* Clamping & Fixture Section */}
                        <div className="pt-3 border-t border-border/30 flex flex-col gap-2">
                            <span className="text-[9px] font-bold uppercase tracking-widest text-amber-400">Workpiece Clamping & Fixture Offsets</span>
                            <div className="grid grid-cols-2 gap-3">
                                <div className="flex flex-col gap-1 bg-background/50 rounded-lg p-2 border border-border/30">
                                    <span className="text-[9px] uppercase text-muted-foreground/80 font-bold">Bottom Clamping / Grip (-Z)</span>
                                    <div className="flex items-center justify-between gap-1">
                                        <input
                                            type="number"
                                            step={isInch ? "0.01" : "0.1"}
                                            value={toDisplay(setup.clampingAllowance ?? setup.stockOffsetBottom ?? setup.axialOffsetBottom ?? 5.0)}
                                            onChange={(e) => {
                                                const val = fromDisplay(parseFloat(e.target.value) || 0);
                                                onChange({
                                                    ...setup,
                                                    clampingAllowance: val,
                                                    stockOffsetBottom: val,
                                                    axialOffsetBottom: val
                                                });
                                            }}
                                            className="w-full bg-transparent border-none p-0 text-xs font-mono text-foreground outline-none font-bold"
                                        />
                                        <span className="text-[10px] font-mono text-amber-400 font-bold shrink-0">{isInch ? "in" : "mm"}</span>
                                    </div>
                                </div>

                                <div className="flex flex-col gap-1 bg-background/50 rounded-lg p-2 border border-border/30">
                                    <span className="text-[9px] uppercase text-muted-foreground/80 font-bold">Safety Clearance Margin</span>
                                    <div className="flex items-center justify-between gap-1">
                                        <input
                                            type="number"
                                            step={isInch ? "0.01" : "0.1"}
                                            value={toDisplay(setup.fixtureClearance ?? 3.0)}
                                            onChange={(e) => update('fixtureClearance', fromDisplay(parseFloat(e.target.value) || 0))}
                                            className="w-full bg-transparent border-none p-0 text-xs font-mono text-foreground outline-none font-bold"
                                        />
                                        <span className="text-[10px] font-mono text-amber-400 font-bold shrink-0">{isInch ? "in" : "mm"}</span>
                                    </div>
                                </div>
                            </div>

                            {(() => {
                                const grip = setup.clampingAllowance ?? setup.stockOffsetBottom ?? setup.axialOffsetBottom ?? 2.0;
                                const clearance = setup.fixtureClearance ?? 3.0;
                                const stockLength = setup.cylinderLength ?? (setup.stockDimensions?.[2]) ?? (setup.stockDimensions?.[1]) ?? 0;
                                const usableLength = stockLength > 0 ? stockLength - grip - clearance : null;
                                
                                if (usableLength !== null && usableLength <= 0) {
                                    return (
                                        <div className="mt-2 p-2 bg-red-500/10 border border-red-500/30 rounded-lg text-[10px] text-red-400 font-mono flex items-center gap-2">
                                            <span>⚠️ Grip ({toDisplay(grip)}{isInch ? "in" : "mm"}) + clearance ({toDisplay(clearance)}{isInch ? "in" : "mm"}) exceeds total stock length ({toDisplay(stockLength)}{isInch ? "in" : "mm"}).</span>
                                        </div>
                                    );
                                }
                                if (usableLength !== null && usableLength > 0) {
                                    return (
                                        <div className="mt-2 px-2 py-1 bg-amber-500/5 border border-amber-500/20 rounded-md text-[9px] text-amber-300 font-mono flex justify-between">
                                            <span>Usable Machining Length:</span>
                                            <span className="font-bold">{toDisplay(usableLength)} {isInch ? "in" : "mm"}</span>
                                        </div>
                                    );
                                }
                                return null;
                            })()}
                        </div>
                    </div>

                    {(setup.stockType === 'from_solid' || setup.stockType === 'from_model') && (
                        <div className="flex flex-col gap-3 bg-background/30 rounded-xl p-4 border border-border/40">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-purple-400 flex items-center gap-1.5">
                                <Layers className="size-3.5" /> Solid CAD Body Stock Selection
                            </span>
                            <div className="flex flex-col gap-2">
                                <label className="text-[9px] uppercase text-muted-foreground/80 font-bold tracking-wider">Select CAD Stock Body</label>
                                <Select
                                    value={setup.stockSolidId || "active_part_casting"}
                                    onValueChange={(val) => update('stockSolidId', val)}
                                >
                                    <SelectTrigger className="w-full bg-background/50 border border-border/50 rounded-xl px-4 py-2.5 text-xs text-foreground">
                                        <SelectValue placeholder="Select CAD Stock Body" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="active_part_casting">Pre-Cast Solid Body (Cast_A356_V1)</SelectItem>
                                        <SelectItem value="forged_preform">Forged Rough Preform (Forging_3D)</SelectItem>
                                        <SelectItem value="op1_semi_finished">Op-1 Semi-Finished Substrate</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                    )}

                    {setup.stockType === 'from_file' && (
                        <div className="flex flex-col gap-3 bg-background/30 rounded-xl p-4 border border-border/40">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-amber-400 flex items-center gap-1.5">
                                <FileCheck className="size-3.5" /> External Stock File (STEP / STL)
                            </span>
                            <div className="flex flex-col gap-2">
                                <label className="text-[9px] uppercase text-muted-foreground/80 font-bold tracking-wider">Import Stock Mesh / STEP File</label>
                                <div className="flex items-center gap-3">
                                    <input
                                        type="file"
                                        id="stock-file-input"
                                        accept=".step,.stp,.stl,.iges,.igs"
                                        onChange={(e) => {
                                            const f = e.target.files?.[0];
                                            if (f) {
                                                update('stockFileName', f.name);
                                                update('stockFilePath', f.name);
                                            }
                                        }}
                                        className="hidden"
                                    />
                                    <label 
                                        htmlFor="stock-file-input"
                                        className="cursor-pointer flex items-center gap-2 bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/30 px-4 py-2.5 rounded-xl text-xs font-medium transition-all"
                                    >
                                        <Upload className="size-3.5" />
                                        {setup.stockFileName ? "Change Stock File" : "Choose STEP/STL File..."}
                                    </label>
                                    {setup.stockFileName && (
                                        <span className="text-xs text-foreground/80 font-mono truncate bg-background/50 px-3 py-1.5 rounded-lg border border-border/30">
                                            {setup.stockFileName}
                                        </span>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}

                    <StockPreview 
                        stockType={setup.stockType}
                        dimensions={setup.stockDimensions || [100, 100, 20]} 
                        units={(setup.displayUnits || setup.units || 'mm') as 'mm'|'in'} 
                        origin={setup.originPosition || 'top_center'} 
                    />

                    <div className="h-px bg-border/40 my-2" />

                    {/* Zero Location Info Box */}
                    <div className="flex flex-col gap-5 bg-primary/5 border border-primary/20 rounded-xl p-5 shadow-sm">
                        <div className="flex flex-col gap-2">
                            <div className="flex items-center gap-2 mb-1">
                                <Info className="size-3.5 text-primary" />
                                <label className="text-[10px] font-bold uppercase tracking-widest text-primary">Part Zero Location</label>
                            </div>
                            <p className="text-[10px] text-foreground/70 leading-relaxed mb-2 ml-5">
                                Part Zero Location chooses where X0, Y0 and Z0 are placed on the part.
                            </p>
                            <div className="ml-5">
                                <Select
                                    value={setup.originPosition || ""}
                                    onValueChange={(val) => update('originPosition', val as OriginPosition)}
                                >
                                    <SelectTrigger className="w-full h-auto px-4 py-2.5 bg-background/80 border-primary/20 rounded-lg text-xs text-foreground focus:border-primary/60 focus:ring-1 focus:ring-primary/30 shadow-sm data-[placeholder]:text-muted-foreground/70">
                                        <SelectValue placeholder="Select Origin" />
                                    </SelectTrigger>
                                    <SelectContent className="z-50 max-h-64">
                                        <SelectItem value="top_center">Top Center</SelectItem>
                                        <SelectItem value="bottom_center">Bottom Center</SelectItem>
                                        <SelectItem value="model_center">Model Center</SelectItem>
                                        <SelectItem value="front_left_top">Front Left Top</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                        
                        <div className="flex flex-col gap-2 mt-2">
                            <div className="flex items-center gap-2 mb-1">
                                <Info className="size-3.5 text-primary" />
                                <label className="text-[10px] font-bold uppercase tracking-widest text-primary">Machine Work Offset</label>
                            </div>
                            <p className="text-[10px] text-foreground/70 leading-relaxed mb-2 ml-5">
                                The memory location in the CNC controller where the operator stores that physical zero position.
                            </p>
                            <div className="ml-5">
                                <Select
                                    value={setup.wcs || ""}
                                    onValueChange={(val) => update('wcs', val as WorkCoordinateSystem)}
                                >
                                    <SelectTrigger className="w-full h-auto px-4 py-2.5 bg-background/80 border-primary/20 rounded-lg text-xs text-foreground focus:border-primary/60 focus:ring-1 focus:ring-primary/30 shadow-sm data-[placeholder]:text-muted-foreground/70">
                                        <SelectValue placeholder="Select Offset" />
                                    </SelectTrigger>
                                    <SelectContent className="z-50 max-h-64">
                                        {['G54', 'G55', 'G56', 'G57', 'G58', 'G59'].map(o => (
                                            <SelectItem key={o} value={o}>{o}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
