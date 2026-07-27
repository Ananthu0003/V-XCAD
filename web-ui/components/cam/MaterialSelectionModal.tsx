import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { MATERIAL_MATRIX, MaterialProfileItem, MaterialCategory, getMaterialProfile } from "@/lib/cam/materialProfiles"
import { Layers, Search, ShieldCheck, Gauge, Flame, Sparkles } from "lucide-react"
import { useState, useMemo } from "react"
import type { MaterialType } from "@/types/cam"

export function MaterialSelectionModal({
    currentMaterialId,
    onSelect
}: {
    currentMaterialId?: string;
    onSelect: (materialId: MaterialType) => void;
}) {
    const [open, setOpen] = useState(false);
    const [activeCategory, setActiveCategory] = useState<string>("all");
    const [searchQuery, setSearchQuery] = useState("");

    const currentProfile = getMaterialProfile(currentMaterialId);

    const categories = useMemo(() => [
        { id: "all", label: "All Materials", count: MATERIAL_MATRIX.materials.length },
        ...MATERIAL_MATRIX.categories.map(c => ({
            id: c.id,
            label: c.label,
            count: MATERIAL_MATRIX.materials.filter(m => m.category === c.id).length
        }))
    ], []);

    const filteredMaterials = useMemo(() => {
        const q = searchQuery.toLowerCase().trim();
        return MATERIAL_MATRIX.materials.filter(m => {
            const matchesCat = activeCategory === "all" || m.category === activeCategory;
            const matchesSearch = !q || 
                m.name.toLowerCase().includes(q) || 
                m.id.toLowerCase().includes(q) || 
                m.categoryLabel.toLowerCase().includes(q) ||
                m.description.toLowerCase().includes(q) ||
                m.hardnessHb.toString().includes(q);
            return matchesCat && matchesSearch;
        });
    }, [activeCategory, searchQuery]);

    const handleSelect = (material: MaterialProfileItem) => {
        onSelect(material.id as MaterialType);
        setOpen(false);
    };

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger 
                render={
                    <Button 
                        variant="outline" 
                        className="w-full h-auto py-3 px-4 justify-start text-left font-normal bg-background/50 border-border/50 hover:bg-background hover:border-primary/50"
                    />
                }
            >
                <div className="flex items-center gap-3 w-full">
                    <div className="size-8 rounded-lg bg-cyan-500/10 flex items-center justify-center shrink-0">
                        <Layers className="size-4 text-cyan-400" />
                    </div>
                    <div className="flex flex-col gap-0.5 overflow-hidden flex-1">
                        <span className="text-xs font-medium text-foreground truncate">
                            {currentProfile?.name || "Select Workpiece Material"}
                        </span>
                        <span className="text-[10px] text-muted-foreground uppercase tracking-wider truncate flex items-center gap-2">
                            <span>{currentProfile?.categoryLabel || "No Material Selected"}</span>
                            {currentProfile && (
                                <span className="text-cyan-400/80 font-mono">
                                    ({currentProfile.machinabilityRating}% Machinability)
                                </span>
                            )}
                        </span>
                    </div>
                </div>
            </DialogTrigger>

            <DialogContent className="sm:max-w-5xl max-h-[85vh] p-0 overflow-hidden flex flex-col bg-background/95 backdrop-blur-xl border-primary/20">
                <DialogHeader className="px-6 py-4 border-b border-border/40 bg-muted/5 flex items-center justify-between">
                    <DialogTitle className="flex items-center gap-2 text-lg">
                        <Layers className="size-5 text-cyan-400" />
                        Industrial Material Library
                    </DialogTitle>
                </DialogHeader>

                <div className="flex flex-1 overflow-hidden min-h-[460px]">
                    {/* Category Sidebar */}
                    <div className="w-60 border-r border-border/40 bg-muted/5 flex flex-col p-3 gap-1 overflow-y-auto shrink-0">
                        <span className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/70 px-3 py-1">
                            Material Families
                        </span>
                        {categories.map(cat => (
                            <button
                                key={cat.id}
                                onClick={() => setActiveCategory(cat.id)}
                                className={`text-left px-3 py-2.5 text-xs rounded-xl transition-all flex items-center justify-between ${
                                    activeCategory === cat.id 
                                        ? 'bg-cyan-500/15 text-cyan-400 font-semibold border border-cyan-500/30' 
                                        : 'text-muted-foreground hover:bg-foreground/5 hover:text-foreground'
                                }`}
                            >
                                <span className="truncate">{cat.label}</span>
                                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-full bg-background/50 text-muted-foreground/80">
                                    {cat.count}
                                </span>
                            </button>
                        ))}
                    </div>

                    {/* Main Workspace */}
                    <div className="flex-1 flex flex-col overflow-hidden">
                        {/* Search Bar */}
                        <div className="p-4 border-b border-border/40 bg-background/30">
                            <div className="relative">
                                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                                <input 
                                    type="text" 
                                    placeholder="Search by alloy, name, category, or hardness (e.g. 6061, Ti-6Al-4V, Stainless, D2)..." 
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    className="w-full bg-background/60 border border-border/50 rounded-xl pl-10 pr-4 py-2.5 text-xs text-foreground focus:outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/20 transition-all shadow-sm"
                                />
                            </div>
                        </div>

                        {/* Material Grid */}
                        <div className="flex-1 overflow-y-auto p-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5 content-start">
                            {filteredMaterials.map(mat => {
                                const isSelected = currentMaterialId === mat.id;
                                return (
                                    <button
                                        key={mat.id}
                                        onClick={() => handleSelect(mat)}
                                        className={`text-left flex flex-col justify-between p-4 rounded-xl border transition-all relative overflow-hidden group min-h-[165px] ${
                                            isSelected 
                                                ? 'bg-cyan-500/10 border-cyan-500 shadow-md shadow-cyan-500/5' 
                                                : 'bg-background/40 border-border/40 hover:border-cyan-500/40 hover:bg-background/80'
                                        }`}
                                    >
                                        <div>
                                            <div className="flex items-start justify-between gap-2 mb-1.5">
                                                <div className="flex flex-col gap-0.5">
                                                    <span className="text-xs font-bold text-foreground group-hover:text-cyan-400 transition-colors leading-snug">
                                                        {mat.name}
                                                    </span>
                                                    <span className="text-[10px] text-muted-foreground/80 font-medium">
                                                        {mat.categoryLabel}
                                                    </span>
                                                </div>
                                                {isSelected && (
                                                    <span className="bg-cyan-500 text-black text-[9px] font-bold uppercase px-1.5 py-0.5 rounded shrink-0">
                                                        Active
                                                    </span>
                                                )}
                                            </div>

                                            <p className="text-[11px] text-muted-foreground/80 line-clamp-2 mb-3 leading-relaxed font-normal">
                                                {mat.description}
                                            </p>
                                        </div>

                                        {/* Physical & Machining Stats Grid */}
                                        <div className="pt-2.5 border-t border-border/30 grid grid-cols-2 gap-x-2 gap-y-1.5 text-[10px]">
                                            <div className="flex items-center gap-1.5 text-muted-foreground min-w-0">
                                                <Gauge className="size-3 text-cyan-400 shrink-0" />
                                                <span className="truncate">Speed: <strong className="text-foreground font-mono">{mat.cuttingSpeedMMin} m/min</strong></span>
                                            </div>
                                            <div className="flex items-center gap-1.5 text-muted-foreground min-w-0">
                                                <Flame className="size-3 text-amber-400 shrink-0" />
                                                <span className="truncate">Rating: <strong className="text-foreground font-mono">{mat.machinabilityRating}%</strong></span>
                                            </div>
                                            <div className="flex items-center gap-1.5 text-muted-foreground min-w-0">
                                                <ShieldCheck className="size-3 text-emerald-400 shrink-0" />
                                                <span className="truncate">Hardness: <strong className="text-foreground font-mono">{mat.hardnessHb} HB</strong></span>
                                            </div>
                                            <div className="flex items-center gap-1.5 text-muted-foreground min-w-0">
                                                <Sparkles className="size-3 text-purple-400 shrink-0" />
                                                <span className="truncate">Density: <strong className="text-foreground font-mono">{mat.densityGcm3} g/cm³</strong></span>
                                            </div>
                                        </div>
                                    </button>
                                );
                            })}

                            {filteredMaterials.length === 0 && (
                                <div className="col-span-full flex flex-col items-center justify-center p-12 text-muted-foreground text-sm">
                                    <Layers className="size-10 mb-3 opacity-20" />
                                    No material found matching &quot;{searchQuery}&quot;
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}
