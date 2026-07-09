'use client';

import { useToolWizardStore } from '@/store/toolWizardStore';
import { Button } from '@/components/ui/button';
import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { toolSchema } from '@/lib/validation/toolSchema';

export function ReviewSaveStep() {
  const { toolData, resetWizard, editingId, onComplete } = useToolWizardStore();
  const [errors, setErrors] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();

  const handleSave = async (redirect: boolean) => {
    setIsSaving(true);
    setErrors([]);
    
    // Validate
    const result = toolSchema.safeParse(toolData);
    if (!result.success) {
      const errs = result.error.issues.map(e => `${e.path.join('.')}: ${e.message}`);
      setErrors(errs);
      setIsSaving(false);
      return;
    }

    try {
      const isEditing = !!editingId;
      const endpoint = isEditing ? `/api/tools/${editingId}` : '/api/tools';
      const method = isEditing ? 'PUT' : 'POST';

      const res = await fetch(endpoint, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(result.data)
      });
      
      if (!res.ok) {
        throw new Error('Failed to save tool');
      }

      if (redirect) {
        resetWizard();
        if (onComplete) {
          onComplete();
          return;
        }

        const returnUrl = searchParams.get('returnUrl');
        if (returnUrl) {
          router.push(returnUrl);
        } else {
          router.push(isEditing ? `/tools/${editingId}` : '/tools');
        }
      } else {
        resetWizard();
        router.refresh(); // Fetch new nextToolNumber from server
      }
    } catch (e: any) {
      setErrors([e.message || "An error occurred"]);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-muted p-4 rounded-md">
        <h3 className="font-medium mb-2">Tool Summary</h3>
        <ul className="text-sm space-y-1">
          <li><strong>Name:</strong> {toolData.name || 'Unnamed Tool'}</li>
          <li><strong>Diameter:</strong> {toolData.geometry?.diameter} {toolData.unit}</li>
          <li><strong>Type:</strong> {toolData.type?.replace(/_/g, ' ')}</li>
        </ul>
      </div>

      {errors.length > 0 && (
        <div className="bg-destructive/10 text-destructive p-4 rounded-md text-sm space-y-1">
          <p className="font-bold">Validation Errors:</p>
          <ul className="list-disc pl-4">
            {errors.map((e, i) => <li key={i}>{e}</li>)}
          </ul>
        </div>
      )}

      <div className="flex gap-4">
        <Button 
          onClick={() => handleSave(true)} 
          disabled={isSaving}
        >
          {isSaving ? 'Saving...' : 'Save Tool'}
        </Button>
        <Button 
          variant="outline" 
          onClick={() => handleSave(false)} 
          disabled={isSaving}
        >
          Save & Create Another
        </Button>
      </div>
    </div>
  );
}
