import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Tiny helper so components don't each import both clsx + twMerge. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
