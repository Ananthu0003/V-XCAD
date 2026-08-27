import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { MACHINE_MATRIX, MachineProfile, MachineRecommendationResponse } from "@/lib/cam/machineProfiles"
import { Settings2, Cpu, Wrench, Search, BoxSelect, Sparkles, CheckCircle2, AlertCircle } from "lucide-react"
import { useState, useMemo } from "react"

const CATEGORIES = [
    { id: "all", label: "All Machines", match: [] },
    { id: "recommended", label: "AI Recommended", match: [] },
    { id: "mill", label: "Milling Centers", match: ["MILL_", "_VMC", "_HMC", "DRILL_TAP"] },
    { id: "lathe", label: "Turning Centers", match: ["LATHE", "MILL_TURN"] },
    { id: "router", label: "Routers", match: ["ROUTER"] },
    { id: "waterjet", label: "Waterjet & Plasma", match: ["WATERJET", "PLASMA"] },
    { id: "laser", label: "Lasers", match: ["LASER"] },
    { id: "edm", label: "EDM", match: ["EDM"] },
    { id: "grind", label: "Grinders", match: ["GRIND"] }
];

function getCategoryForProfile(machineType: string) {
    for (let i = 2; i < CATEGORIES.length; i++) {
        if (CATEGORIES[i].match.some(m => machineType.includes(m))) return CATEGORIES[i].id;
    }
    return "other";
}

export function MachineSelectionModal({
    currentProfileId,
    recommendation,
    onSelect
}: {
    currentProfileId: string;
    recommendation?: MachineRecommendationResponse | null;
    onSelect: (machineType: string, profileId: string, controller: string, postProcessor: string) => void;
}) {
    const [open, setOpen] = useState(false);
    const [activeCategory, setActiveCategory] = useState("all");
    const [searchQuery, setSearchQuery] = useState("");

    const currentProfile = MACHINE_MATRIX.machineProfiles.find(p => p.id === currentProfileId);

    // Map of recommendation by profile ID
    const recMap = useMemo(() => {
        const map = new Map<string, { confidence: number; isPrimary: boolean; reason: string; fitsEnvelope: boolean }>();
        if (!recommendation) return map;
        
        if (recommendation.primaryRecommendation) {
            map.set(recommendation.primaryRecommendation.profileId, {
                confidence: recommendation.primaryRecommendation.confidence,
                isPrimary: true,
                reason: recommendation.primaryRecommendation.reason,
                fitsEnvelope: recommendation.primaryRecommendation.fitsEnvelope
            });
        }
        if (recommendation.alternatives) {
            recommendation.alternatives.forEach(alt => {
                map.set(alt.profileId, {
                    confidence: alt.confidence,
                    isPrimary: false,
                    reason: alt.reason,
                    fitsEnvelope: alt.fitsEnvelope
                });
            });
        }
        return map;
    }, [recommendation]);

    const filteredProfiles = useMemo(() => {
        const q = searchQuery.toLowerCase().trim();
        const axisMatch = /^([23456789])$/.exec(q) || /\b([23456789])(?:-|\s)*(?:axis|axes|ax|x)\b/i.exec(q);
        const targetAxis = axisMatch ? parseInt(axisMatch[1], 10) : null;
        
        let remainingQuery = q;
        if (targetAxis !== null) {
            remainingQuery = q
                .replace(/^([23456789])$/, '')
                .replace(/\b([23456789])(?:-|\s)*(?:axis|axes|ax|x)\b/i, '')
                .trim();
        }

        let list = MACHINE_MATRIX.machineProfiles.filter(p => {
            if (activeCategory === "recommended") {
                if (!recMap.has(p.id)) return false;
            } else if (activeCategory !== "all") {
                if (getCategoryForProfile(p.machineType) !== activeCategory) return false;
            }

            if (targetAxis !== null && p.axisCount !== targetAxis) {
                return false;
            }

            if (!remainingQuery) return true;

            const machineTypeSearchable = p.machineType.toLowerCase().replace(/_/g, ' ');
            const matchesSearch = p.label.toLowerCase().includes(remainingQuery) || 
                                  p.id.toLowerCase().includes(remainingQuery) || 
                                  machineTypeSearchable.includes(remainingQuery) ||
                                  `${p.axisCount} axis`.includes(remainingQuery) ||
                                  `${p.axisCount}-axis`.includes(remainingQuery);
            return matchesSearch;
        });

        // Sort so primary and recommended machines appear first
        return list.sort((a, b) => {
            const recA = recMap.get(a.id);
            const recB = recMap.get(b.id);
            if (recA?.isPrimary) return -1;
            if (recB?.isPrimary) return 1;
            if (recA && !recB) return -1;
            if (!recA && recB) return 1;
            return (recB?.confidence || 0) - (recA?.confidence || 0);
        });
    }, [activeCategory, searchQuery, recMap]);

    const handleSelect = (profile: MachineProfile) => {
        onSelect(profile.machineType, profile.id, profile.defaultController, profile.recommendedPost);
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
                    <div className="size-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                        <Settings2 className="size-4 text-primary" />
                    </div>
                    <div className="flex flex-col gap-0.5 overflow-hidden flex-1">
                        <div className="flex items-center gap-2">
                            <span className="text-xs font-medium text-foreground truncate">
                                {currentProfile?.label || "Select a Machine"}
                            </span>
                            {recMap.get(currentProfileId)?.isPrimary && (
                                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 shrink-0">
                                    <Sparkles className="size-2.5" /> AI Optimal
                                </span>
                            )}
                        </div>
                        <span className="text-[10px] text-muted-foreground uppercase tracking-wider truncate">
                            {currentProfile?.machineType.replace(/_/g, ' ') || "No Machine Selected"}
                        </span>
                    </div>
                </div>
            </DialogTrigger>
            <DialogContent className="sm:max-w-4xl max-h-[85vh] p-0 overflow-hidden flex flex-col bg-background/95 backdrop-blur-xl border-primary/20">
                <DialogHeader className="px-6 py-4 border-b border-border/40 bg-muted/5">
                    <div className="flex items-center justify-between">
                        <DialogTitle className="flex items-center gap-2 text-lg">
                            <BoxSelect className="size-5 text-primary" />
                            Machine Library
                        </DialogTitle>
                        {recommendation?.primaryRecommendation && (
                            <div className="flex items-center gap-1.5 text-xs text-muted-foreground bg-primary/10 px-2.5 py-1 rounded-full border border-primary/20">
                                <Sparkles className="size-3 text-primary animate-pulse" />
                                <span>Part Type: <strong className="text-foreground uppercase tracking-wider">{recommendation.detectedPartType.replace(/_/g, ' ')}</strong></span>
                            </div>
                        )}
                    </div>
                </DialogHeader>
                
                <div className="flex flex-1 overflow-hidden min-h-[400px]">
                    {/* Sidebar */}
                    <div className="w-56 border-r border-border/40 bg-muted/5 flex flex-col p-3 gap-1 overflow-y-auto">
                        {CATEGORIES.map(cat => {
                            const isRecCat = cat.id === "recommended";
                            return (
                                <button
                                    key={cat.id}
                                    onClick={() => setActiveCategory(cat.id)}
                                    className={`text-left px-3 py-2 text-xs rounded-lg transition-colors flex items-center justify-between ${
                                        activeCategory === cat.id 
                                            ? 'bg-primary/20 text-primary font-medium' 
                                            : 'text-muted-foreground hover:bg-foreground/5'
                                    }`}
                                >
                                    <span className="flex items-center gap-1.5">
                                        {isRecCat && <Sparkles className="size-3 text-amber-400" />}
                                        {cat.label}
                                    </span>
                                    {isRecCat && recMap.size > 0 && (
                                        <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-amber-500/20 text-amber-300 font-bold">
                                            {recMap.size}
                                        </span>
                                    )}
                                </button>
                            );
                        })}
                    </div>

                    {/* Main Content */}
                    <div className="flex-1 flex flex-col overflow-hidden">
                        <div className="p-4 border-b border-border/40">
                            <div className="relative">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                                <input 
                                    type="text" 
                                    placeholder="Search machines..." 
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    className="w-full bg-background/50 border border-border/50 rounded-lg pl-9 pr-4 py-2 text-xs text-foreground focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20"
                                />
                            </div>
                        </div>
                        <div className="flex-1 overflow-y-auto p-4 grid grid-cols-2 lg:grid-cols-3 gap-3 content-start">
                            {filteredProfiles.map(profile => {
                                const rec = recMap.get(profile.id);
                                return (
                                    <button
                                        key={profile.id}
                                        onClick={() => handleSelect(profile)}
                                        className={`text-left flex flex-col p-4 rounded-xl border transition-all relative group ${
                                            currentProfileId === profile.id 
                                                ? 'bg-primary/10 border-primary shadow-sm ring-1 ring-primary/30' 
                                                : rec?.isPrimary
                                                ? 'bg-emerald-500/5 border-emerald-500/30 hover:border-emerald-500/60 hover:bg-emerald-500/10'
                                                : 'bg-background/40 border-border/40 hover:border-primary/40 hover:bg-background'
                                        }`}
                                    >
                                        <div className="flex items-center justify-between gap-2 mb-1.5">
                                            <div className="flex items-center gap-2 min-w-0">
                                                <Cpu className={`size-4 shrink-0 ${currentProfileId === profile.id ? 'text-primary' : rec?.isPrimary ? 'text-emerald-400' : 'text-muted-foreground'}`} />
                                                <span className="text-xs font-bold text-foreground truncate">{profile.label}</span>
                                            </div>
                                            {rec?.isPrimary && (
                                                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 shrink-0">
                                                    <Sparkles className="size-2.5" /> Optimal
                                                </span>
                                            )}
                                            {!rec?.isPrimary && rec && (
                                                <span className="text-[9px] font-semibold text-amber-400/90 bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/20 shrink-0">
                                                    {Math.round(rec.confidence * 100)}%
                                                </span>
                                            )}
                                        </div>

                                        <div className="flex flex-col gap-1 mt-1">
                                            <span className="text-[10px] text-muted-foreground">Axes: <strong className="text-foreground/80">{profile.axisCount}</strong></span>
                                            <span className="text-[10px] text-muted-foreground truncate">Type: <strong className="text-foreground/80">{profile.machineType}</strong></span>
                                        </div>

                                        {rec?.reason && (
                                            <div className="mt-2 pt-2 border-t border-border/30 text-[10px] text-muted-foreground/90 line-clamp-2 leading-relaxed">
                                                💡 {rec.reason}
                                            </div>
                                        )}
                                    </button>
                                );
                            })}
                            {filteredProfiles.length === 0 && (
                                <div className="col-span-full flex flex-col items-center justify-center p-8 text-muted-foreground text-sm">
                                    <Wrench className="size-8 mb-2 opacity-20" />
                                    No machines found.
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    )
}

