'use client';

import { useToolWizardStore } from '@/store/toolWizardStore';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function CutterGeometryStep() {
  const { toolData, updateToolData } = useToolWizardStore();
  const geo = toolData.geometry || {} as any;
  const type = toolData.type;

  const updateGeo = (key: string, value: number) => {
    updateToolData({ geometry: { ...geo, [key]: value } });
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-6">
        
        {/* Common Fields */}
        <div className="space-y-2">
          <Label>Diameter</Label>
          <Input 
            type="number" step="0.1" 
            value={geo.diameter || ''} 
            onChange={(e) => updateGeo('diameter', parseFloat(e.target.value))}
          />
        </div>

        <div className="space-y-2">
          <Label>Overall Length</Label>
          <Input 
            type="number" step="0.1" 
            value={geo.overallLength || ''} 
            onChange={(e) => updateGeo('overallLength', parseFloat(e.target.value))}
          />
        </div>
        
        <div className="space-y-2">
          <Label>Flute Length</Label>
          <Input 
            type="number" step="0.1" 
            value={geo.fluteLength || ''} 
            onChange={(e) => updateGeo('fluteLength', parseFloat(e.target.value))}
          />
        </div>

        {/* Dynamic Fields based on tool type */}
        {['flat_end_mill', 'ball_end_mill', 'bull_nose_end_mill', 'drill', 'chamfer_mill'].includes(type || '') && (
          <div className="space-y-2">
            <Label>Flutes</Label>
            <Input 
              type="number" 
              value={geo.fluteCount || ''} 
              onChange={(e) => updateGeo('fluteCount', parseInt(e.target.value))}
            />
          </div>
        )}

        {(type === 'bull_nose_end_mill' || type === 'flat_end_mill') && (
          <div className="space-y-2">
            <Label>Corner Radius</Label>
            <Input 
              type="number" step="0.1" 
              value={geo.cornerRadius || ''} 
              onChange={(e) => updateGeo('cornerRadius', parseFloat(e.target.value))}
            />
          </div>
        )}

        {type === 'ball_end_mill' && (
          <div className="space-y-2">
            <Label>Ball Radius (Should be Dia / 2)</Label>
            <Input 
              type="number" step="0.1" 
              value={geo.ballRadius || ''} 
              onChange={(e) => updateGeo('ballRadius', parseFloat(e.target.value))}
            />
          </div>
        )}

        {type === 'drill' && (
          <div className="space-y-2">
            <Label>Point Angle (degrees)</Label>
            <Input 
              type="number" step="0.1" 
              value={geo.pointAngle || 118} 
              onChange={(e) => updateGeo('pointAngle', parseFloat(e.target.value))}
            />
          </div>
        )}

        {type === 'chamfer_mill' && (
          <div className="space-y-2">
            <Label>Included Angle (degrees)</Label>
            <Input 
              type="number" step="0.1" 
              value={geo.includedAngle || 90} 
              onChange={(e) => updateGeo('includedAngle', parseFloat(e.target.value))}
            />
          </div>
        )}

      </div>
    </div>
  );
}
