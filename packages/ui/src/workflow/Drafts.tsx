import type { Api } from "@cedarloom/client";
import { Refusal, readDocument, WORKFLOW_SCHEMA_VERSION, WorkflowDefinition } from "@cedarloom/contracts";
import { Button, Group, Stack, Text, Title } from "@mantine/core";
import { type ReactNode, type RefObject, useEffect, useRef, useState } from "react";
import { t, when } from "../i18n.ts";
import type { Change } from "./document.ts";
import { describe } from "./problems.ts";

type Offer = { id: string; savedAt: string; problem?: string };
type Answer<T> = { data: T | undefined } | { problem: string };

// A save waits this long after the last edit, so a drag or a burst of edits is one write.
const DELAY = 1000;

// This tab's drafts: for each id, the hash of the version it saved or restored last, which its next save replaces. Like
// the document, they outlive the view; a reload starts without them, and every draft is offered.
const mine = new Map<string, string>();
// Every workflow this tab saved or restored since the page loaded: its own drafts are no offer, even while a save that
// started as the view closed has not answered yet.
const ours = new Set<string>();
// The last edit made while a draft of its workflow was on offer: Discard saves it, also after the view was left.
let held: WorkflowDefinition | null = null;

const idOf = (workflow: WorkflowDefinition): string => workflow.metadata.id.toLowerCase();

/** The answer's data, or why there is none: the server's first finding as a sentence, the status, or no server. */
const ask = async <T,>(
  request: () => Promise<{ data?: T; error?: unknown; response: Response }>,
): Promise<Answer<T>> => {
  try {
    const { data, error, response } = await request();
    if (error === undefined) return { data };
    const first = Refusal.safeParse(error).data?.findings[0];
    return {
      problem: first === undefined ? t("error.failed", { status: response.status, error: "" }) : describe(first),
    };
  } catch {
    return { problem: t("error.unreachable") };
  }
};

/** The drafts found when the editor opens, but this tab's own; their ids stay unsaved until restored or discarded. */
const useOffers = (api: Api) => {
  const [offers, setOffers] = useState<Offer[]>([]);
  const open = useRef(new Set<string>());
  useEffect(() => {
    const load = async (): Promise<void> => {
      const answer = await ask(() => api.GET("/api/drafts"));
      const found = ("data" in answer ? (answer.data?.drafts ?? []) : []).filter((draft) => !ours.has(draft.id));
      open.current = new Set(found.map((draft) => draft.id));
      setOffers(found);
    };
    void load();
  }, [api]);
  /** Ends an offer, or (with a problem) keeps it to be discarded only. */
  const settle = (id: string, problem?: string): void => {
    if (problem === undefined) open.current.delete(id);
    const next = (offer: Offer): Offer[] => {
      if (offer.id !== id) return [offer];
      return problem === undefined ? [] : [{ ...offer, problem }];
    };
    setOffers((all) => all.flatMap(next));
  };
  return { offers, open, settle };
};

type Saving = {
  api: Api;
  workflow: WorkflowDefinition;
  /** How many documents were opened: an opened one is no edit, so it is not saved. */
  loads: number;
  onStatus: (text: string) => void;
  open: RefObject<Set<string>>;
};

/** Saves each edit a second after the last; `cancel` drops what waits of a workflow, `resume` saves its held edit. */
const useAutosave = ({ api, workflow, loads, onStatus, open }: Saving) => {
  const [saved, setSaved] = useState("");
  const pending = useRef<WorkflowDefinition | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const seen = useRef({ loads, workflow });
  const save = async (next: WorkflowDefinition): Promise<void> => {
    const id = idOf(next);
    if (open.current.has(id)) {
      held = next;
      return onStatus(t("draft.waiting", { id }));
    }
    ours.add(id);
    const body = { workflow: next, replaces: mine.get(id) ?? null };
    const answer = await ask(() => api.PUT("/api/drafts/{id}", { params: { path: { id } }, body }));
    if ("problem" in answer) return onStatus(t("draft.notSaved", { reason: answer.problem }));
    if (answer.data === undefined) return undefined;
    mine.set(id, answer.data.hash);
    setSaved(t("draft.saved", { time: when(answer.data.savedAt) }));
    if (answer.data.overwrote) onStatus(t("draft.overwrote", { id }));
  };
  const flush = (): void => {
    clearTimeout(timer.current);
    const next = pending.current;
    pending.current = null;
    if (next !== null) void save(next);
  };
  useEffect(() => {
    const was = seen.current;
    seen.current = { loads, workflow };
    if (loads !== was.loads || workflow === was.workflow) return;
    // An edit of another workflow (after an import, or an undo across one) first saves what waits of the one before.
    if (pending.current !== null && idOf(pending.current) !== idOf(workflow)) flush();
    pending.current = workflow;
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, DELAY);
  }, [loads, workflow]);
  // Leaving the view saves what is waiting.
  useEffect(() => flush, []);
  const cancel = (id: string): void => {
    if (held !== null && idOf(held) === id) held = null;
    if (pending.current === null || idOf(pending.current) !== id) return;
    clearTimeout(timer.current);
    pending.current = null;
  };
  const resume = (id: string): void => {
    if (held === null || idOf(held) !== id) return;
    void save(held);
    held = null;
  };
  return { saved, setSaved, cancel, resume };
};

type Props = Omit<Saving, "open"> & { change: (change: Change) => void; focus: () => void };

/**
 * The editor's drafts in the state folder: each edit is saved a second after the last one, the drafts found on opening
 * are offered to restore or discard, and `release` removes this tab's draft after an export.
 */
export const useDrafts = ({ change, focus, ...props }: Props) => {
  const { api, workflow, onStatus } = props;
  const { offers, open, settle } = useOffers(api);
  const { saved, setSaved, cancel, resume } = useAutosave({ ...props, open });
  // Restore and Discard remove their button: their result is announced, and focus moves to it.
  const announce = (text: string): void => {
    onStatus(text);
    focus();
  };
  const refuse = (id: string, reason: string): void => {
    settle(id, reason);
    announce(t("draft.notRestored", { id, reason }));
  };
  const restore = async (id: string): Promise<void> => {
    const answer = await ask(() => api.GET("/api/drafts/{id}", { params: { path: { id } } }));
    if ("problem" in answer) return refuse(id, answer.problem);
    if (answer.data === undefined) return undefined;
    const read = readDocument(WorkflowDefinition, WORKFLOW_SCHEMA_VERSION, answer.data.workflow);
    if (!read.ok) return refuse(id, describe(read.finding));
    // An edit of the same workflow that waits would write the version before the draft over it.
    cancel(id);
    ours.add(id);
    mine.set(id, answer.data.hash);
    change({ kind: "replace", workflow: read.value });
    settle(id);
    setSaved("");
    announce(t("draft.restored", { time: when(answer.data.savedAt) }));
  };
  const discard = async (id: string): Promise<void> => {
    const answer = await ask(() => api.DELETE("/api/drafts/{id}", { params: { path: { id } } }));
    settle(id);
    announce("problem" in answer ? answer.problem : t("draft.discarded", { id }));
    resume(id);
  };
  const release = (): void => {
    const id = idOf(workflow);
    // Only the open workflow's: a save of another one that still waits goes ahead.
    cancel(id);
    if (!mine.delete(id)) return;
    setSaved("");
    void ask(() => api.DELETE("/api/drafts/{id}", { params: { path: { id } } }));
  };
  return { offers: <Offers offers={offers} restore={restore} discard={discard} />, saved, release };
};

type OffersProps = { offers: Offer[]; restore: (id: string) => Promise<void>; discard: (id: string) => Promise<void> };

/** The drafts found on opening, each to restore or discard; one that cannot be read says why, and can only go. */
const Offers = ({ offers, restore, discard }: OffersProps): ReactNode =>
  offers.length === 0 ? null : (
    <section aria-labelledby="workflow-drafts">
      <Title order={3} size="h5" id="workflow-drafts" mb="xs">
        {t("draft.title")}
      </Title>
      <Stack gap="xs">
        {offers.map(({ id, savedAt, problem }) => (
          <Group key={id}>
            <Text>{t("draft.offer", { id, time: when(savedAt) })}</Text>
            {problem === undefined ? (
              <Button size="xs" onClick={() => void restore(id)} aria-label={t("draft.restoreOne", { id })}>
                {t("draft.restore")}
              </Button>
            ) : (
              <Text>{t("draft.unreadable", { reason: problem })}</Text>
            )}
            <Button
              size="xs"
              variant="default"
              onClick={() => void discard(id)}
              aria-label={t("draft.discardOne", { id })}
            >
              {t("draft.discard")}
            </Button>
          </Group>
        ))}
      </Stack>
    </section>
  );
