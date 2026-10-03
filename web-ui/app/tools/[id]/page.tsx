import { getToolById } from '@/lib/db/tools';
import { notFound } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { Pencil, ArrowLeft } from 'lucide-react';
import { ToolPreview } from '@/components/tools/wizard/ToolPreview';
import { ToggleStatusButton } from '@/components/tools/ToggleStatusButton';

import { DeleteToolButton } from '@/components/tools/DeleteToolButton';

export default async function ToolDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ returnUrl?: string }>;
}) {
  const { id } = await params;
  const { returnUrl } = await searchParams;
  const backHref = returnUrl || "/tools";
  const tool = await getToolById(id);

  if (!tool) {
    notFound();
  }

  const gcodePreview = `T[ToolNumber] M06
S${tool.cuttingData?.spindleRpm || 1000} M03
G43 H[LengthOffset] Z50.
G41 D[DiameterOffset]`;

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Link href={backHref} className={cn(buttonVariants({ variant: "outline", size: "icon" }))}>
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div>
            <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
              {tool.name}
              <ToggleStatusButton toolId={tool.id} initialStatus={tool.isActive} />
            </h1>
            <p className="text-muted-foreground mt-1">
              {tool.type.replace(/_/g, ' ')} • {tool.category}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link href={`/tools/${tool.id}/edit${returnUrl ? `?returnUrl=${encodeURIComponent(returnUrl)}` : ''}`} className={cn(buttonVariants())}>
            <Pencil className="mr-2 h-4 w-4" /> Edit Tool
          </Link>
          <DeleteToolButton toolId={tool.id} />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        {/* Left Side: Details */}
        <div className="lg:col-span-2 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle>Cutter Geometry</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex justify-between border-b pb-2">
                  <span className="text-muted-foreground">Diameter</span>
                  <span className="font-medium">{tool.geometry?.diameter} {tool.unit}</span>
                </div>
                <div className="flex justify-between border-b pb-2">
                  <span className="text-muted-foreground">Flute Length</span>
                  <span className="font-medium">{tool.geometry?.fluteLength} {tool.unit}</span>
                </div>
                <div className="flex justify-between border-b pb-2">
                  <span className="text-muted-foreground">Overall Length</span>
                  <span className="font-medium">{tool.geometry?.overallLength} {tool.unit}</span>
                </div>
                <div className="flex justify-between pb-2">
                  <span className="text-muted-foreground">Flutes</span>
                  <span className="font-medium">{tool.geometry?.fluteCount || '-'}</span>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Offsets & Assembly</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex justify-between border-b pb-2">
                  <span className="text-muted-foreground">Length Offset (H)</span>
                  <span className="font-medium">{tool.offsets?.lengthOffset}</span>
                </div>
                <div className="flex justify-between border-b pb-2">
                  <span className="text-muted-foreground">Diameter Offset (D)</span>
                  <span className="font-medium">{tool.offsets?.diameterOffset}</span>
                </div>
                <div className="flex justify-between border-b pb-2">
                  <span className="text-muted-foreground">Stickout Length</span>
                  <span className="font-medium">{tool.assembly?.stickoutLength || '-'} {tool.unit}</span>
                </div>
                <div className="flex justify-between pb-2">
                  <span className="text-muted-foreground">Compensation</span>
                  <span className="font-medium capitalize">{tool.offsets?.compensationType || 'Computer'}</span>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Cutting Data (Default)</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex justify-between border-b pb-2">
                  <span className="text-muted-foreground">Spindle Speed</span>
                  <span className="font-medium">{tool.cuttingData?.spindleRpm || '-'} RPM</span>
                </div>
                <div className="flex justify-between border-b pb-2">
                  <span className="text-muted-foreground">Cutting Feed</span>
                  <span className="font-medium">{tool.cuttingData?.feedRate || '-'} mm/min</span>
                </div>
                <div className="flex justify-between border-b pb-2">
                  <span className="text-muted-foreground">Plunge Feed</span>
                  <span className="font-medium">{tool.cuttingData?.plungeRate || '-'} mm/min</span>
                </div>
                <div className="flex justify-between pb-2">
                  <span className="text-muted-foreground">Coolant</span>
                  <span className="font-medium capitalize">{tool.cuttingData?.coolant || 'Off'}</span>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>G-Code Preview</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground mb-2">This is an example toolcall sequence. Always verify output.</p>
                <pre className="bg-muted p-4 rounded-md font-mono text-sm overflow-x-auto">
                  {gcodePreview}
                </pre>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Right Side: Visual Preview */}
        <div className="lg:col-span-1 sticky top-6">
          <Card className="h-[600px] flex flex-col overflow-hidden bg-slate-950 border-slate-800 shadow-xl">
            <CardContent className="p-0 flex-1 relative min-h-0 overflow-hidden">
              <ToolPreview toolData={tool} />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
