'use client';

import dynamic from 'next/dynamic';

const HitlWorkspace = dynamic(() => import('@/components/HitlWorkspace'), {
  ssr: false,
});

export default function WorkspacePage() {
  return <HitlWorkspace />;
}
