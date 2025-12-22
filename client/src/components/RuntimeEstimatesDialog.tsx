import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Calculator, Loader2 } from "lucide-react";
import type { SchematicComponent } from "@shared/schema";

interface RuntimeEstimatesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  components: SchematicComponent[];
  systemVoltage: number;
}

export function RuntimeEstimatesDialog({
  open,
  onOpenChange,
  components,
  systemVoltage,
}: RuntimeEstimatesDialogProps) {
  const [estimates, setEstimates] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open && components.length > 0) {
      const fetchEstimates = async () => {
        setLoading(true);
        try {
          const res = await fetch('/api/runtime-estimates', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ components, systemVoltage }),
            credentials: 'include',
          });
          if (res.ok) {
            const data = await res.json();
            setEstimates(data);
          }
        } catch (error) {
          console.error('Failed to fetch runtime estimates:', error);
        } finally {
          setLoading(false);
        }
      };

      fetchEstimates();
    }
  }, [open, components, systemVoltage]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Calculator className="h-5 w-5" />
            System Runtime Estimates
          </DialogTitle>
          <DialogDescription>
            Battery runtime, energy consumption, solar production, and charging estimates
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            <span className="ml-3 text-sm text-muted-foreground">Calculating estimates...</span>
          </div>
        ) : !estimates ? (
          <div className="text-center text-muted-foreground py-12">
            <Calculator className="h-12 w-12 mx-auto mb-3 opacity-20" />
            <p className="text-sm">No estimates available</p>
          </div>
        ) : (
          <div className="space-y-4 mt-4">
            <div className="bg-muted p-4 rounded-lg">
              <Label className="text-xs text-muted-foreground">Battery Runtime</Label>
              <div className="text-2xl font-semibold mt-1">
                {estimates.batteryRuntimeHours >= 9999 ? '∞' : estimates.batteryRuntimeHours.toFixed(1)} hours
              </div>
              <div className="text-xs text-muted-foreground mt-2">
                Based on battery capacity and average load
              </div>
            </div>

            <div className="bg-muted p-4 rounded-lg">
              <Label className="text-xs text-muted-foreground">Daily Energy Consumption</Label>
              <div className="text-2xl font-semibold mt-1">
                {estimates.dailyConsumptionWh.toFixed(0)} Wh/day
              </div>
            </div>

            <div className="bg-muted p-4 rounded-lg">
              <Label className="text-xs text-muted-foreground mb-2 block">Daily Solar Production</Label>
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-sm">Low (2h sun):</span>
                  <span className="font-mono font-semibold">{estimates.dailyProductionWh.low.toFixed(0)} Wh</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm">Medium (4h sun):</span>
                  <span className="font-mono font-semibold">{estimates.dailyProductionWh.medium.toFixed(0)} Wh</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm">High (6h sun):</span>
                  <span className="font-mono font-semibold">{estimates.dailyProductionWh.high.toFixed(0)} Wh</span>
                </div>
              </div>
            </div>

            <div className="bg-muted p-4 rounded-lg">
              <Label className="text-xs text-muted-foreground mb-2 block">Net Daily Energy</Label>
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-sm">Low:</span>
                  <span className={`font-mono font-semibold ${estimates.netDailyEnergyWh.low < 0 ? 'text-destructive' : 'text-green-600'}`}>
                    {estimates.netDailyEnergyWh.low.toFixed(0)} Wh
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm">Medium:</span>
                  <span className={`font-mono font-semibold ${estimates.netDailyEnergyWh.medium < 0 ? 'text-destructive' : 'text-green-600'}`}>
                    {estimates.netDailyEnergyWh.medium.toFixed(0)} Wh
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm">High:</span>
                  <span className={`font-mono font-semibold ${estimates.netDailyEnergyWh.high < 0 ? 'text-destructive' : 'text-green-600'}`}>
                    {estimates.netDailyEnergyWh.high.toFixed(0)} Wh
                  </span>
                </div>
              </div>
            </div>

            {estimates.autonomyDays.medium !== null && (
              <div className="bg-muted p-4 rounded-lg">
                <Label className="text-xs text-muted-foreground">Autonomy Days</Label>
                <div className="text-2xl font-semibold mt-1">
                  {estimates.autonomyDays.medium?.toFixed(1)} days
                </div>
                <div className="text-xs text-muted-foreground mt-2">
                  Medium solar scenario
                </div>
              </div>
            )}

            <div className="bg-muted p-4 rounded-lg">
              <Label className="text-xs text-muted-foreground mb-2 block">Solar Charging Time</Label>
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-sm">Low:</span>
                  <span className="font-mono font-semibold">{estimates.solarChargingTimeHours.low.toFixed(1)} hours</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm">Medium:</span>
                  <span className="font-mono font-semibold">{estimates.solarChargingTimeHours.medium.toFixed(1)} hours</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm">High:</span>
                  <span className="font-mono font-semibold">{estimates.solarChargingTimeHours.high.toFixed(1)} hours</span>
                </div>
              </div>
              <div className="text-xs text-muted-foreground mt-3">
                Time to charge from 50% to 100% SOC
              </div>
            </div>

            {estimates.shorePowerChargingTimeHours !== null && (
              <div className="bg-muted p-4 rounded-lg">
                <Label className="text-xs text-muted-foreground">Shore Power Charging Time</Label>
                <div className="text-2xl font-semibold mt-1">
                  {estimates.shorePowerChargingTimeHours.toFixed(1)} hours
                </div>
                <div className="text-xs text-muted-foreground mt-2">
                  From 50% to 100% SOC
                </div>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
