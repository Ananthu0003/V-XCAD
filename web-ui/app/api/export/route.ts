import { NextResponse } from 'next/server';
import { getTools } from '@/lib/db/tools';

export async function GET() {
  try {
    const tools = await getTools();
    
    // Format tools to match the requested export format
    const exportData = tools.map(tool => ({
      name: tool.name,
      category: tool.category,
      type: tool.type,
      description: tool.description,
      manufacturer: tool.manufacturer,
      partNumber: tool.partNumber,
      unit: tool.unit,
      isActive: tool.isActive,
      geometry: tool.geometry,
      offsets: tool.offsets,
      assembly: tool.assembly ? {
        stickoutLength: tool.assembly.stickoutLength,
        totalLength: tool.assembly.totalLength,
        safeClearanceLength: tool.assembly.safeClearanceLength,
        holder: tool.assembly.holder ? {
          name: tool.assembly.holder.name,
          type: tool.assembly.holder.type
        } : undefined
      } : undefined,
      cuttingData: tool.cuttingData,
      compatibility: tool.compatibility
    }));

    return new NextResponse(JSON.stringify(exportData, null, 2), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': 'attachment; filename="tool_library_export.json"'
      }
    });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to export tools' }, { status: 500 });
  }
}
