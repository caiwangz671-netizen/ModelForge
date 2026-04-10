import { motion, useReducedMotion } from 'framer-motion';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface PageTransitionProps {
    children: ReactNode;
    className?: string;
}

export function PageTransition({ children, className }: PageTransitionProps) {
    const prefersReducedMotion = useReducedMotion();

    return (
        <motion.div
            initial={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, x: 18, scale: 0.998 }}
            animate={prefersReducedMotion ? { opacity: 1 } : { opacity: 1, x: 0, scale: 1 }}
            exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, x: -12, scale: 0.998 }}
            transition={{
                duration: prefersReducedMotion ? 0.16 : 0.24,
                ease: [0.22, 1, 0.36, 1]
            }}
            className={cn('will-change-transform h-full', className)}
        >
            {children}
        </motion.div>
    );
}
