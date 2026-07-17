import type { SetupSettings, StockType, MaterialType, WorkCoordinateSystem, OriginPosition, PostProcessor } from '@/types/cam';
import { MACHINE_MATRIX, MachineType, ControllerId, PostProcessorId, MachineProfile } from '@/lib/cam/machineProfiles';
import { getProfilesForMachineType, getCompatibleControllers, getCompatiblePostProcessors } from '@/lib/cam/machineValidation';
import { AlertTriangle, Info } from 'lucide-react';
import { StockPreview } from './StockPreview';
import { MachineSelectionModal } from './MachineSelectionModal';
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
};

export function SetupSection({ setup, onChange }: SetupSectionProps) {
    const update = (field: keyof SetupSettings, value: any) => {
        onChange({ ...setup, internalUnits: 'mm', [field]: value });
    };

    const isInch = (setup.displayUnits || setup.units) === 'in';
    const displayMultiplier = isInch ? (1 / 25.4) : 1.0;
    const saveMultiplier = isInch ? 25.4 : 1.0;

    const toDisplay = (val: number | undefined) => {
        if (val === undefined) return 0;
        return Number((val * displayMultiplier).toFixed(4));
    };

    const fromDisplay = (val: number) => {
        return val * saveMultiplier;
    };

    const updateDimension = (index: number, value: number) => {
        const newDims = [...(setup.stockDimensions || [0,0,0])] as [number, number, number];
        newDims[index] = fromDisplay(value);
        onChange({ ...setup, internalUnits: 'mm', stockDimensions: newDims });
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
            <div className="flex flex-col gap-6 bg-muted/5 border border-border/40 rounded-2xl p-6 shadow-sm relative overflow-hidden">
                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-emerald-500/50 to-green-500/50 opacity-50" />

                <h3 className="text-[11px] font-bold uppercase tracking-widest text-primary border-b border-border/40 pb-3 flex items-center gap-2">
                    Workpiece & Zero Location
                </h3>

                <div className="flex flex-col gap-5">
                    <div className="grid grid-cols-2 gap-4">
                        <div className="flex flex-col gap-2">
                            <label className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/80 pl-1">Stock Type</label>
                            <Select
                                value={setup.stockType || ""}
                                onValueChange={(val) => update('stockType', val as StockType)}
                            >
                                <SelectTrigger className="w-full h-auto px-4 py-3 bg-background/50 border-border/50 rounded-xl text-xs text-foreground focus:border-primary/50 focus:ring-1 focus:ring-primary/20 shadow-sm data-[placeholder]:text-muted-foreground/70">
                                    <SelectValue placeholder="Select Stock Type" />
                                </SelectTrigger>
                                <SelectContent className="z-50 max-h-64">
                                    <SelectItem value="box">Box (Relative to Model)</SelectItem>
                                    <SelectItem value="cylinder">Cylinder</SelectItem>
                                    <SelectItem value="from_model">From Solid Model</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="flex flex-col gap-2">
                            <label className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/80 pl-1">Material</label>
                            <Select
                                value={setup.material || ""}
                                onValueChange={(val) => update('material', val as MaterialType)}
                            >
                                <SelectTrigger className="w-full h-auto px-4 py-3 bg-background/50 border-border/50 rounded-xl text-xs text-foreground focus:border-primary/50 focus:ring-1 focus:ring-primary/20 shadow-sm data-[placeholder]:text-muted-foreground/70">
                                    <SelectValue placeholder="Select Material" />
                                </SelectTrigger>
                                <SelectContent className="z-50 max-h-64">
                                    <SelectItem value="aluminum_6061">Aluminum 6061</SelectItem>
                                    <SelectItem value="mild_steel">Mild Steel</SelectItem>
                                    <SelectItem value="stainless_steel">Stainless Steel</SelectItem>
                                    <SelectItem value="brass">Brass</SelectItem>
                                    <SelectItem value="plastic">Plastic / Delrin</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    <div className="flex flex-col gap-2">
                        <label className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/80 pl-1">Extra Material Around Part {isInch ? "(in)" : "(mm)"}</label>
                        <input
                            type="number"
                            step={isInch ? "0.01" : "0.1"}
                            value={toDisplay(setup.stockOffset)}
                            onChange={(e) => update('stockOffset', fromDisplay(parseFloat(e.target.value) || 0))}
                            className="w-full bg-background/50 border border-border/50 rounded-xl px-4 py-3 text-xs font-mono text-foreground focus:border-primary/50 focus:ring-1 focus:ring-primary/20 outline-none transition-all shadow-sm"
                        />
                    </div>

                    <div className="flex flex-col gap-2">
                        <label className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/80 pl-1">Stock Dimensions {isInch ? "(in)" : "(mm)"}</label>
                        {setup.stockType === 'cylinder' ? (
                            <div className="grid grid-cols-2 gap-3">
                                <div className="flex flex-col gap-1.5 bg-background/30 rounded-lg p-2 border border-border/30">
                                    <span className="text-[9px] uppercase text-muted-foreground/60 pl-1 font-bold tracking-widest">Diameter</span>
                                    <input
                                        type="number"
                                        value={toDisplay(setup.stockDimensions?.[0])}
                                        onChange={(e) => {
                                            const v = parseFloat(e.target.value) || 0;
                                            const newDims = [...(setup.stockDimensions || [0,0,0])] as [number, number, number];
                                            newDims[0] = fromDisplay(v);
                                            newDims[1] = fromDisplay(v);
                                            onChange({ ...setup, internalUnits: 'mm', stockDimensions: newDims });
                                        }}
                                        className="w-full bg-transparent border-none px-1 py-1 text-sm font-mono text-foreground outline-none transition-all"
                                    />
                                </div>
                                <div className="flex flex-col gap-1.5 bg-background/30 rounded-lg p-2 border border-border/30">
                                    <span className="text-[9px] uppercase text-muted-foreground/60 pl-1 font-bold tracking-widest">Height (Z)</span>
                                    <input
                                        type="number"
                                        value={toDisplay(setup.stockDimensions?.[2])}
                                        onChange={(e) => updateDimension(2, parseFloat(e.target.value) || 0)}
                                        className="w-full bg-transparent border-none px-1 py-1 text-sm font-mono text-foreground outline-none transition-all"
                                    />
                                </div>
                            </div>
                        ) : (
                            <div className="grid grid-cols-3 gap-3">
                                <div className="flex flex-col gap-1.5 bg-background/30 rounded-lg p-2 border border-border/30">
                                    <span className="text-[9px] uppercase text-muted-foreground/60 pl-1 font-bold tracking-widest">Length (X)</span>
                                    <input
                                        type="number"
                                        value={toDisplay(setup.stockDimensions?.[0])}
                                        onChange={(e) => updateDimension(0, parseFloat(e.target.value) || 0)}
                                        className="w-full bg-transparent border-none px-1 py-1 text-sm font-mono text-foreground outline-none transition-all"
                                    />
                                </div>
                                <div className="flex flex-col gap-1.5 bg-background/30 rounded-lg p-2 border border-border/30">
                                    <span className="text-[9px] uppercase text-muted-foreground/60 pl-1 font-bold tracking-widest">Width (Y)</span>
                                    <input
                                        type="number"
                                        value={toDisplay(setup.stockDimensions?.[1])}
                                        onChange={(e) => updateDimension(1, parseFloat(e.target.value) || 0)}
                                        className="w-full bg-transparent border-none px-1 py-1 text-sm font-mono text-foreground outline-none transition-all"
                                    />
                                </div>
                                <div className="flex flex-col gap-1.5 bg-background/30 rounded-lg p-2 border border-border/30">
                                    <span className="text-[9px] uppercase text-muted-foreground/60 pl-1 font-bold tracking-widest">Height (Z)</span>
                                    <input
                                        type="number"
                                        value={toDisplay(setup.stockDimensions?.[2])}
                                        onChange={(e) => updateDimension(2, parseFloat(e.target.value) || 0)}
                                        className="w-full bg-transparent border-none px-1 py-1 text-sm font-mono text-foreground outline-none transition-all"
                                    />
                                </div>
                            </div>
                        )}
                    </div>

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
