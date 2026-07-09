'use server';

import { prisma } from "@/lib/prisma";
import { revalidatePath } from 'next/cache';
import { Prisma } from '@prisma/client';

export async function toggleHolderStatus(id: string, currentStatus: boolean) {
  await prisma.holder.update({
    where: { id },
    data: { isActive: !currentStatus }
  });
  
  revalidatePath('/holders');
  revalidatePath(`/holders/${id}`);
}

export async function createHolder(data: any) {
  try {
    const holder = await prisma.holder.create({
      data
    });
    
    revalidatePath('/holders');
    return { success: true, id: holder.id };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return { success: false, error: 'A holder with this name already exists' };
    }
    console.error("Failed to create holder:", error);
    return { success: false, error: 'Failed to create holder' };
  }
}

export async function updateHolder(id: string, data: any) {
  try {
    await prisma.holder.update({
      where: { id },
      data
    });
    
    revalidatePath('/holders');
    revalidatePath(`/holders/${id}`);
    return { success: true };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return { success: false, error: 'A holder with this name already exists' };
    }
    console.error("Failed to update holder:", error);
    return { success: false, error: 'Failed to update holder' };
  }
}

export async function deleteHolder(id: string) {
  try {
    await prisma.holder.delete({
      where: { id }
    });
    revalidatePath('/holders');
    return { success: true };
  } catch (error: any) {
    console.error("Failed to delete holder:", error);
    return { success: false, error: "Cannot delete this holder. It might be used in an active assembly." };
  }
}
