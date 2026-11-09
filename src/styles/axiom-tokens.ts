/**
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * AXIOM DESIGN SYSTEM - MASTER TOKENS
 * Finance OS for Agencies - Single Source of Truth
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *
 * This file contains ALL design tokens for the AXIOM design system.
 * Reference: OrgDashboard.tsx
 *
 * USAGE:
 * import { AXIOM } from '@/styles/axiom-tokens';
 * style={{ background: AXIOM.backgrounds.main }}
 */

export const AXIOM = {
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 1. BACKGROUNDS
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  backgrounds: {
    // Main app background (pure black)
    main: '#0a0a0a',

    // Chart/Section containers with purple gradient
    chartContainer: 'linear-gradient(135deg, rgba(30, 15, 50, 0.6) 0%, rgba(10, 5, 20, 0.8) 100%)',

    // List/Table containers with dark gradient
    listContainer: 'linear-gradient(135deg, rgba(15, 23, 42, 0.5) 0%, rgba(0, 0, 0, 0.3) 100%)',

    // Inner cards/items (dark transparent)
    innerCard: 'rgba(0, 0, 0, 0.3)',

    // Top bar gradient
    topBar: 'linear-gradient(180deg, rgba(15, 23, 42, 0.95) 0%, rgba(10, 10, 10, 0.9) 100%)',
  },

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 2. TEXT GRADIENTS - BLUE THEME
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  text: {
    // Page titles (white to blue gradient)
    titleGradient: 'linear-gradient(135deg, #ffffff 0%, #3b82f6 100%)',

    // Gradient properties for title
    titleStyle: {
      background: 'linear-gradient(135deg, #ffffff 0%, #3b82f6 100%)',
      WebkitBackgroundClip: 'text',
      WebkitTextFillColor: 'transparent',
    },

    // Text colors
    white: '#ffffff',
    slate400: '#94a3b8',
    slate500: '#64748b',
    slate300: '#cbd5e1',
  },

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 3. BORDERS
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  borders: {
    // Default subtle border
    default: '1px solid rgba(148, 163, 184, 0.1)',

    // Colored borders for chart containers
    purple: '1px solid rgba(168, 85, 247, 0.2)',
    cyan:   '1px solid rgba(6, 182, 212, 0.2)',
    pink:   '1px solid rgba(236, 72, 153, 0.2)',
    green:  '1px solid rgba(16, 185, 129, 0.2)',
    amber:  '1px solid rgba(245, 158, 11, 0.2)',
    blue:   '1px solid rgba(59, 130, 246, 0.2)',
    red:    '1px solid rgba(239, 68, 68, 0.2)',
    orange: '1px solid rgba(249, 115, 22, 0.2)',

    // Top bar border
    topBar: '1px solid rgba(148, 163, 184, 0.1)',
  },

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 4. BOX SHADOWS
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  shadows: {
    // Default shadow
    default: '0 20px 60px -20px rgba(0, 0, 0, 0.8)',

    // Colored shadows for chart containers
    purple: '0 20px 60px -20px rgba(168, 85, 247, 0.5)',
    cyan:   '0 20px 60px -20px rgba(6, 182, 212, 0.5)',
    pink:   '0 20px 60px -20px rgba(236, 72, 153, 0.5)',
    green:  '0 20px 60px -20px rgba(16, 185, 129, 0.5)',
    amber:  '0 20px 60px -20px rgba(245, 158, 11, 0.5)',
    blue:   '0 20px 60px -20px rgba(59, 130, 246, 0.5)',
    red:    '0 20px 60px -20px rgba(239, 68, 68, 0.5)',
    orange: '0 20px 60px -20px rgba(249, 115, 22, 0.5)',

    // Icon box shadows (stronger glow)
    iconPurple: '0 10px 30px -10px rgba(168, 85, 247, 0.6)',
    iconCyan:   '0 10px 30px -10px rgba(6, 182, 212, 0.6)',
    iconPink:   '0 10px 30px -10px rgba(236, 72, 153, 0.6)',
    iconGreen:  '0 10px 30px -10px rgba(16, 185, 129, 0.6)',
    iconAmber:  '0 10px 30px -10px rgba(245, 158, 11, 0.6)',
    iconBlue:   '0 10px 30px -10px rgba(59, 130, 246, 0.6)',
    iconRed:    '0 10px 30px -10px rgba(239, 68, 68, 0.6)',
    iconOrange: '0 10px 30px -10px rgba(249, 115, 22, 0.6)',
  },

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 5. RADIAL OVERLAYS (for chart containers)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  radialOverlays: {
    purple: 'radial-gradient(circle at 50% 50%, rgba(139, 92, 246, 0.3), transparent 70%)',
    cyan:   'radial-gradient(circle at 50% 50%, rgba(6, 182, 212, 0.3), transparent 70%)',
    pink:   'radial-gradient(circle at 50% 50%, rgba(236, 72, 153, 0.3), transparent 70%)',
    green:  'radial-gradient(circle at 50% 50%, rgba(16, 185, 129, 0.3), transparent 70%)',
    amber:  'radial-gradient(circle at 50% 50%, rgba(245, 158, 11, 0.3), transparent 70%)',
    blue:   'radial-gradient(circle at 50% 50%, rgba(59, 130, 246, 0.3), transparent 70%)',
    red:    'radial-gradient(circle at 50% 50%, rgba(239, 68, 68, 0.3), transparent 70%)',
  },

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 6. ICON BOX GRADIENTS
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  iconBoxes: {
    purple: 'linear-gradient(to bottom right, rgb(168, 85, 247), rgb(236, 72, 153))',
    cyan:   'linear-gradient(to bottom right, rgb(6, 182, 212), rgb(59, 130, 246))',
    pink:   'linear-gradient(to bottom right, rgb(236, 72, 153), rgb(244, 63, 94))',
    green:  'linear-gradient(to bottom right, rgb(16, 185, 129), rgb(5, 150, 105))',
    amber:  'linear-gradient(to bottom right, rgb(245, 158, 11), rgb(249, 115, 22))',
    blue:   'linear-gradient(to bottom right, rgb(59, 130, 246), rgb(37, 99, 235))',
    red:    'linear-gradient(to bottom right, rgb(239, 68, 68), rgb(220, 38, 38))',
    orange: 'linear-gradient(to bottom right, rgb(249, 115, 22), rgb(234, 88, 12))',
  },

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 7. CHART STYLING
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  charts: {
    grid: {
      stroke: 'rgba(148, 163, 184, 0.08)',
      strokeDasharray: '3 3',
      vertical: false,
    },
    axis: {
      stroke: 'rgba(148, 163, 184, 0.5)',
      tickLine: false,
      axisLine: false,
      fontSize: '12px',
      fontWeight: 500,
    },
    tooltip: {
      backgroundColor: 'rgba(15, 23, 42, 0.98)',
      border: '1px solid rgba(168, 85, 247, 0.3)',
      backdropFilter: 'blur(20px)',
      borderRadius: '12px',
      padding: '12px 16px',
      boxShadow: '0 10px 30px rgba(0, 0, 0, 0.2)',
      labelColor: '#e2e8f0',
      itemColor: '#94a3b8',
    },
    colors: {
      purple: '#a855f7',
      cyan:   '#06b6d4',
      pink:   '#ec4899',
      green:  '#10b981',
      amber:  '#f59e0b',
      blue:   '#3b82f6',
      red:    '#ef4444',
    },
  },

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 8. BUTTON GRADIENTS
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  buttons: {
    primary: {
      background: 'rgba(168, 85, 247, 0.3)',
      border: '1px solid rgba(168, 85, 247, 0.5)',
      color: '#ffffff',
    },
    secondary: {
      background: 'rgba(0, 0, 0, 0.2)',
      border: 'none',
      color: 'rgba(148, 163, 184, 0.7)',
    },
    action: {
      background: 'linear-gradient(135deg, rgba(6, 182, 212, 0.4), rgba(59, 130, 246, 0.4))',
      border: '1px solid rgba(6, 182, 212, 0.5)',
      boxShadow: '0 10px 30px -10px rgba(6, 182, 212, 0.6)',
      color: '#ffffff',
    },
    success: {
      background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.3), rgba(5, 150, 105, 0.3))',
      border: '1px solid rgba(16, 185, 129, 0.5)',
      color: '#ffffff',
    },
    danger: {
      background: 'linear-gradient(135deg, rgba(239, 68, 68, 0.3), rgba(220, 38, 38, 0.3))',
      border: '1px solid rgba(239, 68, 68, 0.5)',
      color: '#ffffff',
    },
    info: {
      background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.3), rgba(37, 99, 235, 0.3))',
      border: '1px solid rgba(59, 130, 246, 0.5)',
      color: '#ffffff',
    },
    warning: {
      background: 'linear-gradient(135deg, rgba(245, 158, 11, 0.3), rgba(249, 115, 22, 0.3))',
      border: '1px solid rgba(245, 158, 11, 0.5)',
      color: '#ffffff',
    },
    outline: {
      background: 'rgba(0, 0, 0, 0.3)',
      border: '1px solid rgba(148, 163, 184, 0.1)',
      color: 'rgba(148, 163, 184, 0.7)',
    },
  },

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 9. BADGE COLORS
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  badges: {
    success: {
      background: 'rgba(16, 185, 129, 0.1)',
      border: '1px solid rgba(16, 185, 129, 0.3)',
      color: 'rgb(52, 211, 153)',
    },
    danger: {
      background: 'rgba(239, 68, 68, 0.1)',
      border: '1px solid rgba(239, 68, 68, 0.3)',
      color: 'rgb(248, 113, 113)',
    },
    warning: {
      background: 'rgba(245, 158, 11, 0.1)',
      border: '1px solid rgba(245, 158, 11, 0.3)',
      color: 'rgb(251, 191, 36)',
    },
    info: {
      background: 'rgba(59, 130, 246, 0.1)',
      border: '1px solid rgba(59, 130, 246, 0.3)',
      color: 'rgb(96, 165, 250)',
    },
    purple: {
      background: 'rgba(168, 85, 247, 0.1)',
      border: '1px solid rgba(168, 85, 247, 0.3)',
      color: 'rgb(192, 132, 252)',
    },
    cyan: {
      background: 'rgba(6, 182, 212, 0.1)',
      border: '1px solid rgba(6, 182, 212, 0.3)',
      color: 'rgb(34, 211, 238)',
    },
    neutral: {
      background: 'rgba(148, 163, 184, 0.1)',
      border: '1px solid rgba(148, 163, 184, 0.2)',
      color: 'rgb(148, 163, 184)',
    },
  },

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 10. INPUT FIELDS
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  inputs: {
    background: 'rgba(0, 0, 0, 0.3)',
    border: '1px solid rgba(148, 163, 184, 0.1)',
    color: '#ffffff',
    placeholder: '#64748b',
    focus: {
      border: '1px solid rgba(168, 85, 247, 0.5)',
      boxShadow: '0 0 0 3px rgba(168, 85, 247, 0.1)',
    },
  },

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 11. CONTAINER PRESETS (Complete containers)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  containers: {
    chartPurple: {
      background: 'linear-gradient(135deg, rgba(30, 15, 50, 0.6) 0%, rgba(10, 5, 20, 0.8) 100%)',
      border: '1px solid rgba(168, 85, 247, 0.2)',
      boxShadow: '0 20px 60px -20px rgba(168, 85, 247, 0.5)',
    },
    chartCyan: {
      background: 'linear-gradient(135deg, rgba(30, 15, 50, 0.6) 0%, rgba(10, 5, 20, 0.8) 100%)',
      border: '1px solid rgba(6, 182, 212, 0.2)',
      boxShadow: '0 20px 60px -20px rgba(6, 182, 212, 0.5)',
    },
    chartPink: {
      background: 'linear-gradient(135deg, rgba(30, 15, 50, 0.6) 0%, rgba(10, 5, 20, 0.8) 100%)',
      border: '1px solid rgba(236, 72, 153, 0.2)',
      boxShadow: '0 20px 60px -20px rgba(236, 72, 153, 0.5)',
    },
    chartGreen: {
      background: 'linear-gradient(135deg, rgba(30, 15, 50, 0.6) 0%, rgba(10, 5, 20, 0.8) 100%)',
      border: '1px solid rgba(16, 185, 129, 0.2)',
      boxShadow: '0 20px 60px -20px rgba(16, 185, 129, 0.5)',
    },
    chartAmber: {
      background: 'linear-gradient(135deg, rgba(30, 15, 50, 0.6) 0%, rgba(10, 5, 20, 0.8) 100%)',
      border: '1px solid rgba(245, 158, 11, 0.2)',
      boxShadow: '0 20px 60px -20px rgba(245, 158, 11, 0.5)',
    },
    chartBlue: {
      background: 'linear-gradient(135deg, rgba(30, 15, 50, 0.6) 0%, rgba(10, 5, 20, 0.8) 100%)',
      border: '1px solid rgba(59, 130, 246, 0.2)',
      boxShadow: '0 20px 60px -20px rgba(59, 130, 246, 0.5)',
    },
    chartRed: {
      background: 'linear-gradient(135deg, rgba(30, 15, 50, 0.6) 0%, rgba(10, 5, 20, 0.8) 100%)',
      border: '1px solid rgba(239, 68, 68, 0.2)',
      boxShadow: '0 20px 60px -20px rgba(239, 68, 68, 0.5)',
    },
    list: {
      background: 'linear-gradient(135deg, rgba(15, 23, 42, 0.5) 0%, rgba(0, 0, 0, 0.3) 100%)',
      border: '1px solid rgba(148, 163, 184, 0.1)',
      boxShadow: '0 20px 60px -20px rgba(0, 0, 0, 0.8)',
    },
    item: {
      background: 'rgba(0, 0, 0, 0.3)',
      border: '1px solid rgba(148, 163, 184, 0.1)',
    },
    modal: {
      background: 'linear-gradient(135deg, rgba(20, 24, 39, 0.98) 0%, rgba(10, 12, 22, 0.99) 100%)',
      border: '1px solid rgba(148, 163, 184, 0.2)',
      boxShadow: '0 25px 70px -15px rgba(0, 0, 0, 0.9)',
    },
  },

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 12. TYPOGRAPHY & LAYOUT (Tailwind class strings — use with cn())
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  typography: {
    pageTitle: 'text-2xl sm:text-3xl lg:text-4xl font-bold tracking-tight mb-1 sm:mb-2',
    sectionTitle: 'text-base sm:text-lg font-semibold text-white',
    bodyMuted: 'text-sm text-slate-400',
    monoMuted: 'text-xs text-slate-400 font-mono',
    monoLabel: 'text-[10px] uppercase tracking-wider text-slate-400 font-mono',
  },

  layout: {
    /** Standard page padding + min height */
    page: 'p-4 sm:p-6 lg:p-8 min-h-full',
    /** Vertical rhythm between major sections */
    pageStack: 'space-y-6 sm:space-y-8',
    /** Header row: stack on small screens */
    headerRow: 'flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between',
  },

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 13. ANIMATION PRESETS
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  animations: {
    fadeInTop: {
      initial: { opacity: 0, y: -20 },
      animate: { opacity: 1, y: 0 },
    },
    fadeInBottom: {
      initial: { opacity: 0, y: 30 },
      animate: { opacity: 1, y: 0 },
    },
    fadeInLeft: {
      initial: { opacity: 0, x: -20 },
      animate: { opacity: 1, x: 0 },
    },
    fadeInRight: {
      initial: { opacity: 0, x: 20 },
      animate: { opacity: 1, x: 0 },
    },
    scale: {
      initial: { opacity: 0, scale: 0.9 },
      animate: { opacity: 1, scale: 1 },
    },
    hoverScale: {
      whileHover: { scale: 1.05 },
      whileTap:   { scale: 0.95 },
    },
    hoverScaleSmall: {
      whileHover: { scale: 1.02 },
      whileTap:   { scale: 0.98 },
    },
  },
} as const;

/**
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * HELPER FUNCTIONS
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 */

/** Get chart container style by color */
export function getChartContainer(color: 'purple' | 'cyan' | 'pink' | 'green' | 'amber' | 'blue' | 'red') {
  return {
    background: AXIOM.backgrounds.chartContainer,
    border:     AXIOM.borders[color],
    boxShadow:  AXIOM.shadows[color],
  };
}

/** Get icon box style by color */
export function getIconBox(color: 'purple' | 'cyan' | 'pink' | 'green' | 'amber' | 'blue' | 'red' | 'orange') {
  return {
    background: AXIOM.iconBoxes[color],
    boxShadow:  AXIOM.shadows[`icon${color.charAt(0).toUpperCase() + color.slice(1)}` as keyof typeof AXIOM.shadows],
  };
}

/** Get radial overlay style by color */
export function getRadialOverlay(color: 'purple' | 'cyan' | 'pink' | 'green' | 'amber' | 'blue' | 'red') {
  return {
    background: AXIOM.radialOverlays[color],
    opacity: 0.4,
  };
}

/** Get button style by variant */
export function getButton(variant: 'primary' | 'secondary' | 'success' | 'danger' | 'info' | 'warning' | 'outline') {
  return AXIOM.buttons[variant];
}

/** Get badge style by variant */
export function getBadge(variant: 'success' | 'danger' | 'warning' | 'info' | 'purple' | 'cyan') {
  return AXIOM.badges[variant];
}

/**
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * TYPE EXPORTS
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 */

export type ColorVariant  = 'purple' | 'cyan' | 'pink' | 'green' | 'amber' | 'blue' | 'red' | 'orange';
export type ButtonVariant = 'primary' | 'secondary' | 'success' | 'danger' | 'info' | 'warning' | 'outline';
export type BadgeVariant  = 'success' | 'danger' | 'warning' | 'info' | 'purple' | 'cyan';
