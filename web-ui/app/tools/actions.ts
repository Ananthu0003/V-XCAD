'use server';

import { prisma } from "@/lib/prisma";
import { revalidatePath } from 'next/cache';

export async function toggleToolStatus(id: string, currentStatus: boolean) {
  await prisma.tool.update({
    where: { id },
    data: { isActive: !currentStatus }
  });
  
  revalidatePath(`/tools/${id}`);
  revalidatePath(`/tools`);
}

export async function deleteTool(id: string) {
  try {
    await prisma.tool.delete({
      where: { id }
    });
    revalidatePath('/tools');
    return { success: true };
  } catch (error: any) {
    console.error("Failed to delete tool:", error);
    return { success: false, error: "Cannot delete this tool. It might be used in an active assembly." };
  }
}
