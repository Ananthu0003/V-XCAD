'use client';

import { useState, useTransition } from 'react';
import { Badge } from '@/components/ui/badge';
import { toggleToolStatus } from '@/app/tools/actions';

export function ToggleStatusButton({ toolId, initialStatus }: { toolId: string, initialStatus: boolean }) {
  const [isPending, startTransition] = useTransition();

  const handleToggle = () => {
    startTransition(() => {
      toggleToolStatus(toolId, initialStatus);
    });
  };

  if (initialStatus) {
    return (
      <Badge 
        onClick={handleToggle}
        className={`bg-emerald-500/10 text-emerald-500 border-emerald-500/20 cursor-pointer hover:bg-emerald-500/20 transition-colors ${isPending ? 'opacity-50' : ''}`}
      >
        {isPending ? 'Updating...' : 'Active'}
      </Badge>
    );
  }

  return (
    <Badge 
      variant="outline" 
      onClick={handleToggle}
      className={`cursor-pointer hover:bg-muted transition-colors ${isPending ? 'opacity-50' : ''}`}
    >
      {isPending ? 'Updating...' : 'Inactive'}
    </Badge>
  );
}
