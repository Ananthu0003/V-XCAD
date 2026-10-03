'use client';

import { useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { MoreHorizontal, Pencil, Trash2, Eye } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { deleteHolder } from '@/app/holders/actions';
import { toast } from 'sonner';

export function HolderTableRowActions({ 
  holderId, 
  holderName, 
  onDeleted, 
  onViewDetails, 
  onEditHolder 
}: { 
  holderId: string; 
  holderName: string;
  onDeleted?: () => void;
  onViewDetails?: (id: string) => void;
  onEditHolder?: (id: string) => void;
}) {
  const router = useRouter();
  const pathname = usePathname();

  const getReturnUrlQuery = () => {
    if (pathname === '/workspace') {
      return `?returnUrl=${encodeURIComponent('/workspace?action=openHolderLibrary')}`;
    }
    if (pathname !== '/holders') {
      return `?returnUrl=${encodeURIComponent(pathname)}`;
    }
    return '';
  };

  const [isDeleting, setIsDeleting] = useState(false);
  const [showDelete, setShowDelete] = useState(false);

  const handleDelete = async () => {
    setIsDeleting(true);
    const res = await deleteHolder(holderId);
    if (res.success) {
      toast.success("Holder deleted");
      setShowDelete(false);
      if (onDeleted) {
        onDeleted();
      } else {
        router.refresh();
      }
    } else {
      toast.error(res.error || "Failed to delete holder");
      setIsDeleting(false);
    }
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="ghost" className="h-8 w-8 p-0 relative z-20" />}>
          <span className="sr-only">Open menu</span>
          <MoreHorizontal className="h-4 w-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => onViewDetails ? onViewDetails(holderId) : router.push(`/holders/${holderId}${getReturnUrlQuery()}`)}>
            <Eye className="mr-2 h-4 w-4" /> View Details
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onEditHolder ? onEditHolder(holderId) : router.push(`/holders/${holderId}/edit${getReturnUrlQuery()}`)}>
            <Pencil className="mr-2 h-4 w-4" /> Edit Holder
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem 
            className="text-destructive focus:text-destructive cursor-pointer" 
            onClick={() => setShowDelete(true)}
          >
            <Trash2 className="mr-2 h-4 w-4" /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={showDelete} onOpenChange={setShowDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Holder?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete {holderName}? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={isDeleting}
              onClick={(e) => {
                e.preventDefault();
                handleDelete();
              }}
            >
              {isDeleting ? "Deleting..." : "Delete"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
