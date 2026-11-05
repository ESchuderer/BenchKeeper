import type { WorkflowDefinition } from "@cedarloom/contracts";
import { Button, Modal, Select, type SelectProps, Stack } from "@mantine/core";
import { type ReactNode, useState } from "react";
import { t } from "../i18n.ts";
import { sources, targets } from "./connections.ts";
import type { Change } from "./document.ts";

type Props = {
  workflow: WorkflowDefinition;
  opened: boolean;
  onClose: () => void;
  change: (change: Change) => void;
  onDone: (text: string) => void;
};

// Searchable, with its list inside the dialog: a list in a portal would sit outside the dialog's landmark.
const HandleSelect = (props: SelectProps): ReactNode => (
  <Select searchable comboboxProps={{ withinPortal: false }} {...props} />
);

/**
 * The keyboard path to a connection: pick an output, then one of the inputs that may take it, and connect. Mantine's
 * modal keeps focus inside and returns it to the button that opened it.
 */
export const ConnectDialog = ({ workflow, opened, onClose, change, onDone }: Props): ReactNode => {
  const [from, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState<string | null>(null);
  const outputs = sources(workflow);
  const source = outputs.find((item) => item.value === from);
  const inputs = source === undefined ? [] : targets(workflow, source.end);
  const target = inputs.find((item) => item.value === to);
  // Each opening starts with empty fields.
  const close = (): void => {
    setFrom(null);
    setTo(null);
    onClose();
  };
  const connect = (): void => {
    if (source === undefined || target === undefined) return;
    change({ kind: "connect", from: source.end, to: target.end });
    onDone(t("editor.connected", { from: source.label, to: target.label }));
    close();
  };
  const choose = (value: string | null): void => {
    setFrom(value);
    setTo(null);
  };
  return (
    <Modal
      opened={opened}
      onClose={close}
      title={t("editor.connectTitle")}
      closeButtonProps={{ "aria-label": t("editor.close") }}
      // Mantine's header element would count as a second banner landmark next to the shell's; inside a dialog it is none.
      attributes={{ header: { role: "none" } }}
    >
      <Stack>
        <HandleSelect label={t("editor.connectFrom")} data={outputs} value={from} onChange={choose} data-autofocus />
        <HandleSelect
          label={t("editor.connectTo")}
          data={inputs}
          value={to}
          onChange={setTo}
          disabled={!source}
          // Tied to the field, so a screen reader on it hears why its list is empty.
          description={source !== undefined && inputs.length === 0 ? t("editor.noTargets") : undefined}
        />
        <Button onClick={connect} disabled={target === undefined}>
          {t("editor.connect")}
        </Button>
      </Stack>
    </Modal>
  );
};
