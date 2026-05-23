import Link from 'next/link';
import { ArrowRight, Cuboid, Zap, Layers, Code2 } from 'lucide-react';
import { getSession } from '@/lib/auth';
import { Hero3D } from '@/components/Hero3D';

export default async function LandingPage() {
  const session = await getSession();
  const isLoggedIn = Boolean(session);
  return (
    <div className="min-h-screen bg-background text-foreground selection:bg-blue-500/30 overflow-hidden relative font-sans">
      {/* Background Effects */}
      <div className="absolute inset-0 z-0 pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-blue-500/10 dark:bg-blue-600/20 rounded-full blur-[128px]" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-cyan-500/5 dark:bg-cyan-600/10 rounded-full blur-[128px]" />
        {/* Light mode: subtle blue tint. Dark mode: near-black */}
        <div className="absolute inset-0 bg-gradient-to-br from-slate-50 via-blue-50/30 to-white dark:from-black dark:via-blue-950/10 dark:to-black" />
      </div>

      {/* Navigation */}
      <nav className="relative z-10 flex items-center justify-between px-6 py-6 max-w-7xl mx-auto">
        <div className="flex items-center gap-3">
          <div className="relative w-10 h-10 flex items-center justify-center">
            <div className="absolute inset-0 bg-blue-500 rounded-lg transform rotate-45 opacity-20"></div>
            <Cuboid className="w-6 h-6 text-blue-500 dark:text-blue-400 relative z-10" />
          </div>
          <span className="text-2xl font-bold tracking-[0.2em] bg-clip-text text-transparent bg-gradient-to-b from-gray-900 via-gray-700 to-gray-500 dark:from-gray-100 dark:via-gray-300 dark:to-gray-500 drop-shadow-sm">
            CADVΞX
          </span>
        </div>
        <div className="flex items-center gap-6">
          {isLoggedIn ? (
            <Link
              href="/workspace"
              className="group relative inline-flex items-center justify-center px-6 py-2.5 text-sm font-semibold text-white transition-all duration-200 bg-blue-600 rounded-xl hover:bg-blue-500 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-600 focus:ring-offset-background shadow-[0_0_20px_rgba(37,99,235,0.3)] hover:shadow-[0_0_30px_rgba(37,99,235,0.5)]"
            >
              Go to Workspace
              <ArrowRight className="w-4 h-4 ml-2 group-hover:translate-x-1 transition-transform" />
            </Link>
          ) : (
            <>
              <Link href="/login" className="text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white transition-colors text-sm font-medium">
                Log in
              </Link>
              <Link href="/register" className="group relative inline-flex items-center justify-center px-6 py-2.5 text-sm font-semibold text-white transition-all duration-200 bg-blue-600 rounded-xl hover:bg-blue-500 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-600 focus:ring-offset-background shadow-[0_0_20px_rgba(37,99,235,0.3)] hover:shadow-[0_0_30px_rgba(37,99,235,0.5)]">
                Sign Up
              </Link>
            </>
          )}
        </div>
      </nav>

      {/* Hero Section */}
      <main className="relative z-10 flex flex-col items-center justify-center px-6 pt-20 pb-32 text-center max-w-7xl mx-auto min-h-[85vh]">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-blue-50 dark:bg-white/5 border border-blue-200 dark:border-white/10 text-blue-600 dark:text-blue-400 text-sm font-medium mb-8 backdrop-blur-md">
          {/* <Zap className="w-10 h-10" /> */}
          <span className="tracking-wide">INTELLIGENT 3D EVOLUTION</span>
        </div>
        
        <h1 className="text-5xl md:text-7xl font-extrabold tracking-tight mb-6">
          <span className="block text-transparent bg-clip-text bg-gradient-to-b from-gray-900 via-gray-700 to-gray-500 dark:from-white dark:via-gray-200 dark:to-gray-400 mb-2">
            Where 2D Evolves Into
          </span>
          <span className="block text-transparent bg-clip-text bg-gradient-to-r from-blue-500 via-blue-600 to-cyan-500 dark:from-blue-400 dark:via-blue-500 dark:to-cyan-400 pb-2 drop-shadow-[0_0_25px_rgba(59,130,246,0.4)]">
            Intelligent 3D
          </span>
        </h1>
        
        <p className="mt-6 text-lg md:text-xl text-gray-600 dark:text-gray-400 max-w-2xl mx-auto leading-relaxed">
          The next generation AI-powered CAD copilot. Seamlessly transform your two-dimensional ideas into complex, intelligent three-dimensional models with unparalleled precision.
        </p>
        
        <div className="mt-12 flex flex-col sm:flex-row items-center gap-6">
          <Link href={isLoggedIn ? "/workspace" : "/register"} className="group relative inline-flex items-center justify-center px-8 py-4 text-base font-bold text-white transition-all duration-200 bg-gradient-to-b from-blue-500 to-blue-700 border border-blue-400/30 rounded-2xl hover:from-blue-400 hover:to-blue-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-600 focus:ring-offset-background shadow-[0_0_40px_rgba(37,99,235,0.4)] overflow-hidden">
            <div className="absolute inset-0 w-full h-full -ml-14 bg-gradient-to-r from-transparent via-white/20 to-transparent skew-x-[20deg] group-hover:animate-[shimmer_1.5s_infinite]" />
            {isLoggedIn ? 'Open Workspace' : 'Start Designing'}
            <ArrowRight className="w-5 h-5 ml-2 group-hover:translate-x-1 transition-transform" />
          </Link>
          
          <Link href="#features" className="inline-flex items-center justify-center px-8 py-4 text-base font-bold text-gray-600 dark:text-gray-300 transition-all duration-200 bg-gray-100 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-2xl hover:bg-gray-200 dark:hover:bg-white/10 hover:text-gray-900 dark:hover:text-white backdrop-blur-sm">
            Learn More
          </Link>
        </div>

        {/* Mockup / Visual */}
        <div className="mt-24 relative w-full max-w-5xl mx-auto h-[500px]" style={{ perspective: '2000px' }}>
          <div className="absolute inset-0 bg-gradient-to-t from-background via-transparent to-transparent z-10 rounded-t-3xl pointer-events-none" />
          <div className="relative w-full h-full rounded-t-3xl border-t border-l border-r border-gray-200 dark:border-white/10 bg-white/70 dark:bg-black/60 backdrop-blur-xl overflow-hidden shadow-[0_-20px_60px_rgba(37,99,235,0.15)]">
            <div className="flex items-center px-4 py-3 border-b border-gray-200 dark:border-white/10 bg-gray-50/80 dark:bg-white/5 absolute top-0 w-full z-20">
              <div className="flex gap-2">
                <div className="w-3 h-3 rounded-full bg-red-400" />
                <div className="w-3 h-3 rounded-full bg-yellow-400" />
                <div className="w-3 h-3 rounded-full bg-green-400" />
              </div>
            </div>
            <div className="w-full h-full bg-background pt-12 relative overflow-hidden flex">
              
              {/* Fake Left Sidebar (File Explorer / History) */}
              <div className="hidden md:flex flex-col w-48 border-r border-border bg-zinc-50/50 dark:bg-white/5 p-4 space-y-4">
                <div className="h-2 w-16 bg-gray-300 dark:bg-gray-700 rounded-full" />
                <div className="space-y-2">
                  <div className="h-2 w-full bg-gray-200 dark:bg-gray-800 rounded-full" />
                  <div className="h-2 w-3/4 bg-gray-200 dark:bg-gray-800 rounded-full" />
                  <div className="h-2 w-5/6 bg-gray-200 dark:bg-gray-800 rounded-full" />
                </div>
                <div className="h-2 w-12 bg-gray-300 dark:bg-gray-700 rounded-full mt-6" />
                <div className="space-y-2">
                  <div className="h-2 w-4/5 bg-gray-200 dark:bg-gray-800 rounded-full" />
                  <div className="h-2 w-full bg-gray-200 dark:bg-gray-800 rounded-full" />
                </div>
              </div>

              {/* Main Viewport Area */}
              <div className="flex-1 relative flex items-center justify-center overflow-hidden">
                  <div className="absolute inset-0 bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:24px_24px]"></div>
                  <div className="absolute inset-0 opacity-30 dark:opacity-40 bg-[radial-gradient(circle_at_50%_50%,_rgba(59,130,246,0.3)_0%,_transparent_60%)] pointer-events-none" />
                  
                  {/* Floating Action Bar */}
                  <div className="absolute top-4 left-1/2 -translate-x-1/2 flex items-center gap-2 px-4 py-2 rounded-xl bg-background/80 backdrop-blur-md border border-border shadow-sm z-10">
                    <div className="w-4 h-4 rounded-full bg-blue-500/20 flex items-center justify-center"><div className="w-1.5 h-1.5 rounded-full bg-blue-500" /></div>
                    <div className="w-4 h-4 rounded bg-gray-200 dark:bg-gray-700" />
                    <div className="w-4 h-4 rounded bg-gray-200 dark:bg-gray-700" />
                    <div className="w-px h-4 bg-border mx-2" />
                    <div className="w-12 h-2 rounded-full bg-gray-200 dark:bg-gray-700" />
                  </div>

                  <div className="w-full h-full relative z-0">
                    <Hero3D />
                  </div>
              </div>

              {/* Fake Right Sidebar (Code Editor / Parameters) */}
              <div className="hidden lg:flex flex-col w-64 border-l border-border bg-zinc-50/50 dark:bg-white/5 p-4">
                <div className="flex items-center justify-between mb-6">
                  <div className="flex gap-2">
                    <div className="h-2 w-10 bg-blue-500 rounded-full" />
                    <div className="h-2 w-10 bg-gray-300 dark:bg-gray-700 rounded-full" />
                  </div>
                </div>
                
                {/* Code-like lines */}
                <div className="space-y-3 font-mono text-[10px] opacity-40">
                  <div className="flex gap-2"><span className="text-pink-500 font-bold">def</span> <span className="text-blue-500">build_model</span><span className="text-foreground">(params):</span></div>
                  <div className="pl-4 h-1.5 w-3/4 bg-gray-400 dark:bg-gray-600 rounded-full" />
                  <div className="pl-4 h-1.5 w-1/2 bg-gray-400 dark:bg-gray-600 rounded-full" />
                  <div className="pl-4 flex gap-2"><span className="text-pink-500 font-bold">with</span> <span className="text-cyan-500">BuildPart</span><span className="text-foreground">()</span> <span className="text-pink-500 font-bold">as</span> <span className="text-foreground">part:</span></div>
                  <div className="pl-8 h-1.5 w-5/6 bg-blue-400 dark:bg-blue-600 rounded-full" />
                  <div className="pl-8 h-1.5 w-2/3 bg-gray-400 dark:bg-gray-600 rounded-full" />
                  <div className="pl-8 h-1.5 w-4/5 bg-gray-400 dark:bg-gray-600 rounded-full" />
                  <div className="pl-8 h-1.5 w-3/4 bg-gray-400 dark:bg-gray-600 rounded-full" />
                  <div className="pl-4 h-1.5 w-1/3 bg-pink-400 dark:bg-pink-800 rounded-full mt-2" />
                </div>

                <div className="mt-auto h-8 w-full bg-blue-500/10 border border-blue-500/20 rounded-lg flex items-center justify-center">
                  <div className="h-1.5 w-1/3 bg-blue-500 rounded-full" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Features Section */}
      <section id="features" className="relative z-10 py-32 bg-gray-50 dark:bg-black border-t border-gray-200 dark:border-white/5">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-5xl font-bold mb-6 text-gray-900 dark:text-transparent dark:bg-clip-text dark:bg-gradient-to-b dark:from-white dark:to-gray-500">
              Powerful Features
            </h2>
            <p className="text-gray-500 dark:text-gray-400 max-w-2xl mx-auto text-lg">
              Everything you need to design, iterate, and export complex 3D models from simple 2D descriptions.
            </p>
          </div>
          <div className="grid md:grid-cols-3 gap-8">
            <div className="p-8 rounded-3xl bg-white dark:bg-transparent dark:bg-gradient-to-b dark:from-white/5 dark:to-transparent border border-gray-200 dark:border-white/5 hover:border-blue-400 dark:hover:border-blue-500/30 shadow-sm hover:shadow-blue-100 dark:shadow-none transition-all duration-300 group hover:-translate-y-1">
              <div className="w-14 h-14 rounded-2xl bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/20 flex items-center justify-center mb-6 group-hover:scale-110 group-hover:bg-blue-100 dark:group-hover:bg-blue-500/20 transition-all duration-300">
                <Layers className="w-7 h-7 text-blue-600 dark:text-blue-400" />
              </div>
              <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-3">Seamless 2D to 3D</h3>
              <p className="text-gray-500 dark:text-gray-400 leading-relaxed">
                Upload your 2D sketches and let our AI engine instantly generate precise 3D models ready for engineering and rendering.
              </p>
            </div>
            <div className="p-8 rounded-3xl bg-white dark:bg-transparent dark:bg-gradient-to-b dark:from-white/5 dark:to-transparent border border-gray-200 dark:border-white/5 hover:border-cyan-400 dark:hover:border-cyan-500/30 shadow-sm hover:shadow-cyan-100 dark:shadow-none transition-all duration-300 group hover:-translate-y-1">
              <div className="w-14 h-14 rounded-2xl bg-cyan-50 dark:bg-cyan-500/10 border border-cyan-200 dark:border-cyan-500/20 flex items-center justify-center mb-6 group-hover:scale-110 group-hover:bg-cyan-100 dark:group-hover:bg-cyan-500/20 transition-all duration-300">
                <Zap className="w-7 h-7 text-cyan-600 dark:text-cyan-400" />
              </div>
              <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-3">Real-time Generation</h3>
              <p className="text-gray-500 dark:text-gray-400 leading-relaxed">
                Experience lightning-fast model generation and adjustments. See your changes reflected instantly in the interactive viewport.
              </p>
            </div>
            <div className="p-8 rounded-3xl bg-white dark:bg-transparent dark:bg-gradient-to-b dark:from-white/5 dark:to-transparent border border-gray-200 dark:border-white/5 hover:border-blue-400 dark:hover:border-blue-500/30 shadow-sm hover:shadow-blue-100 dark:shadow-none transition-all duration-300 group hover:-translate-y-1">
              <div className="w-14 h-14 rounded-2xl bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/20 flex items-center justify-center mb-6 group-hover:scale-110 group-hover:bg-blue-100 dark:group-hover:bg-blue-500/20 transition-all duration-300">
                <Code2 className="w-7 h-7 text-blue-600 dark:text-blue-400" />
              </div>
              <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-3">Parametric Control</h3>
              <p className="text-gray-500 dark:text-gray-400 leading-relaxed">
                Retain full control over the generated models with deep parametric adjustments and intelligent constraints.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="relative z-10 py-24 border-t border-gray-200 dark:border-white/10 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-blue-600 to-blue-800 dark:from-blue-900/30 dark:to-black" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-blue-400/20 dark:bg-blue-600/10 rounded-full blur-[100px] pointer-events-none" />
        <div className="max-w-4xl mx-auto px-6 text-center relative z-10">
          <h2 className="text-4xl md:text-5xl font-bold mb-6 text-white">
            Ready to Evolve Your Design?
          </h2>
          <p className="text-xl text-blue-100 dark:text-blue-200/70 mb-10">
            Join the future of computer-aided design today.
          </p>
          <Link
            href={isLoggedIn ? "/workspace" : "/register"}
            className="inline-flex items-center justify-center px-10 py-5 text-lg font-bold text-blue-700 dark:text-black transition-all duration-200 bg-white rounded-2xl hover:bg-blue-50 dark:hover:bg-gray-100 hover:scale-105 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-white shadow-[0_0_30px_rgba(255,255,255,0.3)]"
          >
            {isLoggedIn ? 'Open Workspace' : 'Start Designing for Free'}
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="relative z-10 py-12 border-t border-gray-200 dark:border-white/10 bg-background">
        <div className="max-w-7xl mx-auto px-6 flex flex-col md:flex-row justify-between items-center gap-6 relative">
          <div className="flex items-center gap-2">
            <div className="relative w-10 h-10 flex items-center justify-center">
              <div className="absolute inset-0 bg-blue-500 rounded-lg transform rotate-45 opacity-20"></div>
              <Cuboid className="w-6 h-6 text-blue-500 dark:text-blue-400 relative z-10" />
            </div>
            <span className="text-xl font-bold tracking-widest text-gray-900 dark:text-gray-300">CADVΞX </span>
            <span className="text-gray-500 dark:text-gray-600 text-sm">by</span>
            <a href="https://datavex.in/" target="_blank" rel="noopener noreferrer" className="text-blue-600 dark:text-blue-500 hover:text-blue-500 dark:hover:text-blue-400 font-semibold transition-colors">Datavex.ai</a>
          </div>
          <p className="text-gray-400 dark:text-gray-600 text-sm text-center md:absolute md:left-1/2 md:-translate-x-1/2">
            © {new Date().getFullYear()} CADVΞX. All rights reserved.
          </p>
        </div>
      </footer>

      {/* Tailwind Custom Animations */}
      <style dangerouslySetInnerHTML={{__html: `
        @keyframes shimmer {
          100% { transform: translateX(200%); }
        }
      `}} />
    </div>
  );
}
