import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { LogIn } from "lucide-react";

interface SessionExpiredDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onLogin: () => void;
}

export function SessionExpiredDialog({
  open,
  onOpenChange,
  onLogin,
}: SessionExpiredDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <LogIn className="h-5 w-5" />
            Session Expired
          </AlertDialogTitle>
          <AlertDialogDescription>
            Your session has expired. Please sign in again to save your work.
            <br />
            <span className="font-medium text-foreground">
              Don't worry — your current design is still here and won't be lost!
            </span>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onLogin}>
            <LogIn className="mr-2 h-4 w-4" />
            Sign In with Google
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
