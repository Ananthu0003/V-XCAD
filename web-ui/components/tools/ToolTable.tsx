'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Button, buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Search, Plus, MoreHorizontal, Pencil, Trash2, Eye } from 'lucide-react';
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
import { deleteTool } from '@/app/tools/actions';
import { toast } from 'sonner';

export function ToolTable({ 
  initialTools, 
  onDeleted, 
  onSelect, 
  onCreateNew,
  onViewDetails,
  onEditTool
}: { 
  initialTools: any[], 
  onDeleted?: () => void, 
  onSelect?: (tool: any) => void, 
  onCreateNew?: () => void,
  onViewDetails?: (tool: any) => void,
  onEditTool?: (tool: any) => void
}) {
  const [search, setSearch] = useState('');
  const router = useRouter();
  const pathname = usePathname();
  
  const [isDeleting, setIsDeleting] = useState<string | null>(null);
  const [toolToDelete, setToolToDelete] = useState<any | null>(null);

  const getReturnUrlQuery = () => {
    if (pathname === '/workspace') {
      return `?returnUrl=${encodeURIComponent('/workspace?action=openToolLibrary')}`;
    }
    if (pathname !== '/tools') {
      return `?returnUrl=${encodeURIComponent(pathname)}`;
    }
    return '';
  };

  const filteredTools = initialTools.filter(tool => {
    const searchLower = search.toLowerCase().trim();
    if (!searchLower) return true;
    
    const isNumericSearch = /^\d/.test(searchLower);
    const escapeRegExp = (str: string) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    
    // For numeric searches, ensure the match isn't preceded by a decimal point or another digit.
    // e.g. "5mm" won't match "1.5mm" or "25mm"
    const regex = isNumericSearch 
      ? new RegExp(`(^|[^0-9.])${escapeRegExp(searchLower)}`, 'i')
      : new RegExp(escapeRegExp(searchLower), 'i');
      
    const diamStr = `${tool.geometry?.diameter || tool.diameter || ''}${tool.unit || 'mm'}`.toLowerCase();
    
    return regex.test(tool.name.toLowerCase()) ||
           regex.test(tool.type.toLowerCase()) ||
           regex.test(diamStr);
  });

  const handleDelete = async () => {
    if (!toolToDelete) return;
    setIsDeleting(toolToDelete.id);
    const res = await deleteTool(toolToDelete.id);
    if (res.success) {
      toast.success("Tool deleted");
      setToolToDelete(null);
      if (onDeleted) {
        onDeleted();
      } else {
        router.refresh();
      }
    } else {
      toast.error(res.error || "Failed to delete tool");
    }
    setIsDeleting(null);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="relative w-72">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search tools..."
            className="pl-8"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        {onCreateNew ? (
          <Button onClick={onCreateNew}>
            <Plus className="mr-2 h-4 w-4" />
            Create Tool
          </Button>
        ) : (
          <Link href={`/tools/new${getReturnUrlQuery()}`} className={cn(buttonVariants())}>
            <Plus className="mr-2 h-4 w-4" />
            Create Tool
          </Link>
        )}
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Diameter</TableHead>
              <TableHead>Flutes</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-[80px] text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredTools.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center h-24 text-muted-foreground">
                  No tools found.
                </TableCell>
              </TableRow>
            ) : (
              filteredTools.map((tool) => (
                <TableRow
                  key={tool.id}
                  className={cn("transition-colors", onSelect ? "cursor-pointer hover:bg-muted/50" : "cursor-pointer")}
                  onClick={() => onSelect ? onSelect(tool) : router.push(`/tools/${tool.id}${getReturnUrlQuery()}`)}
                >
                  <TableCell>{tool.name}</TableCell>
                  <TableCell className="capitalize">{tool.type.replace(/_/g, ' ')}</TableCell>
                  <TableCell>{tool.geometry?.diameter} {tool.unit}</TableCell>
                  <TableCell>{tool.geometry?.fluteCount || '-'}</TableCell>
                  <TableCell>
                    {tool.isActive ? (
                      <Badge variant="outline" className="bg-emerald-500/10 text-emerald-500 border-emerald-500/20">Active</Badge>
                    ) : (
                      <Badge variant="outline" className="bg-slate-500/10 text-slate-500 border-slate-500/20">Inactive</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                    <Button variant="ghost" size="sm" onClick={() => onViewDetails ? onViewDetails(tool) : router.push(`/tools/${tool.id}${getReturnUrlQuery()}`)}>
                      <Eye className="h-4 w-4 mr-2" /> Details
                    </Button>
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
