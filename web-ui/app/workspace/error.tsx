'use client';

import { useEffect } from 'react';

export default function WorkspaceError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('CRITICAL: Workspace caught runtime error:', error);
  }, [error]);

  return (
    <div className="flex h-screen w-screen flex-col items-center justify-center bg-[#090d16] p-6 text-white font-mono">
      <div className="max-w-2xl w-full rounded-2xl border border-red-500/40 bg-red-950/20 p-6 shadow-2xl backdrop-blur-md">
        <div className="flex items-center gap-3 mb-4">
          <div className="size-3 rounded-full bg-red-500 animate-ping" />
          <h2 className="text-base font-bold text-red-400 uppercase tracking-wider">
            Workspace Client Exception
          </h2>
        </div>
        <p className="text-sm text-red-200 bg-red-900/30 p-3 rounded-lg border border-red-500/20 mb-4 break-words font-semibold">
          {error.message || String(error)}
        </p>
        {error.stack && (
          <pre className="max-h-80 overflow-auto rounded-lg bg-black/60 p-3 text-[11px] text-zinc-300 whitespace-pre-wrap border border-white/5">
            {error.stack}
          </pre>
        )}
        <div className="mt-6 flex gap-3">
          <button
            onClick={() => reset()}
            className="rounded-xl bg-red-600 px-4 py-2 text-xs font-bold text-white hover:bg-red-500 transition-colors"
          >
            Retry Workspace
          </button>
          <button
            onClick={() => (window.location.href = '/workspace')}
            className="rounded-xl border border-white/10 px-4 py-2 text-xs font-medium text-zinc-300 hover:bg-white/10 transition-colors"
          >
            Reset URL
          </button>
        </div>
      </div>
    </div>
  );
}
