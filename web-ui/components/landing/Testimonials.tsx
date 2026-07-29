'use client';

import { AnimatedSection } from './AnimatedSection';

export function Testimonials() {
  const testimonials = [
    {
      quote: "What used to take hours of DFM review now takes a 10-second look. It has changed how fast we can turn quotes around.",
      name: "James Dyer",
      shop: "Accurate Dial & Nameplate",
    },
    {
      quote: "VΞXCAD saved us 4 hours on determining tooling and quoting in the first week, and helped us build a foundation to scale our shop.",
      name: "Elijah Langworthy",
      shop: "Nocturnal Welding",
    },
  ];

  return (
    <section className="relative z-10 py-24 border-t border-black/10 dark:border-white/5 overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-blue-500/[0.02] to-transparent pointer-events-none" />
      
      <div className="max-w-6xl mx-auto px-6 relative">
        <div className="grid md:grid-cols-2 gap-8">
          {testimonials.map((test, idx) => (
            <AnimatedSection key={idx} delay={idx * 0.15} direction="up" duration={0.7}>
              <figure className="relative p-8 rounded-3xl bg-black/5 dark:bg-[#0a0f14] border border-black/10 dark:border-white/10 shadow-sm h-full flex flex-col justify-between group hover:border-blue-500/30 transition-colors">
                <div aria-hidden="true" className="absolute -top-4 -left-2 text-6xl text-blue-500/20 font-serif leading-none group-hover:text-blue-500/40 transition-colors">
                  &ldquo;
                </div>
                <blockquote className="relative z-10 text-xl md:text-2xl font-medium text-zinc-800 dark:text-gray-200 leading-snug mb-8">
                  {test.quote}
                </blockquote>
                <figcaption className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center text-white font-bold text-sm shadow-inner">
                    {test.name.charAt(0)}
                  </div>
                  <div className="flex flex-col">
                    <span className="text-zinc-900 dark:text-white font-semibold text-sm">{test.name}</span>
                    <span className="text-zinc-500 dark:text-gray-400 text-sm">{test.shop}</span>
                  </div>
                </figcaption>
              </figure>
            </AnimatedSection>
          ))}
        </div>
      </div>
    </section>
  );
}
