
'use client';

import { useEffect, useState } from 'react';
import { ToolTable } from '@/components/tools/ToolTable';

export function ManageToolsTab() {
  const [tools, setTools] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchTools = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/cam/tools');
      const data = await res.json();
      setTools(data.tools || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTools();
  }, []);

  if (loading) {
    return <div className="p-10 text-center text-muted-foreground animate-pulse">Loading tools...</div>;
  }

  return (
    <div className="p-4">
      <div className="mb-4">
        <h3 className="text-sm font-bold tracking-widest uppercase text-foreground mb-1">Global Tool Management</h3>
        <p className="text-xs text-muted-foreground">Manage your entire CNC tool library.</p>
      </div>
      <ToolTable initialTools={tools} onDeleted={fetchTools} />
    </div>
  );
}

