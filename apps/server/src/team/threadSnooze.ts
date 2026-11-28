import type {
  AuthSessionId,
  OrchestrationV2Command,
  OrchestrationV2ThreadShell,
  TeamThreadSnoozeState,
  ThreadId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import type { TeamService } from "./TeamService.ts";

export function makeThreadSnoozeOverlay(rows: ReadonlyArray<TeamThreadSnoozeState> | null) {
  const byId = rows === null ? null : new Map(rows.map((row) => [row.threadId, row]));
  return <T extends { readonly id: ThreadId }>(thread: T): T => {
    if (byId === null) return thread;
    const snooze = byId.get(thread.id);
    return {
      ...thread,
      snoozedUntil: snooze?.snoozedUntil ? DateTime.makeUnsafe(snooze.snoozedUntil) : null,
      snoozedAt: snooze?.snoozedAt ? DateTime.makeUnsafe(snooze.snoozedAt) : null,
      lastSnoozeWakeAt: snooze?.lastSnoozeWakeAt
        ? DateTime.makeUnsafe(snooze.lastSnoozeWakeAt)
        : null,
    };
  };
}

export const ignoreSharedRelaySnooze = Effect.fn("TeamThreadSnooze.ignoreSharedRelaySnooze")(
  function* <
    T extends { readonly id: ThreadId; readonly snoozedUntil?: DateTime.Utc | null | undefined },
  >(service: Option.Option<TeamService["Service"]>, thread: Option.Option<T>) {
    return Option.isSome(thread) &&
      thread.value.snoozedUntil != null &&
      Option.isSome(service) &&
      (yield* service.value.isTeamConfigured())
      ? Option.map(thread, makeThreadSnoozeOverlay([]))
      : thread;
  },
);

export function isSnoozeOnlyRecoveryUpdate(command: OrchestrationV2Command): boolean {
  if (command.type !== "thread.metadata.update" || command.limitRecovery?.snooze === undefined)
    return false;
  const {
    type: _type,
    commandId: _commandId,
    threadId: _threadId,
    limitRecovery,
    ...other
  } = command;
  return (
    limitRecovery.autoResume === undefined &&
    Object.values(other).every((value) => value === undefined)
  );
}

export function overlayCompatRecoverySnooze(
  thread: OrchestrationV2ThreadShell,
): OrchestrationV2ThreadShell {
  const { latestRunId, usageLimitResetAt, snoozedUntil, limitRecovery } = thread;
  const snooze =
    latestRunId !== null &&
    usageLimitResetAt != null &&
    snoozedUntil != null &&
    DateTime.toEpochMillis(snoozedUntil) === Date.parse(usageLimitResetAt);
  if (snooze && latestRunId !== null && usageLimitResetAt != null) {
    return {
      ...thread,
      limitRecovery: {
        runId: latestRunId,
        resetAt: usageLimitResetAt,
        snooze: true,
        autoResume:
          limitRecovery?.runId === latestRunId &&
          Date.parse(limitRecovery.resetAt) === Date.parse(usageLimitResetAt) &&
          limitRecovery.autoResume,
      },
    };
  }
  return limitRecovery?.snooze === true
    ? { ...thread, limitRecovery: { ...limitRecovery, snooze: false } }
    : thread;
}

export const loadMemberSnoozeOverlay = (
  teamService: TeamService["Service"],
  sessionId: AuthSessionId,
) =>
  teamService
    .listActorThreadSnoozes({ kind: "session", sessionId })
    .pipe(Effect.map(makeThreadSnoozeOverlay));
