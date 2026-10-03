'use client';

import { useEffect } from 'react';
import { useToolWizardStore } from '@/store/toolWizardStore';
import { ToolWizard } from '@/components/tools/wizard/ToolWizard';

export function CreateToolClientWrapper({ nextToolNumber }: { nextToolNumber: number }) {
  const { resetWizard, updateToolData, editingId, setEditingId } = useToolWizardStore();

  useEffect(() => {
    // Only initialize if we're not currently editing (which shouldn't happen here, but to be safe)
    if (editingId) {
      setEditingId(null);
    }
    
    // Reset to defaults
    resetWizard();
    
    // Override with the synced tool number
    updateToolData({ 
      offsets: { 
        lengthOffset: nextToolNumber, 
        diameterOffset: nextToolNumber, 
        compensationType: 'computer' 
      }
    });

    return () => {
      // Cleanup
      resetWizard();
    };
  }, [nextToolNumber, resetWizard, updateToolData, editingId, setEditingId]);

  return <ToolWizard />;
}
