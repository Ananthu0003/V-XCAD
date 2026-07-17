import { Suspense } from 'react';
import { HolderForm } from '@/components/holders/HolderForm';

export default function NewHolderPage() {
  return (
    <div className="py-6">
      <Suspense fallback={<div>Loading...</div>}>
        <HolderForm />
      </Suspense>
    </div>
  );
}
