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
import { Button } from "@/components/ui/button";
import type { Role } from "@/types";

interface RoleDeleteDialogProps {
  onConfirmDelete: () => void;
  onOpenChange: (open: boolean) => void;
  roleToDelete: Role | null;
}

export function RoleDeleteDialog({
  onConfirmDelete,
  onOpenChange,
  roleToDelete,
}: RoleDeleteDialogProps) {
  return (
    <AlertDialog open={roleToDelete !== null} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete role?</AlertDialogTitle>
          <AlertDialogDescription>
            {roleToDelete
              ? `This will permanently remove ${roleToDelete.name}.`
              : "This will permanently remove the selected role."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel asChild>
            <Button variant="ghost">Cancel</Button>
          </AlertDialogCancel>
          <AlertDialogAction asChild>
            <Button
              variant="destructive"
              onClick={() => void onConfirmDelete()}
            >
              Delete
            </Button>
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
