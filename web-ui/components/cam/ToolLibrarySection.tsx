import { useState, useEffect } from 'react';
import type { Tool, ToolType, ToolMaterial } from '@/types/cam';
import { Search, Filter, Wrench, X, ChevronDown, ChevronRight, Star, Clock, Zap, Plus, Trash2 } from 'lucide-react';

type ToolLibrarySectionProps = {
	tools: Tool[];
	onChange: (tools: Tool[]) => void;
	workpieceMaterial?: string;
};

export function ToolLibrarySection({ tools: selectedTools, onChange, workpieceMaterial = 'aluminum_6061' }: ToolLibrarySectionProps) {
	const [isOpen, setIsOpen] = useState(false);
	const [editingToolIndex, setEditingToolIndex] = useState<number | null>(null);
	const [search, setSearch] = useState('');
	const [dbTools, setDbTools] = useState<any[]>([]);
	const [loading, setLoading] = useState(false);

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

	const selectTool = (t: any) => {
		const newTool: Tool = {
			id: Date.now().toString(),
			dbId: t.id,
			name: t.name,
			number: `T${selectedTools.length + 1}`, // Default, will be updated below
			type: t.type as ToolType,
			diameter: t.diameter,
			flutes: t.flutes,
			stickout: t.stickout,
			material: t.material.material_code as ToolMaterial,
			coating: t.coating?.coating_name,
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
		
		setIsOpen(false);
		setEditingToolIndex(null);
	};

	const removeTool = (index: number) => {
		const updatedTools = [...selectedTools];
		updatedTools.splice(index, 1);
		onChange(updatedTools);
	};

	const openModal = (index: number | null) => {
		setEditingToolIndex(index);
		setIsOpen(true);
	};

	const filteredTools = dbTools.filter(t => t.name.toLowerCase().includes(search.toLowerCase()));

	const materialOptimized = filteredTools.filter(t => {
		const recs = t.material?.recommended_workpiece_materials || [];
		const coatRecs = t.coating?.recommended_materials || [];
		return recs.includes(workpieceMaterial) || coatRecs.includes(workpieceMaterial);
	});

	return (
		<div className="flex flex-col gap-4">
			{/* Selected Tools List */}
			<div className="flex flex-col gap-2">
				{selectedTools.map((tool, index) => (
					<div key={tool.id} className="flex items-center justify-between bg-accent dark:bg-black/40 border border-border dark:border-white/10 p-3 rounded-xl">
						<div className="flex items-center gap-3">
							<div className="bg-blue-500/20 text-blue-500 p-2 rounded-lg">
								<Wrench className="size-4" />
							</div>
							<div className="flex flex-col">
								<span className="text-xs font-bold text-foreground">
									{tool.name || `${tool.type.replace('_', ' ')} Ø${tool.diameter}mm`}
								</span>
								<span className="text-[10px] text-muted-foreground uppercase">
									{tool.number} • {tool.flutes} Flutes • {tool.material} {tool.coating ? `• ${tool.coating}` : ''}
								</span>
							</div>
						</div>
						<div className="flex items-center gap-2">
							<button 
								onClick={() => openModal(index)}
								className="text-xs bg-white/5 hover:bg-white/10 px-3 py-1.5 rounded-lg font-medium transition-colors border border-white/10"
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
				))}
				<button
					onClick={() => openModal(null)}
					className="flex items-center justify-center gap-2 border border-dashed border-white/20 bg-white/5 hover:bg-white/10 hover:border-white/30 text-muted-foreground hover:text-foreground py-3 rounded-xl text-xs font-bold transition-colors mt-2"
				>
					<Plus className="size-3.5" />
					Add Tool
				</button>
			</div>

			{/* Full Screen Modal Overlay */}
			{isOpen && (
				<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 sm:p-10">
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
									<select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-xs focus:outline-none">
										<option value="">All Types</option>
										<option value="flat_end_mill">Flat End Mill</option>
										<option value="ball_nose">Ball Nose</option>
										<option value="drill">Drill</option>
										<option value="chamfer_mill">Chamfer Mill</option>
										<option value="face_mill">Face Mill</option>
									</select>
								</div>

								<div className="flex flex-col gap-2">
									<label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Tool Material</label>
									<select value={materialFilter} onChange={e => setMaterialFilter(e.target.value)} className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-xs focus:outline-none">
										<option value="">All Materials</option>
										<option value="CARBIDE">Solid Carbide</option>
										<option value="HSS">HSS</option>
										<option value="HSS_CO">Cobalt HSS</option>
									</select>
								</div>

								<div className="flex flex-col gap-2">
									<label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Coating</label>
									<select value={coatingFilter} onChange={e => setCoatingFilter(e.target.value)} className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-xs focus:outline-none">
										<option value="">All Coatings</option>
										<option value="UNCOATED">Uncoated</option>
										<option value="TIALN">TiAlN</option>
										<option value="DLC">DLC</option>
										<option value="TIN">TiN</option>
									</select>
								</div>
							</div>
						</div>

						{/* Main Content */}
						<div className="flex-1 flex flex-col min-w-0 bg-background">
							<div className="flex items-center justify-between p-4 border-b border-border dark:border-white/5">
								<h2 className="font-bold">Select Tool</h2>
								<button onClick={() => setIsOpen(false)} className="p-2 hover:bg-white/10 rounded-lg transition-colors text-muted-foreground">
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
														{t.material.material_code} {t.coating ? `+ ${t.coating.coating_code}` : ''}
													</span>
												</button>
											))}
										</div>
									</div>
								)}

								{/* All Tools List */}
								<div className="flex flex-col gap-3">
									<h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
										All Tools ({filteredTools.length})
									</h3>
									
									{loading ? (
										<div className="flex justify-center p-10">
											<span className="animate-pulse text-muted-foreground text-sm">Loading tools...</span>
										</div>
									) : (
										<div className="border border-border dark:border-white/5 rounded-xl overflow-hidden">
											<table className="w-full text-left text-sm">
												<thead className="bg-accent/50 dark:bg-white/5 text-xs uppercase text-muted-foreground">
													<tr>
														<th className="px-4 py-3 font-medium">Name</th>
														<th className="px-4 py-3 font-medium">Type</th>
														<th className="px-4 py-3 font-medium text-right">Dia. (mm)</th>
														<th className="px-4 py-3 font-medium text-right">Flutes</th>
														<th className="px-4 py-3 font-medium">Material</th>
														<th className="px-4 py-3 font-medium">Coating</th>
													</tr>
												</thead>
												<tbody className="divide-y divide-border dark:divide-white/5">
													{filteredTools.map(t => (
														<tr 
															key={t.id} 
															onClick={() => selectTool(t)}
															className="hover:bg-white/5 cursor-pointer transition-colors group"
														>
															<td className="px-4 py-3 font-medium group-hover:text-blue-400">{t.name}</td>
															<td className="px-4 py-3 text-muted-foreground">{t.type.replace('_', ' ')}</td>
															<td className="px-4 py-3 text-right font-mono">{t.diameter}</td>
															<td className="px-4 py-3 text-right font-mono">{t.flutes}</td>
															<td className="px-4 py-3 text-muted-foreground text-xs">{t.material.material_name}</td>
															<td className="px-4 py-3 text-muted-foreground text-xs">{t.coating?.coating_name || '-'}</td>
														</tr>
													))}
													{filteredTools.length === 0 && (
														<tr>
															<td colSpan={6} className="px-4 py-8 text-center text-muted-foreground text-sm">
																No tools match the selected filters.
															</td>
														</tr>
													)}
												</tbody>
											</table>
										</div>
									)}
								</div>

							</div>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}
