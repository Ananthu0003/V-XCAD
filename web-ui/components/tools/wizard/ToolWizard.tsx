'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToolWizardStore } from '@/store/toolWizardStore';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { BasicInfoStep } from './BasicInfoStep';
import { CutterGeometryStep } from './CutterGeometryStep';
import { OffsetsStep } from './OffsetsStep';
import { HolderAssemblyStep } from './HolderAssemblyStep';
import { CuttingDataStep } from './CuttingDataStep';
import { CompatibilityStep } from './CompatibilityStep';
import { ReviewSaveStep } from './ReviewSaveStep';
import { ToolPreview } from './ToolPreview';

const steps = [
  { id: 1, title: 'Basic Info', component: BasicInfoStep },
  { id: 2, title: 'Geometry', component: CutterGeometryStep },
  { id: 3, title: 'Offsets', component: OffsetsStep },
  { id: 4, title: 'Holder & Assembly', component: HolderAssemblyStep },
  { id: 5, title: 'Feeds & Speeds', component: CuttingDataStep },
  { id: 6, title: 'Compatibility', component: CompatibilityStep },
  { id: 7, title: 'Review & Save', component: ReviewSaveStep },
];

export function ToolWizard() {
  const { currentStep, nextStep, prevStep, toolData, editingId, resetWizard, onCancel } = useToolWizardStore();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isCancelDialogOpen, setIsCancelDialogOpen] = useState(false);
  
  const currentStepData = steps.find(s => s.id === currentStep);
  const StepComponent = currentStepData?.component || BasicInfoStep;

  const handleCancel = () => {
    setIsCancelDialogOpen(true);
  };

  const confirmCancel = () => {
    setIsCancelDialogOpen(false);
    resetWizard();
    
    if (onCancel) {
      onCancel();
      return;
    }

    const returnUrl = searchParams.get('returnUrl');
    if (returnUrl) {
      router.push(returnUrl);
    } else if (editingId) {
      router.push(`/tools/${editingId}`);
    } else {
      router.push('/tools');
    }
  };

  return (
    <>
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Sidebar Steps */}
        <div className="col-span-1 lg:col-span-3 space-y-1">
          {steps.map((step) => (
            <div 
              key={step.id} 
              className={`px-4 py-3 rounded-md text-sm font-medium transition-colors ${
                currentStep === step.id 
                  ? 'bg-primary text-primary-foreground' 
                  : currentStep > step.id 
                    ? 'bg-muted/50 text-foreground' 
                    : 'text-muted-foreground'
              }`}
            >
              Step {step.id}: {step.title}
            </div>
          ))}
        </div>

        {/* Main Content Area */}
        <div className="col-span-1 lg:col-span-5">
          <Card className="min-h-[500px] flex flex-col">
            <CardHeader>
              <CardTitle>{currentStepData?.title}</CardTitle>
            </CardHeader>
            <CardContent className="flex-1 flex flex-col">
              <div className="flex-1">
                <StepComponent />
              </div>
              
              <div className="flex justify-between mt-8 pt-4 border-t">
                <div className="flex gap-2">
                  <Button 
                    variant="outline" 
                    onClick={prevStep} 
                    disabled={currentStep === 1}
                  >
                    Previous
                  </Button>
                  <Button 
                    variant="ghost" 
                    onClick={handleCancel}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    Cancel
                  </Button>
                </div>
                {currentStep < steps.length && (
                  <Button onClick={nextStep}>
                    Next Step
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Tool Preview Area */}
        <div className="col-span-1 lg:col-span-4 sticky top-6">
          <Card className="h-[500px] flex flex-col overflow-hidden bg-slate-950 border-slate-800 shadow-xl">
            <CardHeader className="bg-slate-900 py-3 border-b border-slate-800">
              <CardTitle className="text-sm text-slate-300 font-medium flex items-center justify-between">
                <span className="truncate pr-2">{toolData.name || 'Unnamed Tool'}</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0 flex-1 relative min-h-0 overflow-hidden">
              <ToolPreview />
            </CardContent>
          </Card>
        </div>
      </div>

      <Dialog open={isCancelDialogOpen} onOpenChange={setIsCancelDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel Tool Creation?</DialogTitle>
            <DialogDescription>
              Are you sure you want to cancel? Any unsaved changes you've made to this tool will be permanently lost.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-4 flex gap-2 sm:justify-end">
            <Button variant="outline" onClick={() => setIsCancelDialogOpen(false)}>
              Keep Editing
            </Button>
            <Button variant="destructive" onClick={confirmCancel}>
              Discard Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
