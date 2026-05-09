import { cva } from "class-variance-authority";

export const buttonVariants = cva(
  "inline-flex shrink-0 cursor-pointer select-none items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium outline-none transition-[background-color,border-color,color,box-shadow,opacity,transform] duration-150 ease-out active:translate-y-px disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-45 disabled:active:translate-y-0 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "border border-primary/80 bg-primary text-primary-foreground shadow-xs hover:bg-primary/90 hover:shadow-sm",
        destructive:
          "border border-graph-status-error/35 bg-graph-status-error/14 text-graph-status-error shadow-xs hover:bg-graph-status-error/22 hover:text-graph-status-error focus-visible:ring-graph-status-error/30",
        outline:
          "border border-input bg-background/60 text-foreground shadow-xs hover:border-ring/35 hover:bg-accent/70 hover:text-accent-foreground hover:shadow-sm dark:bg-input/30 dark:hover:bg-input/50",
        secondary:
          "border border-border/70 bg-secondary text-secondary-foreground shadow-xs hover:border-border hover:bg-secondary/80 hover:shadow-sm",
        ghost:
          "text-muted-foreground hover:bg-accent/55 hover:text-accent-foreground active:bg-accent/70 dark:hover:bg-accent/50",
        link: "text-primary underline-offset-4 hover:underline active:translate-y-0",
      },
      size: {
        default: "h-9 gap-2 px-4 py-2 has-[>svg]:px-3",
        xs: "h-6 gap-1 px-2 text-xs has-[>svg]:px-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 gap-1.5 px-3 text-xs has-[>svg]:px-2.5",
        lg: "h-10 gap-2 px-6 has-[>svg]:px-4",
        icon: "size-9",
        "icon-xs": "size-6 [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-8",
        "icon-lg": "size-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);
