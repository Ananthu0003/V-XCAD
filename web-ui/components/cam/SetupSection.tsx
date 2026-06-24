import type { SetupSettings, StockType, MaterialType, WorkCoordinateSystem, OriginPosition, PostProcessor } from '@/types/cam';

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

    const postProcessors: { label: string, value: PostProcessor }[] = [
        { label: 'Fanuc', value: 'fanuc' },
        { label: 'Haas', value: 'haas' },
        { label: 'Siemens', value: 'siemens' },
        { label: 'Heidenhain', value: 'heidenhain' },
        { label: 'Mazak', value: 'mazak' },
        { label: 'Mitsubishi', value: 'mitsubishi' },
        { label: 'GRBL', value: 'grbl' },
        { label: 'Mach3', value: 'mach3' },
        { label: 'LinuxCNC', value: 'linuxcnc' },
        { label: 'Generic ISO', value: 'iso' },
    ];

    return (
        <div className="flex flex-col gap-4">
            {/* Machine & Post Processor */}
            <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-2">
                    <label className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/80">Machine</label>
                    <input
                        type="text"
                        value={setup.machine}
                        onChange={(e) => update('machine', e.target.value)}
                        placeholder="Haas VF-2"
                        className="w-full bg-background border border-border rounded-lg px-3 py-3 text-xs text-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50 outline-none transition-all shadow-inner"
                    />
                </div>
                <div className="flex flex-col gap-2">
                    <label className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/80">Post Processor</label>
                    <select
                        value={setup.postProcessor || 'fanuc'}
                        onChange={(e) => update('postProcessor', e.target.value as PostProcessor)}
                        className="w-full bg-background border border-border rounded-lg px-3 py-3 text-xs text-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50 outline-none transition-all shadow-inner"
                    >
                        {postProcessors.map(p => (
                            <option key={p.value} value={p.value}>{p.label}</option>
                        ))}
                    </select>
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
