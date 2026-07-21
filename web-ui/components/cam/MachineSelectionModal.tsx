import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { MACHINE_MATRIX, MachineProfile } from "@/lib/cam/machineProfiles"
import { Settings2, Cpu, Wrench, Search, BoxSelect } from "lucide-react"
import { useState, useMemo } from "react"

const CATEGORIES = [
    { id: "all", label: "All Machines", match: [] },
    { id: "mill", label: "Milling Centers", match: ["MILL_", "_VMC", "_HMC", "DRILL_TAP"] },
    { id: "lathe", label: "Turning Centers", match: ["LATHE", "MILL_TURN"] },
    { id: "router", label: "Routers", match: ["ROUTER"] },
    { id: "waterjet", label: "Waterjet & Plasma", match: ["WATERJET", "PLASMA"] },
    { id: "laser", label: "Lasers", match: ["LASER"] },
    { id: "edm", label: "EDM", match: ["EDM"] },
    { id: "grind", label: "Grinders", match: ["GRIND"] }
];

function getCategoryForProfile(machineType: string) {
    for (let i = 1; i < CATEGORIES.length; i++) {
        if (CATEGORIES[i].match.some(m => machineType.includes(m))) return CATEGORIES[i].id;
    }
    return "other";
}

export function MachineSelectionModal({
    currentProfileId,
    onSelect
}: {
    currentProfileId: string;
    onSelect: (machineType: string, profileId: string, controller: string, postProcessor: string) => void;
}) {
    const [open, setOpen] = useState(false);
    const [activeCategory, setActiveCategory] = useState("all");
    const [searchQuery, setSearchQuery] = useState("");

    const currentProfile = MACHINE_MATRIX.machineProfiles.find(p => p.id === currentProfileId);

    const filteredProfiles = useMemo(() => {
        const q = searchQuery.toLowerCase().trim();
        let filtered = MACHINE_MATRIX.machineProfiles.filter(p => {
            const matchesCat = activeCategory === "all" || getCategoryForProfile(p.machineType) === activeCategory;
            const machineTypeSearchable = p.machineType.toLowerCase().replace(/_/g, ' ');
            const matchesSearch = p.label.toLowerCase().includes(q) || 
                                  p.id.toLowerCase().includes(q) || 
                                  machineTypeSearchable.includes(q) ||
                                  `${p.axisCount} axis`.includes(q) ||
                                  `${p.axisCount}-axis`.includes(q) ||
                                  p.axisCount.toString() === q;
            return matchesCat && matchesSearch;
        });

        if (q) {
            filtered.sort((a, b) => {
                const aAxisMatch = a.axisCount.toString() === q || `${a.axisCount} axis` === q || `${a.axisCount}-axis` === q;
                const bAxisMatch = b.axisCount.toString() === q || `${b.axisCount} axis` === q || `${b.axisCount}-axis` === q;
                
                if (aAxisMatch && !bAxisMatch) return -1;
                if (!aAxisMatch && bAxisMatch) return 1;
                return 0;
            });
        }
        
        return filtered;
    }, [activeCategory, searchQuery]);

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
                        <div className="flex flex-col gap-0.5 overflow-hidden">
                            <span className="text-xs font-medium text-foreground truncate">
                                {currentProfile?.label || "Select a Machine"}
                            </span>
                            <span className="text-[10px] text-muted-foreground uppercase tracking-wider truncate">
                                {currentProfile?.machineType.replace(/_/g, ' ') || "No Machine Selected"}
                            </span>
                        </div>
                    </div>
            </DialogTrigger>
            <DialogContent className="sm:max-w-4xl max-h-[85vh] p-0 overflow-hidden flex flex-col bg-background/95 backdrop-blur-xl border-primary/20">
                <DialogHeader className="px-6 py-4 border-b border-border/40 bg-muted/5">
                    <DialogTitle className="flex items-center gap-2 text-lg">
                        <BoxSelect className="size-5 text-primary" />
                        Machine Library
                    </DialogTitle>
                </DialogHeader>
                
                <div className="flex flex-1 overflow-hidden min-h-[400px]">
                    {/* Sidebar */}
                    <div className="w-56 border-r border-border/40 bg-muted/5 flex flex-col p-3 gap-1 overflow-y-auto">
                        {CATEGORIES.map(cat => (
                            <button
                                key={cat.id}
                                onClick={() => setActiveCategory(cat.id)}
                                className={`text-left px-3 py-2 text-xs rounded-lg transition-colors ${activeCategory === cat.id ? 'bg-primary/20 text-primary font-medium' : 'text-muted-foreground hover:bg-foreground/5'}`}
                            >
                                {cat.label}
                            </button>
                        ))}
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
                            {filteredProfiles.map(profile => (
                                <button
                                    key={profile.id}
                                    onClick={() => handleSelect(profile)}
                                    className={`text-left flex flex-col p-4 rounded-xl border transition-all ${currentProfileId === profile.id ? 'bg-primary/10 border-primary shadow-sm' : 'bg-background/40 border-border/40 hover:border-primary/40 hover:bg-background'}`}
                                >
                                    <div className="flex items-center gap-2 mb-2">
                                        <Cpu className={`size-4 ${currentProfileId === profile.id ? 'text-primary' : 'text-muted-foreground'}`} />
                                        <span className="text-xs font-bold text-foreground truncate">{profile.label}</span>
                                    </div>
                                    <div className="flex flex-col gap-1 mt-1">
                                        <span className="text-[10px] text-muted-foreground">Axes: <strong className="text-foreground/80">{profile.axisCount}</strong></span>
                                        <span className="text-[10px] text-muted-foreground truncate">Type: <strong className="text-foreground/80">{profile.machineType}</strong></span>
                                    </div>
                                </button>
                            ))}
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
