// Centralized framer-motion animation presets — CACapp

export const PAGE_TRANSITION = { duration: 0.2, ease: [0.4, 0, 0.2, 1] }

export const pageVariants = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0 },
  exit:    { opacity: 0, y: -6 },
}

export const CARD_TRANSITION = { duration: 0.25, ease: [0.4, 0, 0.2, 1] }

export const cardVariants = {
  initial: { opacity: 0, y: 14, scale: 0.985 },
  animate: { opacity: 1, y: 0,  scale: 1 },
}

export const staggerContainer = {
  animate: { transition: { staggerChildren: 0.055 } },
}

export const FADE_TRANSITION = { duration: 0.15 }

export const fadeVariants = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit:    { opacity: 0 },
}

export const SIDEBAR_SPRING = { type: 'spring', damping: 30, stiffness: 300 }

export const OVERLAY_TRANSITION = { duration: 0.15 }

export const listItemVariants = {
  initial: { opacity: 0, x: -8 },
  animate: { opacity: 1, x: 0 },
}
