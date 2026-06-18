'use client';

import { motion } from 'framer-motion';
import { ReactNode } from 'react';

interface AnimatedSectionProps {
  children: ReactNode;
  className?: string;
  delay?: number;
  direction?: 'up' | 'down' | 'left' | 'right' | 'none';
  duration?: number;
  amount?: number;
}

const directionMap = {
  up:    { y: 48, x: 0 },
  down:  { y: -48, x: 0 },
  left:  { y: 0, x: 48 },
  right: { y: 0, x: -48 },
  none:  { y: 0, x: 0 },
};

export function AnimatedSection({
  children,
  className,
  delay = 0,
  direction = 'up',
  duration = 0.7,
  amount = 0.15,
}: AnimatedSectionProps) {
  const offset = directionMap[direction];

  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, ...offset }}
      whileInView={{ opacity: 1, x: 0, y: 0 }}
      viewport={{ once: true, amount }}
      transition={{
        type: 'spring',
        stiffness: 60,
        damping: 18,
        delay,
        duration,
      }}
    >
      {children}
    </motion.div>
  );
}
