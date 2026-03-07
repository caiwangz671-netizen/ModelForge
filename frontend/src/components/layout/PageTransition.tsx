import { motion } from 'framer-motion';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface PageTransitionProps {
    children: ReactNode;
    className?: string;
}

export function PageTransition({ children, className }: PageTransitionProps) {
    return (
        <motion.div
            initial={{ opacity: 0, y: 18, scale: 0.992, filter: 'blur(10px)' }}
            animate={{ opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' }}
            exit={{ opacity: 0, y: -14, scale: 0.996, filter: 'blur(8px)' }}
            transition={{
                duration: 0.42,
                ease: [0.22, 1, 0.36, 1]
            }}
            className={cn('will-change-transform', className)}
        >
            {children}
        </motion.div>
    );
}
