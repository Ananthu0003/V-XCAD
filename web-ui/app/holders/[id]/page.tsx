import { prisma } from "@/lib/prisma";
import { notFound } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { Pencil, ArrowLeft } from 'lucide-react';
import { ToggleHolderStatusButton } from '@/components/holders/ToggleHolderStatusButton';
import { HolderPreview } from '@/components/holders/HolderPreview';
import { DeleteHolderButton } from '@/components/holders/DeleteHolderButton';

export default async function HolderDetailPage({ 
  params,
  searchParams,
}: { 
  params: Promise<{ id: string }>;
  searchParams: Promise<{ returnUrl?: string }>;
}) {
  const { id } = await params;
  const { returnUrl } = await searchParams;
  const backHref = returnUrl || "/holders";
  const holder = await prisma.holder.findUnique({
    where: { id }
  });

  if (!holder) {
    notFound();
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Link href={backHref} className={cn(buttonVariants({ variant: "outline", size: "icon" }))}>
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div>
            <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
              {holder.name}
              <ToggleHolderStatusButton holderId={holder.id} initialStatus={holder.isActive} />
            </h1>
            <p className="text-muted-foreground mt-1">
              {holder.type.replace(/_/g, ' ')} • {holder.manufacturer || 'Unknown Manufacturer'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link href={`/holders/${holder.id}/edit${returnUrl ? `?returnUrl=${encodeURIComponent(returnUrl)}` : ''}`} className={cn(buttonVariants())}>
            <Pencil className="mr-2 h-4 w-4" /> Edit Holder
          </Link>
          <DeleteHolderButton holderId={holder.id} />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        
        {/* Left Column: Info */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Holder Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex justify-between border-b pb-2">
                <span className="text-muted-foreground">Type</span>
                <span className="font-medium">{holder.type}</span>
              </div>
              <div className="flex justify-between border-b pb-2">
                <span className="text-muted-foreground">Gauge Length</span>
                <span className="font-medium">{holder.gaugeLength}</span>
              </div>
              <div className="flex justify-between border-b pb-2">
                <span className="text-muted-foreground">Diameter</span>
                <span className="font-medium">{holder.diameter}</span>
              </div>
              <div className="flex justify-between border-b pb-2">
                <span className="text-muted-foreground">Shank Size</span>
                <span className="font-medium">{holder.shankSize || '-'}</span>
              </div>
              <div className="flex justify-between pb-2">
                <span className="text-muted-foreground">Taper Type</span>
                <span className="font-medium">{holder.taperType || '-'}</span>
              </div>
            </CardContent>
          </Card>

          {holder.description && (
            <Card>
              <CardHeader>
                <CardTitle>Description</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm whitespace-pre-wrap">{holder.description}</p>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Right Column: Visual Preview */}
        <div className="lg:col-span-1 sticky top-6">
          <Card className="h-[600px] flex flex-col overflow-hidden shadow-md">
            <CardContent className="p-0 flex-1 relative min-h-0 overflow-hidden">
              <HolderPreview holderData={holder as any} />
            </CardContent>
          </Card>
        </div>

      </div>
    </div>
  );
}
