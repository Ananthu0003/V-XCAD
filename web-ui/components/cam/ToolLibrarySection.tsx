import { useState, useEffect } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Tool, ToolType, ToolMaterial } from '@/types/cam';
import { Search, Filter, Wrench, X, ChevronDown, ChevronRight, Star, Clock, Zap, Plus, Trash2, Pencil, Info } from 'lucide-react';
import { ToolTable } from '@/components/tools/ToolTable';
import { HolderTable } from '@/components/holders/HolderTable';
import { ToolWizard } from '@/components/tools/wizard/ToolWizard';
import { HolderForm } from '@/components/holders/HolderForm';
import { ToolPreview } from '@/components/tools/wizard/ToolPreview';
import { useToolWizardStore } from '@/store/toolWizardStore';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { DeleteToolButton } from '@/components/tools/DeleteToolButton';

import { useSearchParams, useRouter, usePathname } from 'next/navigation';

type ToolLibrarySectionProps = {
	tools: Tool[];
	onChange: (tools: Tool[]) => void;
	workpieceMaterial?: string;
};

export function ToolLibrarySection({ tools: selectedTools, onChange, workpieceMaterial = 'aluminum_6061' }: ToolLibrarySectionProps) {
	const searchParams = useSearchParams();
	const router = useRouter();
	const pathname = usePathname();

	const [isOpen, setIsOpen] = useState(searchParams.get('action') === 'openToolLibrary');
	const [editingToolIndex, setEditingToolIndex] = useState<number | null>(null);
	const [search, setSearch] = useState('');
	const [dbTools, setDbTools] = useState<any[]>([]);
	const [loading, setLoading] = useState(false);

	const [isHolderOpen, setIsHolderOpen] = useState(searchParams.get('action') === 'openHolderLibrary');
	const [editingHolderIndex, setEditingHolderIndex] = useState<number | null>(null);
	const [dbHolders, setDbHolders] = useState<any[]>([]);
	const [loadingHolders, setLoadingHolders] = useState(false);

	const [isWizardOpen, setIsWizardOpen] = useState(false);
	const [viewingTool, setViewingTool] = useState<any | null>(null);
	
	const [isHolderFormOpen, setIsHolderFormOpen] = useState(false);
	const [editingHolderIdModal, setEditingHolderIdModal] = useState<string | null>(null);
	const [viewingHolder, setViewingHolder] = useState<any | null>(null);

	useEffect(() => {
		const action = searchParams.get('action');
		if (action === 'openToolLibrary') {
			setIsOpen(true);
		} else if (action === 'openHolderLibrary') {
			setIsHolderOpen(true);
		}
	}, [searchParams]);

	// Filters
	const [materialFilter, setMaterialFilter] = useState<string>('');
	const [coatingFilter, setCoatingFilter] = useState<string>('');
	const [typeFilter, setTypeFilter] = useState<string>('');

	useEffect(() => {
		if (isOpen) {
			fetchTools();
		}
	}, [isOpen, materialFilter, coatingFilter, typeFilter]);

	const fetchTools = async () => {
		setLoading(true);
		try {
			const query = new URLSearchParams();
			if (materialFilter) query.append('material', materialFilter);
			if (coatingFilter) query.append('coating', coatingFilter);
			if (typeFilter) query.append('type', typeFilter);

			const res = await fetch(`/api/cam/tools?${query.toString()}`);
			const data = await res.json();
			if (data.tools) {
				setDbTools(data.tools);
			}
		} catch (e) {
			console.error(e);
		} finally {
			setLoading(false);
		}
	};

	const fetchHolders = async () => {
		setLoadingHolders(true);
		try {
			const res = await fetch(`/api/cam/holders`);
			const data = await res.json();
			if (data.holders) {
				setDbHolders(data.holders);
			}
		} catch (e) {
			console.error(e);
		} finally {
			setLoadingHolders(false);
		}
	};

	useEffect(() => {
		fetchHolders();
	}, []);

	const autoSelectHolder = (toolDiameter: number, toolType: string, holders: any[]) => {
		if (!holders || holders.length === 0) return '';
		
		const exactNameMatch = holders.find(h => {
			const nameLower = h.name.toLowerCase();
			return (nameLower.includes('weldon') || nameLower.includes('shrink fit')) && h.name.includes(`${Math.round(toolDiameter)}mm`);
		});
		if (exactNameMatch) return exactNameMatch.name;

		if (['drill', 'center_drill', 'spot_drill', 'reamer'].includes(toolType)) {
			const drillChuck = holders.find(h => h.name.toLowerCase().includes('drill chuck'));
			if (drillChuck) return drillChuck.name;
		}

		if (toolType === 'face_mill') {
			const shellMill = holders.find(h => h.name.toLowerCase().includes('shell mill'));
			if (shellMill) return shellMill.name;
		}

		if (toolDiameter <= 10) {
			const er16 = holders.find(h => h.name.includes('ER16'));
			if (er16) return er16.name;
		}
		
		if (toolDiameter <= 20) {
			const er32 = holders.find(h => h.name.includes('ER32'));
			if (er32) return er32.name;
		}

		const weldon = holders.find(h => h.name.toLowerCase().includes('end mill holder') || h.name.toLowerCase().includes('weldon'));
		if (weldon) return weldon.name;

		return holders[0].name;
	};

	useEffect(() => {
		if (dbHolders.length > 0 && selectedTools.some(t => !t.holder)) {
			const updatedTools = selectedTools.map(t => {
				if (!t.holder) {
					return { ...t, holder: autoSelectHolder(t.diameter || 0, t.type, dbHolders) };
				}
				return t;
			});
			onChange(updatedTools);
		}
	}, [dbHolders, selectedTools, onChange]);

	const selectTool = (t: any) => {
		const newTool: Tool = {
			id: Date.now().toString(),
			dbId: t.id,
			name: t.name,
			number: `T${selectedTools.length + 1}`, // Default, will be updated below
			type: t.type as ToolType,
			diameter: t.geometry?.diameter || 0,
			flutes: t.geometry?.fluteCount || 0,
			stickout: t.assembly?.stickoutLength || 0,
			material: 'CARBIDE' as ToolMaterial,
			coating: '',
			cuttingData: t.cuttingData,
			holder: autoSelectHolder(t.geometry?.diameter || 0, t.type as ToolType, dbHolders),
		};

		if (editingToolIndex !== null && editingToolIndex >= 0) {
			const updatedTools = [...selectedTools];
			// Keep the same id and number if replacing
			newTool.id = updatedTools[editingToolIndex].id;
			newTool.number = updatedTools[editingToolIndex].number;
			updatedTools[editingToolIndex] = newTool;
			onChange(updatedTools);
		} else {
			onChange([...selectedTools, newTool]);
		}

		if (searchParams.get('action')) {
			// clean up url
			router.replace(pathname, { scroll: false });
		}
		setIsOpen(false);
		setEditingToolIndex(null);
	};

	const removeTool = (index: number) => {
		const updatedTools = [...selectedTools];
		updatedTools.splice(index, 1);
		onChange(updatedTools);
	};

	const handleViewToolDetails = async (tool: Tool) => {
		let dbTool = null;
		
		if (tool.dbId) {
			dbTool = dbTools.find(t => t.id === tool.dbId);
			if (!dbTool) {
				setLoading(true);
				try {
					const res = await fetch(`/api/cam/tools`);
					const data = await res.json();
					if (data.tools) {
						setDbTools(data.tools);
						dbTool = data.tools.find((t: any) => t.id === tool.dbId);
					}
				} catch(e) {}
				setLoading(false);
			}
		}

		if (dbTool) {
			setViewingTool(dbTool);
		} else {
			// Fallback for tools generated by AI that aren't in the DB
			const fallbackTool = {
				id: tool.id,
				name: tool.name || `${tool.type.replace('_', ' ')} A~${tool.diameter}mm`,
				type: tool.type,
				unit: 'mm',
				geometry: {
					diameter: tool.diameter,
					fluteCount: tool.flutes,
					fluteLength: tool.stickout ? tool.stickout * 0.8 : 0,
					overallLength: tool.stickout ? tool.stickout * 1.5 : 0,
				},
				assembly: {
					stickoutLength: tool.stickout || 0,
				},
				offsets: {
					lengthOffset: tool.lengthOffsetH || '-',
					diameterOffset: tool.diameterOffsetD || '-',
					compensationType: 'Computer',
				},
				cuttingData: {
					spindleRpm: tool.cuttingData?.spindleRpm || '-',
					feedRate: tool.cuttingData?.feedRate || '-',
					plungeRate: tool.cuttingData?.plungeRate || '-',
					coolant: tool.cuttingData?.coolant || 'Off',
				},
                material: tool.material,
                coating: tool.coating
			};
			setViewingTool(fallbackTool);
		}
	};

	const openModal = (index: number | null) => {
		setEditingToolIndex(index);
		setIsOpen(true);
	};

	const openHolderModal = (index: number) => {
		setEditingHolderIndex(index);
		setIsHolderOpen(true);
	};

	const selectHolder = (holder: any) => {
		if (editingHolderIndex !== null && editingHolderIndex >= 0) {
			const updatedTools = [...selectedTools];
			updatedTools[editingHolderIndex].holder = holder.name;
			onChange(updatedTools);
		}
		if (searchParams.get('action')) {
			router.replace(pathname, { scroll: false });
		}
		setIsHolderOpen(false);
		setEditingHolderIndex(null);
	};

	const openWizard = () => {
		const store = useToolWizardStore.getState();
		store.resetWizard();
		store.setOnCancel(() => setIsWizardOpen(false));
		store.setOnComplete(() => {
			setIsWizardOpen(false);
			fetchTools();
		});
		setIsWizardOpen(true);
	};

	const editTool = (tool: any) => {
		const store = useToolWizardStore.getState();
		store.resetWizard();

		let validCategory: "milling" | "drilling" | "turning" | "custom_form" = 'milling';
		if (tool.type === 'drill') validCategory = 'drilling';
		else if (tool.type === 'boring_bar') validCategory = 'turning';

		let validType = tool.type;
		const validTypes = ['flat_end_mill', 'ball_end_mill', 'bull_nose_end_mill', 'drill', 'chamfer_mill', 'face_mill', 'thread_mill', 't_slot_cutter', 'dovetail_cutter', 'reamer', 'boring_bar', 'custom_profile_tool'];
		if (!validTypes.includes(validType)) {
			if (validType === 'ball_nose') validType = 'ball_end_mill';
			else if (validType === 'end mill' || validType === 'end_mill') validType = 'flat_end_mill';
			else validType = 'flat_end_mill';
		}

		const formData = {
			name: tool.name || '',
			category: validCategory,
			type: validType,
			unit: tool.unit || 'mm',
			isActive: tool.isActive !== false,
			geometry: {
				diameter: tool.diameter || tool.geometry?.diameter || 6.35,
				fluteLength: tool.geometry?.fluteLength || tool.stickout || 20,
				overallLength: tool.geometry?.overallLength || (tool.stickout ? tool.stickout * 1.5 : 30),
				fluteCount: tool.flutes || tool.geometry?.fluteCount || 2,
				shankDiameter: tool.geometry?.shankDiameter || undefined,
				pointAngle: validType === 'drill' ? (tool.geometry?.pointAngle || 118) : undefined,
				includedAngle: validType === 'chamfer_mill' ? (tool.geometry?.includedAngle || 90) : undefined
			},
			offsets: {
				lengthOffset: (typeof tool.offsets?.lengthOffset === 'number') ? tool.offsets.lengthOffset : (parseInt(tool.lengthOffsetH || tool.number?.replace('T', '')) || 1),
				diameterOffset: (typeof tool.offsets?.diameterOffset === 'number') ? tool.offsets.diameterOffset : (parseInt(tool.diameterOffsetD || tool.number?.replace('T', '')) || 1),
				compensationType: tool.offsets?.compensationType?.toLowerCase() || 'computer',
			},
			assembly: {
				holderId: tool.assembly?.holderId || '',
				stickoutLength: tool.stickout || tool.assembly?.stickoutLength || 20,
			},
			cuttingData: {
				spindleRpm: parseInt(tool.cuttingData?.spindleRpm) || 10000,
				feedRate: parseInt(tool.cuttingData?.feedRate) || 1000,
				plungeRate: parseInt(tool.cuttingData?.plungeRate) || 300,
				retractRate: parseInt(tool.cuttingData?.retractRate) || 300,
				coolant: tool.cuttingData?.coolant !== '-' ? (tool.cuttingData?.coolant || 'flood') : 'flood',
			}
		};

		store.setInitialData(formData);
		const isDbTool = tool.dbId || dbTools.some(t => t.id === tool.id);
		store.setEditingId(isDbTool ? (tool.dbId || tool.id) : null);
		store.setOnCancel(() => setIsWizardOpen(false));
		store.setOnComplete(() => {
			setIsWizardOpen(false);
			fetchTools();
		});
		setIsWizardOpen(true);
	};

	const editHolder = (holderId: string) => {
		setEditingHolderIdModal(holderId);
		setIsHolderFormOpen(true);
	};

	const filteredTools = dbTools.filter(t => t.name.toLowerCase().includes(search.toLowerCase()));

	const materialOptimized = filteredTools.filter(t => {
		const materials = t.compatibility?.compatibleMaterialsJson
			? JSON.parse(t.compatibility.compatibleMaterialsJson)
			: [];
		return materials.includes(workpieceMaterial);
	});

	return (
		<div className="flex flex-col gap-4">
			{/* Selected Tools List */}
			<div className="flex flex-col gap-3">
				{selectedTools.map((tool, index) => (
					<div key={tool.id} className="flex flex-col gap-2 bg-accent dark:bg-black/40 border border-border dark:border-white/10 p-3 rounded-xl">
						<div className="flex items-center justify-between">
							<div className="flex items-center gap-3">
								<div className="bg-blue-500/20 text-blue-500 p-2 rounded-lg">
									<Wrench className="size-4" />
								</div>
								<div className="flex flex-col">
									<span className="text-xs font-bold text-foreground">
										{tool.name || `${tool.type.replace('_', ' ')} A~${tool.diameter}mm`}
									</span>
									<span className="text-[10px] text-muted-foreground uppercase">
										{tool.number} • {tool.flutes} Flutes • {tool.material} {tool.coating ? `• ${tool.coating}` : ''}
									</span>
								</div>
							</div>
							<div className="flex items-center gap-2">
								<button
									onClick={() => handleViewToolDetails(tool)}
									className="text-[10px] uppercase font-bold tracking-wider bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 px-3 py-1.5 rounded-lg transition-colors border border-blue-500/20 flex items-center gap-1.5"
								>
									<Info className="size-3" />
									Details
								</button>
								<button
									onClick={() => openModal(index)}
									className="text-[10px] uppercase font-bold tracking-wider bg-white/5 hover:bg-white/10 px-3 py-1.5 rounded-lg transition-colors border border-white/10"
								>
									Change
								</button>
								{selectedTools.length > 1 && (
									<button
										onClick={() => removeTool(index)}
										className="text-xs text-red-500 hover:bg-red-500/10 p-1.5 rounded-lg font-medium transition-colors border border-transparent hover:border-red-500/20"
										title="Remove Tool"
									>
										<Trash2 className="size-4" />
									</button>
								)}
							</div>
						</div>
						<div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 border-t border-border/50">
							<div className="flex flex-col gap-1">
								<label className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">Tool Num</label>
								<input type="text" value={tool.number} onChange={(e) => {
									const newTools = [...selectedTools];
									newTools[index].number = e.target.value;
									onChange(newTools);
								}} className="w-full bg-background border border-border rounded px-2 py-1 text-xs" />
							</div>
							<div className="flex flex-col gap-1">
								<label className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">Length (H)</label>
								<input type="text" value={tool.lengthOffsetH || ''} onChange={(e) => {
									const newTools = [...selectedTools];
									newTools[index].lengthOffsetH = e.target.value;
									onChange(newTools);
								}} placeholder="H01" className="w-full bg-background border border-border rounded px-2 py-1 text-xs" />
							</div>
							<div className="flex flex-col gap-1">
								<label className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">Diam (D)</label>
								<input type="text" value={tool.diameterOffsetD || ''} onChange={(e) => {
									const newTools = [...selectedTools];
									newTools[index].diameterOffsetD = e.target.value;
									onChange(newTools);
								}} placeholder="D01" className="w-full bg-background border border-border rounded px-2 py-1 text-xs" />
							</div>
							<div className="flex flex-col gap-1">
								<label className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">Holder</label>
								<div
									onClick={() => openHolderModal(index)}
									className="w-full bg-background border border-border hover:border-blue-500/50 cursor-pointer rounded px-2 py-1 text-xs truncate flex items-center justify-between transition-colors"
								>
									<span>{tool.holder || 'Select Holder'}</span>
									<ChevronDown className="size-3 text-muted-foreground" />
								</div>
							</div>
						</div>
					</div>
				))}
				<div className="mt-2">
					<button
						onClick={() => openModal(null)}
						className="w-full flex items-center justify-center gap-2 border border-dashed border-white/20 bg-white/5 hover:bg-white/10 hover:border-white/30 text-muted-foreground hover:text-foreground py-3 rounded-xl text-xs font-bold transition-colors"
					>
						<Plus className="size-3.5" />
						Add Tool
					</button>
				</div>
			</div>

			{/* Full Screen Modal Overlay */}
			{isOpen && (
				<div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 sm:p-10">
					<div className="bg-background border border-border dark:border-white/10 shadow-2xl rounded-2xl w-full max-w-5xl h-[85vh] flex overflow-hidden">

						{/* Filters Sidebar */}
						<div className="w-64 border-r border-border dark:border-white/5 bg-accent/30 dark:bg-black/20 flex flex-col">
							<div className="p-4 border-b border-border dark:border-white/5">
								<h2 className="font-bold text-sm flex items-center gap-2">
									<Filter className="size-4 text-blue-500" />
									Library Filters
								</h2>
							</div>
							<div className="flex-1 overflow-y-auto p-4 flex flex-col gap-6">
								<div className="flex flex-col gap-2">
									<label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Search Name</label>
									<div className="relative">
										<Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
										<input
											type="text"
											placeholder="Search..."
											value={search}
											onChange={e => setSearch(e.target.value)}
											className="w-full bg-black/40 border border-white/10 rounded-lg pl-9 pr-3 py-2 text-xs focus:outline-none focus:border-blue-500"
										/>
									</div>
								</div>

								<div className="flex flex-col gap-2">
									<label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Tool Type</label>
									<Select value={typeFilter} onValueChange={(val) => setTypeFilter(val || '')}>
    <SelectTrigger className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-xs focus:outline-none">
        <SelectValue />
    </SelectTrigger>
    <SelectContent>
<SelectItem value="">All Types</SelectItem>
										<SelectItem value="flat_end_mill">Flat End Mill</SelectItem>
										<SelectItem value="ball_end_mill">Ball Nose</SelectItem>
										<SelectItem value="drill">Drill</SelectItem>
										<SelectItem value="chamfer_mill">Chamfer Mill</SelectItem>
										<SelectItem value="face_mill">Face Mill</SelectItem>
    </SelectContent>
</Select>
								</div>

								<div className="flex flex-col gap-2">
									<label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Tool Material</label>
									<Select value={materialFilter} onValueChange={(val) => setMaterialFilter(val || '')}>
    <SelectTrigger className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-xs focus:outline-none">
        <SelectValue />
    </SelectTrigger>
    <SelectContent>
<SelectItem value="">All Materials</SelectItem>
										<SelectItem value="CARBIDE">Solid Carbide</SelectItem>
										<SelectItem value="HSS">HSS</SelectItem>
										<SelectItem value="HSS_CO">Cobalt HSS</SelectItem>
    </SelectContent>
</Select>
								</div>

								<div className="flex flex-col gap-2">
									<label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Coating</label>
									<Select value={coatingFilter} onValueChange={(val) => setCoatingFilter(val || '')}>
    <SelectTrigger className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-xs focus:outline-none">
        <SelectValue />
    </SelectTrigger>
    <SelectContent>
<SelectItem value="">All Coatings</SelectItem>
										<SelectItem value="UNCOATED">Uncoated</SelectItem>
										<SelectItem value="TIALN">TiAlN</SelectItem>
										<SelectItem value="DLC">DLC</SelectItem>
										<SelectItem value="TIN">TiN</SelectItem>
    </SelectContent>
</Select>
								</div>
							</div>
						</div>

						{/* Main Content */}
						<div className="flex-1 flex flex-col min-w-0 bg-background">
							<div className="flex items-center justify-between p-4 border-b border-border dark:border-white/5">
								<h2 className="font-bold">Select Tool</h2>
								<button onClick={() => {
									if (searchParams.get('action')) router.replace(pathname, { scroll: false });
									setIsOpen(false);
								}} className="p-2 hover:bg-white/10 rounded-lg transition-colors text-muted-foreground">
									<X className="size-4" />
								</button>
							</div>

							<div className="flex-1 overflow-y-auto p-6 flex flex-col gap-8">

								{/* Smart Groups */}
								{materialOptimized.length > 0 && !search && !typeFilter && !materialFilter && !coatingFilter && (
									<div className="flex flex-col gap-3">
										<h3 className="text-xs font-bold uppercase tracking-wider text-emerald-500 flex items-center gap-2">
											<Zap className="size-3.5" />
											Optimized for {workpieceMaterial.replace('_', ' ')}
										</h3>
										<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
											{materialOptimized.slice(0, 3).map(t => (
												<button
													key={t.id}
													onClick={() => selectTool(t)}
													className="text-left flex flex-col p-3 rounded-xl border border-emerald-500/30 bg-emerald-500/5 hover:bg-emerald-500/10 transition-colors"
												>
													<span className="text-sm font-bold truncate">{t.name}</span>
													<span className="text-[10px] text-muted-foreground mt-1">
														{t.category}
													</span>
												</button>
											))}
										</div>
									</div>
								)}

								{/* All Tools List */}
								<div className="flex flex-col gap-4">
									<div className="flex items-center justify-between border-b border-border/40 pb-3">
										<h3 className="text-sm font-bold uppercase tracking-wider text-foreground">
											All Tools
										</h3>
										<div className="flex items-center justify-center bg-primary/15 text-primary border border-primary/30 px-3 py-1 rounded-full shadow-sm transition-all hover:scale-105 hover:bg-primary/20 hover:shadow-md cursor-default">
											<span className="text-sm font-black">{filteredTools.length}</span>
											<span className="text-xs font-medium ml-1.5 opacity-80">Available</span>
										</div>
									</div>

									{loading ? (
										<div className="flex justify-center p-10">
											<span className="animate-pulse text-muted-foreground text-sm">Loading tools...</span>
										</div>
									) : (
										<div className="bg-background">
											<ToolTable
												initialTools={filteredTools}
												onSelect={selectTool}
												onCreateNew={openWizard}
												onViewDetails={(t) => setViewingTool(t)}
												onEditTool={editTool}
											/>
										</div>
									)}
								</div>

							</div>
						</div>
					</div>
				</div>
			)}

			{/* Create Tool Wizard Overlay */}
			{isWizardOpen && (
				<div className="fixed inset-0 z-[45] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 sm:p-10">
					<div className="bg-background border border-border dark:border-white/10 shadow-2xl rounded-2xl w-full max-w-6xl max-h-[90vh] overflow-y-auto">
						<div className="p-6">
							<ToolWizard />
						</div>
					</div>
				</div>
			)}

			{/* Holder Selection Modal */}
			{isHolderOpen && (
				<div className="fixed inset-0 z-[40] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 sm:p-10">
					<div className="bg-background border border-border dark:border-white/10 shadow-2xl rounded-2xl w-full max-w-5xl h-[85vh] flex flex-col overflow-hidden">
						<div className="flex items-center justify-between p-4 border-b border-border dark:border-white/5">
							<h2 className="font-bold">Select Holder</h2>
							<button onClick={() => {
								if (searchParams.get('action')) router.replace(pathname, { scroll: false });
								setIsHolderOpen(false);
							}} className="p-2 hover:bg-white/10 rounded-lg transition-colors text-muted-foreground">
								<X className="size-4" />
							</button>
						</div>
						<div className="flex-1 overflow-y-auto p-6">
							{loadingHolders ? (
								<div className="flex justify-center p-10">
									<span className="animate-pulse text-muted-foreground text-sm">Loading holders...</span>
								</div>
							) : (
								<HolderTable
									initialHolders={dbHolders}
									onSelect={selectHolder}
									onCreateNew={() => { setEditingHolderIdModal(null); setIsHolderFormOpen(true); }}
									onViewDetails={(id: string) => {
										const h = dbHolders.find(x => x.id === id);
										if(h) setViewingHolder(h);
									}}
									onEditHolder={editHolder}
								/>
							)}
						</div>
					</div>
				</div>
			)}

			{/* Create Holder Form Overlay */}
			{isHolderFormOpen && (
				<div className="fixed inset-0 z-[45] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 sm:p-10">
					<div className="bg-background border border-border dark:border-white/10 shadow-2xl rounded-2xl w-full max-w-6xl max-h-[90vh] overflow-y-auto">
						<div className="p-6">
							<HolderForm
								initialData={editingHolderIdModal ? (dbHolders.find(h => h.id === editingHolderIdModal) as any) : undefined}
								onCancel={() => { setIsHolderFormOpen(false); setEditingHolderIdModal(null); }}
								onComplete={() => {
									setIsHolderFormOpen(false);
									setEditingHolderIdModal(null);
									fetchHolders();
								}}
							/>
						</div>
					</div>
				</div>
			)}

			{/* Tool Details Modal */}
			{viewingTool && (
				<div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 sm:p-10">
					<div className="bg-background border border-border dark:border-white/10 shadow-2xl rounded-2xl w-full max-w-6xl max-h-[90vh] flex flex-col overflow-hidden">
						<div className="flex items-center justify-between p-4 border-b border-border dark:border-white/5">
							<div className="flex items-center gap-4">
								<h2 className="font-bold text-xl">{viewingTool.name}</h2>
								<div className="flex items-center gap-2">
									<Button variant="outline" size="sm" onClick={() => {
										setViewingTool(null);
										editTool(viewingTool);
									}}>
										<Pencil className="h-4 w-4 mr-2" />
										Edit
									</Button>
									<DeleteToolButton 
										toolId={viewingTool.id} 
										onSuccess={() => {
											setViewingTool(null);
											fetchTools();
										}} 
									/>
								</div>
							</div>
							<button onClick={() => setViewingTool(null)} className="p-2 hover:bg-white/10 rounded-lg transition-colors text-muted-foreground">
								<X className="size-4" />
							</button>
						</div>
						<div className="flex-1 overflow-y-auto p-6 bg-muted/10">
							<div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
								{/* Left Side: Details */}
								<div className="lg:col-span-2 space-y-6">
									<div className="grid grid-cols-1 md:grid-cols-2 gap-6">
										<Card>
											<CardHeader>
												<CardTitle>Cutter Geometry</CardTitle>
											</CardHeader>
											<CardContent className="space-y-2 text-sm">
												<div className="flex justify-between border-b pb-2">
													<span className="text-muted-foreground">Diameter</span>
													<span className="font-medium">{viewingTool.geometry?.diameter} {viewingTool.unit}</span>
												</div>
												<div className="flex justify-between border-b pb-2">
													<span className="text-muted-foreground">Flute Length</span>
													<span className="font-medium">{viewingTool.geometry?.fluteLength} {viewingTool.unit}</span>
												</div>
												<div className="flex justify-between border-b pb-2">
													<span className="text-muted-foreground">Overall Length</span>
													<span className="font-medium">{viewingTool.geometry?.overallLength} {viewingTool.unit}</span>
												</div>
												<div className="flex justify-between border-b pb-2">
													<span className="text-muted-foreground">Flutes</span>
													<span className="font-medium">{viewingTool.geometry?.fluteCount || '-'}</span>
												</div>
												<div className="flex justify-between border-b pb-2">
													<span className="text-muted-foreground">Shank Dia.</span>
													<span className="font-medium">{viewingTool.geometry?.shankDiameter || '-'} {viewingTool.unit}</span>
												</div>
												<div className="flex justify-between border-b pb-2">
													<span className="text-muted-foreground">Material</span>
													<span className="font-medium capitalize">{viewingTool.material || 'Carbide'}</span>
												</div>
												<div className="flex justify-between pb-2">
													<span className="text-muted-foreground">Coating</span>
													<span className="font-medium capitalize">{viewingTool.coating || 'Uncoated'}</span>
												</div>
											</CardContent>
										</Card>

										<Card>
											<CardHeader>
												<CardTitle>Offsets & Assembly</CardTitle>
											</CardHeader>
											<CardContent className="space-y-2 text-sm">
												<div className="flex justify-between border-b pb-2">
													<span className="text-muted-foreground">Length Offset (H)</span>
													<span className="font-medium">{viewingTool.offsets?.lengthOffset || '-'}</span>
												</div>
												<div className="flex justify-between border-b pb-2">
													<span className="text-muted-foreground">Diameter Offset (D)</span>
													<span className="font-medium">{viewingTool.offsets?.diameterOffset || '-'}</span>
												</div>
												<div className="flex justify-between border-b pb-2">
													<span className="text-muted-foreground">Stickout Length</span>
													<span className="font-medium">{viewingTool.assembly?.stickoutLength || '-'} {viewingTool.unit}</span>
												</div>
												<div className="flex justify-between pb-2">
													<span className="text-muted-foreground">Compensation</span>
													<span className="font-medium capitalize">{viewingTool.offsets?.compensationType || 'Computer'}</span>
												</div>
											</CardContent>
										</Card>

										<Card>
											<CardHeader>
												<CardTitle>Cutting Data (Default)</CardTitle>
											</CardHeader>
											<CardContent className="space-y-2 text-sm">
												<div className="flex justify-between border-b pb-2">
													<span className="text-muted-foreground">Spindle Speed</span>
													<span className="font-medium">{viewingTool.cuttingData?.spindleRpm || '-'} RPM</span>
												</div>
												<div className="flex justify-between border-b pb-2">
													<span className="text-muted-foreground">Cutting Feed</span>
													<span className="font-medium">{viewingTool.cuttingData?.feedRate || '-'} mm/min</span>
												</div>
												<div className="flex justify-between border-b pb-2">
													<span className="text-muted-foreground">Plunge Feed</span>
													<span className="font-medium">{viewingTool.cuttingData?.plungeRate || '-'} mm/min</span>
												</div>
												<div className="flex justify-between pb-2">
													<span className="text-muted-foreground">Coolant</span>
													<span className="font-medium capitalize">{viewingTool.cuttingData?.coolant || 'Off'}</span>
												</div>
											</CardContent>
										</Card>

										<Card>
											<CardHeader>
												<CardTitle>G-Code Preview</CardTitle>
											</CardHeader>
											<CardContent>
												<p className="text-xs text-muted-foreground mb-2">Example toolcall sequence.</p>
												<pre className="bg-muted p-4 rounded-md font-mono text-sm overflow-x-auto">
{`T[ToolNumber] M06
S${viewingTool.cuttingData?.spindleRpm || 1000} M03
G43 H[LengthOffset] Z50.
G41 D[DiameterOffset]`}
												</pre>
											</CardContent>
										</Card>
									</div>
								</div>

								{/* Right Side: Visual Preview */}
								<div className="lg:col-span-1">
									<Card className="h-[600px] flex flex-col overflow-hidden bg-slate-950 border-slate-800 shadow-xl">
										<CardContent className="p-0 flex-1 relative min-h-0 overflow-hidden">
											<ToolPreview toolData={viewingTool} />
										</CardContent>
									</Card>
								</div>
							</div>
						</div>
					</div>
				</div>
			)}

			{/* Holder Details Modal */}
			{viewingHolder && (
				<div className="fixed inset-0 z-[50] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 sm:p-10">
					<div className="bg-background border border-border dark:border-white/10 shadow-2xl rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
						<div className="flex items-center justify-between p-4 border-b border-border dark:border-white/5">
							<h2 className="font-bold text-xl">{viewingHolder.name}</h2>
							<button onClick={() => setViewingHolder(null)} className="p-2 hover:bg-white/10 rounded-lg transition-colors text-muted-foreground">
								<X className="size-4" />
							</button>
						</div>
						<div className="flex-1 overflow-y-auto p-6 space-y-4">
							<div>
								<h3 className="font-bold text-sm text-muted-foreground uppercase tracking-wider mb-2">Description</h3>
								<p>{viewingHolder.description || 'No description available.'}</p>
							</div>
							<div className="grid grid-cols-2 gap-4">
								<div>
									<h3 className="font-bold text-sm text-muted-foreground uppercase tracking-wider mb-2">Dimensions</h3>
									<ul className="space-y-1 text-sm">
										<li><span className="text-muted-foreground">Gage Length:</span> {viewingHolder.gageLength} mm</li>
										<li><span className="text-muted-foreground">Diameter:</span> {viewingHolder.diameter} mm</li>
										<li><span className="text-muted-foreground">Overall Length:</span> {viewingHolder.overallLength} mm</li>
									</ul>
								</div>
								<div>
									<h3 className="font-bold text-sm text-muted-foreground uppercase tracking-wider mb-2">Details</h3>
									<ul className="space-y-1 text-sm">
										<li><span className="text-muted-foreground">Taper Type:</span> {viewingHolder.taperType || 'N/A'}</li>
										<li><span className="text-muted-foreground">Manufacturer:</span> {viewingHolder.manufacturer || 'N/A'}</li>
										<li><span className="text-muted-foreground">Part Number:</span> {viewingHolder.partNumber || 'N/A'}</li>
									</ul>
								</div>
							</div>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}
