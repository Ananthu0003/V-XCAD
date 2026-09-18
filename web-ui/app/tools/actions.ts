'use server';

import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";
import { revalidatePath } from 'next/cache';

export async function toggleToolStatus(id: string, currentStatus: boolean) {
  const admin = await requireAdmin();
  if (!admin) {
    throw new Error("Unauthorized: Admin privileges required");
  }

  await prisma.tool.update({
    where: { id },
    data: { isActive: !currentStatus }
  });
  
  revalidatePath(`/tools/${id}`);
  revalidatePath(`/tools`);
}

export async function deleteTool(id: string) {
  const admin = await requireAdmin();
  if (!admin) {
    return { success: false, error: "Unauthorized: Admin privileges required" };
  }

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

