import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { MACHINE_MATRIX, PostProcessorId, ControllerId } from "@/lib/cam/machineProfiles"
import { FileCode, Search, FileTerminal, BoxSelect } from "lucide-react"
import { useState, useMemo } from "react"

export function PostProcessorSelectionModal({
    machineProfileId,
    currentPostId,
    currentControllerId,
    onSelect
}: {
    machineProfileId: string;
    currentPostId: string;
    currentControllerId: string;
    onSelect: (postId: string, controllerId: string) => void;
}) {
    const [open, setOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");

    const profile = MACHINE_MATRIX.machineProfiles.find(p => p.id === machineProfileId);

    const availablePosts = useMemo(() => {
        if (!profile) return [];
        
        const posts: {id: string, label: string, controller: ControllerId, controllerLabel: string}[] = [];
        
        // Find all controllers compatible with this machine profile
        for (const ctrlId of profile.compatibleControllers) {
            const ctrl = MACHINE_MATRIX.controllers[ctrlId];
            if (!ctrl) continue;
            
            // For each controller, find its compatible posts
            for (const postId of ctrl.compatiblePosts) {
                const postInfo = MACHINE_MATRIX.postProcessors[postId];
                if (postInfo && postInfo.machineTypes.includes(profile.machineType)) {
                    posts.push({
                        id: postId,
                        label: postInfo.label,
                        controller: ctrlId,
                        controllerLabel: ctrl.label
                    });
                }
            }
        }
        
        return posts.filter(p => p.label.toLowerCase().includes(searchQuery.toLowerCase()) || p.controllerLabel.toLowerCase().includes(searchQuery.toLowerCase()));
    }, [machineProfileId, profile, searchQuery]);

    const handleSelect = (postId: string, controllerId: string) => {
        onSelect(postId, controllerId);
        setOpen(false);
    };

    const currentPostLabel = currentPostId === 'AUTO' 
        ? "AUTO (Determined by Controller)" 
        : (MACHINE_MATRIX.postProcessors[currentPostId as PostProcessorId]?.label || "Select Format");
        
    const currentControllerLabel = MACHINE_MATRIX.controllers[currentControllerId as ControllerId]?.label || "No Controller";

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
                    <div className="size-8 rounded-lg bg-emerald-500/10 flex items-center justify-center shrink-0">
                        <FileCode className="size-4 text-emerald-500" />
                    </div>
                    <div className="flex flex-col gap-0.5 overflow-hidden">
                        <span className="text-xs font-medium text-foreground truncate">
                            {currentPostLabel}
                        </span>
                        <span className="text-[10px] text-muted-foreground uppercase tracking-wider truncate">
                            {currentControllerLabel}
                        </span>
                    </div>
                </div>
            </DialogTrigger>
            <DialogContent className="sm:max-w-xl max-h-[85vh] p-0 overflow-hidden flex flex-col bg-background/95 backdrop-blur-xl border-emerald-500/20 font-sans">
                <DialogHeader className="px-6 py-4 border-b border-border/40 bg-muted/5">
                    <DialogTitle className="flex items-center gap-2 text-lg">
                        <FileCode className="size-5 text-emerald-500" />
                        CNC Controller & Post Processor
                    </DialogTitle>
                </DialogHeader>
                
                <div className="flex flex-1 overflow-hidden min-h-[200px] flex-col">
                    <div className="p-4 border-b border-border/40">
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                            <input 
                                type="text" 
                                placeholder="Search by controller or format..." 
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="w-full bg-background/50 border border-border/50 rounded-lg pl-9 pr-4 py-2 text-xs text-foreground focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/20"
                            />
                        </div>
                    </div>
                    
                    <div className="flex-1 overflow-y-auto p-4 grid grid-cols-1 gap-3 content-start">

                        {availablePosts.map(post => (
                            <button
                                key={`${post.controller}-${post.id}`}
                                onClick={() => handleSelect(post.id, post.controller)}
                                className={`text-left flex flex-col p-4 rounded-xl border transition-all ${currentPostId === post.id ? 'bg-emerald-500/10 border-emerald-500 shadow-sm' : 'bg-background/40 border-border/40 hover:border-emerald-500/40 hover:bg-background'}`}
                            >
                                <div className="flex items-center gap-2 mb-2">
                                    <FileTerminal className={`size-4 ${currentPostId === post.id ? 'text-emerald-500' : 'text-muted-foreground'}`} />
                                    <span className="text-xs font-bold text-foreground truncate">{post.label}</span>
                                </div>
                                <div className="flex flex-col gap-1 mt-1">
                                    <span className="text-[10px] text-muted-foreground truncate">Controller: <strong className="text-foreground/80">{post.controllerLabel}</strong></span>
                                </div>
                            </button>
                        ))}
                        
                        {availablePosts.length === 0 && (
                            <div className="col-span-full flex flex-col items-center justify-center p-8 text-muted-foreground text-sm">
                                <BoxSelect className="size-8 mb-2 opacity-20" />
                                No formats found for this machine.
                            </div>
                        )}
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    )
}
