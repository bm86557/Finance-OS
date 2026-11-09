import { motion } from 'motion/react';

interface QuantumLoaderProps {
  size?: number;
  colors?: string[];
}

export function QuantumLoader({
  size = 80,
  colors = ['#2dd4ff', '#a855f7', '#ec4899']
}: QuantumLoaderProps) {
  return (
    <div className="flex items-center justify-center" style={{ width: size, height: size }}>
      <div className="relative" style={{ width: size, height: size }}>
        {/* Orbiting particles */}
        {colors.map((color, index) => (
          <motion.div
            key={index}
            className="absolute rounded-full"
            style={{
              width: size / 6,
              height: size / 6,
              background: `radial-gradient(circle, ${color}, ${color}80)`,
              boxShadow: `0 0 20px ${color}80`,
              left: '50%',
              top: '50%',
              marginLeft: -size / 12,
              marginTop: -size / 12,
              transformOrigin: `${size / 3}px 0px`,
            }}
            animate={{
              rotate: 360,
            }}
            transition={{
              duration: 3,
              repeat: Infinity,
              ease: 'linear',
              delay: index * 0.4,
            }}
          />
        ))}

        {/* Center core */}
        <motion.div
          className="absolute inset-0 m-auto rounded-full"
          style={{
            width: size / 4,
            height: size / 4,
            background: 'linear-gradient(135deg, #2dd4ff, #a855f7, #ec4899)',
            boxShadow: '0 0 30px rgba(45, 212, 255, 0.6)',
          }}
          animate={{
            scale: [1, 1.2, 1],
            rotate: [0, 180, 360],
          }}
          transition={{
            duration: 4,
            repeat: Infinity,
            ease: 'easeInOut',
          }}
        />

        {/* Energy rings */}
        {[0, 1].map((index) => (
          <motion.div
            key={`ring-${index}`}
            className="absolute inset-0 rounded-full"
            style={{
              border: '2px solid rgba(45, 212, 255, 0.3)',
            }}
            animate={{
              scale: [1, 1.5],
              opacity: [0.6, 0],
            }}
            transition={{
              duration: 2,
              repeat: Infinity,
              ease: 'easeOut',
              delay: index * 1,
            }}
          />
        ))}
      </div>
    </div>
  );
}
