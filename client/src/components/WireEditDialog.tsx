import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useState, useEffect } from "react";
import type { Wire } from "@shared/schema";

interface WireEditDialogProps {
    wire: Wire | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSave: (wireId: string, updates: Partial<Wire>) => void;
}

// Helper function to detect if a wire is AC
function isACWire(wire: Wire | null): boolean {
    if (!wire) return false;
    
    // Check if polarity is already AC type
    if (wire.polarity === "hot" || wire.polarity === "neutral" || wire.polarity === "ground") {
        return true;
    }
    
    // Check if terminals are AC type
    if (wire.fromTerminal?.startsWith("ac-") || wire.toTerminal?.startsWith("ac-")) {
        return true;
    }
    
    return false;
}

export function WireEditDialog({ wire, open, onOpenChange, onSave }: WireEditDialogProps) {
    const [gauge, setGauge] = useState<string>("");
    const [polarity, setPolarity] = useState<string>("");
    const [length, setLength] = useState<string>("");
    const [material, setMaterial] = useState<string>("");

    useEffect(() => {
        if (wire) {
            // Strip " AWG" suffix for the select input
            const gaugeValue = wire.gauge ? wire.gauge.replace(" AWG", "") : "10";
            setGauge(gaugeValue);
            setPolarity(wire.polarity || "positive");
            setLength(wire.length?.toString() || "0");
            setMaterial(wire.conductorMaterial || "copper");
        }
    }, [wire]);

    const handleSave = () => {
        if (!wire) return;

        // Handle parallel run gauges (e.g., "4/0-parallel-2")
        if (gauge.includes("-parallel-")) {
            // For parallel runs, we'll just set the base gauge
            // The parallel wire creation should be handled separately
            const baseGauge = gauge.split("-parallel-")[0];
            const formattedGauge = `${baseGauge} AWG`;
            onSave(wire.id, {
                gauge: formattedGauge,
                polarity: polarity as "positive" | "negative" | "ground" | "hot" | "neutral",
                length: parseFloat(length),
                conductorMaterial: material as "copper" | "aluminum"
            });
        } else {
            // Ensure gauge has AWG suffix if it's a number
            let formattedGauge = gauge;
            if (gauge && !gauge.endsWith("AWG")) {
                formattedGauge = `${gauge} AWG`;
            }

            onSave(wire.id, {
                gauge: formattedGauge,
                polarity: polarity as "positive" | "negative" | "ground" | "hot" | "neutral",
                length: parseFloat(length),
                conductorMaterial: material as "copper" | "aluminum"
            });
        }
        onOpenChange(false);
    };

    if (!wire) return null;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle>Edit Wire</DialogTitle>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="gauge" className="text-right">Gauge</Label>
                        <Select value={gauge} onValueChange={setGauge}>
                            <SelectTrigger className="col-span-3">
                                <SelectValue placeholder="Select gauge" />
                            </SelectTrigger>
                            <SelectContent>
                                {["4/0", "3/0", "2/0", "1/0", "1", "2", "4", "6", "8", "10", "12", "14", "16", "18"].map(g => (
                                    <SelectItem key={g} value={g}>{g} AWG</SelectItem>
                                ))}
                                {/* Parallel run options */}
                                <SelectItem value="4/0-parallel-2">4/0 AWG (2 parallel)</SelectItem>
                                <SelectItem value="4/0-parallel-3">4/0 AWG (3 parallel)</SelectItem>
                                <SelectItem value="4/0-parallel-4">4/0 AWG (4 parallel)</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="polarity" className="text-right">Polarity</Label>
                        <Select value={polarity} onValueChange={setPolarity}>
                            <SelectTrigger className="col-span-3">
                                <SelectValue placeholder="Select polarity" />
                            </SelectTrigger>
                            <SelectContent>
                                {isACWire(wire) ? (
                                    // AC wire options
                                    <>
                                        <SelectItem value="hot">Hot</SelectItem>
                                        <SelectItem value="neutral">Neutral</SelectItem>
                                        <SelectItem value="ground">Ground</SelectItem>
                                    </>
                                ) : (
                                    // DC wire options
                                    <>
                                        <SelectItem value="positive">Positive (+)</SelectItem>
                                        <SelectItem value="negative">Negative (-)</SelectItem>
                                        <SelectItem value="ground">Ground</SelectItem>
                                    </>
                                )}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="material" className="text-right">Type</Label>
                        <Select value={material} onValueChange={setMaterial}>
                            <SelectTrigger className="col-span-3">
                                <SelectValue placeholder="Select material" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="copper">Copper</SelectItem>
                                <SelectItem value="aluminum">Aluminum</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                        <Label htmlFor="length" className="text-right">Length (ft)</Label>
                        <Input id="length" value={length} onChange={e => setLength(e.target.value)} className="col-span-3" type="number" step="0.1" />
                    </div>
                </div>
                <DialogFooter>
                    <Button onClick={handleSave}>Save Changes</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
