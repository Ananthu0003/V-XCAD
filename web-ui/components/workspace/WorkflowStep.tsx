'use client';

import { motion } from 'framer-motion';
import { ReactNode } from 'react';

interface WorkflowStepProps {
  step: number;
  title: string;
  description: string;
  icon: ReactNode;
  delay?: number;
  isLast?: boolean;
  accentColor?: string;
}

export function WorkflowStep({
  step,
  title,
  description,
  icon,
  delay = 0,
  isLast = false,
  accentColor = 'blue',
}: WorkflowStepProps) {
  const colorMap: Record<string, { pill: string; ring: string; icon: string; connector: string }> = {
    blue:  { pill: 'bg-blue-500/15 border-blue-500/30 text-blue-400',   ring: 'ring-blue-500/30',  icon: 'bg-blue-500/20 text-blue-400',  connector: 'from-blue-500/40 to-cyan-500/20' },
    cyan:  { pill: 'bg-cyan-500/15 border-cyan-500/30 text-cyan-400',   ring: 'ring-cyan-500/30',  icon: 'bg-cyan-500/20 text-cyan-400',  connector: 'from-cyan-500/40 to-violet-500/20' },
    violet:{ pill: 'bg-violet-500/15 border-violet-500/30 text-violet-400', ring: 'ring-violet-500/30', icon: 'bg-violet-500/20 text-violet-400', connector: 'from-violet-500/40 to-emerald-500/20' },
    emerald:{ pill: 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400', ring: 'ring-emerald-500/30', icon: 'bg-emerald-500/20 text-emerald-400', connector: 'from-emerald-500/40 to-blue-500/20' },
  };
  const c = colorMap[accentColor] ?? colorMap.blue;

  return (
    <motion.div
      className="relative flex flex-col items-center"
      initial={{ opacity: 0, y: 40 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.2 }}
      transition={{ type: 'spring', stiffness: 55, damping: 16, delay }}
    >
      {/* Step pill */}
      <div className={`inline-flex items-center justify-center w-9 h-9 rounded-full border text-sm font-bold font-mono ring-4 ${c.pill} ${c.ring} mb-4 z-10`}>
        {String(step).padStart(2, '0')}
      </div>

      {/* Connector line */}
      {!isLast && (
        <div className={`absolute top-9 left-1/2 -translate-x-1/2 w-0.5 h-full bg-gradient-to-b ${c.connector} opacity-50 z-0`} />
      )}

      {/* Card */}
      <motion.div
        className="relative z-10 w-full p-6 rounded-2xl border border-white/5 bg-white/3 backdrop-blur-sm hover:border-white/15 hover:bg-white/5 transition-all duration-300 group"
        whileHover={{ y: -4 }}
        transition={{ type: 'spring', stiffness: 200, damping: 20 }}
      >
        <div className={`w-11 h-11 rounded-xl flex items-center justify-center mb-4 ${c.icon} group-hover:scale-110 transition-transform duration-300`}>
          {icon}
        </div>
        <h3 className="text-white font-semibold text-lg mb-2">{title}</h3>
        <p className="text-gray-400 text-sm leading-relaxed">{description}</p>
      </motion.div>
    </motion.div>
  );
}
