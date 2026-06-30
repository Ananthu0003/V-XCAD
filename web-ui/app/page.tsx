import Link from 'next/link';
import {
  ArrowRight, Cuboid, Upload, Cpu, Sliders, Download,
  Code2, Box, History, Zap, FileImage, ChevronRight,
} from 'lucide-react';
import { getSession } from '@/lib/auth';
import { Hero3D } from '@/components/landing/Hero3D';
import { AnimatedSection } from '@/components/landing/AnimatedSection';
import { AnimatedCode } from '@/components/landing/AnimatedCode';
import { WorkflowStep } from '@/components/workspace/WorkflowStep';
import { LandingClient } from '@/components/landing/LandingClient';
import { BackToTop } from '@/components/landing/BackToTop';

export default async function LandingPage() {
  const session = await getSession();
  const isLoggedIn = Boolean(session);

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-[#080c10] text-zinc-900 dark:text-white selection:bg-blue-500/30 overflow-hidden relative font-sans">

      {/* ── Ambient background glows ── */}
      <div className="absolute inset-0 z-0 pointer-events-none overflow-hidden">
        {/* Ambient background glows removed for a cleaner CAD look */}
        {/* Grid overlay */}
        <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:48px_48px]" />
      </div>

      {/* ── Navigation ── */}
      <nav className="fixed top-0 left-0 right-0 z-50 border-b border-black/10 dark:border-white/5">
        <div className="flex items-center justify-between px-6 py-5 max-w-7xl mx-auto w-full">
          
          {/* Targets #home at the top of your page content wrapper */}
          <Link href="/" className="flex items-center gap-2 group">
            <div className="relative w-12 h-12 flex items-center justify-center">
              <div className="absolute inset-0 bg-blue-500 rounded-xl transform rotate-45 opacity-20 group-hover:opacity-30 transition-opacity"></div>
              <Cuboid className="w-7 h-7 text-blue-400 relative z-10" />
            </div>
            <span className="text-3xl font-bold tracking-widest bg-clip-text text-transparent bg-gradient-to-r from-gray-900 to-gray-500 dark:from-gray-100 dark:to-gray-500">
              VΞXCAD
            </span>
          </Link>

          <div className="hidden md:flex items-center text-zinc-900 dark:text-white gap-8">
            <a href="#how-it-works" className="text-sm text-zinc-600 dark:text-gray-400 hover:text-zinc-900 dark:text-white scroll-smooth transition-colors">How it Works</a>
            <a href="#features" className="text-sm text-zinc-600 dark:text-gray-400 hover:text-zinc-900 dark:text-white scroll-smooth transition-colors">Features</a>
          </div>

          <div className="flex items-center gap-4">
            {isLoggedIn ? (
              <Link href="/workspace" className="group inline-flex items-center gap-2 px-5 py-2 text-sm font-semibold text-white bg-zinc-900 dark:bg-blue-600 hover:bg-zinc-800 dark:hover:bg-blue-500 rounded-xl transition-all duration-200 shadow-[0_0_20px_rgba(37,99,235,0.4)]">
                Open Workspace
                <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
              </Link>
            ) : (
              <>
                <Link href="/login" className="text-sm text-zinc-600 dark:text-gray-400 hover:text-zinc-900 dark:text-white transition-colors font-medium">Sign in</Link>
                <Link href="/register" className="group inline-flex items-center gap-2 px-5 py-2 text-sm font-semibold text-white bg-zinc-900 dark:bg-blue-600 hover:bg-zinc-800 dark:hover:bg-blue-500 rounded-xl transition-all duration-200 shadow-[0_0_20px_rgba(37,99,235,0.35)]">
                  Get Started
                  <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                </Link>
              </>
            )}
          </div>

        </div>
      </nav>

      {/* ── Hero ── */}
      <main className="relative z-10 px-6 pt-24 pb-12 max-w-5xl mx-auto text-center">
        <AnimatedSection delay={0} direction="down" duration={0.6}>
          <div className="inline-flex items-center gap-2.5 px-4 py-2 rounded-full bg-blue-500/10 border border-blue-500/25 text-blue-400 text-xs font-semibold tracking-widest mb-8 uppercase">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500" />
            </span>
            AI-Powered CAD Copilot
          </div>
        </AnimatedSection>

        <AnimatedSection delay={0.1} direction="up" duration={0.9}>
          <h1 className="text-5xl md:text-7xl font-extrabold tracking-tight leading-[1.05] mb-6">
            <span className="block text-zinc-900 dark:text-white mb-1">Describe It.</span>
            <span className="block text-primary">Generate It.</span>
            <span className="block text-zinc-900 dark:text-white mt-1">Perfect It.</span>
          </h1>
        </AnimatedSection>

        <AnimatedSection delay={0.22} direction="up" duration={0.8}>
          <p className="text-lg md:text-xl text-zinc-600 dark:text-gray-400 max-w-2xl mx-auto leading-relaxed mt-4">
            Upload a 2D sketch or PDF, describe your part in plain English — and VΞXCAD streams a fully
            parametric <span className="text-blue-400 font-medium">build123d Python script</span>, renders it to
            a 3D model, and generates production-ready <span className="text-emerald-400 font-medium">CNC G-code</span> in real time.
          </p>
        </AnimatedSection>

        <AnimatedSection delay={0.35} direction="up" duration={0.8}>
          <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link
              href={isLoggedIn ? '/workspace' : '/register'}
              className="group relative inline-flex items-center gap-2 px-8 py-4 text-base font-bold text-white bg-gradient-to-b from-zinc-800 to-zinc-950 dark:from-blue-500 dark:to-blue-700 border border-blue-400/20 rounded-2xl hover:from-zinc-700 dark:hover:from-blue-400 hover:to-zinc-900 dark:hover:to-blue-600 shadow-[0_0_50px_rgba(37,99,235,0.45)] transition-all duration-200 overflow-hidden"
            >
              <div className="absolute inset-0 -ml-16 bg-gradient-to-r from-transparent via-white/15 to-transparent skew-x-[20deg] group-hover:translate-x-[300%] transition-transform duration-700 ease-in-out" />
              {isLoggedIn ? 'Open Workspace' : 'Start Designing for Free'}
              <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
            </Link>
            <a
              href="#how-it-works"
              className="inline-flex items-center gap-2 px-8 py-4 text-base font-medium text-zinc-700 dark:text-gray-300 bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-2xl hover:bg-black/10 dark:bg-white/8 hover:text-zinc-900 dark:text-white hover:border-white/20 transition-all duration-200 backdrop-blur-sm"
            >
              See how it works
              <ChevronRight className="w-4 h-4" />
            </a>
          </div>
        </AnimatedSection>
      </main>

      {/* ── App Mockup ── */}
      <AnimatedSection delay={0.5} direction="up" duration={1.0} amount={0.05} className="relative z-10 w-full px-4 pb-24">
        <div className="relative w-full max-w-5xl mx-auto" style={{ perspective: '2000px' }}>
          {/* Bottom fade */}
          <div className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-zinc-50 dark:from-[#080c10] to-transparent z-20 pointer-events-none rounded-b-3xl" />
          {/* Glow */}
          <div className="absolute -inset-px rounded-3xl bg-gradient-to-b from-blue-500/20 to-transparent pointer-events-none z-20" />

          <div className="relative w-full rounded-2xl border border-black/10 dark:border-white/8 bg-white dark:bg-[#0d1117]/90 backdrop-blur-xl overflow-hidden shadow-[0_40px_120px_rgba(0,0,0,0.8),0_0_60px_rgba(37,99,235,0.12)]">
            {/* Window chrome */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-black/5 dark:border-white/6 bg-black/5 dark:bg-white/3">
              <div className="flex gap-2">
                <div className="w-3 h-3 rounded-full bg-red-500/70" />
                <div className="w-3 h-3 rounded-full bg-yellow-500/70" />
                <div className="w-3 h-3 rounded-full bg-green-500/70" />
              </div>
              <div className="flex items-center gap-2 px-3 py-1 rounded-md bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/8">
                <div className="w-3 h-3 rounded-sm bg-blue-500/40 flex items-center justify-center">
                  <div className="w-1.5 h-1.5 rounded-sm bg-blue-400" />
                </div>
                <span className="text-[10px] text-zinc-600 dark:text-gray-400 font-mono">cadvex.app/workspace</span>
              </div>
              <div className="w-16" />
            </div>

            {/* App layout */}
            <div className="flex h-[520px]">
              {/* Left: Chat panel skeleton */}
              <div className="w-72 border-r border-black/10 dark:border-white/5 bg-zinc-100 dark:bg-[#0a0f14] flex flex-col">
                {/* Upload area */}
                <div className="p-4 border-b border-black/10 dark:border-white/5">
                  <div className="rounded-xl border border-dashed border-blue-500/30 bg-blue-500/5 p-3 flex flex-col items-center gap-2">
                    <div className="w-7 h-7 rounded-lg bg-blue-500/15 flex items-center justify-center">
                      <Upload className="w-3.5 h-3.5 text-blue-400" />
                    </div>
                    <div className="h-1.5 w-20 bg-blue-500/30 rounded-full" />
                    <div className="h-1 w-14 bg-black/10 dark:bg-white/10 rounded-full" />
                  </div>
                </div>

                {/* Chat messages */}
                <div className="flex-1 p-4 space-y-3 overflow-hidden">
                  {/* User message */}
                  <div className="flex justify-end">
                    <div className="bg-blue-600/25 border border-blue-500/20 rounded-2xl rounded-tr-sm px-3 py-2 max-w-[80%] space-y-1">
                      <div className="h-1.5 w-24 bg-blue-300/40 rounded-full" />
                      <div className="h-1.5 w-16 bg-blue-300/30 rounded-full" />
                    </div>
                  </div>
                  {/* AI typing */}
                  <div className="flex gap-2 items-start">
                    <div className="w-6 h-6 rounded-full bg-gradient-to-br from-blue-500 to-cyan-500 flex-shrink-0 flex items-center justify-center">
                      <Cpu className="w-3 h-3 text-zinc-900 dark:text-white" />
                    </div>
                    <div className="bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/8 rounded-2xl rounded-tl-sm px-3 py-2 max-w-[80%] space-y-1.5">
                      <div className="h-1.5 w-28 bg-gray-600 rounded-full" />
                      <div className="h-1.5 w-20 bg-gray-700 rounded-full" />
                      <div className="h-1.5 w-24 bg-gray-700 rounded-full" />
                    </div>
                  </div>
                  {/* SSE streaming indicator */}
                  <div className="flex gap-2 items-start">
                    <div className="w-6 h-6 rounded-full bg-gradient-to-br from-blue-500 to-cyan-500 flex-shrink-0 flex items-center justify-center">
                      <Cpu className="w-3 h-3 text-zinc-900 dark:text-white" />
                    </div>
                    <div className="bg-black/5 dark:bg-white/5 border border-blue-500/20 rounded-2xl rounded-tl-sm px-3 py-2">
                      <div className="flex items-center gap-1.5">
                        <span className="relative flex h-1.5 w-1.5">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
                          <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-blue-500" />
                        </span>
                        <span className="text-[9px] text-blue-400 font-mono">Generating script…</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Input bar */}
                <div className="p-3 border-t border-black/10 dark:border-white/5">
                  <div className="flex items-center gap-2 rounded-xl bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/8 px-3 py-2">
                    <div className="flex-1 h-1.5 bg-black/10 dark:bg-white/10 rounded-full" />
                    <div className="w-6 h-6 rounded-lg bg-blue-600/40 flex items-center justify-center">
                      <ArrowRight className="w-3 h-3 text-blue-300" />
                    </div>
                  </div>
                </div>
              </div>

              {/* Center: 3D Viewport */}
              <div className="flex-1 relative flex flex-col">
                {/* Toolbar */}
                <div className="flex items-center justify-between px-4 py-2.5 border-b border-black/10 dark:border-white/5 bg-white/2">
                  <div className="flex items-center gap-1.5">
                    {['Viewport', 'Parameters', 'Code Engine'].map((t, i) => (
                      <div key={t} className={`px-3 py-1 rounded-md text-[10px] font-medium ${i === 0 ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30' : 'text-gray-500'}`}>{t}</div>
                    ))}
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="px-2.5 py-1 rounded-md bg-emerald-500/15 border border-emerald-500/25 text-[9px] font-mono text-emerald-400 flex items-center gap-1.5">
                      <span className="relative flex h-1.5 w-1.5">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                        <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
                      </span>
                      Sync to Engine
                    </div>
                    <div className="px-2.5 py-1 rounded-md bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/8 text-[9px] text-zinc-600 dark:text-gray-400 flex items-center gap-1">
                      <Download className="w-2.5 h-2.5" /> STL
                    </div>
                    <div className="px-2.5 py-1 rounded-md bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/8 text-[9px] text-zinc-600 dark:text-gray-400 flex items-center gap-1">
                      <Download className="w-2.5 h-2.5" /> G-Code
                    </div>
                  </div>
                </div>
                {/* 3D canvas area */}
                <div className="flex-1 relative overflow-hidden">
                  <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.015)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.015)_1px,transparent_1px)] bg-[size:24px_24px]" />
                  <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_50%,rgba(59,130,246,0.12)_0%,transparent_60%)]" />
                  <div className="w-full h-full">
                    <Hero3D />
                  </div>
                </div>
              </div>

              {/* Right: Code editor panel */}
              <div className="hidden lg:flex flex-col w-52 border-l border-black/10 dark:border-white/5 bg-white dark:bg-[#0d1117]">
                <div className="flex items-center gap-1.5 px-3 py-2.5 border-b border-black/10 dark:border-white/5">
                  <div className="px-2 py-0.5 rounded bg-blue-500/15 border border-blue-500/25 text-[9px] text-blue-400 font-mono font-semibold">model.py</div>
                  <div className="px-2 py-0.5 rounded text-[9px] text-zinc-500 dark:text-gray-600 font-mono">params.json</div>
                </div>
                <div className="flex-1 overflow-hidden p-3">
                  <AnimatedCode />
                </div>
                <div className="px-3 py-2 border-t border-black/10 dark:border-white/5 flex items-center gap-2">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
                  </span>
                  <span className="text-[9px] font-mono text-green-400">Generating…</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </AnimatedSection>

      {/* ── How It Works ── */}
      <section id="how-it-works" className="relative z-10 py-28">
        <div className="max-w-6xl mx-auto px-6">
          <AnimatedSection direction="up" duration={0.7}>
            <div className="text-center mb-16">
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 text-xs font-semibold tracking-widest mb-5 uppercase">
                The Workflow
              </div>
              <h2 className="text-3xl md:text-5xl font-bold text-zinc-900 dark:text-white mb-4 tracking-tight">
                From Sketch to CNC Ready<br />
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-blue-500">in Four Steps</span>
              </h2>
              <p className="text-zinc-600 dark:text-gray-400 max-w-xl mx-auto text-lg">
                No complex CAD/CAM software. No manual modeling. Just describe what you need.
              </p>
            </div>
          </AnimatedSection>

          {/* Steps grid */}
          <div className="grid md:grid-cols-4 gap-6 relative mt-12">

            {/* Step 1 */}
            <AnimatedSection delay={0} direction="up" duration={0.7}>
              <div className="relative p-6 rounded-3xl bg-black/5 dark:bg-white/[0.02] border border-black/10 dark:border-white/5 hover:bg-black/10 dark:hover:bg-white/[0.04] hover:border-blue-500/30 transition-all duration-300 group flex flex-col items-center text-center h-full">
                <div className="absolute inset-0 bg-gradient-to-b from-blue-500/5 to-transparent rounded-3xl opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />
                <div className="relative w-14 h-14 mb-6 mt-2">
                  <div className="absolute inset-0 bg-blue-500/10 rounded-2xl border border-blue-500/20 group-hover:bg-zinc-800 dark:hover:bg-blue-500/20 group-hover:border-blue-500/40 group-hover:scale-110 transition-all duration-500" />
                  <div className="absolute -top-3 -right-3 w-7 h-7 rounded-full bg-zinc-50 dark:bg-[#080c10] border-2 border-blue-500/40 flex items-center justify-center text-[11px] font-black font-mono text-blue-400 shadow-[0_0_15px_rgba(59,130,246,0.3)] z-10">1</div>
                  <div className="w-full h-full flex items-center justify-center relative z-0">
                    <FileImage className="w-6 h-6 text-blue-400" />
                  </div>
                </div>
                <h3 className="text-zinc-900 dark:text-white font-bold text-lg mb-3">Upload & Describe</h3>
                <p className="text-zinc-600 dark:text-gray-400 text-sm leading-relaxed">
                  Drop a 2D sketch, engineering drawing, or PDF. Add a natural-language prompt describing your part.
                </p>
              </div>
            </AnimatedSection>

            {/* Step 2 */}
            <AnimatedSection delay={0.12} direction="up" duration={0.7}>
              <div className="relative p-6 rounded-3xl bg-black/5 dark:bg-white/[0.02] border border-black/10 dark:border-white/5 hover:bg-black/10 dark:hover:bg-white/[0.04] hover:border-cyan-500/30 transition-all duration-300 group flex flex-col items-center text-center h-full">
                <div className="absolute inset-0 bg-gradient-to-b from-cyan-500/5 to-transparent rounded-3xl opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />
                <div className="relative w-14 h-14 mb-6 mt-2">
                  <div className="absolute inset-0 bg-cyan-500/10 rounded-2xl border border-cyan-500/20 group-hover:bg-cyan-500/20 group-hover:border-cyan-500/40 group-hover:scale-110 transition-all duration-500" />
                  <div className="absolute -top-3 -right-3 w-7 h-7 rounded-full bg-zinc-50 dark:bg-[#080c10] border-2 border-cyan-500/40 flex items-center justify-center text-[11px] font-black font-mono text-cyan-400 shadow-[0_0_15px_rgba(6,182,212,0.3)] z-10">2</div>
                  <div className="w-full h-full flex items-center justify-center relative z-0">
                    <Cpu className="w-6 h-6 text-cyan-400" />
                  </div>
                </div>
                <h3 className="text-zinc-900 dark:text-white font-bold text-lg mb-3">AI Script Generation</h3>
                <p className="text-zinc-600 dark:text-gray-400 text-sm leading-relaxed">
                  Gemini AI streams a fully parametric <code className="text-cyan-400 text-xs bg-cyan-500/10 px-1.5 py-0.5 rounded-md border border-cyan-500/20">build123d</code> Python script live.
                </p>
              </div>
            </AnimatedSection>

            {/* Step 3 */}
            <AnimatedSection delay={0.24} direction="up" duration={0.7}>
              <div className="relative p-6 rounded-3xl bg-black/5 dark:bg-white/[0.02] border border-black/10 dark:border-white/5 hover:bg-black/10 dark:hover:bg-white/[0.04] hover:border-violet-500/30 transition-all duration-300 group flex flex-col items-center text-center h-full">
                <div className="absolute inset-0 bg-gradient-to-b from-violet-500/5 to-transparent rounded-3xl opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />
                <div className="relative w-14 h-14 mb-6 mt-2">
                  <div className="absolute inset-0 bg-violet-500/10 rounded-2xl border border-violet-500/20 group-hover:bg-violet-500/20 group-hover:border-violet-500/40 group-hover:scale-110 transition-all duration-500" />
                  <div className="absolute -top-3 -right-3 w-7 h-7 rounded-full bg-zinc-50 dark:bg-[#080c10] border-2 border-violet-500/40 flex items-center justify-center text-[11px] font-black font-mono text-violet-400 shadow-[0_0_15px_rgba(139,92,246,0.3)] z-10">3</div>
                  <div className="w-full h-full flex items-center justify-center relative z-0">
                    <Sliders className="w-6 h-6 text-violet-400" />
                  </div>
                </div>
                <h3 className="text-zinc-900 dark:text-white font-bold text-lg mb-3">Edit & Refine</h3>
                <p className="text-zinc-600 dark:text-gray-400 text-sm leading-relaxed">
                  Tune parameters with the visual drawer, or edit the raw Python script in the Monaco code editor.
                </p>
              </div>
            </AnimatedSection>

            {/* Step 4 */}
            <AnimatedSection delay={0.36} direction="up" duration={0.7}>
              <div className="relative p-6 rounded-3xl bg-black/5 dark:bg-white/[0.02] border border-black/10 dark:border-white/5 hover:bg-black/10 dark:hover:bg-white/[0.04] hover:border-emerald-500/30 transition-all duration-300 group flex flex-col items-center text-center h-full">
                <div className="absolute inset-0 bg-gradient-to-b from-emerald-500/5 to-transparent rounded-3xl opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />
                <div className="relative w-14 h-14 mb-6 mt-2">
                  <div className="absolute inset-0 bg-emerald-500/10 rounded-2xl border border-emerald-500/20 group-hover:bg-emerald-500/20 group-hover:border-emerald-500/40 group-hover:scale-110 transition-all duration-500" />
                  <div className="absolute -top-3 -right-3 w-7 h-7 rounded-full bg-zinc-50 dark:bg-[#080c10] border-2 border-emerald-500/40 flex items-center justify-center text-[11px] font-black font-mono text-emerald-400 shadow-[0_0_15px_rgba(16,185,129,0.3)] z-10">4</div>
                  <div className="w-full h-full flex items-center justify-center relative z-0">
                    <Download className="w-6 h-6 text-emerald-400" />
                  </div>
                </div>
                <h3 className="text-zinc-900 dark:text-white font-bold text-lg mb-3">Export & Manufacture</h3>
                <p className="text-zinc-600 dark:text-gray-400 text-sm leading-relaxed">
                  Hit <span className="text-emerald-400 font-medium bg-emerald-500/10 px-1.5 py-0.5 rounded-md border border-emerald-500/20">Sync to Engine</span> to view the model, then export STL, STEP, or CNC G-Code.
                </p>
              </div>
            </AnimatedSection>
          </div>
        </div>
      </section>

      {/* ── Feature Showcase ── */}
      <section id="features" className="relative z-10 py-28 border-t border-black/10 dark:border-white/5">
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-blue-950/5 to-transparent pointer-events-none" />
        <div className="max-w-6xl mx-auto px-6 relative">
          <AnimatedSection direction="up" duration={0.7}>
            <div className="text-center mb-16">
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-violet-500/10 border border-violet-500/20 text-violet-400 text-xs font-semibold tracking-widest mb-5 uppercase">
                Capabilities
              </div>
              <h2 className="text-3xl md:text-5xl font-bold text-zinc-900 dark:text-white mb-4 tracking-tight">
                Everything You Need to
                <span className="block text-transparent bg-clip-text bg-gradient-to-r from-violet-400 to-blue-500">Go from Idea to Part</span>
              </h2>
              <p className="text-zinc-600 dark:text-gray-400 max-w-xl mx-auto text-lg">
                A complete AI CAD/CAM workspace — no external tools required.
              </p>
            </div>
          </AnimatedSection>

          <div className="grid md:grid-cols-3 gap-5">

            {/* Feature: Image/PDF Input */}
            <AnimatedSection delay={0} direction="up" duration={0.7}>
              <div className="p-6 rounded-2xl bg-black/5 dark:bg-white/3 border border-black/5 dark:border-white/6 hover:border-blue-500/30 hover:bg-black/5 dark:bg-white/5 transition-all duration-300 group hover:-translate-y-1 cursor-default h-full">
                <div className="w-12 h-12 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center mb-5 group-hover:bg-zinc-800 dark:hover:bg-blue-500/20 group-hover:scale-110 transition-all duration-300">
                  <FileImage className="w-6 h-6 text-blue-400" />
                </div>
                <h3 className="text-zinc-900 dark:text-white font-bold text-base mb-2">Image & PDF Input</h3>
                <p className="text-zinc-600 dark:text-gray-400 text-sm leading-relaxed">
                  Upload sketches, engineering drawings, or multi-page PDFs as reference input for the AI to analyze and convert.
                </p>
              </div>
            </AnimatedSection>

            {/* Feature: Streaming */}
            <AnimatedSection delay={0.08} direction="up" duration={0.7}>
              <div className="p-6 rounded-2xl bg-black/5 dark:bg-white/3 border border-black/5 dark:border-white/6 hover:border-cyan-500/30 hover:bg-black/5 dark:bg-white/5 transition-all duration-300 group hover:-translate-y-1 cursor-default h-full">
                <div className="w-12 h-12 rounded-xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center mb-5 group-hover:bg-cyan-500/20 group-hover:scale-110 transition-all duration-300">
                  <Zap className="w-6 h-6 text-cyan-400" />
                </div>
                <h3 className="text-zinc-900 dark:text-white font-bold text-base mb-2">Real-Time Streaming</h3>
                <p className="text-zinc-600 dark:text-gray-400 text-sm leading-relaxed">
                  The build123d Python script is streamed token-by-token via SSE — watch your CAD code appear live as it's generated.
                </p>
              </div>
            </AnimatedSection>

            {/* Feature: Parameter Drawer */}
            <AnimatedSection delay={0.16} direction="up" duration={0.7}>
              <div className="p-6 rounded-2xl bg-black/5 dark:bg-white/3 border border-black/5 dark:border-white/6 hover:border-violet-500/30 hover:bg-black/5 dark:bg-white/5 transition-all duration-300 group hover:-translate-y-1 cursor-default h-full">
                <div className="w-12 h-12 rounded-xl bg-violet-500/10 border border-violet-500/20 flex items-center justify-center mb-5 group-hover:bg-violet-500/20 group-hover:scale-110 transition-all duration-300">
                  <Sliders className="w-6 h-6 text-violet-400" />
                </div>
                <h3 className="text-zinc-900 dark:text-white font-bold text-base mb-2">Visual Parameter Drawer</h3>
                <p className="text-zinc-600 dark:text-gray-400 text-sm leading-relaxed">
                  Auto-parsed <code className="text-violet-400 text-xs bg-black/5 dark:bg-white/5 px-1 rounded">PARAMETERS</code> dict exposed as interactive sliders and inputs — no code editing needed.
                </p>
              </div>
            </AnimatedSection>

            {/* Feature: Monaco Editor */}
            <AnimatedSection delay={0.24} direction="up" duration={0.7}>
              <div className="p-6 rounded-2xl bg-black/5 dark:bg-white/3 border border-black/5 dark:border-white/6 hover:border-blue-500/30 hover:bg-black/5 dark:bg-white/5 transition-all duration-300 group hover:-translate-y-1 cursor-default h-full">
                <div className="w-12 h-12 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center mb-5 group-hover:bg-zinc-800 dark:hover:bg-blue-500/20 group-hover:scale-110 transition-all duration-300">
                  <Code2 className="w-6 h-6 text-blue-400" />
                </div>
                <h3 className="text-zinc-900 dark:text-white font-bold text-base mb-2">Monaco Code Engine</h3>
                <p className="text-zinc-600 dark:text-gray-400 text-sm leading-relaxed">
                  Full VS Code-quality editor for the generated Python script. Modify the logic directly and sync back to the engine.
                </p>
              </div>
            </AnimatedSection>

            {/* Feature: 3D Viewport */}
            <AnimatedSection delay={0.32} direction="up" duration={0.7}>
              <div className="p-6 rounded-2xl bg-black/5 dark:bg-white/3 border border-black/5 dark:border-white/6 hover:border-cyan-500/30 hover:bg-black/5 dark:bg-white/5 transition-all duration-300 group hover:-translate-y-1 cursor-default h-full">
                <div className="w-12 h-12 rounded-xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center mb-5 group-hover:bg-cyan-500/20 group-hover:scale-110 transition-all duration-300">
                  <Box className="w-6 h-6 text-cyan-400" />
                </div>
                <h3 className="text-zinc-900 dark:text-white font-bold text-base mb-2">Interactive 3D Viewport</h3>
                <p className="text-zinc-600 dark:text-gray-400 text-sm leading-relaxed">
                  React Three Fiber STL viewer with orbit controls. Inspect your model from every angle right in the browser.
                </p>
              </div>
            </AnimatedSection>

            {/* Feature: CNC Export */}
            <AnimatedSection delay={0.40} direction="up" duration={0.7}>
              <div className="p-6 rounded-2xl bg-black/5 dark:bg-white/3 border border-black/5 dark:border-white/6 hover:border-emerald-500/30 hover:bg-black/5 dark:bg-white/5 transition-all duration-300 group hover:-translate-y-1 cursor-default h-full">
                <div className="w-12 h-12 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center mb-5 group-hover:bg-emerald-500/20 group-hover:scale-110 transition-all duration-300">
                  <History className="w-6 h-6 text-emerald-400" />
                </div>
                <h3 className="text-zinc-900 dark:text-white font-bold text-base mb-2">Manufacture with CAM</h3>
                <p className="text-zinc-600 dark:text-gray-400 text-sm leading-relaxed">
                  Go from idea to physical part effortlessly. Export standard STL or STEP files, or instantly generate toolpaths and CNC G-Code.
                </p>
              </div>
            </AnimatedSection>

          </div>
        </div>
      </section>

      {/* ── Prompt demo strip ── */}
      <LandingClient />

      {/* ── CTA ── */}
      <section className="relative z-10 py-28 border-t border-black/10 dark:border-white/5 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-blue-100 via-zinc-50 to-zinc-50 dark:from-blue-950/40 dark:via-[#080c10] dark:to-[#080c10]" />
        {/* Glow removed */}
        <AnimatedSection direction="up" duration={0.8} amount={0.2}>
          <div className="max-w-3xl mx-auto px-6 text-center relative z-10">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400 text-xs font-semibold tracking-widest mb-8 uppercase">
              Start Today — It&apos;s Free
            </div>
            <h2 className="text-4xl md:text-6xl font-extrabold tracking-tight mb-6 text-zinc-900 dark:text-white leading-[1.1]">
              Ready to Build<br />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-cyan-400">Your First Part?</span>
            </h2>
            <p className="text-xl text-zinc-600 dark:text-gray-400 mb-10 max-w-lg mx-auto leading-relaxed">
              Join designers and engineers who are already generating production-ready CAD models with AI.
            </p>
            <Link
              href={isLoggedIn ? '/workspace' : '/register'}
              className="group inline-flex items-center gap-3 px-10 py-5 text-lg font-bold text-white bg-gradient-to-b from-zinc-800 to-zinc-950 dark:from-blue-500 dark:to-blue-700 rounded-2xl hover:from-zinc-700 dark:hover:from-blue-400 hover:to-zinc-900 dark:hover:to-blue-600 shadow-[0_0_60px_rgba(37,99,235,0.5)] hover:shadow-[0_0_80px_rgba(37,99,235,0.7)] transition-all duration-200"
            >
              {isLoggedIn ? 'Open Workspace' : 'Start Designing for Free'}
              <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
            </Link>
          </div>
        </AnimatedSection>
      </section>

      {/* ── Footer ── */}
      <BackToTop />
      <footer className="relative z-10 py-10 border-t border-black/10 dark:border-white/5 bg-zinc-50 dark:bg-[#080c10]">
        <div className="max-w-7xl mx-auto px-6 flex flex-col md:flex-row justify-between items-center gap-4">
          <div className="flex items-center gap-2">
            <Link href="/" className="flex items-center gap-2 group">
              <div className="relative w-8 h-8 flex items-center justify-center">
                <div className="absolute inset-0 bg-blue-500 rounded-xl transform rotate-45 opacity-20 group-hover:opacity-30 transition-opacity"/>
                <Cuboid className="w-4 h-4 text-blue-400 relative z-10" />
              </div>
              <span className="text-base font-bold tracking-widest text-zinc-900 dark:text-white">VΞXCAD</span>
            </Link>
            <span className="text-zinc-500 dark:text-gray-400 text-sm">by</span>
            <a href="https://datavex.in/" target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:text-blue-400 font-semibold text-sm transition-colors">Datavex.ai</a>
          </div>
          <p className="text-zinc-500 dark:text-gray-400 text-sm text-center">
            © {new Date().getFullYear()} VΞXCAD. All rights reserved.
          </p>
        </div>
      </footer>

    </div>
  );
}
