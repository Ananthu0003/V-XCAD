'use client';

import { useToolWizardStore } from '@/store/toolWizardStore';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export function OffsetsStep() {
  const { toolData, updateToolData } = useToolWizardStore();
  const offsets = toolData.offsets || {} as any;

  const updateOffsets = (key: string, value: any) => {
    updateToolData({ offsets: { ...offsets, [key]: value } });
  };

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground mb-4">
        Define how the CNC control should apply length and diameter compensation for this tool.
      </p>

      <div className="grid grid-cols-2 gap-6">
        <div className="space-y-2">
          <Label>Length Offset (H)</Label>
          <Input 
            type="number" 
            value={offsets.lengthOffset || ''} 
            onChange={(e) => updateOffsets('lengthOffset', parseInt(e.target.value))}
          />
        </div>

        <div className="space-y-2">
          <Label>Diameter Offset (D)</Label>
          <Input 
            type="number" 
            value={offsets.diameterOffset || ''} 
            onChange={(e) => updateOffsets('diameterOffset', parseInt(e.target.value))}
          />
        </div>

        <div className="space-y-2">
          <Label>Compensation Type</Label>
          <Select 
            value={offsets.compensationType || 'computer'} 
            onValueChange={(v: string) => updateOffsets('compensationType', v)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="computer">Computer</SelectItem>
              <SelectItem value="control">Control</SelectItem>
              <SelectItem value="wear">Wear</SelectItem>
              <SelectItem value="inverse_wear">Inverse Wear</SelectItem>
              <SelectItem value="off">Off</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
}
