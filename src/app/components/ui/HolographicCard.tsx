import { motion, useMotionValue, useSpring, useTransform } from 'motion/react';
import { ReactNode, useRef, MouseEvent } from 'react';

interface HolographicCardProps {
  children: ReactNode;
  className?: string;
  style?: React.CSSProperties;
  glowColor?: string;
  intensity?: 'low' | 'medium' | 'high';
  enableTilt?: boolean;
}

export function HolographicCard({ 
  children, 
  className = '', 
  glowColor = '#2dd4ff',
  intensity = 'medium',
  enableTilt = true
}: HolographicCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  
  // Mouse position tracking
  const mouseX = useMotionValue(0);
  const mouseY = useMotionValue(0);
  
  // Smooth spring animations for tilt
  const rotateX = useSpring(useTransform(mouseY, [-0.5, 0.5], [5, -5]), { damping: 20, stiffness: 300 });
  const rotateY = useSpring(useTransform(mouseX, [-0.5, 0.5], [-5, 5]), { damping: 20, stiffness: 300 });
  
  // Glow position
  const glowX = useSpring(useTransform(mouseX, [-0.5, 0.5], [0, 100]), { damping: 20, stiffness: 300 });
  const glowY = useSpring(useTransform(mouseY, [-0.5, 0.5], [0, 100]), { damping: 20, stiffness: 300 });
  
  const handleMouseMove = (e: MouseEvent<HTMLDivElement>) => {
    if (!cardRef.current || !enableTilt) return;
    
    const rect = cardRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width - 0.5;
    const y = (e.clientY - rect.top) / rect.height - 0.5;
    
    mouseX.set(x);
    mouseY.set(y);
  };
  
  const handleMouseLeave = () => {
    mouseX.set(0);
    mouseY.set(0);
  };
  
  const intensityMap = {
    low: { blur: 40, opacity: 0.3, scale: 0.8 },
    medium: { blur: 60, opacity: 0.5, scale: 1 },
    high: { blur: 80, opacity: 0.7, scale: 1.2 }
  };
  
  const settings = intensityMap[intensity];
  
  return (
    <motion.div
      ref={cardRef}
      className={`relative overflow-hidden ${className}`}
      style={{
        rotateX: enableTilt ? rotateX : 0,
        rotateY: enableTilt ? rotateY : 0,
        transformStyle: 'preserve-3d',
      }}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      whileHover={{ scale: 1.02 }}
      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
    >
      {/* Holographic glow effect */}
      <motion.div
        className="absolute pointer-events-none"
        style={{
          width: '300px',
          height: '300px',
          left: glowX,
          top: glowY,
          x: '-50%',
          y: '-50%',
          background: `radial-gradient(circle, ${glowColor}${Math.round(settings.opacity * 255).toString(16).padStart(2, '0')}, transparent 70%)`,
          filter: `blur(${settings.blur}px)`,
          scale: settings.scale,
        }}
      />
      
      {/* Scanline effect */}
      <div 
        className="absolute inset-0 pointer-events-none opacity-5"
        style={{
          backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(255, 255, 255, 0.03) 2px, rgba(255, 255, 255, 0.03) 4px)',
        }}
      />
      
      {/* Glass border with shimmer */}
      <div 
        className="absolute inset-0 pointer-events-none rounded-[inherit]"
        style={{
          background: `linear-gradient(135deg, 
            rgba(255, 255, 255, 0.1) 0%, 
            rgba(255, 255, 255, 0.05) 50%, 
            rgba(255, 255, 255, 0.1) 100%
          )`,
          padding: '1px',
          mask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
          maskComposite: 'exclude',
          WebkitMask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
          WebkitMaskComposite: 'xor',
        }}
      />
      
      {/* Content */}
      <div className="relative z-10">
        {children}
      </div>
    </motion.div>
  );
}
