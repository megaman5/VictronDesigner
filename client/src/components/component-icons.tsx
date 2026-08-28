/**
 * Schematic-style icons for the component library.
 *
 * These replace a handful of repeated Lucide glyphs (Cable was doing duty for
 * twelve different parts, Gauge for nine) with silhouettes that actually look
 * like the hardware: an inverter has cooling fins, a shunt has a stud at each
 * end, a busbar has bolts along it. At 20px the goal is a recognisable
 * outline, not detail - they read as a family with the canvas artwork.
 *
 * Everything is stroked in currentColor so the icons inherit theme colour.
 */
import type { Terminal } from "@/lib/terminal-config";

interface IconProps {
  className?: string;
}

function Svg({ className, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className ?? "h-5 w-5"}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

/** Wall-mount inverter/charger: upright case, cooling fins, terminal strip. */
const InverterIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="5" y="3" width="14" height="18" rx="2" />
    <path d="M8 6h8M8 8.5h8" opacity={0.5} />
    <path d="M9 13.5l2.5-3v3l2.5-3" />
    <path d="M8.5 18h2M13.5 18h2" />
  </Svg>
);

/** Solar charge controller: case with a sun on the front. */
const MpptIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="4" y="4" width="16" height="16" rx="2" />
    <circle cx="12" cy="11" r="2.5" />
    <path d="M12 6.5v1M12 14.5v1M8.5 11h-1M16.5 11h-1" opacity={0.7} />
    <path d="M8 18h3M13 18h3" opacity={0.5} />
  </Svg>
);

/** Battery block: case, cell divisions, two posts on top. */
const BatteryIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="7" width="18" height="12" rx="1.5" />
    <path d="M7 7V5.5h2.5V7M14.5 7V5.5H17V7" />
    <path d="M9 11.5h2M10 10.5v2" />
    <path d="M14 11.5h2" />
  </Svg>
);

/** Solar panel: framed cell grid, seen at a slight angle. */
const SolarPanelIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="2.5" y="5" width="19" height="11" rx="1" />
    <path d="M9 5v11M15 5v11M2.5 9.7h19M2.5 12.5h19" opacity={0.6} />
    <path d="M12 16v3M9 19h6" />
  </Svg>
);

/** Shunt: long bar with a heavy stud at each end. */
const ShuntIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="7" y="9" width="10" height="6" rx="1" />
    <path d="M7 12H3.5M20.5 12H17" />
    <circle cx="3.5" cy="12" r="1.6" />
    <circle cx="20.5" cy="12" r="1.6" />
    <path d="M10 11.5h4" opacity={0.6} />
  </Svg>
);

/** Busbar: bar with bolt positions along it. */
const BusbarIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="2.5" y="9" width="19" height="6" rx="1.5" />
    <circle cx="6.5" cy="12" r="1.2" />
    <circle cx="12" cy="12" r="1.2" />
    <circle cx="17.5" cy="12" r="1.2" />
  </Svg>
);

/** Lynx module: busbar built from bolted-together sections. */
const LynxIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="2.5" y="8" width="19" height="8" rx="1.5" />
    <path d="M9 8v8M15 8v8" opacity={0.6} />
    <circle cx="5.7" cy="12" r="1" />
    <circle cx="12" cy="12" r="1" />
    <circle cx="18.3" cy="12" r="1" />
  </Svg>
);

/** GX monitor: flat box with a port row. */
const GxIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="6" width="18" height="12" rx="2" />
    <rect x="6" y="9" width="7" height="4.5" rx="0.5" opacity={0.6} />
    <path d="M16 9.5v4M18.5 9.5v4" opacity={0.6} />
    <path d="M7 16.5h10" opacity={0.4} />
  </Svg>
);

/** Cartridge fuse: body with the fusible element running through. */
const FuseIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="6" y="8.5" width="12" height="7" rx="3.5" />
    <path d="M6 12H2.5M21.5 12H18" />
    <path d="M8.5 12c1.5-2 2 2 3.5 0s2 2 3.5 0" opacity={0.8} />
  </Svg>
);

/** Circuit breaker: DIN body with a toggle lever. */
const BreakerIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="6" y="4" width="12" height="16" rx="1.5" />
    <path d="M12 4V2M12 22v-2" />
    <path d="M9.5 14.5l5-5" />
    <circle cx="9.5" cy="14.5" r="1.1" />
    <path d="M8 7.5h8" opacity={0.4} />
  </Svg>
);

/** Battery isolator switch: rotary knob on a round body. */
const SwitchIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8" />
    <path d="M12 12V6.5" />
    <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
    <path d="M5.5 18.5l1.8-1.8M18.5 18.5l-1.8-1.8" opacity={0.5} />
  </Svg>
);

/** Shore power inlet: connector body with pins. */
const ShorePowerIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="7.5" />
    <circle cx="9.5" cy="10.5" r="1.1" fill="currentColor" stroke="none" />
    <circle cx="14.5" cy="10.5" r="1.1" fill="currentColor" stroke="none" />
    <circle cx="12" cy="15" r="1.1" fill="currentColor" stroke="none" />
  </Svg>
);

/** Alternator: rotor housing with drive pulley. */
const AlternatorIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="10.5" cy="12" r="6.5" />
    <path d="M17 9.5h3.5M17 14.5h3.5" opacity={0.6} />
    <circle cx="10.5" cy="12" r="2.2" />
    <path d="M10.5 5.5v2M10.5 16.5v2" opacity={0.5} />
  </Svg>
);

/** AC load: wall socket. */
const AcLoadIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="4" y="4" width="16" height="16" rx="3" />
    <circle cx="9.5" cy="10.5" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="14.5" cy="10.5" r="1.2" fill="currentColor" stroke="none" />
    <path d="M9 15.5h6" />
  </Svg>
);

/** DC load: lamp. */
const DcLoadIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9 16.5a5 5 0 1 1 6 0v1.5H9z" />
    <path d="M9.5 20.5h5M10.5 22.5h3" opacity={0.7} />
  </Svg>
);

/** Distribution panel: rows of breakers behind a door. */
const PanelIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="4" y="3" width="16" height="18" rx="1.5" />
    <path d="M7 7.5h4M13 7.5h4M7 12h4M13 12h4M7 16.5h4M13 16.5h4" opacity={0.75} />
  </Svg>
);

/** Transfer switch: two sources, one output. */
const TransferSwitchIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 7h4M3 17h4" />
    <path d="M7 7l7 4.2M7 17l7-4.2" opacity={0.8} />
    <circle cx="7" cy="7" r="1.1" fill="currentColor" stroke="none" />
    <circle cx="7" cy="17" r="1.1" fill="currentColor" stroke="none" />
    <rect x="14" y="9.5" width="4" height="5" rx="1" />
    <path d="M18 12h3" />
  </Svg>
);

/** DC-DC converter: case with a one-way conversion arrow. */
const DcDcIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="4" y="6" width="16" height="12" rx="2" />
    <path d="M8 12h7M12.5 9.5l2.5 2.5-2.5 2.5" />
    <path d="M4 9.5H2M22 14.5h-2" opacity={0.6} />
  </Svg>
);

/** Mains charger: case feeding a battery. */
const ChargerIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="7" width="10" height="10" rx="1.5" />
    <path d="M7.5 9.5l-1.5 3h2l-1.5 3" />
    <rect x="15.5" y="9" width="6" height="6" rx="1" />
    <path d="M17 9V7.8M20 9V7.8" opacity={0.7} />
    <path d="M13 12h2.5" />
  </Svg>
);

/** FET isolator: one input fanning out to several isolated outputs. */
const IsolatorIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2.5 12H6" />
    <rect x="6" y="5" width="7" height="14" rx="1.5" />
    <path d="M13 8h4.5M13 12h4.5M13 16h4.5" />
    <path d="M19 6.5v3M19 10.5v3M19 14.5v3" opacity={0.6} />
  </Svg>
);

/** Combiner relay: two banks bridged by a contact. */
const CombinerIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="2.5" y="9" width="6" height="6" rx="1" />
    <rect x="15.5" y="9" width="6" height="6" rx="1" />
    <path d="M8.5 12h2M13.5 12h2" />
    <path d="M10.5 12.5l3-2" />
    <circle cx="10.5" cy="12.5" r="0.9" fill="currentColor" stroke="none" />
  </Svg>
);

/** Balancer: two cells tied together by a balancing link. */
const BalancerIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="2.5" y="11" width="8" height="8" rx="1" />
    <rect x="13.5" y="11" width="8" height="8" rx="1" />
    <path d="M6.5 11V7.5h11V11" />
    <path d="M12 7.5v-3" />
  </Svg>
);

/** Battery protect: load disconnect behind a shield. */
const ProtectIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 2.5l7 2.8v6c0 4.4-3 7.6-7 9-4-1.4-7-4.6-7-9v-6z" />
    <path d="M12.5 8l-2.5 4h3l-2.5 4" />
  </Svg>
);

/** Round battery monitor with a display face. */
const MonitorIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <circle cx="12" cy="12" r="5.5" opacity={0.5} />
    <path d="M9.5 11.5h5M10.5 14h3" opacity={0.9} />
  </Svg>
);

const ICONS: Record<string, (p: IconProps) => JSX.Element> = {
  bmv: MonitorIcon,
  multiplus: InverterIcon,
  quattro: InverterIcon,
  "phoenix-inverter": InverterIcon,
  inverter: InverterIcon,
  mppt: MpptIcon,
  battery: BatteryIcon,
  "solar-panel": SolarPanelIcon,
  smartshunt: ShuntIcon,
  "lynx-shunt": ShuntIcon,
  "busbar-positive": BusbarIcon,
  "busbar-negative": BusbarIcon,
  "lynx-power-in": LynxIcon,
  "lynx-distributor": LynxIcon,
  "lynx-smart-bms": LynxIcon,
  cerbo: GxIcon,
  fuse: FuseIcon,
  "dc-breaker": BreakerIcon,
  "ac-breaker": BreakerIcon,
  switch: SwitchIcon,
  "shore-power": ShorePowerIcon,
  alternator: AlternatorIcon,
  "ac-load": AcLoadIcon,
  "dc-load": DcLoadIcon,
  "ac-panel": PanelIcon,
  "dc-panel": PanelIcon,
  "transfer-switch": TransferSwitchIcon,
  "orion-dc-dc": DcDcIcon,
  "blue-smart-charger": ChargerIcon,
  argofet: IsolatorIcon,
  "cyrix-ct": CombinerIcon,
  "battery-balancer": BalancerIcon,
  "battery-protect": ProtectIcon,
};

/** Icon for a built-in component type. Falls back to a plain box. */
export function ComponentIcon({ type, className }: { type: string; className?: string }) {
  const Icon = ICONS[type];
  if (Icon) return <Icon className={className} />;
  return (
    <Svg className={className}>
      <rect x="4" y="6" width="16" height="12" rx="2" />
    </Svg>
  );
}

/**
 * Icon for a user-defined component, drawn from the definition itself rather
 * than a generic placeholder: the real body proportions with the author's
 * terminals dotted around the edge where they actually sit. Two custom parts
 * with different terminal layouts get visibly different icons.
 */
export function CustomComponentIcon({
  width,
  height,
  terminals,
  className,
}: {
  width: number;
  height: number;
  terminals: Terminal[];
  className?: string;
}) {
  // Fit the body into a 24x24 box, leaving room for edge terminals.
  const pad = 4;
  const inner = 24 - pad * 2;
  const scale = Math.min(inner / Math.max(width, 1), inner / Math.max(height, 1));
  const w = Math.max(width * scale, 3);
  const h = Math.max(height * scale, 3);
  const ox = (24 - w) / 2;
  const oy = (24 - h) / 2;

  return (
    <svg viewBox="0 0 24 24" className={className ?? "h-5 w-5"} aria-hidden="true">
      <rect
        x={ox}
        y={oy}
        width={w}
        height={h}
        rx={1.5}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeDasharray="3 2"
      />
      {terminals.slice(0, 12).map((t, i) => (
        <circle
          key={i}
          cx={ox + (t.x / Math.max(width, 1)) * w}
          cy={oy + (t.y / Math.max(height, 1)) * h}
          r={1.4}
          fill={t.color}
        />
      ))}
    </svg>
  );
}
