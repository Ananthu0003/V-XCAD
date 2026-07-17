import { prisma } from "@/lib/prisma";
import { notFound } from 'next/navigation';
import { HolderForm } from '@/components/holders/HolderForm';
import { Suspense } from 'react';

export default async function EditHolderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const holder = await prisma.holder.findUnique({
    where: { id }
  });

  if (!holder) {
    notFound();
  }

  // Convert to values that the form expects
  const initialData = {
    ...holder,
    type: holder.type as any,
    taperType: holder.taperType as any,
  };
  return (
    <div className="py-6">
      <Suspense fallback={<div>Loading...</div>}>
        <HolderForm initialData={initialData} />
      </Suspense>
    </div>
  );
}
