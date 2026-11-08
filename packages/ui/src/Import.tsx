import type { Api, components } from "@cedarloom/client";
import { Alert, Button, Group, List, Stack, Table, Text, TextInput, Title } from "@mantine/core";
import { shown } from "@cedarloom/contracts/escape";
import { type FormEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { call } from "./call.ts";
import { t } from "./i18n.ts";

type Preview = components["schemas"]["ImportPreview"];
type Review = Preview["review"];
type Extension = Review["extensions"][number];

const short = (commit: string): string => commit.slice(0, 12);

/** Each workflow of the import: its status against the store, its version, the nodes it changes, its license. */
const Units = ({ units }: { units: Review["units"] }) => (
  <Table.ScrollContainer minWidth={560}>
    <Table striped>
      <Table.Caption c="bright">{t("import.units")}</Table.Caption>
      <Table.Thead>
        <Table.Tr>
          <Table.Th>{t("import.workflow")}</Table.Th>
          <Table.Th>{t("import.status")}</Table.Th>
          <Table.Th>{t("import.version")}</Table.Th>
          <Table.Th>{t("import.changes")}</Table.Th>
          <Table.Th>{t("import.license")}</Table.Th>
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {units.map((unit) => (
          <Table.Tr key={unit.id}>
            <Table.Td ff="monospace">{unit.id}</Table.Td>
            <Table.Td>{t("import.unitStatus", { status: unit.status })}</Table.Td>
            <Table.Td>
              {unit.stored === null || unit.stored === unit.version
                ? unit.version
                : t("import.versionChange", { stored: unit.stored, version: unit.version })}
            </Table.Td>
            <Table.Td>
              {t("import.nodes", {
                added: unit.changes.added.length,
                changed: unit.changes.changed.length,
                removed: unit.changes.removed.length,
              })}
            </Table.Td>
            <Table.Td>{unit.license ?? t("import.noLicense")}</Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  </Table.ScrollContainer>
);

/** Every line that runs or writes, in full, per workflow: an imported workflow is code. */
const Risks = ({ risks }: { risks: Review["risks"] }) =>
  risks.length === 0 ? (
    <Text>{t("import.noRisks")}</Text>
  ) : (
    [...Map.groupBy(risks, (risk) => risk.workflow)].map(([workflow, lines]) => (
      <Stack key={workflow} gap={4}>
        <Text fw={700} ff="monospace">
          {workflow}
        </Text>
        <List>
          {lines.map((risk) => (
            <List.Item key={`${risk.node} ${risk.kind} ${risk.text}`}>
              {t("import.riskKind", { kind: risk.kind, node: risk.node })}{" "}
              <Text span ff="monospace" inherit>
                {/* No cut: the contract bounds the text, and its escapes can make it longer than it is. */}
                {shown(risk.text, Number.POSITIVE_INFINITY)}
              </Text>
            </List.Item>
          ))}
        </List>
      </Stack>
    ))
  );

// What an extension asks for, a line each: the hosts it calls, the credentials it uses there, files, programs.
const asks = ({ capabilities: asked }: Extension): string[] => {
  if (asked === null) return [t("import.unknownAsks")];
  const credentials = Object.entries(asked.credentials ?? {}).map(([id, { hosts }]) =>
    t("import.credential", { id, hosts: hosts.join(", ") }),
  );
  // Each program with every file the host may run for it, per platform.
  const programs = Object.entries(asked.programs ?? {}).map(([id, where]) => {
    const files = Object.entries(where).flatMap(([os, found]) => (found?.length ? [`${os}: ${found.join(", ")}`] : []));
    return files.length > 0 ? t("import.program", { id, files: files.join("; ") }) : t("import.programNowhere", { id });
  });
  return [
    ...(asked.net?.length ? [t("import.net", { hosts: asked.net.join(", ") })] : []),
    ...credentials,
    ...(asked.projectRead ? [t("import.projectRead")] : []),
    ...(asked.planWrite ? [t("import.planWrite")] : []),
    ...programs,
  ];
};

/** The extensions the workflows use, as the import's lock pins them; the import installs none of them. */
const Extensions = ({ extensions }: { extensions: Extension[] }) =>
  extensions.length === 0 ? (
    <Text>{t("import.noExtensions")}</Text>
  ) : (
    <List>
      {extensions.map((extension) => (
        <ExtensionShown key={extension.id} extension={extension} />
      ))}
    </List>
  );

/** One pinned extension: where from, whether its files match the lock, whether it is here, and what it asks for. */
const ExtensionShown = ({ extension }: { extension: Extension }) => {
  const lines = asks(extension);
  return (
    <List.Item>
      <Text span ff="monospace" inherit>
        {extension.id} {extension.version}
      </Text>{" "}
      {t("import.pin", {
        git: extension.git,
        folder: extension.path === undefined ? "no" : "yes",
        path: extension.path ?? "",
        commit: short(extension.commit),
      })}{" "}
      {t("import.pinStatus", { status: extension.status })}{" "}
      {extension.installed ? t("import.installed") : t("import.notInstalled")}
      {lines.length > 0 && (
        <List withPadding>
          {lines.map((line) => (
            <List.Item key={line}>{line}</List.Item>
          ))}
        </List>
      )}
    </List.Item>
  );
};

// Each license with the workflows under it, none stated counted as such.
const licenses = (units: Review["units"]): string =>
  [...Map.groupBy(units, (unit) => unit.license ?? t("import.noLicense"))]
    .map(([license, under]) => t("import.licenseCount", { license, count: under.length }))
    .join(", ");

/** The review of one import, before anything is stored (P6 a), with the source it came from. */
const ReviewShown = ({ review }: { review: Review }) => {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), [review]);
  const { source } = review;
  return (
    <Stack>
      <Title order={3} size="h5" ref={heading} tabIndex={-1}>
        {"git" in source
          ? t("import.from", { git: source.git, ref: source.ref, commit: short(source.commit) })
          : t("import.fromFolder", { folder: shown(source.folder) })}
      </Title>
      <Units units={review.units} />
      <Title order={4} size="h6">
        {t("import.what")}
      </Title>
      <Risks risks={review.risks} />
      <Title order={4} size="h6">
        {t("import.extensions")}
      </Title>
      <Extensions extensions={review.extensions} />
      <Text>{t("import.licenses", { licenses: licenses(review.units) })}</Text>
    </Stack>
  );
};

type Source = { git: string; ref: string };

/** The Git source to review: its URL and a branch or tag. */
const SourceForm = ({ busy, onReview }: { busy: boolean; onReview: (source: Source) => void }) => {
  const [git, setGit] = useState("");
  const [ref, setRef] = useState("main");
  const submit = (event: FormEvent): void => {
    event.preventDefault();
    onReview({ git, ref });
  };
  return (
    <form onSubmit={submit}>
      <Group align="end">
        <TextInput
          label={t("import.git")}
          required
          value={git}
          onChange={(event) => setGit(event.currentTarget.value)}
          style={{ flexGrow: 1 }}
        />
        <TextInput
          label={t("import.ref")}
          required
          value={ref}
          onChange={(event) => setRef(event.currentTarget.value)}
        />
        <Button type="submit" loading={busy}>
          {t("import.review")}
        </Button>
      </Group>
    </form>
  );
};

/** The plan's offer: how many workflows it stores, and the button that applies it; or that there is nothing to import. */
const ApplyOffer = ({ preview, busy, onApply }: { preview: Preview; busy: boolean; onApply: Apply }) => {
  const { id, planHash } = preview;
  if (id === null || planHash === null) return <Text>{t("import.nothing")}</Text>;
  const planned = preview.review.units.filter((unit) => ["new", "update"].includes(unit.status)).length;
  return (
    <Group>
      <Text>{t("import.plan", { count: planned })}</Text>
      <Button loading={busy} onClick={() => onApply(id, planHash)}>
        {t("import.apply")}
      </Button>
    </Group>
  );
};
type Apply = (importId: string, approve: string) => void;
// Refusals after which the plan shown no longer applies, so only a new review can offer one.
const STALE = new Set(["import.not-found", "plan.not-approved", "plan.file-changed", "store.moved"]);

/**
 * An import from a Git source: its review first, then, only on the user's word, the plan applied with the hash of the
 * review shown, as one run. The outcome is a live region that takes the focus.
 */
export const Import = ({ api }: { api: Api }): ReactNode => {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [problem, setProblem] = useState("");
  const [outcome, setOutcome] = useState("");
  const [busy, setBusy] = useState(false);
  const announced = useRef<HTMLParagraphElement>(null);
  const review = async ({ git, ref }: Source): Promise<void> => {
    setBusy(true);
    setOutcome("");
    const answer = await call(() => api.POST("/api/imports", { body: { git, ref } }));
    setProblem("problem" in answer ? answer.problem : "");
    setPreview("data" in answer ? answer.data : null);
    setBusy(false);
  };
  const apply = async (importId: string, approve: string): Promise<void> => {
    setBusy(true);
    const params = { path: { importId } };
    const answer = await call(() => api.POST("/api/imports/{importId}/apply", { params, body: { approve } }));
    // A refused or failed run comes back as a problem with its findings; the review stays while its plan is kept.
    if ("problem" in answer) {
      setOutcome(answer.problem);
      if (answer.codes.some((code) => STALE.has(code))) setPreview(null);
    } else {
      setOutcome(t("import.applied", { runId: answer.data.runId ?? "none" }));
      setPreview(null);
    }
    setBusy(false);
    announced.current?.focus();
  };
  return (
    <Stack>
      <SourceForm busy={busy} onReview={(source) => void review(source)} />
      {problem !== "" && <Alert color="red">{problem}</Alert>}
      {preview && (
        <>
          <ReviewShown review={preview.review} />
          <ApplyOffer preview={preview} busy={busy} onApply={(id, hash) => void apply(id, hash)} />
        </>
      )}
      <Text role="status" ref={announced} tabIndex={-1}>
        {outcome}
      </Text>
    </Stack>
  );
};
