'use client';

import { Activity, Clock, Layers, Zap } from 'lucide-react';
import { AnimatedSection } from './AnimatedSection';

export function ValueGrid() {
  const values = [
    {
      title: 'Instant DFM & Part Analysis',
      description: 'Upload a 2D sketch or PDF and get geometry, tooling, and manufacturability reviewed in seconds.',
      icon: Activity,
      color: 'text-emerald-400',
      bg: 'bg-emerald-500/10',
      border: 'border-emerald-500/20',
      hoverBorder: 'hover:border-emerald-500/40',
      hoverGlow: 'group-hover:shadow-[0_0_20px_rgba(52,211,153,0.15)]',
    },
    {
      title: 'Faster, More Accurate Quotes',
      description: 'Cycle time, material, and cost estimates generated automatically, so quoting takes minutes, not days.',
      icon: Clock,
      color: 'text-cyan-400',
      bg: 'bg-cyan-500/10',
      border: 'border-cyan-500/20',
      hoverBorder: 'hover:border-cyan-500/40',
      hoverGlow: 'group-hover:shadow-[0_0_20px_rgba(34,211,238,0.15)]',
    },
    {
      title: 'Flexible Tooling Library',
      description: 'Model your tooling, materials, and workholding, so each generated G-Code reflects how your shop runs.',
      icon: Layers,
      color: 'text-violet-400',
      bg: 'bg-violet-500/10',
      border: 'border-violet-500/20',
      hoverBorder: 'hover:border-violet-500/40',
      hoverGlow: 'group-hover:shadow-[0_0_20px_rgba(167,139,250,0.15)]',
    },
    {
      title: 'Real-time Parametric CAD',
      description: 'Generate fully parametric build123d scripts in real-time. Review, tweak, and run. You stay in control.',
      icon: Zap,
      color: 'text-amber-400',
      bg: 'bg-amber-500/10',
      border: 'border-amber-500/20',
      hoverBorder: 'hover:border-amber-500/40',
      hoverGlow: 'group-hover:shadow-[0_0_20px_rgba(251,191,36,0.15)]',
    },
  ];

  return (
    <section className="relative z-10 py-24">
      <div className="max-w-6xl mx-auto px-6">
        <AnimatedSection direction="up" duration={0.7}>
          <div className="mb-12">
            <div className="text-xs font-bold tracking-widest text-zinc-500 dark:text-gray-400 uppercase mb-3">
              SEAMLESS MANUFACTURING
            </div>
            <h2 className="text-3xl md:text-5xl font-bold text-zinc-900 dark:text-white mb-4 tracking-tight">
              Eliminate the friction between<br/>
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-cyan-400">
                design and production.
              </span>
            </h2>
            <p className="text-zinc-600 dark:text-gray-400 text-lg max-w-2xl">
              VΞXCAD replaces hours of manual drafting, DFM analysis, and toolpath generation with intelligent, real-time automation.
            </p>
          </div>
        </AnimatedSection>

        <div className="grid md:grid-cols-2 gap-6">
          {values.map((value, idx) => (
            <AnimatedSection key={value.title} delay={idx * 0.1} direction="up" duration={0.6}>
              <div
                className={`relative p-8 rounded-3xl bg-black/5 dark:bg-white/[0.02] border border-black/10 dark:border-white/5 transition-all duration-300 group flex items-start gap-6 h-full ${value.hoverBorder} ${value.hoverGlow}`}
              >
                {/* Glow effect on hover */}
                <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent dark:from-white/[0.02] dark:to-transparent rounded-3xl opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />
                
                <div className={`flex-shrink-0 w-14 h-14 rounded-2xl ${value.bg} ${value.border} border flex items-center justify-center group-hover:scale-110 transition-transform duration-300`}>
                  <value.icon className={`w-6 h-6 ${value.color}`} />
                </div>
                
                <div>
                  <h3 className="text-zinc-900 dark:text-white font-bold text-xl mb-2">{value.title}</h3>
                  <p className="text-zinc-600 dark:text-gray-400 text-base leading-relaxed">
                    {value.description}
                  </p>
                </div>
              </div>
            </AnimatedSection>
          ))}
        </div>
      </div>
    </section>
  );
}
