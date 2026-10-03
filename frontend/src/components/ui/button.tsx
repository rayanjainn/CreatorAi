import Link from 'next/link'
import { forwardRef, type AnchorHTMLAttributes, type ButtonHTMLAttributes } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

/** Variants map onto the teammate's `.button` CSS classes (see styles/ui.css). */
export const buttonVariants = cva('button', {
  variants: {
    variant: {
      primary: '',
      secondary: 'button-secondary',
      ghost: 'button-ghost',
      danger: 'button-danger',
      light: 'button-light',
    },
    size: { md: '', sm: 'button-sm', lg: 'button-lg' },
    block: { true: 'button-block', false: '' },
  },
  defaultVariants: { variant: 'primary', size: 'md', block: false },
})

type Variants = VariantProps<typeof buttonVariants>

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & Variants & { loading?: boolean }

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, block, loading, disabled, children, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(buttonVariants({ variant, size, block }), className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading && <span className="spinner" aria-hidden />}
      {children}
    </button>
  )
})

export type LinkButtonProps = AnchorHTMLAttributes<HTMLAnchorElement> & Variants & { href: string }

export function LinkButton({ className, variant, size, block, href, ...rest }: LinkButtonProps) {
  return <Link href={href} className={cn(buttonVariants({ variant, size, block }), className)} {...rest} />
}

export function IconButton({
  label,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button type="button" aria-label={label} title={label} className={cn('icon-button', className)} {...rest}>
      {children}
    </button>
  )
}
