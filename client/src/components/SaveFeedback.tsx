import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface SaveFeedbackProps {
  show: boolean;
  message?: string;
}

export function SaveFeedback({ show, message = "Saved!" }: SaveFeedbackProps) {
  const [visible, setVisible] = useState(false);
  const [key, setKey] = useState(0);

  useEffect(() => {
    if (show) {
      // Reset and trigger animation by changing key
      setVisible(false);
      setKey(prev => prev + 1);
      // Small delay to ensure the reset is visible, then show
      const showTimer = setTimeout(() => {
        setVisible(true);
      }, 10);
      
      // Hide after duration
      const hideTimer = setTimeout(() => {
        setVisible(false);
      }, 2000);
      
      return () => {
        clearTimeout(showTimer);
        clearTimeout(hideTimer);
      };
    } else {
      setVisible(false);
    }
  }, [show]);

  return (
    <div
      key={key}
      className={cn(
        "absolute top-4 right-4 pointer-events-none z-50 transition-all duration-500 ease-in-out",
        visible ? "opacity-100 translate-y-0 scale-100" : "opacity-0 -translate-y-4 scale-95"
      )}
      style={{
        transition: "opacity 500ms ease-in-out, transform 500ms ease-in-out",
      }}
    >
      <div className="bg-green-500/95 dark:bg-green-600/95 text-white px-3 py-1.5 rounded-md shadow-lg flex items-center gap-2 backdrop-blur-sm border border-green-400/30 animate-in fade-in slide-in-from-top-2">
        <Check className="h-3.5 w-3.5 animate-in zoom-in duration-300" />
        <span className="text-xs font-medium">{message}</span>
      </div>
    </div>
  );
}
