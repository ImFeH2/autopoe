import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

const sharedProps = {
  "aria-hidden": true,
  fill: "none",
  focusable: false,
  stroke: "currentColor",
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  strokeWidth: 1.8,
  viewBox: "0 0 24 24",
};

export function PlusIcon(props: IconProps) {
  return (
    <svg {...sharedProps} {...props}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function ArrowUpIcon(props: IconProps) {
  return (
    <svg {...sharedProps} {...props}>
      <path d="m6.5 10.5 5.5-5.5 5.5 5.5M12 5v14" />
    </svg>
  );
}

export function ChatIcon(props: IconProps) {
  return (
    <svg {...sharedProps} {...props}>
      <path d="M7 18.2 3.8 20l.8-3.7A8.2 8.2 0 1 1 7 18.2Z" />
      <path d="M8 10.5h8M8 13.5h5" />
    </svg>
  );
}

export function SparkIcon(props: IconProps) {
  return (
    <svg {...sharedProps} {...props}>
      <path d="M12 2.8c.6 4.2 3 6.6 7.2 7.2-4.2.6-6.6 3-7.2 7.2-.6-4.2-3-6.6-7.2-7.2 4.2-.6 6.6-3 7.2-7.2Z" />
      <path d="M19 16.5c.2 1.5 1 2.3 2.5 2.5-1.5.2-2.3 1-2.5 2.5-.2-1.5-1-2.3-2.5-2.5 1.5-.2 2.3-1 2.5-2.5Z" />
    </svg>
  );
}
