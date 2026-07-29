'use client';

import { useToolWizardStore } from '@/store/toolWizardStore';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function HolderAssemblyStep() {
  const { toolData, updateToolData } = useToolWizardStore();
  const assembly = toolData.assembly || {} as any;
  const geometry = toolData.geometry;

  const updateAssembly = (key: string, value: any) => {
    updateToolData({ assembly: { ...assembly, [key]: value } });
  };

  const stickoutError = (assembly.stickoutLength && geometry?.fluteLength && assembly.stickoutLength < geometry.fluteLength)
    ? "Stickout cannot be less than flute length."
    : null;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-6">
        <div className="space-y-2">
          <Label>Stickout Length</Label>
          <Input 
            type="number" step="0.1"
            placeholder="e.g. 45.0"
            value={assembly.stickoutLength || ''} 
            onChange={(e) => updateAssembly('stickoutLength', parseFloat(e.target.value))}
          />
          {stickoutError && (
            <p className="text-sm text-destructive mt-1">{stickoutError}</p>
          )}
        </div>

        <div className="space-y-2">
          <Label>Total Assembly Length</Label>
          <Input 
            type="number" step="0.1"
            placeholder="e.g. 120.0"
            value={assembly.totalLength || ''} 
            onChange={(e) => updateAssembly('totalLength', parseFloat(e.target.value))}
          />
        </div>

        <div className="space-y-2">
          <Label>Safe Clearance Length</Label>
          <Input 
            type="number" step="0.1"
            placeholder="e.g. 2.0"
            value={assembly.safeClearanceLength || ''} 
            onChange={(e) => updateAssembly('safeClearanceLength', parseFloat(e.target.value))}
          />
        </div>
      </div>
    </div>
  );
}
