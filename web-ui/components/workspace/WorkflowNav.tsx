'use client';

import { useState, useEffect } from 'react';
import { Cuboid, Layers, Circle, CheckCircle2, Wrench, Package, LogIn, LogOut, UserPlus, User } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Logo } from '@/components/shared/Logo';
import { cn } from '@/lib/utils';

type WorkflowStage = 'blueprint' | 'extraction' | 'cad' | 'cam' | 'gcode';

interface WorkflowNavProps {
  workflowStage: WorkflowStage;
  setWorkflowStage: (stage: WorkflowStage) => void;
}

const STAGES = [
  { id: 'blueprint', label: 'BLUEPRINT ANALYSIS' },
  { id: 'cad', label: '3D CAD GENERATION' },
  { id: 'cam', label: 'CAM TOOLPATHS' },
  { id: 'gcode', label: 'G-CODE OUTPUT' },
];

export function WorkflowNav({ workflowStage, setWorkflowStage }: WorkflowNavProps) {
  const router = useRouter();
  const [user, setUser] = useState<{ id: string; name?: string; email?: string; role?: string } | null>(null);
  const [loadingUser, setLoadingUser] = useState(true);

  useEffect(() => {
    let isMounted = true;
    fetch('/api/auth/me')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (isMounted) {
          if (data?.user) {
            setUser(data.user);
          } else {
            setUser(null);
          }
          setLoadingUser(false);
        }
      })
      .catch(() => {
        if (isMounted) {
          setUser(null);
          setLoadingUser(false);
        }
      });
    return () => {
      isMounted = false;
    };
  }, []);

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
      setUser(null);
      router.push('/login');
      router.refresh();
    } catch (e) {
      console.error('Logout error:', e);
    }
  };

  // Map internal stages to display stages
  const getActiveDisplayStage = () => {
    if (workflowStage === 'extraction') return 'blueprint';
    return workflowStage;
  };

  const activeDisplayStage = getActiveDisplayStage();
  const activeIndex = STAGES.findIndex(s => s.id === activeDisplayStage);

  return (
    <div className="flex h-full w-full flex-col bg-transparent font-sans text-sm relative">
      {/* Header / Logo */}
      <div className="flex h-[72px] shrink-0 items-center px-6 border-b border-slate-200 dark:border-white/5">
        <Link href="/" className="flex items-center gap-3 group hover:opacity-80 transition-opacity">
          <Logo size={36} showGlow />
          <div className="flex items-baseline gap-2">
            <span className="text-xl font-bold tracking-[0.2em] text-slate-900 dark:text-white uppercase font-sans">
              VΞXCAD
            </span>
            <span className="text-[10px] font-mono text-slate-400 dark:text-muted-foreground/50">v0.1.0</span>
          </div>
        </Link>
      </div>

      {/* Project Workflow Header */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-slate-200 dark:border-white/5">
        <Layers className="size-4 text-blue-600 dark:text-blue-400" />
        <h4 className="text-[11px] font-bold uppercase tracking-[0.15em] text-blue-600 dark:text-blue-400">
          PROJECT WORKFLOW
        </h4>
      </div>

      {/* Project Workflow Navigation */}
      <div className="flex-1 py-4 overflow-y-auto">
        <div className="space-y-0 relative">
          {/* Vertical connecting line background */}
          <div className="absolute left-[35px] top-[30px] bottom-[30px] w-[2px] bg-slate-200 dark:bg-[#1e293b] z-0" />
          
          {/* Vertical connecting line active fill */}
          <div 
            className="absolute left-[35px] top-[30px] w-[2px] bg-blue-600 dark:bg-gradient-primary shadow-sm dark:shadow-[0_0_15px_rgba(59,130,246,0.6)] z-0 transition-all duration-700 ease-in-out" 
            style={{ 
              height: `${(Math.max(0, activeIndex) / (STAGES.length - 1)) * 100}%` 
            }}
          />

          {STAGES.map((stage, idx) => {
            const isActive = activeDisplayStage === stage.id;
            const isPast = idx < activeIndex;
            
            return (
              <button
                key={stage.id}
                onClick={() => setWorkflowStage(stage.id as WorkflowStage)}
                className={cn(
                  "relative flex w-full items-center gap-5 px-6 py-4 transition-all text-left group z-10 cursor-pointer",
                  isActive ? "bg-blue-500/10 dark:bg-blue-500/5 backdrop-blur-sm" : "hover:bg-slate-100 dark:hover:bg-white/5 bg-transparent"
                )}
              >
                {/* Active Indicator Line on the left */}
                {isActive && (
                  <div className="absolute left-0 top-0 bottom-0 w-[3px] bg-blue-600 dark:bg-gradient-primary shadow-sm dark:shadow-[0_0_15px_rgba(59,130,246,0.6)]" />
                )}

                {/* Icon */}
                <div className="relative flex size-6 shrink-0 items-center justify-center z-10 bg-slate-100 dark:bg-[#121c2e] rounded-full">
                  {isPast ? (
                    <CheckCircle2 className="size-5 text-blue-600 dark:text-blue-500 bg-transparent rounded-full shadow-xs" />
                  ) : isActive ? (
                    <div className="relative flex items-center justify-center size-5">
                      <div className="absolute inset-0 rounded-full border-[2px] border-blue-500/30" />
                      <div className="absolute inset-0 rounded-full border-[2px] border-blue-600 dark:border-blue-500 border-t-transparent animate-spin" />
                      <div className="size-1.5 rounded-full bg-blue-600 dark:bg-blue-500" />
                    </div>
                  ) : (
                    <div className="size-5 rounded-full border-[2px] border-slate-300 dark:border-white/10 group-hover:border-slate-400 dark:group-hover:border-white/20 transition-colors bg-slate-100 dark:bg-[#121c2e]" />
                  )}
                </div>

                {/* Label */}
                <span className={cn(
                  "text-[11px] font-bold uppercase tracking-widest transition-colors",
                  isActive ? "text-blue-600 dark:text-white" : isPast ? "text-slate-700 dark:text-blue-100/70" : "text-slate-500 group-hover:text-slate-900 dark:text-[#64748b] dark:group-hover:text-white/80"
                )}>
                  {stage.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* User / Auth Section */}
      <div className="shrink-0 p-4 border-t border-slate-200 dark:border-white/5">
        {loadingUser ? (
          <div className="h-10 animate-pulse rounded-xl bg-slate-200/50 dark:bg-white/5" />
        ) : user ? (
          <div className="flex items-center justify-between gap-3 p-2 rounded-xl bg-slate-100/80 dark:bg-[#111a2e] border border-slate-200/60 dark:border-white/5">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="size-8 rounded-lg bg-blue-600/10 dark:bg-blue-500/20 border border-blue-500/30 flex items-center justify-center shrink-0 text-blue-600 dark:text-blue-400 font-bold text-xs">
                {(user.name || user.email || 'U')[0].toUpperCase()}
              </div>
              <div className="min-w-0">
                <p className="text-xs font-semibold text-slate-800 dark:text-slate-200 truncate">
                  {user.name || user.email?.split('@')[0]}
                </p>
                <p className="text-[10px] text-slate-500 dark:text-muted-foreground truncate">
                  {user.email || user.role || 'Member'}
                </p>
              </div>
            </div>
            <button
              onClick={handleLogout}
              title="Sign Out"
              className="p-1.5 text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-500/10 rounded-lg transition-colors cursor-pointer"
            >
              <LogOut className="size-4" />
            </button>
          </div>
        ) : (
          <div className="space-y-1.5">
            <Link
              href="/login"
              className="flex items-center justify-center gap-2 w-full py-2 px-3 text-xs font-bold uppercase tracking-wider text-white bg-blue-600 hover:bg-blue-500 rounded-xl transition-all shadow-xs"
            >
              <LogIn className="size-3.5" />
              Sign In
            </Link>
            <Link
              href="/register"
              className="flex items-center justify-center gap-2 w-full py-1.5 px-3 text-xs font-semibold text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/5 rounded-xl transition-all"
            >
              <UserPlus className="size-3.5" />
              Create Account
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
