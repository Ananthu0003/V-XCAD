'use client';

import { useToolWizardStore } from '@/store/toolWizardStore';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export function CuttingDataStep() {
  const { toolData, updateToolData } = useToolWizardStore();
  const data = toolData.cuttingData || {} as any;
  const dia = toolData.geometry?.diameter || 0;
  const flutes = toolData.geometry?.fluteCount || 1;

  const updateData = (key: string, value: any) => {
    updateToolData({ cuttingData: { ...data, [key]: value } });
  };

  // Helper calculations
  const fpt = data.spindleRpm && data.feedRate ? (data.feedRate / (data.spindleRpm * flutes)).toFixed(4) : 0;
  const surfaceSpeed = data.spindleRpm && dia ? ((Math.PI * dia * data.spindleRpm) / 1000).toFixed(1) : 0;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-6">
        <div className="space-y-2">
          <Label>Spindle Speed (RPM)</Label>
          <Input 
            type="number" 
            placeholder="e.g. 10000"
            value={data.spindleRpm || ''} 
            onChange={(e) => updateData('spindleRpm', parseInt(e.target.value))}
          />
        </div>

        <div className="space-y-2">
          <Label>Cutting Feed Rate</Label>
          <Input 
            type="number" 
            placeholder="e.g. 1200"
            value={data.feedRate || ''} 
            onChange={(e) => updateData('feedRate', parseInt(e.target.value))}
          />
        </div>

        <div className="space-y-2">
          <Label>Plunge Feed Rate</Label>
          <Input 
            type="number" 
            placeholder="e.g. 300"
            value={data.plungeRate || ''} 
            onChange={(e) => updateData('plungeRate', parseInt(e.target.value))}
          />
        </div>

        <div className="space-y-2">
          <Label>Retract Feed Rate</Label>
          <Input 
            type="number" 
            placeholder="e.g. 500"
            value={data.retractRate || ''} 
            onChange={(e) => updateData('retractRate', parseInt(e.target.value))}
          />
        </div>

        <div className="space-y-2">
          <Label>Coolant</Label>
          <Select 
            value={data.coolant || 'off'} 
            onValueChange={(v: string) => updateData('coolant', v)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="off">Off</SelectItem>
              <SelectItem value="flood">Flood</SelectItem>
              <SelectItem value="mist">Mist</SelectItem>
              <SelectItem value="air">Air</SelectItem>
              <SelectItem value="through_spindle">Through Spindle</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="bg-muted p-4 rounded-md grid grid-cols-2 gap-4">
        <div>
          <span className="text-sm text-muted-foreground block">Calculated Feed per Tooth (fz):</span>
          <span className="text-lg font-mono font-medium">{fpt} mm/tooth</span>
        </div>
        <div>
          <span className="text-sm text-muted-foreground block">Calculated Surface Speed (Vc):</span>
          <span className="text-lg font-mono font-medium">{surfaceSpeed} m/min</span>
        </div>
      </div>
    </div>
  );
}
