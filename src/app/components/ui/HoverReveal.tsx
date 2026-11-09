import { motion } from 'motion/react';
import { ReactNode, useState } from 'react';

interface HoverRevealProps {
  children: ReactNode;
  revealContent: ReactNode;
  className?: string;
  direction?: 'up' | 'down' | 'left' | 'right';
}

export function HoverReveal({
  children,
  revealContent,
  className = '',
  direction = 'up'
}: HoverRevealProps) {
  const [isHovered, setIsHovered] = useState(false);

  const directions = {
    up: { y: [20, 0], origin: 'bottom' },
    down: { y: [-20, 0], origin: 'top' },
    left: { x: [20, 0], origin: 'right' },
    right: { x: [-20, 0], origin: 'left' }
  };

  const animation = directions[direction];

  return (
    <div
      className={`relative overflow-hidden ${className}`}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Base content */}
      <motion.div
        animate={{
          opacity: isHovered ? 0.3 : 1,
          scale: isHovered ? 0.95 : 1,
        }}
        transition={{ duration: 0.3 }}
      >
        {children}
      </motion.div>

      {/* Reveal content */}
      <motion.div
        className="absolute inset-0 flex items-center justify-center"
        initial={{ opacity: 0, ...animation }}
        animate={
          direction === 'up' || direction === 'down'
            ? { opacity: isHovered ? 1 : 0, y: isHovered ? 0 : (animation as { y: number[] }).y[0] }
            : { opacity: isHovered ? 1 : 0, x: isHovered ? 0 : (animation as { x: number[] }).x[0] }
        }
        transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
      >
        {revealContent}
      </motion.div>
    </div>
  );
}
