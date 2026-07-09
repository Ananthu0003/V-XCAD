import { getToolById } from '@/lib/db/tools';
import { notFound } from 'next/navigation';
import { EditToolClientWrapper } from './EditToolClientWrapper';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

export default async function EditToolPage({ 
  params,
  searchParams,
}: { 
  params: Promise<{ id: string }>;
  searchParams: Promise<{ returnUrl?: string }>;
}) {
  const { id } = await params;
  const { returnUrl } = await searchParams;
  const tool = await getToolById(id);

  if (!tool) {
    notFound();
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Edit Tool: {tool.name}</h1>
        <p className="text-muted-foreground mt-1">
          Modify the parameters of this tool. Changes will update the existing tool record.
        </p>
      </div>
      
      <EditToolClientWrapper initialData={tool} toolId={tool.id} returnUrl={returnUrl} />
    </div>
  );
}
