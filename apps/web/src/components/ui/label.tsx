import * as React from 'react';
import { cn } from '@/lib/utils';

export type LabelProps = React.LabelHTMLAttributes<HTMLLabelElement>;

function Label({ className, ...props }: LabelProps) {
  return <label className={cn('text-sm font-medium leading-none', className)} {...props} />;
}

export { Label };
