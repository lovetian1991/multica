import { useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@multica/ui/components/ui/alert-dialog";
import { SettingsCard, SettingsTab } from "@multica/views/settings";
import { useT } from "@multica/views/i18n";
import { ServerEndpointForm } from "./server-endpoint-form";

export function ServerSettingsTab() {
  const { t } = useT("settings");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [editing, setEditing] = useState(false);

  return (
    <SettingsTab
      title={t(($) => $.desktop.server.title)}
      description={t(($) => $.desktop.server.page_description)}
    >
      <SettingsCard>
        <ServerEndpointForm
          variant="settings"
          defaultEditing={editing}
          onRequestChange={() => setConfirmOpen(true)}
          onCancelEditing={() => setEditing(false)}
        />
      </SettingsCard>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t(($) => $.desktop.server.switch_dialog_title)}</AlertDialogTitle>
            <AlertDialogDescription>
              {t(($) => $.desktop.server.switch_dialog_description)}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t(($) => $.desktop.server.cancel)}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                setConfirmOpen(false);
                setEditing(true);
              }}
            >
              {t(($) => $.desktop.server.switch_dialog_continue)}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SettingsTab>
  );
}
