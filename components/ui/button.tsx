import type { ButtonHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

type ButtonVariant = 'primary' | 'secondary' | 'danger'

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
}

const variantClassMap: Record<ButtonVariant, string> = {
  primary:
    'bg-brand-600 hover:bg-brand-500 text-white disabled:bg-brand-400 disabled:text-white/90',
  secondary:
    'bg-slate-800 hover:bg-slate-700 text-white disabled:bg-slate-700 disabled:text-slate-300',
  danger: 'bg-rose-600 hover:bg-rose-500 text-white disabled:bg-rose-400 disabled:text-white/80',
}

export const Button = ({ className, variant = 'primary', ...props }: Props) => {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center rounded-xl px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed',
        variantClassMap[variant],
        className,
      )}
      {...props}
    />
  )
}
