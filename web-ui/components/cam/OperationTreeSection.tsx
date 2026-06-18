import type { CamOperation, OperationType } from '@/types/cam';
import { Plus, Trash2, Settings2 } from 'lucide-react';

type OperationTreeSectionProps = {
	operations: CamOperation[];
	activeOperationId: string;
	onSelect: (id: string) => void;
	onAdd: (type: OperationType) => void;
	onDelete: (id: string) => void;
};

const opTypeLabels: Record<OperationType, string> = {
	'facing': 'Facing',
	'pocket': '2D Pocket',
	'2d_contour': '2D Contour',
	'drilling': 'Drilling',
	'chamfer': 'Chamfer',
};

export function OperationTreeSection({ operations, activeOperationId, onSelect, onAdd, onDelete }: OperationTreeSectionProps) {
	return (
		<div className="flex flex-col gap-3">
			<div className="flex flex-col gap-1 rounded-2xl border border-border dark:border-white/10 bg-accent/40 dark:bg-black/40 p-2">
				<div className="px-3 py-1 flex items-center justify-between">
					<span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Setup 1</span>
					<div className="group relative">
						<button className="flex items-center justify-center p-1 hover:bg-blue-500/20 hover:text-blue-500 rounded text-muted-foreground transition-colors">
							<Plus className="size-3.5" />
						</button>
						<div className="absolute right-0 top-full mt-1 hidden w-32 flex-col rounded-xl border border-border bg-background shadow-xl group-hover:flex z-50">
							{(Object.keys(opTypeLabels) as OperationType[]).map(type => (
								<button
									key={type}
									onClick={() => onAdd(type)}
									className="px-3 py-2 text-left text-xs hover:bg-accent first:rounded-t-xl last:rounded-b-xl"
								>
									{opTypeLabels[type]}
								</button>
							))}
						</div>
					</div>
				</div>
				
				<div className="flex flex-col gap-1 pl-2">
					{operations.map((op, index) => {
						const isActive = op.id === activeOperationId;
						return (
							<div
								key={op.id}
								onClick={() => onSelect(op.id)}
								className={`group flex cursor-pointer items-center justify-between rounded-xl px-3 py-2 transition-all ${
									isActive 
										? 'bg-blue-500/20 border border-blue-500/30 text-blue-500' 
										: 'hover:bg-accent/50 text-foreground border border-transparent'
								}`}
							>
								<div className="flex items-center gap-2">
									<Settings2 className="size-3.5 opacity-50" />
									<span className="text-xs font-semibold">{index + 1}. {op.name}</span>
								</div>
								
								{operations.length > 1 && (
									<button
										onClick={(e) => {
											e.stopPropagation();
											onDelete(op.id);
										}}
										className="opacity-0 group-hover:opacity-100 p-1 hover:text-rose-500 transition-colors"
									>
										<Trash2 className="size-3" />
									</button>
								)}
							</div>
						);
					})}
				</div>
			</div>
		</div>
	);
}
