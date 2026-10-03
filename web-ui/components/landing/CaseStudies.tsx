'use client';

import { Play } from 'lucide-react';
import { AnimatedSection } from './AnimatedSection';

export function CaseStudies() {
  const cases = [
    {
      shop: 'Neff Machine',
      before: 'Hours of manual DFM review',
      after: 'A 10-second review',
      image: '/img/home/case-neff.jpg', // Placeholder for now, can be an actual image later or just a gradient box
      color: 'from-blue-500 to-cyan-500',
    },
    {
      shop: 'Hill Manufacturing',
      before: 'Time lost programming fixtures',
      after: 'Instant fixture machining',
      color: 'from-emerald-500 to-teal-500',
    },
    {
      shop: 'Accurate Dial & Nameplate',
      before: 'Quoting and programming bottleneck',
      after: 'The spindle became the constraint',
      color: 'from-violet-500 to-purple-500',
    },
  ];

  return (
    <section className="relative z-10 py-24">
      <div className="max-w-6xl mx-auto px-6">
        <AnimatedSection direction="up" duration={0.7}>
          <div className="mb-12">
            <div className="text-xs font-bold tracking-widest text-zinc-500 dark:text-gray-400 uppercase mb-3">
              Case studies
            </div>
            <h2 className="text-3xl md:text-5xl font-bold text-zinc-900 dark:text-white tracking-tight">
              Results from real shops.
            </h2>
          </div>
        </AnimatedSection>

        <div className="grid md:grid-cols-3 gap-6">
          {cases.map((c, idx) => (
            <AnimatedSection key={idx} delay={idx * 0.1} direction="up" duration={0.6}>
              <div className="group rounded-3xl bg-black/5 dark:bg-[#0a0f14] border border-black/10 dark:border-white/10 overflow-hidden hover:border-blue-500/30 transition-colors h-full flex flex-col cursor-pointer">
                
                {/* Media area placeholder */}
                <div className="relative aspect-video bg-zinc-200 dark:bg-black/40 overflow-hidden">
                  <div className={`absolute inset-0 bg-gradient-to-br ${c.color} opacity-20 group-hover:opacity-40 transition-opacity duration-500`} />
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="w-12 h-12 rounded-full bg-white/10 backdrop-blur-md border border-white/20 flex items-center justify-center group-hover:scale-110 transition-transform duration-300">
                      <Play className="w-5 h-5 text-zinc-900 dark:text-white ml-1" />
                    </div>
                  </div>
                </div>

                {/* Content */}
                <div className="p-6 flex-1 flex flex-col">
                  <h3 className="text-lg font-bold text-zinc-900 dark:text-white mb-4">{c.shop}</h3>
                  
                  <div className="mb-4 flex-1">
                    <div className="text-[11px] font-bold text-zinc-500 dark:text-gray-500 uppercase tracking-wider mb-1">Before</div>
                    <p className="text-sm text-zinc-600 dark:text-gray-400">{c.before}</p>
                  </div>
                  
                  <div>
                    <div className="text-[11px] font-bold text-blue-500 uppercase tracking-wider mb-1">After</div>
                    <p className="text-sm font-medium text-zinc-900 dark:text-white">{c.after}</p>
                  </div>
                </div>
              </div>
            </AnimatedSection>
          ))}
        </div>
      </div>
    </section>
  );
}
