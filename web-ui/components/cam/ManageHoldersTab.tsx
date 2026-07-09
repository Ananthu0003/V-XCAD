
'use client';

import { useEffect, useState } from 'react';
import { HolderTable } from '@/components/holders/HolderTable';

export function ManageHoldersTab() {
  const [holders, setHolders] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchHolders = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/cam/holders');
      const data = await res.json();
      setHolders(data.holders || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHolders();
  }, []);

  if (loading) {
    return <div className="p-10 text-center text-muted-foreground animate-pulse">Loading holders...</div>;
  }

  return (
    <div className="p-4">
      <div className="mb-4">
        <h3 className="text-sm font-bold tracking-widest uppercase text-foreground mb-1">Global Holder Management</h3>
        <p className="text-xs text-muted-foreground">Manage your entire CNC holder library.</p>
      </div>
      <HolderTable initialHolders={holders} onDeleted={fetchHolders} />
    </div>
  );
}

