'use client';

import { useEffect } from 'react';
import { useToolWizardStore } from '@/store/toolWizardStore';
import { ToolWizard } from '@/components/tools/wizard/ToolWizard';

export function EditToolClientWrapper({ initialData, toolId, returnUrl }: { initialData: any, toolId: string, returnUrl?: string }) {
  const { setInitialData, setEditingId, resetWizard } = useToolWizardStore();

  useEffect(() => {
    setInitialData(initialData);
    setEditingId(toolId);

    return () => {
      // Cleanup when leaving the edit page so we don't accidentally edit this tool later
      resetWizard();
    };
  }, [initialData, toolId, setInitialData, setEditingId, resetWizard]);

  return <ToolWizard />;
}
