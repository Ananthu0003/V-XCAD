'use client';

import { useTransition } from 'react';
import { Badge } from '@/components/ui/badge';
import { toggleHolderStatus } from '@/app/holders/actions';

export function ToggleHolderStatusButton({ holderId, initialStatus }: { holderId: string, initialStatus: boolean }) {
  const [isPending, startTransition] = useTransition();

  const handleToggle = (e: React.MouseEvent) => {
    e.preventDefault(); // Prevent navigating if this is inside a Link
    startTransition(() => {
      toggleHolderStatus(holderId, initialStatus);
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
