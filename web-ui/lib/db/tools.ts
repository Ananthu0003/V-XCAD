import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import { ToolFormValues } from '../validation/toolSchema';

export async function getTools() {
  return await prisma.tool.findMany({
    include: {
      geometry: true,
      offsets: true,
      assembly: {
        include: { holder: true }
      },
      cuttingData: true,
      compatibility: true,
    }
  });
}

export async function getToolById(id: string) {
  return await prisma.tool.findUnique({
    where: { id },
    include: {
      geometry: true,
      offsets: true,
      assembly: {
        include: { holder: true }
      },
      cuttingData: true,
      compatibility: true,
    }
  });
}

export async function createTool(data: ToolFormValues) {
  return await prisma.tool.create({
    data: {
      name: data.name,
      category: data.category,
      type: data.type,
      description: data.description,
      manufacturer: data.manufacturer,
      partNumber: data.partNumber,
      unit: data.unit,
      isActive: data.isActive,
      geometry: {
        create: data.geometry
      },
      offsets: {
        create: data.offsets
      },
      ...(data.assembly ? {
        assembly: {
          create: {
            ...data.assembly,
            holderId: data.assembly.holderId || null,
          }
        }
      } : {}),
      ...(data.cuttingData ? {
        cuttingData: {
          create: data.cuttingData
        }
      } : {}),
      ...(data.compatibility ? {
        compatibility: {
          create: data.compatibility
        }
      } : {})
    },
    include: {
      geometry: true,
      offsets: true,
      assembly: true,
      cuttingData: true,
      compatibility: true,
    }
  });
}

export async function updateTool(id: string, data: ToolFormValues) {
  // First, we need to handle nested updates properly.
  // Prisma doesn't do deep upserts cleanly in a single update without some boilerplate.
  
  return await prisma.tool.update({
    where: { id },
    data: {
      name: data.name,
      category: data.category,
      type: data.type,
      description: data.description,
      manufacturer: data.manufacturer,
      partNumber: data.partNumber,
      unit: data.unit,
      isActive: data.isActive,
      geometry: {
        upsert: {
          create: data.geometry,
          update: data.geometry
        }
      },
      offsets: {
        upsert: {
          create: data.offsets,
          update: data.offsets
        }
      },
      assembly: data.assembly ? {
        upsert: {
          create: {
            ...data.assembly,
            holderId: data.assembly.holderId || null,
          },
          update: {
            ...data.assembly,
            holderId: data.assembly.holderId || null,
          }
        }
      } : { delete: true },
      cuttingData: data.cuttingData ? {
        upsert: {
          create: data.cuttingData,
          update: data.cuttingData
        }
      } : { delete: true },
      compatibility: data.compatibility ? {
        upsert: {
          create: data.compatibility,
          update: data.compatibility
        }
      } : { delete: true }
    }
  });
}

export async function deactivateTool(id: string) {
  return await prisma.tool.update({
    where: { id },
    data: { isActive: false }
  });
}

export async function deleteTool(id: string) {
  return await prisma.tool.delete({
    where: { id }
  });
}

export async function duplicateTool(id: string) {
  const existingTool = await getToolById(id);
  if (!existingTool) throw new Error('Tool not found');

  const { id: _, createdAt, updatedAt, geometry, offsets, assembly, cuttingData, compatibility, ...rest } = existingTool;

  // We omit IDs from the nested objects
  const buildNestedCreate = (obj: any) => {
    if (!obj) return undefined;
    const { id, toolId, ...data } = obj;
    return { create: data };
  };

  return await prisma.tool.create({
    data: {
      ...rest,
      name: `${rest.name} (Copy)`,
      geometry: buildNestedCreate(geometry),
      offsets: buildNestedCreate(offsets),
      assembly: buildNestedCreate(assembly),
      cuttingData: buildNestedCreate(cuttingData),
      compatibility: buildNestedCreate(compatibility)
    }
  });
}
