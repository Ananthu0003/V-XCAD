import type { SetupSettings, StockType, MaterialType, WorkCoordinateSystem, OriginPosition, PostProcessor } from '@/types/cam';
import { MACHINE_MATRIX, MachineType, ControllerId, PostProcessorId, MachineProfile } from '@/lib/cam/machineProfiles';
import { getProfilesForMachineType, getCompatibleControllers, getCompatiblePostProcessors } from '@/lib/cam/machineValidation';

type SetupSectionProps = {
    setup: SetupSettings;
    onChange: (setup: SetupSettings) => void;
};

export function SetupSection({ setup, onChange }: SetupSectionProps) {
    const update = (field: keyof SetupSettings, value: any) => {
        onChange({ ...setup, [field]: value });
    };

    const updateDimension = (index: number, value: number) => {
        const newDims = [...setup.stockDimensions] as [number, number, number];
        newDims[index] = value;
        onChange({ ...setup, stockDimensions: newDims });
    };

    const handleMachineTypeChange = (val: string) => {
        const profiles = getProfilesForMachineType(val);
        const defaultProfile = profiles[0]?.id || '';
        const defaultController = profiles[0]?.defaultController || '';
        
        onChange({
            ...setup,
            machineType: val,
            machineProfile: defaultProfile,
            controller: defaultController,
            postProcessor: 'AUTO'
        });
    };

    const handleMachineProfileChange = (val: string) => {
        const profile = MACHINE_MATRIX.machineProfiles.find(p => p.id === val);
        if (profile) {
            onChange({
                ...setup,
                machineProfile: val,
                controller: profile.defaultController,
                postProcessor: 'AUTO'
            });
        }
    };

    const handleControllerChange = (val: string) => {
        onChange({
            ...setup,
            controller: val,
            postProcessor: 'AUTO'
        });
    };

    const currentProfile = MACHINE_MATRIX.machineProfiles.find(p => p.id === setup.machineProfile);
    const availableProfiles = getProfilesForMachineType(setup.machineType || 'MILL_3X_VMC');
    const availableControllers = getCompatibleControllers(setup.machineProfile || '');
    const availablePosts = getCompatiblePostProcessors(setup.machineProfile || '', setup.controller || '');

    const controllerInfo = MACHINE_MATRIX.controllers[(setup.controller as ControllerId) || 'FANUC_0I_MF'];
    const showHobbyWarning = controllerInfo && !controllerInfo.industrial && currentProfile && currentProfile.machineType !== 'ROUTER_3X';
    const showUnsupportedWarning = currentProfile && !currentProfile.camSupport.gcodeGeneration;

    return (
        <div className="flex flex-col gap-4">
            {/* Machine & Controller Configuration */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="flex flex-col gap-2">
                    <label className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/80">Machine Type</label>
                    <select
                        value={setup.machineType || 'MILL_3X_VMC'}
                        onChange={(e) => handleMachineTypeChange(e.target.value)}
                        className="w-full bg-background border border-border rounded-lg px-3 py-3 text-xs text-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50 outline-none transition-all shadow-inner"
                    >
                        {MACHINE_MATRIX.machineTypes.map(m => (
                            <option key={m.id} value={m.id}>{m.label}</option>
                        ))}
                    </select>
                </div>
                <div className="flex flex-col gap-2">
                    <label className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/80">Machine Profile</label>
                    <select
                        value={setup.machineProfile || ''}
                        onChange={(e) => handleMachineProfileChange(e.target.value)}
                        className="w-full bg-background border border-border rounded-lg px-3 py-3 text-xs text-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50 outline-none transition-all shadow-inner"
                    >
                        {availableProfiles.map(p => (
                            <option key={p.id} value={p.id}>{p.label}</option>
                        ))}
                    </select>
                </div>
                <div className="flex flex-col gap-2">
                    <label className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/80">Controller</label>
                    <select
                        value={setup.controller || ''}
                        onChange={(e) => handleControllerChange(e.target.value)}
                        className="w-full bg-background border border-border rounded-lg px-3 py-3 text-xs text-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50 outline-none transition-all shadow-inner"
                    >
                        {availableControllers.map(c => (
                            <option key={c} value={c}>{MACHINE_MATRIX.controllers[c].label}</option>
                        ))}
                    </select>
                </div>
                <div className="flex flex-col gap-2">
                    <label className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/80">Post Processor</label>
                    <select
                        value={setup.postProcessor || 'AUTO'}
                        onChange={(e) => update('postProcessor', e.target.value as PostProcessor)}
                        className="w-full bg-background border border-border rounded-lg px-3 py-3 text-xs text-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50 outline-none transition-all shadow-inner"
                    >
                        {availablePosts.map(p => (
                            <option key={p} value={p}>{MACHINE_MATRIX.postProcessors[p].label}</option>
                        ))}
                    </select>
                </div>
            </div>

            {showHobbyWarning && (
                <div className="bg-yellow-500/10 border border-yellow-500/50 rounded-lg p-3 text-yellow-200 text-xs flex items-start gap-2">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 shrink-0"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>
                    <div>
                        <strong className="block font-semibold mb-1">Warning: Hobby/Router Controller Selected</strong>
                        This controller is normally used for hobby/router/prototype machines, not industrial VMC machining. G-code generated may not be safe for a real industrial machine.
                    </div>
                </div>
            )}
            
            {showUnsupportedWarning && (
                <div className="bg-orange-500/10 border border-orange-500/50 rounded-lg p-3 text-orange-200 text-xs flex items-start gap-2">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 shrink-0"><circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/></svg>
                    <div>
                        <strong className="block font-semibold mb-1">Warning: G-Code Generation Not Supported</strong>
                        This machine type is available for setup configuration, but G-code generation is not supported yet.
                    </div>
                </div>
            )}

            {/* General Settings */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="flex flex-col gap-2">
                    <label className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/80">Units</label>
                    <select
                        value={setup.units}
                        onChange={(e) => update('units', e.target.value as 'mm' | 'in')}
                        className="w-full bg-background border border-border rounded-lg px-3 py-3 text-xs text-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50 outline-none transition-all shadow-inner"
                    >
                        <option value="mm">Millimeters (mm)</option>
                        <option value="in">Inches (in)</option>
                    </select>
                </div>
                <div className="flex flex-col gap-2">
                    <label className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/80">Tolerance</label>
                    <input
                        type="number"
                        step="0.001"
                        value={setup.tolerance}
                        onChange={(e) => update('tolerance', parseFloat(e.target.value) || 0)}
                        className="w-full bg-background border border-border rounded-lg px-3 py-3 text-xs font-mono text-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50 outline-none transition-all shadow-inner"
                    />
                </div>
                <div className="flex flex-col gap-2">
                    <label className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/80">Stock Offset</label>
                    <input
                        type="number"
                        step="0.1"
                        value={setup.stockOffset}
                        onChange={(e) => update('stockOffset', parseFloat(e.target.value) || 0)}
                        className="w-full bg-background border border-border rounded-lg px-3 py-3 text-xs font-mono text-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50 outline-none transition-all shadow-inner"
                    />
                </div>
            </div>

            {/* Stock Type */}
            <div className="flex flex-col gap-2">
                <label className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/80">Stock Type</label>
                <select
                    value={setup.stockType}
                    onChange={(e) => update('stockType', e.target.value as StockType)}
                    className="w-full bg-background border border-border rounded-lg px-3 py-3 text-xs text-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50 outline-none transition-all shadow-inner"
                >
                    <option value="box">Box (Relative to Model)</option>
                    <option value="cylinder">Cylinder</option>
                    <option value="from_model">From Solid Model</option>
                </select>
            </div>

            {/* Material */}
            <div className="flex flex-col gap-2">
                <label className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/80">Material</label>
                <select
                    value={setup.material}
                    onChange={(e) => update('material', e.target.value as MaterialType)}
                    className="w-full bg-background border border-border rounded-lg px-3 py-3 text-xs text-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50 outline-none transition-all shadow-inner"
                >
                    <option value="aluminum_6061">Aluminum 6061</option>
                    <option value="mild_steel">Mild Steel</option>
                    <option value="stainless_steel">Stainless Steel</option>
                    <option value="brass">Brass</option>
                    <option value="plastic">Plastic / Delrin</option>
                </select>
            </div>

            {/* Dimensions */}
            <div className="flex flex-col gap-2">
                <label className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/80">Stock Dimensions (mm)</label>
                <div className="grid grid-cols-3 gap-2">
                    <div className="flex flex-col gap-1">
                        <span className="text-[9px] uppercase text-muted-foreground/60 pl-1 font-bold">Length (X)</span>
                        <input
                            type="number"
                            value={setup.stockDimensions[0]}
                            onChange={(e) => updateDimension(0, parseFloat(e.target.value) || 0)}
                            className="w-full bg-background border border-border rounded-lg px-3 py-2 text-xs font-mono text-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50 outline-none transition-all shadow-inner"
                        />
                    </div>
                    <div className="flex flex-col gap-1">
                        <span className="text-[9px] uppercase text-muted-foreground/60 pl-1 font-bold">Width (Y)</span>
                        <input
                            type="number"
                            value={setup.stockDimensions[1]}
                            onChange={(e) => updateDimension(1, parseFloat(e.target.value) || 0)}
                            className="w-full bg-background border border-border rounded-lg px-3 py-2 text-xs font-mono text-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50 outline-none transition-all shadow-inner"
                        />
                    </div>
                    <div className="flex flex-col gap-1">
                        <span className="text-[9px] uppercase text-muted-foreground/60 pl-1 font-bold">Height (Z)</span>
                        <input
                            type="number"
                            value={setup.stockDimensions[2]}
                            onChange={(e) => updateDimension(2, parseFloat(e.target.value) || 0)}
                            className="w-full bg-background border border-border rounded-lg px-3 py-2 text-xs font-mono text-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50 outline-none transition-all shadow-inner"
                        />
                    </div>
                </div>
            </div>

            {/* WCS & Origin */}
            <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-2">
                    <label className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/80">WCS Offset</label>
                    <select
                        value={setup.wcs}
                        onChange={(e) => update('wcs', e.target.value as WorkCoordinateSystem)}
                        className="w-full bg-background border border-border rounded-lg px-3 py-3 text-xs text-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50 outline-none transition-all shadow-inner"
                    >
                        {['G54', 'G55', 'G56', 'G57', 'G58', 'G59'].map(o => (
                            <option key={o} value={o}>{o}</option>
                        ))}
                    </select>
                </div>
                <div className="flex flex-col gap-2">
                    <label className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/80">Origin</label>
                    <select
                        value={setup.originPosition}
                        onChange={(e) => update('originPosition', e.target.value as OriginPosition)}
                        className="w-full bg-background border border-border rounded-lg px-3 py-3 text-xs text-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50 outline-none transition-all shadow-inner"
                    >
                        <option value="top_center">Top Center</option>
                        <option value="bottom_center">Bottom Center</option>
                        <option value="model_center">Model Center</option>
                        <option value="front_left_top">Front Left Top</option>
                    </select>
                </div>
            </div>
        </div>
    );
}
