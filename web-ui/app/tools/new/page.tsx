import { prisma } from "@/lib/prisma";
import { CreateToolClientWrapper } from './CreateToolClientWrapper';

export const dynamic = 'force-dynamic';

export default async function CreateToolPage() {
  const toolCount = await prisma.tool.count();
  const nextToolNumber = toolCount + 1;

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Create Custom Tool</h1>
        <p className="text-muted-foreground mt-2">
          Define a new CAM tool by filling out the geometry, offsets, and cutting data.
        </p>
      </div>
      
      <CreateToolClientWrapper nextToolNumber={nextToolNumber} />
    </div>
  );
}
