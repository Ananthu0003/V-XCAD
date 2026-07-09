'use client';

import { useState } from 'react';
import { usePathname } from 'next/navigation';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button, buttonVariants } from '@/components/ui/button';
import { Plus } from 'lucide-react';
import Link from 'next/link';
import { ToggleHolderStatusButton } from '@/components/holders/ToggleHolderStatusButton';
import { HolderTableRowActions } from '@/components/holders/HolderTableRowActions';

export function HolderTable({ initialHolders, onDeleted, onSelect, onCreateNew, onViewDetails, onEditHolder }: { initialHolders: any[], onDeleted?: () => void, onSelect?: (holder: any) => void, onCreateNew?: () => void, onViewDetails?: (id: string) => void, onEditHolder?: (id: string) => void }) {
  const pathname = usePathname();
  // In a real app we might want client-side search here, similar to ToolTable

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="relative w-72">
          {/* Search could go here */}
        </div>
        {onCreateNew ? (
          <Button onClick={onCreateNew}>
            <Plus className="mr-2 h-4 w-4" /> Add Holder
          </Button>
        ) : (
          <Link href={`/holders/new?returnUrl=${encodeURIComponent(pathname + '?action=openHolderLibrary')}`} className={buttonVariants()}>
            <Plus className="mr-2 h-4 w-4" /> Add Holder
          </Link>
        )}
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Status</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Gauge Length</TableHead>
              <TableHead>Diameter</TableHead>
              <TableHead>Taper</TableHead>
              <TableHead className="w-[80px] text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {initialHolders.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center h-24 text-muted-foreground">
                  No holders found. You can add them later or import them.
                </TableCell>
              </TableRow>
            ) : (
              initialHolders.map((holder) => (
                <TableRow key={holder.id} className="relative hover:bg-muted/50 transition-colors group">
                  <TableCell>
                    <ToggleHolderStatusButton holderId={holder.id} initialStatus={holder.isActive} />
                  </TableCell>
                  <TableCell className="font-medium">
                    {onSelect ? (
                      <button onClick={() => onSelect(holder)} className="absolute inset-0 z-0 w-full h-full cursor-pointer">
                        <span className="sr-only">Select {holder.name}</span>
                      </button>
                    ) : (
                      <Link href={`/holders/${holder.id}`} className="absolute inset-0 z-0">
                        <span className="sr-only">View {holder.name}</span>
                      </Link>
                    )}
                    <span className="relative z-10">{holder.name}</span>
                  </TableCell>
                  <TableCell><span className="relative z-10">{holder.type.replace(/_/g, ' ')}</span></TableCell>
                  <TableCell><span className="relative z-10">{holder.gaugeLength}</span></TableCell>
                  <TableCell><span className="relative z-10">{holder.diameter}</span></TableCell>
                  <TableCell><span className="relative z-10">{holder.taperType || '-'}</span></TableCell>
                  <TableCell className="text-right">
                    <HolderTableRowActions holderId={holder.id} holderName={holder.name} onDeleted={onDeleted} onViewDetails={onViewDetails} onEditHolder={onEditHolder} />
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
