import mpptImage from "@assets/stock_images/blue_solar_charge_co_06c184d1.jpg";
import inverterImage from "@assets/stock_images/power_inverter_charg_b862ecae.jpg";
import solarPanelImage from "@assets/stock_images/solar_panel_array_tr_4475ffa1.jpg";
import batteryImage from "@assets/stock_images/deep_cycle_battery_i_59af3eee.jpg";
import monitorImage from "@assets/stock_images/digital_battery_moni_cf7a74bb.jpg";

interface SchematicComponentProps {
  type: string;
  name: string;
  selected?: boolean;
  onClick?: () => void;
}

export function SchematicComponent({ type, name, selected, onClick }: SchematicComponentProps) {
  const getComponentImage = () => {
    switch (type) {
      case "multiplus":
        return inverterImage;
      case "mppt":
        return mpptImage;
      case "cerbo":
        return monitorImage;
      case "bmv":
        return monitorImage;
      case "battery":
        return batteryImage;
      case "solar-panel":
        return solarPanelImage;
      default:
        return inverterImage;
    }
  };

  const getComponentSize = () => {
    switch (type) {
      case "multiplus":
        return { width: 180, height: 160 };
      case "mppt":
        return { width: 160, height: 140 };
      case "cerbo":
        return { width: 160, height: 120 };
      case "bmv":
        return { width: 140, height: 140 };
      case "battery":
        return { width: 160, height: 140 };
      case "solar-panel":
        return { width: 180, height: 140 };
      case "ac-load":
      case "dc-load":
        return { width: 120, height: 100 };
      default:
        return { width: 160, height: 120 };
    }
  };

  const size = getComponentSize();
  const imageUrl = getComponentImage();

  // For AC/DC loads, use icon representation
  if (type === "ac-load" || type === "dc-load") {
    return (
      <div
        className={`cursor-pointer transition-all ${
          selected ? "ring-2 ring-primary ring-offset-2 ring-offset-background" : ""
        }`}
        onClick={onClick}
      >
        <div className="hover-elevate active-elevate-2 rounded-md">
          <svg width={size.width} height={size.height} viewBox={`0 0 ${size.width} ${size.height}`}>
            <rect x="20" y="25" width="80" height="55" fill="#3a3a3a" stroke="#4a4a4a" strokeWidth="2" rx="6" />
            {type === "ac-load" ? (
              <>
                <circle cx="60" cy="52" r="18" fill="none" stroke="white" strokeWidth="3" />
                <line x1="60" y1="40" x2="60" y2="60" stroke="white" strokeWidth="3" />
              </>
            ) : (
              <>
                <line x1="45" y1="52" x2="75" y2="52" stroke="white" strokeWidth="3" />
                <line x1="45" y1="45" x2="45" y2="59" stroke="white" strokeWidth="2" />
                <line x1="75" y1="45" x2="75" y2="59" stroke="white" strokeWidth="2" />
              </>
            )}
            <rect x="10" y="48" width="15" height="8" fill="hsl(var(--background))" stroke="hsl(var(--foreground))" strokeWidth="2" />
            <text x="60" y="17" textAnchor="middle" className="fill-foreground text-xs font-semibold">
              {type === "ac-load" ? "AC Load" : "DC Load"}
            </text>
          </svg>
          <div className="text-xs font-medium text-center mt-1 px-2 truncate">
            {name}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`cursor-pointer transition-all ${
        selected ? "ring-2 ring-primary ring-offset-2 ring-offset-background" : ""
      }`}
      onClick={onClick}
    >
      <div className="hover-elevate active-elevate-2 rounded-md p-2 bg-card/50">
        <div className="relative" style={{ width: size.width, height: size.height }}>
          <img
            src={imageUrl}
            alt={name}
            className="w-full h-full object-contain"
            style={{
              filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.1))",
            }}
          />
        </div>
        <div className="text-xs font-medium text-center mt-2 px-2 truncate">
          {name}
        </div>
      </div>
    </div>
  );
}
