'use client';

import { AnimatedSection } from './AnimatedSection';

export function ChangelogPreview() {
  const releases = [
    {
      date: 'Release 2026-07-28',
      features: [
        '[FEATURE] Introduced Advanced DFM toolpath visualization directly in the browser using WebGL.',
        'Improved AI Agent focus for generating complex 5-axis roughing strategies.',
        'Faster feature identification, processing single-body parts 40% quicker.'
      ]
    },
    {
      date: 'Release 2026-07-14',
      features: [
        '[FEATURE] Search and import tools with Toolsense AI across cut config, and your custom tool libraries.',
        'Improved library search so matching libraries appear above matching individual tools.',
        'Circular countersinks without a matching chamfer tool can now be finished with a ball endmill spiral.'
      ]
    }
  ];

  return (
    <section className="relative z-10 py-24 border-t border-black/10 dark:border-white/5 bg-zinc-50/50 dark:bg-[#05080c]">
      <div className="max-w-4xl mx-auto px-6">
        <AnimatedSection direction="up" duration={0.7}>
          <div className="mb-12">
            <h2 className="text-3xl md:text-4xl font-bold text-zinc-900 dark:text-white tracking-tight">
              Velocity. Constant updates.
            </h2>
            <p className="text-zinc-600 dark:text-gray-400 mt-3 text-lg">
              We ship features faster than traditional CAM software can plan them.
            </p>
          </div>
        </AnimatedSection>

        <div className="space-y-8">
          {releases.map((release, idx) => (
            <AnimatedSection key={idx} delay={idx * 0.15} direction="up" duration={0.6}>
              <article className="p-8 rounded-3xl bg-white dark:bg-[#0d1117] border border-black/10 dark:border-white/10 shadow-sm hover:shadow-md transition-shadow">
                <h3 className="text-lg font-bold text-zinc-900 dark:text-white mb-6 border-b border-black/5 dark:border-white/5 pb-4">
                  {release.date}
                </h3>
                <ul className="space-y-4">
                  {release.features.map((feature, fIdx) => (
                    <li key={fIdx} className="flex gap-4 items-start">
                      <div className="w-1.5 h-1.5 rounded-full bg-blue-500 mt-2 flex-shrink-0" />
                      <p className="text-sm text-zinc-600 dark:text-gray-300 leading-relaxed">
                        {feature.includes('[FEATURE]') ? (
                          <>
                            <span className="inline-block px-1.5 py-0.5 rounded-md bg-blue-500/10 text-blue-500 text-[10px] font-bold tracking-wider mr-2 uppercase">Feature</span>
                            {feature.replace('[FEATURE] ', '')}
                          </>
                        ) : (
                          feature
                        )}
                      </p>
                    </li>
                  ))}
                </ul>
              </article>
            </AnimatedSection>
          ))}
        </div>
        
        <AnimatedSection delay={0.4} direction="up" duration={0.6}>
          <div className="mt-10 text-center">
            <button className="px-6 py-3 rounded-xl bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 text-sm font-semibold text-zinc-900 dark:text-white hover:bg-black/10 dark:hover:bg-white/10 transition-colors">
              View full changelog
            </button>
          </div>
        </AnimatedSection>
      </div>
    </section>
  );
}
