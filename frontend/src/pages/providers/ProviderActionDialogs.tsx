import { Button } from "@/components/ui/button";
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
import type { Provider } from "@/types";

interface ProviderActionDialogsProps {
  clearModelsConfirmOpen: boolean;
  onCancelClearModels: () => void;
  onCancelDeleteProvider: () => void;
  onClearModels: () => void;
  onDeleteProvider: () => void;
  providerToDelete: Provider | null;
}

export function ProviderActionDialogs({
  clearModelsConfirmOpen,
  onCancelClearModels,
  onCancelDeleteProvider,
  onClearModels,
  onDeleteProvider,
  providerToDelete,
}: ProviderActionDialogsProps) {
  return (
    <>
      <AlertDialog
        open={clearModelsConfirmOpen}
        onOpenChange={(open) => {
          if (!open) {
            onCancelClearModels();
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear all models?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes every model from this provider, including discovered
              and manual entries. Save the provider to keep the cleared list.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel asChild>
              <Button type="button" variant="ghost">
                Cancel
              </Button>
            </AlertDialogCancel>
            <AlertDialogAction asChild>
              <Button
                type="button"
                variant="destructive"
                onClick={onClearModels}
              >
                Clear Models
              </Button>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={providerToDelete !== null}
        onOpenChange={(open) => {
          if (!open) {
            onCancelDeleteProvider();
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete provider?</AlertDialogTitle>
            <AlertDialogDescription>
              {providerToDelete
                ? `This will permanently remove ${providerToDelete.name}.`
                : "This will permanently remove the selected provider."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel asChild>
              <Button variant="ghost">Cancel</Button>
            </AlertDialogCancel>
            <AlertDialogAction asChild>
              <Button variant="destructive" onClick={onDeleteProvider}>
                Delete
              </Button>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
