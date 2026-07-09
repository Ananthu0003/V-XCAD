'use client';

import { useToolWizardStore } from '@/store/toolWizardStore';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent } from '@/components/ui/card';

export function BasicInfoStep() {
  const { toolData, updateToolData } = useToolWizardStore();

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-6">
        <div className="space-y-2">
          <Label htmlFor="name">Tool Name</Label>
          <Input 
            id="name" 
            value={toolData.name || ''} 
            onChange={(e) => updateToolData({ name: e.target.value })}
            placeholder="e.g. 10mm Flat End Mill"
          />
        </div>
        <div className="space-y-2">
          <Label>Category</Label>
          <Select 
            value={toolData.category} 
            onValueChange={(v: any) => updateToolData({ category: v })}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select category" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="milling">Milling</SelectItem>
              <SelectItem value="drilling">Drilling</SelectItem>
              <SelectItem value="turning">Turning</SelectItem>
              <SelectItem value="custom_form">Custom Form</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>Tool Type</Label>
          <Select 
            value={toolData.type} 
            onValueChange={(v: any) => updateToolData({ type: v })}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="flat_end_mill">Flat End Mill</SelectItem>
              <SelectItem value="ball_end_mill">Ball End Mill</SelectItem>
              <SelectItem value="bull_nose_end_mill">Bull Nose End Mill</SelectItem>
              <SelectItem value="drill">Drill</SelectItem>
              <SelectItem value="chamfer_mill">Chamfer Mill</SelectItem>
              <SelectItem value="face_mill">Face Mill</SelectItem>
              <SelectItem value="thread_mill">Thread Mill</SelectItem>
              <SelectItem value="t_slot_cutter">T-Slot Cutter</SelectItem>
              <SelectItem value="dovetail_cutter">Dovetail Cutter</SelectItem>
              <SelectItem value="reamer">Reamer</SelectItem>
              <SelectItem value="boring_bar">Boring Bar</SelectItem>
              <SelectItem value="custom_profile_tool">Custom Profile</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>Tool Material</Label>
          <Select 
            value={toolData.material || 'carbide'} 
            onValueChange={(v: any) => updateToolData({ material: v })}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select material" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="hss">HSS (High Speed Steel)</SelectItem>
              <SelectItem value="carbide">Solid Carbide</SelectItem>
              <SelectItem value="hss_co">Cobalt (HSS-Co)</SelectItem>
              <SelectItem value="carbide_insert">Carbide Insert</SelectItem>
              <SelectItem value="ceramic">Ceramic</SelectItem>
              <SelectItem value="cbn">CBN</SelectItem>
              <SelectItem value="pcd">PCD (Diamond)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>Unit System</Label>
          <Select 
            value={toolData.unit} 
            onValueChange={(v: any) => updateToolData({ unit: v })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="mm">Millimeters (mm)</SelectItem>
              <SelectItem value="inch">Inches (in)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>Status</Label>
          <Select 
            value={toolData.isActive !== false ? "active" : "inactive"} 
            onValueChange={(v: any) => updateToolData({ isActive: v === 'active' })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="active">Active (Available for use)</SelectItem>
              <SelectItem value="inactive">Inactive (Broken/Out of stock)</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
}
