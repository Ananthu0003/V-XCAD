import { getTools } from '@/lib/db/tools';
import { ToolTable } from '@/components/tools/ToolTable';

export const dynamic = 'force-dynamic';

export default async function ToolLibraryPage() {
  const tools = await getTools();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Tool Library</h1>
        <p className="text-muted-foreground mt-2">
          Manage and search your custom CNC tools.
        </p>
      </div>
      
      <ToolTable initialTools={tools} />
    </div>
  );
}
