import { ICONS, type IconName } from "./data";

export type { IconName };

// Inline SVG from the generated icon data. Sized by font-size (1em) and
// coloured by currentColor unless told otherwise.
export function Icon({
  name,
  size = "1em",
  className,
  label,
}: {
  name: IconName;
  size?: number | string;
  className?: string;
  label?: string; // set when the icon carries meaning on its own
}) {
  const icon = ICONS[name];
  return (
    <svg
      viewBox={`0 0 ${icon.width} ${icon.height}`}
      width={size}
      height={size}
      fill="currentColor"
      className={className}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      dangerouslySetInnerHTML={{ __html: icon.body }}
    />
  );
}
