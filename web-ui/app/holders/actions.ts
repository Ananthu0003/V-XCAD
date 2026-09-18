'use server';

import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";
import { revalidatePath } from 'next/cache';
import { Prisma } from '@prisma/client';
import { holderSchema } from '@/lib/validation/holderSchema';

export async function toggleHolderStatus(id: string, currentStatus: boolean) {
  const admin = await requireAdmin();
  if (!admin) {
    throw new Error("Unauthorized: Admin privileges required");
  }

  await prisma.holder.update({
    where: { id },
    data: { isActive: !currentStatus }
  });
  
  revalidatePath('/holders');
  revalidatePath(`/holders/${id}`);
}

export async function createHolder(data: unknown) {
  const admin = await requireAdmin();
  if (!admin) {
    return { success: false, error: "Unauthorized: Admin privileges required" };
  }

  const parsed = holderSchema.safeParse(data);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message || 'Invalid holder data' };
  }

  try {
    const holder = await prisma.holder.create({
      data: {
        name: parsed.data.name,
        type: parsed.data.type,
        gaugeLength: parsed.data.gaugeLength,
        diameter: parsed.data.diameter,
        shankSize: parsed.data.shankSize ?? null,
        taperType: parsed.data.taperType ?? null,
        manufacturer: parsed.data.manufacturer ?? null,
        description: parsed.data.description ?? null,
        isActive: parsed.data.isActive,
      }
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

export async function updateHolder(id: string, data: unknown) {
  const admin = await requireAdmin();
  if (!admin) {
    return { success: false, error: "Unauthorized: Admin privileges required" };
  }

  const parsed = holderSchema.partial().safeParse(data);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message || 'Invalid holder data' };
  }

  try {
    await prisma.holder.update({
      where: { id },
      data: {
        ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
        ...(parsed.data.type !== undefined ? { type: parsed.data.type } : {}),
        ...(parsed.data.gaugeLength !== undefined ? { gaugeLength: parsed.data.gaugeLength } : {}),
        ...(parsed.data.diameter !== undefined ? { diameter: parsed.data.diameter } : {}),
        ...(parsed.data.shankSize !== undefined ? { shankSize: parsed.data.shankSize } : {}),
        ...(parsed.data.taperType !== undefined ? { taperType: parsed.data.taperType } : {}),
        ...(parsed.data.manufacturer !== undefined ? { manufacturer: parsed.data.manufacturer } : {}),
        ...(parsed.data.description !== undefined ? { description: parsed.data.description } : {}),
        ...(parsed.data.isActive !== undefined ? { isActive: parsed.data.isActive } : {}),
      }
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
  const admin = await requireAdmin();
  if (!admin) {
    return { success: false, error: "Unauthorized: Admin privileges required" };
  }

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

