import { cn } from "../../lib/utils";
import { HONGYI_LINGGONG_MARK_DATA_URI } from "./hongyi-linggong-mark";

export type MulticaIconMode =
  /** The mark at rest. */
  | "static"
  /** Pulse while an agent is working or waiting. */
  | "think"
  /** Pop in at app launch or sign-in. */
  | "intro"
  /** `intro`, then `think` until whatever is loading unmounts it. */
  | "launch";

interface MulticaIconProps extends Omit<React.ComponentProps<"svg">, "mode"> {
  mode?: MulticaIconMode;
  /** `circle` is the avatar form. */
  shape?: "square" | "circle";
  /**
   * Rendered size in px. Omit to size with `className` (1em default).
   */
  size?: number;
  /** Accessible name. Without one the mark is decorative. */
  title?: string;
}

export function MulticaIcon({
  mode = "static",
  shape = "square",
  size,
  title,
  className,
  style,
  ...props
}: MulticaIconProps) {
  const intro = mode === "intro" || mode === "launch";

  return (
    <svg
      viewBox="0 0 100 100"
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      className={cn(
        "inline-block shrink-0",
        size == null && "size-[1em]",
        shape === "circle" && "rounded-full",
        intro && "multica-pop",
        (mode === "think" || mode === "launch") && "animate-pulse",
        className,
      )}
      style={{ ...(size != null && { width: size, height: size }), ...style }}
      {...props}
    >
      <image href={HONGYI_LINGGONG_MARK_DATA_URI} width={100} height={100} />
    </svg>
  );
}
