'use client';

import { useToolWizardStore } from '@/store/toolWizardStore';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function CompatibilityStep() {
  const { toolData, updateToolData } = useToolWizardStore();
  const compat = toolData.compatibility || {} as any;

  const updateCompat = (key: string, value: any) => {
    updateToolData({ compatibility: { ...compat, [key]: value } });
  };

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground mb-4">
        Specify operations and materials this tool is designed for. (Comma separated for now)
      </p>

      <div className="space-y-4">
        <div className="space-y-2">
          <Label>Compatible Operations</Label>
          <Input 
            value={compat.compatibleOperationsJson ? JSON.parse(compat.compatibleOperationsJson).join(', ') : ''} 
            onChange={(e) => updateCompat('compatibleOperationsJson', JSON.stringify(e.target.value.split(',').map(s => s.trim())))}
            placeholder="e.g. 2d_contour, pocket, facing"
          />
        </div>

        <div className="space-y-2">
          <Label>Compatible Materials</Label>
          <Input 
            value={compat.compatibleMaterialsJson ? JSON.parse(compat.compatibleMaterialsJson).join(', ') : ''} 
            onChange={(e) => updateCompat('compatibleMaterialsJson', JSON.stringify(e.target.value.split(',').map(s => s.trim())))}
            placeholder="e.g. aluminum, steel, brass"
          />
        </div>

        <div className="space-y-2">
          <Label>Unsupported Reason (If applicable)</Label>
          <Input 
            value={compat.unsupportedReason || ''} 
            onChange={(e) => updateCompat('unsupportedReason', e.target.value)}
            placeholder="e.g. Do not use for plunging"
          />
        </div>
      </div>
    </div>
  );
}
