import { Link, type LinkProps } from 'react-router-dom'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cn } from '@/utils/cn'
import { Icon, type IconName } from './Icon'
import { Spinner } from './Spinner'

export type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'accent'
  | 'outline'
  | 'ghost'
  | 'danger'
  | 'inverse'

export type ButtonSize = 'sm' | 'md' | 'lg'

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'btn--primary',
  secondary: 'btn--secondary',
  accent: 'btn--accent',
  outline: 'btn--outline',
  ghost: 'btn--ghost',
  danger: 'btn--danger',
  inverse: 'btn--inverse',
}

const SIZES: Record<ButtonSize, string> = {
  sm: 'btn--sm',
  md: 'btn--md',
  lg: 'btn--lg',
}

interface SharedProps {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
  icon?: IconName
  iconRight?: IconName
  fullWidth?: boolean
  children?: ReactNode
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, SharedProps {}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  icon,
  iconRight,
  fullWidth = false,
  className,
  children,
  disabled,
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        'btn',
        VARIANTS[variant],
        SIZES[size],
        fullWidth && 'btn--full',
        className,
      )}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? (
        <Spinner size={18} />
      ) : (
        icon && <Icon name={icon} size={size === 'lg' ? 20 : 18} />
      )}
      {children && <span className="btn__label">{children}</span>}
      {iconRight && !loading && <Icon name={iconRight} size={size === 'lg' ? 20 : 18} />}
    </button>
  )
}

export interface ButtonLinkProps extends SharedProps {
  to: string
  replace?: boolean
  className?: string
}

export function ButtonLink({
  to,
  variant = 'primary',
  size = 'md',
  loading = false,
  icon,
  iconRight,
  fullWidth = false,
  className,
  children,
}: ButtonLinkProps) {
  return (
    <Link
      to={to}
      className={cn(
        'btn',
        VARIANTS[variant],
        SIZES[size],
        fullWidth && 'btn--full',
        className,
      )}
      aria-busy={loading || undefined}
    >
      {icon && <Icon name={icon} size={size === 'lg' ? 20 : 18} />}
      {children && <span className="btn__label">{children}</span>}
      {iconRight && <Icon name={iconRight} size={size === 'lg' ? 20 : 18} />}
    </Link>
  )
}

/** Icon-only round action (nav cart button, close buttons, etc). */
export function IconButton({
  label,
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      className={cn('icon-btn', className)}
      aria-label={label}
      title={label}
      {...props}
    >
      {children}
    </button>
  )
}

export interface LinkIconButtonProps extends LinkProps {
  label: string
  className?: string
  children: ReactNode
}

export function LinkIconButton({ label, className, children, ...props }: LinkIconButtonProps) {
  return (
    <Link {...props} className={cn('icon-btn', className)} aria-label={label} title={label}>
      {children}
    </Link>
  )
}