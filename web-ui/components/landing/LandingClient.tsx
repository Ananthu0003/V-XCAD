'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { useState, useEffect, useRef } from 'react';
import { FileImage, Cpu, Sliders, Box, Activity } from 'lucide-react';

const PROMPTS = [
  { text: 'Generate a mounting bracket with 4 bolt holes, 80mm × 60mm base, 3mm wall thickness', tag: 'Mechanical Part' },
  { text: 'Create a gear with 24 teeth, module 2, 20° pressure angle and 10mm hub bore', tag: 'Gear Design' },
  { text: 'Design an enclosure box 120×80×40mm with snap-fit lid and cable channel cutouts', tag: 'Enclosure' },
  { text: 'Build a pipe flange DN50, PN16 rated with 4 bolt holes on 125mm PCD', tag: 'Flange' },
  { text: 'Create a phone stand with 15° tilt, cable cutout at base, and rubber pad slots', tag: 'Consumer' },
  { text: 'Design a hex standoff M3, 25mm length with 5mm hex width across flats', tag: 'Fastener' },
];

const TIMELINE_ITEMS = [
  { icon: FileImage, label: 'Image uploaded', detail: 'bracket_sketch.pdf', color: 'blue', time: '0.0s' },
  { icon: Cpu,       label: 'AI analyzing…', detail: 'Gemini 2.5 Flash',  color: 'cyan', time: '1.2s' },
  { icon: Cpu,       label: 'Script streamed', detail: '247 tokens / 84 lines', color: 'violet', time: '4.8s' },
  { icon: Sliders,   label: 'Parameters parsed', detail: '12 editable values',  color: 'amber', time: '4.9s' },
  { icon: Box,       label: 'Model rendered',  detail: 'ai-engine → Three.js', color: 'emerald', time: '6.1s' },
  { icon: Activity,  label: 'Toolpaths generated', detail: 'CNC G-code ready', color: 'blue', time: '6.8s' },
];

const COLOR_MAP: Record<string, { bg: string; border: string; text: string; dot: string }> = {
  blue:    { bg: 'bg-blue-500/10',    border: 'border-blue-500/25',    text: 'text-blue-400',    dot: 'bg-blue-500' },
  cyan:    { bg: 'bg-cyan-500/10',    border: 'border-cyan-500/25',    text: 'text-cyan-400',    dot: 'bg-cyan-500' },
  violet:  { bg: 'bg-violet-500/10',  border: 'border-violet-500/25',  text: 'text-violet-400',  dot: 'bg-violet-500' },
  amber:   { bg: 'bg-amber-500/10',   border: 'border-amber-500/25',   text: 'text-amber-400',   dot: 'bg-amber-500' },
  emerald: { bg: 'bg-emerald-500/10', border: 'border-emerald-500/25', text: 'text-emerald-400', dot: 'bg-emerald-500' },
};

const STAGGER_DELAY = 350;  // Fired quickly like a real automated server trace
const INITIAL_DELAY = 150;  // Quick drop-in for the first item
const HOLD_DURATION = 2000; // 2 seconds to look at the complete "Manufacture Ready" state
const TOTAL_STEPS = TIMELINE_ITEMS.length + 1; 

const TOTAL_CYCLE_TIME = INITIAL_DELAY + (TOTAL_STEPS * STAGGER_DELAY) + HOLD_DURATION;

function TypewriterText({ text, speed = 18 }: { text: string; speed?: number }) {
  const [displayed, setDisplayed] = useState('');
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    setDisplayed('');
    setIdx(0);
  }, [text]);

  useEffect(() => {
    if (idx >= text.length) return;
    const t = setTimeout(() => {
      setDisplayed(text.slice(0, idx + 1));
      setIdx(i => i + 1);
    }, speed);
    return () => clearTimeout(t);
  }, [idx, text, speed]);

  return (
    <span>
      {displayed}
      {idx < text.length && (
        <span className="inline-block w-0.5 h-4 bg-blue-400 ml-0.5 animate-pulse rounded-sm" />
      )}
    </span>
  );
}

export function LandingClient() {
  const [activePrompt, setActivePrompt] = useState(0);
  const [activeStep, setActiveStep] = useState(0);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setInterval(() => {
      setActivePrompt(p => (p + 1) % PROMPTS.length);
    }, TOTAL_CYCLE_TIME);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    setActiveStep(0);
    const timers: ReturnType<typeof setTimeout>[] = [];
    
    TIMELINE_ITEMS.forEach((_, i) => {
      timers.push(
        setTimeout(() => setActiveStep(i + 1), i * STAGGER_DELAY + INITIAL_DELAY)
      );
    });

    timers.push(
      setTimeout(() => setActiveStep(TOTAL_STEPS), TIMELINE_ITEMS.length * STAGGER_DELAY + INITIAL_DELAY)
    );
    
    return () => timers.forEach(clearTimeout);
  }, [activePrompt]);

  // Smooth scroll down to container base when a new trace appends
  useEffect(() => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTo({
        top: scrollContainerRef.current.scrollHeight,
        behavior: 'smooth'
      });
    }
  }, [activeStep]);

  const prompt = PROMPTS[activePrompt];
  const isDone = activeStep === TOTAL_STEPS;

  return (
    <section className="relative z-10 py-20 border-t border-black/10 dark:border-white/5">
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-blue-950/10 to-transparent pointer-events-none" />

      <div className="max-w-6xl mx-auto px-6 relative">
        {/* Heading */}
        <motion.div
          className="text-center mb-12"
          initial={{ opacity: 0, y: 32 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.2 }}
          transition={{ type: 'spring', stiffness: 60, damping: 18 }}
        >
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-semibold tracking-wide mb-4 uppercase shadow-[0_0_15px_rgba(16,185,129,0.1)]">
            See It Live
          </div>
          <h2 className="text-3xl md:text-5xl font-bold text-zinc-900 dark:text-white mb-4 tracking-tight">
            Watch VΞXCAD Work<br/>
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 via-cyan-400 to-blue-500">in Real Time</span>
          </h2>
          <p className="text-zinc-600 dark:text-gray-400 max-w-xl mx-auto text-base">
            Every prompt triggers a full AI pipeline — from language to 3D geometry.
          </p>
        </motion.div>

        {/* Dynamic Dual-Terminal Grid Layout */}
        <div className="grid lg:grid-cols-2 gap-8 items-stretch">

          {/* Left Container */}
          <motion.div
            initial={{ opacity: 0, x: -32 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true, amount: 0.2 }}
            transition={{ type: 'spring', stiffness: 55, damping: 16, delay: 0.1 }}
            className="h-[380px] flex flex-col rounded-3xl border border-white/10 bg-[#080c10]/80 backdrop-blur-xl overflow-hidden shadow-[0_20px_60px_rgba(0,0,0,0.6),inset_0_1px_0_rgba(255,255,255,0.05)] relative"
          >
            <div className="absolute inset-0 bg-gradient-to-b from-blue-500/5 to-transparent pointer-events-none" />
            
            <div className="relative flex items-center px-5 py-4 border-b border-white/10 bg-black/5 dark:bg-white/[0.02] flex-shrink-0">
              <div className="flex gap-2">
                <div className="w-3 h-3 rounded-full bg-red-500/80 shadow-[0_0_10px_rgba(239,68,68,0.2)]" />
                <div className="w-3 h-3 rounded-full bg-yellow-500/80 shadow-[0_0_10px_rgba(234,179,8,0.2)]" />
                <div className="w-3 h-3 rounded-full bg-green-500/80 shadow-[0_0_10px_rgba(34,197,94,0.2)]" />
              </div>
              <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-2 px-3 py-1 rounded-md bg-white/5 border border-white/10">
                 <span className="text-[10px] font-mono text-gray-400">cadvex-prompt.exe</span>
              </div>
            </div>

            <div className="p-6 flex flex-col justify-between flex-1 min-h-0 space-y-4">
              <div className="flex flex-wrap gap-2 overflow-y-auto max-h-[75px] no-scrollbar">
                {PROMPTS.map((p, i) => (
                  <button
                    key={i}
                    onClick={() => setActivePrompt(i)}
                    className={`px-3 py-1.5 rounded-xl text-[11px] font-semibold tracking-wide transition-all duration-300 ${
                      i === activePrompt
                        ? 'bg-blue-500/20 border border-blue-500/50 text-blue-300 shadow-[0_0_15px_rgba(59,130,246,0.15)]'
                        : 'bg-white/5 border border-white/10 text-gray-500 hover:text-gray-300 hover:bg-white/10'
                    }`}
                  >
                    {p.tag}
                  </button>
                ))}
              </div>

              <div className="flex-1 rounded-2xl bg-[#040608] border border-white/10 p-5 shadow-[inset_0_4px_20px_rgba(0,0,0,0.25)] overflow-y-auto">
                <div className="flex items-start gap-3">
                  <span className="text-blue-500 font-mono text-sm mt-0.5 flex-shrink-0">❯</span>
                  <div className="font-mono text-sm text-gray-300 leading-relaxed">
                    <AnimatePresence mode="wait">
                      <motion.span
                        key={activePrompt}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.18 }}
                      >
                        <TypewriterText text={prompt.text} speed={18} />
                      </motion.span>
                    </AnimatePresence>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-3 flex-shrink-0">
                <span className="text-[10px] text-gray-500 font-mono tracking-wider uppercase">Next example</span>
                <div className="flex-1 h-1 bg-white/5 rounded-full overflow-hidden">
                  <motion.div
                    key={activePrompt}
                    className="h-full bg-gradient-to-r from-blue-500 via-cyan-400 to-emerald-400 rounded-full"
                    initial={{ width: '0%' }}
                    animate={{ width: '100%' }}
                    transition={{ duration: TOTAL_CYCLE_TIME / 1000, ease: 'linear' }}
                  />
                </div>
                <span className="text-[10px] text-gray-500 font-mono">
                  {(TOTAL_CYCLE_TIME / 1000).toFixed(1)}s
                </span>
              </div>
            </div>
          </motion.div>

          {/* Right Container (Scrolling Pipeline Logger) */}
          <motion.div
            initial={{ opacity: 0, x: 32 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true, amount: 0.2 }}
            transition={{ type: 'spring', stiffness: 55, damping: 16, delay: 0.2 }}
            className="h-[380px] flex flex-col rounded-3xl border border-white/10 bg-[#080c10]/80 backdrop-blur-xl overflow-hidden shadow-[0_20px_60px_rgba(0,0,0,0.6),inset_0_1px_0_rgba(255,255,255,0.05)] relative"
          >
            <div className="absolute inset-0 bg-gradient-to-b from-emerald-500/5 to-transparent pointer-events-none" />

            <div className="relative flex items-center justify-between px-5 py-4 border-b border-white/10 bg-black/5 dark:bg-white/[0.02] flex-shrink-0">
              <span className="text-[10px] font-mono text-gray-400 uppercase tracking-wide">Pipeline Execution</span>
              <div className="flex items-center gap-2 px-2.5 py-1 rounded-md bg-emerald-500/10 border border-emerald-500/20">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
                </span>
                <span className="text-[9px] font-mono font-bold tracking-wide text-emerald-400 uppercase">Live Trace</span>
              </div>
            </div>

            {/* Scrollable List Frame */}
            <div 
              ref={scrollContainerRef}
              className="p-6 flex-1 overflow-y-auto space-y-3 scroll-smooth no-scrollbar"
            >
              <AnimatePresence>
                {TIMELINE_ITEMS.map((item, i) => {
                  const c = COLOR_MAP[item.color];
                  const Icon = item.icon;
                  const visible = activeStep > i;
                  const isActive = activeStep === i + 1;

                  if (!visible) return null;

                  return (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0, y: 20, scale: 0.98 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, transition: { duration: 0.15 } }}
                      transition={{ type: 'spring', stiffness: 120, damping: 14 }}
                      className={`flex items-center gap-4 p-3 rounded-xl border transition-all duration-300 ${
                        isActive
                          ? `${c.bg} ${c.border} shadow-[0_0_20px_rgba(59,130,246,0.025)]`
                          : 'bg-white/[0.01] border-white/5 opacity-60'
                      }`}
                    >
                      <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 border ${
                        isActive ? `${c.bg} ${c.border}` : 'bg-white/5 border-white/10'
                      }`}>
                        <Icon className={`w-4 h-4 ${isActive ? c.text : 'text-gray-500'}`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className={`text-xs font-semibold ${isActive ? c.text : 'text-gray-400'}`}>
                          {item.label}
                        </div>
                        <div className="text-[10px] text-gray-500 font-mono truncate">{item.detail}</div>
                      </div>
                      <div className="text-[10px] font-mono text-gray-600 flex-shrink-0 bg-black/30 px-2 py-0.5 rounded-md">{item.time}</div>
                      {isActive && (
                        <span className="relative flex h-1.5 w-1.5 flex-shrink-0 ml-1">
                          <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${c.dot}`} />
                          <span className={`relative inline-flex rounded-full h-1.5 w-1.5 ${c.dot}`} />
                        </span>
                      )}
                    </motion.div>
                  );
                })}
              </AnimatePresence>

              {/* Success Done Banner Appended Inside Scroll Area */}
              {isDone && (
                <motion.div
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ type: 'spring', stiffness: 100, damping: 12 }}
                  className="p-3.5 rounded-xl bg-gradient-to-r from-emerald-500/10 to-transparent border border-emerald-500/20 flex items-center gap-4 shadow-[0_0_30px_rgba(16,185,129,0.04)]"
                >
                  <div className="w-9 h-9 rounded-lg bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center flex-shrink-0">
                    <Box className="w-4 h-4 text-emerald-400" />
                  </div>
                  <div>
                    <div className="text-xs font-bold text-emerald-400">Manufacture Ready</div>
                    <div className="text-[10px] text-gray-400 font-mono">Artifacts live</div>
                  </div>
                  <div className="ml-auto flex gap-1 flex-shrink-0">
                    {['.STL', '.STEP', '.GCODE'].map(ext => (
                      <div key={ext} className="px-1.5 py-0.5 rounded bg-white/5 border border-white/10 text-[8px] text-zinc-900 dark:text-white font-mono font-bold">
                        {ext}
                      </div>
                    ))}
                  </div>
                </motion.div>
              )}
            </div>
          </motion.div>
        </div>

        {/* Fixed Metrics Stats Bar - Always directly under terminal card layout */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.3 }}
          transition={{ type: 'spring', stiffness: 60, damping: 18, delay: 0.3 }}
          className="mt-8 grid grid-cols-2 md:grid-cols-4 gap-4"
        >
          {[
            { value: '< 6s',      label: 'Avg. generation time', color: 'text-blue-400',   bg: 'from-blue-500/10' },
            { value: 'build123d', label: 'CAD kernel',           color: 'text-cyan-400',   bg: 'from-cyan-500/10' },
            { value: 'SSE',       label: 'Real-time streaming',  color: 'text-violet-400', bg: 'from-violet-500/10' },
            { value: 'CAD + CAM', label: 'STL, STEP, G-Code',    color: 'text-emerald-400',bg: 'from-emerald-500/10' },
          ].map(stat => (
            <div key={stat.label} className="relative p-5 rounded-2xl bg-black/5 dark:bg-white/[0.02] border border-black/10 dark:border-white/10 text-center overflow-hidden group hover:border-black/20 dark:hover:border-white/20 hover:bg-black/10 dark:hover:bg-white/[0.04] transition-all duration-300 flex flex-col justify-center">
              <div className={`absolute inset-0 bg-gradient-to-b ${stat.bg} to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500`} />
              <div className={`relative text-lg lg:text-xl font-black font-mono mb-0.5 tracking-tight ${stat.color}`}>{stat.value}</div>
              <div className="relative text-[10px] lg:text-xs font-semibold text-zinc-500 dark:text-gray-500 tracking-wider uppercase">{stat.label}</div>
            </div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}