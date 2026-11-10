// Release version policy (ADR-0001 amendment). This module has no dependencies so
// release workflows can run it from a copy of the default branch before checking
// out the tag or candidate commit they build.
import reservedFile from "./reserved-rehearsal-versions.json";

export interface RehearsalReservation {
  /** The release candidate whose update this target rehearses. */
  candidate: string;
  /** The reserved rehearsal target version, never released. */
  version: string;
}

/** The shape of reserved-rehearsal-versions.json, checked by typecheck. */
export interface ReservedVersionsFile {
  rehearsalTargets: readonly RehearsalReservation[];
}

/**
 * The files the desktop build leaves for one version, in this order: the
 * Windows installer, its updater signature and the signing evidence.
 */
export const releaseFiles = (
  version: string
): readonly [installer: string, signature: string, evidence: string] => {
  const installer = `pr0_${version}_x64-setup.exe`;
  return [installer, `${installer}.sig`, "signing-evidence.json"];
};

const versionPattern = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/u;

const nextPatch = (version: string): string => {
  const [major, minor, patch] = version.split(".");
  return `${major}.${minor}.${Number(patch) + 1}`;
};

/** Enforces the version policy on the reserved-versions list. */
export const parseReservations = ({
  rehearsalTargets,
}: ReservedVersionsFile): readonly RehearsalReservation[] => {
  for (const { version, candidate } of rehearsalTargets) {
    if (!(versionPattern.test(version) && versionPattern.test(candidate))) {
      throw new Error(
        `Reservation ${version} for ${candidate} must use plain versions`
      );
    }
    if (version !== nextPatch(candidate)) {
      throw new Error(
        `Rehearsal target ${version} must be the patch version after its candidate ${candidate}`
      );
    }
  }
  const reservations = rehearsalTargets.map(({ version, candidate }) => ({
    version,
    candidate,
  }));
  const reserved = new Set(reservations.map(({ version }) => version));
  if (reserved.size !== reservations.length) {
    throw new Error("A rehearsal version is reserved twice");
  }
  if (reservations.some(({ candidate }) => reserved.has(candidate))) {
    throw new Error("A reserved rehearsal version cannot be a candidate");
  }
  return reservations;
};

export const reservedRehearsalVersions: readonly RehearsalReservation[] =
  parseReservations(reservedFile);

/** Accepts only plain versions that are not reserved for rehearsal targets. */
export const validatePublicVersion = (
  version: string,
  reservations: readonly RehearsalReservation[] = reservedRehearsalVersions
): void => {
  if (!versionPattern.test(version)) {
    throw new Error(`Invalid public version: ${version}`);
  }
  if (reservations.some((reservation) => reservation.version === version)) {
    throw new Error(
      `Invalid public version: ${version} is reserved for a rehearsal target`
    );
  }
};

/** Accepts only reserved rehearsal versions and returns their reservation. */
export const validateRehearsalVersion = (
  version: string,
  reservations: readonly RehearsalReservation[] = reservedRehearsalVersions
): RehearsalReservation => {
  const reservation = reservations.find((entry) => entry.version === version);
  if (!(versionPattern.test(version) && reservation)) {
    throw new Error(`Not a reserved rehearsal version: ${version}`);
  }
  return reservation;
};

const usage =
  "Usage: bun release-versions.ts public <version> | rehearsal <version>";

if (import.meta.main) {
  const [command, version = ""] = process.argv.slice(2);
  if (command === "public") {
    validatePublicVersion(version);
  } else if (command === "rehearsal") {
    // Prints the candidate version for the workflow to build from.
    process.stdout.write(`${validateRehearsalVersion(version).candidate}\n`);
  } else {
    throw new Error(usage);
  }
}
