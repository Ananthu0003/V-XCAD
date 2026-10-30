'use client';

import { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import type { HistoryOperation } from '../HistoryTimelineBar';
import { parseApiError } from '../ui-kit';

export interface UseManualCadSessionOptions {
  sessionId: string;
  initialStlUrl?: string | null;
  initialStepUrl?: string | null;
  onRevisionChange?: () => void;
}

export function useManualCadSession({
  sessionId,
  initialStlUrl,
  initialStepUrl,
  onRevisionChange,
}: UseManualCadSessionOptions) {
  const [activeRevision, setActiveRevision] = useState<string>('rev_000');
  const [stlUrl, setStlUrl] = useState<string | null>(initialStlUrl || null);
  const [topology, setTopology] = useState<any | null>(null);
  const [history, setHistory] = useState<HistoryOperation[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);

  // Reset session state when sessionId or initialStlUrl changes
  useEffect(() => {
    setActiveRevision('rev_000');
    setTopology(null);
    setHistory([]);
    setStlUrl(initialStlUrl || null);
  }, [sessionId, initialStlUrl]);

  const hasValidSession = Boolean(sessionId && sessionId !== 'default_session');
  const hasModel = Boolean(hasValidSession || initialStepUrl || initialStlUrl || stlUrl || topology);

  // 1. Fetch Topology for active revision
  const fetchTopology = useCallback(
    async (revId: string, isPreviewActive = false) => {
      if (!sessionId || (sessionId === 'default_session' && !initialStepUrl && !initialStlUrl)) {
        return;
      }

      try {
        const stepParam = initialStepUrl ? `&source_step=${encodeURIComponent(initialStepUrl)}` : '';
        const res = await fetch(`/api/cad/modify/topology/${sessionId}?revision_id=${revId}${stepParam}`);

        if (res.status === 404) {
          setTopology(null);
          return;
        }

        if (!res.ok) {
          setTopology(null);
          return;
        }

        const data = await res.json();
        if (data && (!data.session_id || data.session_id === sessionId)) {
          setTopology(data);
        } else {
          setTopology(null);
        }

        if (!isPreviewActive) {
          if (revId !== 'rev_000' || !initialStlUrl) {
            setStlUrl(`/api/cad/modify/file/${sessionId}/revisions/${revId}.stl`);
          } else if (initialStlUrl) {
            setStlUrl(initialStlUrl);
          }
        }
      } catch (err: any) {
        console.warn('Topology not available for session:', err?.message || err);
      }
    },
    [sessionId, initialStepUrl, initialStlUrl]
  );

  // 2. Fetch History
  const fetchHistory = useCallback(async () => {
    if (!sessionId || sessionId === 'default_session') return;

    try {
      const res = await fetch(`/api/cad/modify/history/${sessionId}`);

      if (res.status === 404) {
        setHistory([]);
        return;
      }

      if (res.ok) {
        const data = await res.json();
        setHistory(data);
        if (Array.isArray(data) && data.length > 0) {
          const latestOp = data[data.length - 1];
          if (latestOp?.output_revision) {
            setActiveRevision((curr) => {
              if (curr === 'rev_000') {
                return latestOp.output_revision;
              }
              return curr;
            });
          }
        }
      }
    } catch (err: any) {
      console.warn('History not available for session:', err?.message || err);
    }
  }, [sessionId]);

  // Initial load
  useEffect(() => {
    if (sessionId && (sessionId !== 'default_session' || initialStepUrl || initialStlUrl)) {
      fetchTopology(activeRevision);
      fetchHistory();
    }
  }, [sessionId, activeRevision, fetchTopology, fetchHistory, initialStepUrl, initialStlUrl]);

  // Rollback to specific revision
  const handleRollback = useCallback(
    async (targetRev: string) => {
      setIsLoading(true);
      try {
        const res = await fetch('/api/cad/modify/rollback', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            session_id: sessionId,
            target_revision: targetRev,
          }),
        });

        const data = await res.json().catch(() => null);
        if (res.ok && data?.success) {
          setActiveRevision(data.active_revision);
          setStlUrl(data.stl_url);
          toast.success(`Switched to ${data.active_revision}`);
          onRevisionChange?.();
          return true;
        } else {
          toast.error(parseApiError(res, data).message);
          return false;
        }
      } catch (err: any) {
        toast.error(err.message || 'Rollback failed');
        return false;
      } finally {
        setIsLoading(false);
      }
    },
    [sessionId, onRevisionChange]
  );

  const activeIdx = history.findIndex((h) => h.output_revision === activeRevision);
  const canUndo = activeIdx > 0;
  const canRedo = activeIdx >= 0 && activeIdx < history.length - 1;

  const handleUndo = useCallback(async () => {
    if (canUndo) {
      const prevRev = history[activeIdx - 1].output_revision || 'rev_000';
      return await handleRollback(prevRev);
    }
    return false;
  }, [canUndo, history, activeIdx, handleRollback]);

  const handleRedo = useCallback(async () => {
    if (canRedo) {
      const nextRev = history[activeIdx + 1].output_revision;
      if (nextRev) return await handleRollback(nextRev);
    }
    return false;
  }, [canRedo, history, activeIdx, handleRollback]);

  return {
    activeRevision,
    setActiveRevision,
    stlUrl,
    setStlUrl,
    topology,
    setTopology,
    history,
    setHistory,
    isLoading,
    setIsLoading,
    hasModel,
    fetchTopology,
    fetchHistory,
    handleRollback,
    handleUndo,
    handleRedo,
    canUndo,
    canRedo,
    activeIdx,
  };
}

