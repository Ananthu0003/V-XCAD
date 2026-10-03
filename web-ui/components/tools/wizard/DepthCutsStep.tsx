'use client';

import { useToolWizardStore } from '@/store/toolWizardStore';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';

export function DepthCutsStep() {
  const { toolData, updateToolData } = useToolWizardStore();
  const data = toolData.cuttingData || {} as any;

  const updateData = (key: string, value: any) => {
    updateToolData({ cuttingData: { ...data, [key]: value } });
  };

  const depthCutsEnabled = data.depthCutsEnabled !== false; // default true
  const finishEnabled = (data.finishCuts || 0) > 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center space-x-2 border-b pb-4">
        <Checkbox 
          id="depth-cuts" 
          checked={depthCutsEnabled} 
          onCheckedChange={(c) => updateData('depthCutsEnabled', !!c)} 
        />
        <Label htmlFor="depth-cuts" className="font-semibold text-base cursor-pointer">Depth cuts</Label>
      </div>

      <div className={`grid grid-cols-1 xl:grid-cols-2 gap-6 xl:gap-8 ${!depthCutsEnabled ? 'opacity-50 pointer-events-none' : ''}`}>
        
        {/* Left Column: Values */}
        <div className="space-y-6">
          <div className="flex items-center justify-between gap-4">
            <Label className="leading-tight">Maximum rough step:</Label>
            <Input 
              type="number"
              step="0.1"
              className="w-24 shrink-0"
              placeholder="e.g. 2.0"
              value={data.stepdown || ''} 
              onChange={(e) => updateData('stepdown', parseFloat(e.target.value))}
            />
          </div>

          <div className="space-y-4 pt-2">
            <Label className="font-medium text-sm text-slate-500 uppercase tracking-wider block mb-2">Finish</Label>
            <div className="flex items-center justify-between gap-4">
              <Label>Number of cuts:</Label>
              <Input 
                type="number"
                className="w-24 shrink-0"
                placeholder="0"
                value={data.finishCuts || ''} 
                onChange={(e) => updateData('finishCuts', parseInt(e.target.value) || 0)}
              />
            </div>
            
            <div className={`flex items-center justify-between gap-4 ${!finishEnabled ? 'opacity-50 pointer-events-none' : ''}`}>
              <Label>Step:</Label>
              <Input 
                type="number"
                step="0.1"
                className="w-24 shrink-0"
                placeholder="e.g. 0.5"
                value={data.finishStepdown || ''} 
                onChange={(e) => updateData('finishStepdown', parseFloat(e.target.value))}
              />
            </div>
          </div>
        </div>

        {/* Right Column: Radio Options */}
        <div className="space-y-6 border-t xl:border-t-0 xl:border-l xl:pl-6 pt-4 xl:pt-0">
          <div className="space-y-3">
            <Label className="font-medium block mb-3 text-slate-400">Depth cut order</Label>
            <RadioGroup 
              value={data.depthCutOrder || 'contour'} 
              onValueChange={(v) => updateData('depthCutOrder', v)}
              className="flex flex-col space-y-2"
            >
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="contour" id="by-contour" />
                <Label htmlFor="by-contour" className="font-normal cursor-pointer">By contour</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="depth" id="by-depth" />
                <Label htmlFor="by-depth" className="font-normal cursor-pointer">By depth</Label>
              </div>
            </RadioGroup>
          </div>

          <div className="space-y-3 pt-2">
            <Label className="font-medium block mb-3 text-slate-400">Depth cut direction</Label>
            <RadioGroup 
              value={data.depthCutDirection || 'stepdown'} 
              onValueChange={(v) => updateData('depthCutDirection', v)}
              className="flex flex-col space-y-2"
            >
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="stepdown" id="dir-stepdown" />
                <Label htmlFor="dir-stepdown" className="font-normal cursor-pointer">Stepdown</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="stepup" id="dir-stepup" />
                <Label htmlFor="dir-stepup" className="font-normal cursor-pointer">Stepup</Label>
              </div>
            </RadioGroup>
          </div>
        </div>
      </div>

      <div className="border-t pt-6 mt-6">
        <div className="flex items-center justify-between gap-4 w-full md:w-3/4 xl:w-1/2">
          <Label className="font-semibold text-base">Optimal Stepover (Ae):</Label>
          <Input 
            type="number"
            step="0.1"
            className="w-24 shrink-0"
            placeholder="e.g. 0.4"
            value={data.stepover || ''} 
            onChange={(e) => updateData('stepover', parseFloat(e.target.value))}
          />
        </div>
      </div>
    </div>
  );
}
