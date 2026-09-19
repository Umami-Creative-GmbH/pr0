/**
 * PROTOTYPE (issue #9) — seed library carried from the Claude Design
 * prototype, extended with archived and never-used prompts so the Archive and
 * Recents views are distinguishable. In-memory only.
 */

import type { Collection, Library, Prompt, Tag } from "./types";

const DAY = 86_400_000;

export const SEED_COLLECTIONS: Collection[] = [
  { id: "c-dev", name: "Entwicklung", accent: "#E60096" },
  { id: "c-ai", name: "KI", accent: "#FF8900" },
  { id: "c-marketing", name: "Marketing", accent: "#00D4A8" },
  { id: "c-writing", name: "Schreiben", accent: "#0078D2" },
];

export const SEED_TAGS: Tag[] = [
  { id: "t-website", name: "website" },
  { id: "t-audit", name: "audit" },
  { id: "t-ux", name: "ux" },
  { id: "t-react", name: "react" },
  { id: "t-review", name: "review" },
  { id: "t-ton", name: "Ton" },
  { id: "t-text", name: "Text" },
  { id: "t-uebersetzung", name: "Übersetzung" },
  { id: "t-bild", name: "Bild" },
  { id: "t-midjourney", name: "midjourney" },
  { id: "t-system", name: "System" },
  { id: "t-setup", name: "setup" },
  { id: "t-social", name: "social" },
  { id: "t-b2b", name: "b2b" },
  { id: "t-copy", name: "copy" },
  { id: "t-web", name: "web" },
  { id: "t-sql", name: "sql" },
  { id: "t-daten", name: "Daten" },
  { id: "t-meeting", name: "Meeting" },
  { id: "t-summary", name: "summary" },
  { id: "t-git", name: "git" },
  { id: "t-research", name: "research" },
  { id: "t-strasse", name: "Straßenverkehr" },
];

interface SeedSpec {
  id: string;
  title: string;
  description: string;
  content: string;
  collectionId: string | null;
  tagIds: string[];
  favorite?: boolean;
  archived?: boolean;
  createdDaysAgo: number;
  modifiedDaysAgo: number;
  /** Omitted when the prompt has never been copied. */
  usedDaysAgo?: number;
  useCount?: number;
}

const SPECS: SeedSpec[] = [
  {
    id: "p-a11y",
    title: "Website Accessibility Audit",
    description:
      "Vollständiger WCAG-Check einer Seite, sortiert nach Schweregrad.",
    content:
      "Prüfe die folgende Website {{url}} auf Barrierefreiheit nach WCAG 2.2 AA.\n\nGehe Seite für Seite vor und bewerte: Kontraste, Tastaturbedienung, Fokusreihenfolge, semantische Struktur, Alternativtexte, Formularbeschriftungen.\n\nGib das Ergebnis als {{format}} aus. Pro Verstoß: Schweregrad, betroffenes Element, konkrete Empfehlung.",
    collectionId: "c-dev",
    tagIds: ["t-website", "t-audit", "t-ux"],
    favorite: true,
    createdDaysAgo: 191,
    modifiedDaysAgo: 2,
    usedDaysAgo: 2,
    useCount: 34,
  },
  {
    id: "p-review",
    title: "Code Review – React",
    description: "Review auf Lesbarkeit, Performance und Zugänglichkeit.",
    content:
      "Du bist ein erfahrener React-Entwickler. Review den folgenden Code auf Lesbarkeit, Performance und Zugänglichkeit.\n\n{{code}}\n\nAntworte in Stichpunkten, sortiert nach Priorität. Nenne zu jedem Punkt die betroffene Zeile und einen konkreten Vorschlag.",
    collectionId: "c-dev",
    tagIds: ["t-react", "t-review"],
    createdDaysAgo: 228,
    modifiedDaysAgo: 6,
    usedDaysAgo: 6,
    useCount: 21,
  },
  {
    id: "p-rewrite",
    title: "Text professionell umschreiben",
    description: "Sachlicher Ton, gleiche Fakten, definierte Kürzung.",
    content:
      "Schreibe den folgenden Text professionell und sachlich um. Behalte alle Fakten und Zahlen unverändert bei und kürze um etwa {{kuerzung}} Prozent.\n\nVermeide Superlative, Füllwörter und Marketingsprache.\n\n{{text}}",
    collectionId: "c-writing",
    tagIds: ["t-ton", "t-text"],
    favorite: true,
    createdDaysAgo: 243,
    modifiedDaysAgo: 1,
    usedDaysAgo: 1,
    useCount: 57,
  },
  {
    id: "p-translate",
    title: "Übersetzen DE → EN",
    description: "Fachbegriffe bleiben stehen, Ton wählbar.",
    content:
      "Übersetze den folgenden Text ins Englische. Ton: {{ton}}.\n\nFachbegriffe der Branche bleiben unübersetzt. Halte Absatzstruktur und Formatierung bei.\n\n{{text}}",
    collectionId: "c-writing",
    tagIds: ["t-uebersetzung"],
    createdDaysAgo: 245,
    modifiedDaysAgo: 9,
    usedDaysAgo: 9,
    useCount: 42,
  },
  {
    id: "p-image",
    title: "Bildprompt generieren",
    description: "Ein Absatz Englisch, Komposition bis Farbstimmung.",
    content:
      "Erzeuge einen detaillierten Bildprompt für {{motiv}}. Stil: {{stil}}.\n\nBeschreibe in einem Absatz auf Englisch: Komposition, Blickwinkel, Licht, Objektiv, Farbstimmung und Materialität. Keine Aufzählung, keine Kameraeinstellungen als Liste.",
    collectionId: "c-ai",
    tagIds: ["t-bild", "t-midjourney"],
    createdDaysAgo: 201,
    modifiedDaysAgo: 3,
    usedDaysAgo: 3,
    useCount: 18,
  },
  {
    id: "p-system",
    title: "Systemprompt-Gerüst",
    description: "Rolle, Aufgabe, Regeln, Ausgabeformat als Grundgerüst.",
    content:
      "Du bist {{rolle}}.\n\nAufgabe: {{aufgabe}}\n\nRegeln:\n– Antworte ausschließlich auf Deutsch.\n– Frage nach, wenn Informationen fehlen.\n– Keine Annahmen über Daten, die nicht genannt wurden.\n\nAusgabeformat: {{format}}",
    collectionId: "c-ai",
    tagIds: ["t-system", "t-setup"],
    favorite: true,
    createdDaysAgo: 220,
    modifiedDaysAgo: 4,
    usedDaysAgo: 4,
    useCount: 29,
  },
  {
    id: "p-linkedin",
    title: "LinkedIn-Post aus Case Study",
    description: "B2B-Post mit Ergebnis im ersten Satz.",
    content:
      "Erstelle aus der folgenden Case Study einen LinkedIn-Post für ein B2B-Publikum.\n\n{{casestudy}}\n\nDas Ergebnis steht im ersten Satz. Maximal 1.200 Zeichen, keine Hashtag-Wand, kein Emoji.",
    collectionId: "c-marketing",
    tagIds: ["t-social", "t-b2b"],
    createdDaysAgo: 205,
    modifiedDaysAgo: 8,
    usedDaysAgo: 8,
    useCount: 12,
  },
  {
    id: "p-headlines",
    title: "Landingpage-Headlines",
    description: "Zehn Varianten, verb-first und konkret.",
    content:
      "Schreibe zehn Headline-Varianten für die Landingpage von {{produkt}}.\n\nZielgruppe: {{zielgruppe}}\n\nJede Headline beginnt mit einem Verb, nennt einen konkreten Nutzen und bleibt unter 60 Zeichen.",
    collectionId: "c-marketing",
    tagIds: ["t-copy", "t-web"],
    createdDaysAgo: 216,
    modifiedDaysAgo: 11,
    usedDaysAgo: 11,
    useCount: 9,
  },
  {
    id: "p-sql",
    title: "SQL erklären",
    description: "Query Schritt für Schritt aufschlüsseln.",
    content:
      "Erkläre die folgende SQL-Query Schritt für Schritt.\n\n{{query}}\n\nNenne zum Schluss mögliche Performance-Probleme und passende Indizes.",
    collectionId: "c-dev",
    tagIds: ["t-sql", "t-daten"],
    createdDaysAgo: 254,
    modifiedDaysAgo: 14,
    usedDaysAgo: 14,
    useCount: 15,
  },
  {
    id: "p-meeting",
    title: "Meeting-Notizen zusammenfassen",
    description: "Entscheidungen, Aufgaben, offene Punkte.",
    content:
      "Fasse die folgenden Meeting-Notizen zusammen.\n\n{{notizen}}\n\nStruktur: Entscheidungen, Aufgaben mit verantwortlicher Person, offene Punkte. Keine Wiederholung des Verlaufs.",
    collectionId: "c-writing",
    tagIds: ["t-meeting", "t-summary"],
    createdDaysAgo: 271,
    modifiedDaysAgo: 5,
    usedDaysAgo: 5,
    useCount: 38,
  },
  {
    id: "p-commit",
    title: "Commit-Message",
    description: "Conventional Commits aus einem Diff.",
    content:
      "Schreibe eine Commit-Message im Conventional-Commits-Format für das folgende Diff.\n\n{{diff}}\n\nBetreffzeile maximal 72 Zeichen, danach optional drei Stichpunkte.",
    collectionId: "c-dev",
    tagIds: ["t-git"],
    createdDaysAgo: 288,
    modifiedDaysAgo: 16,
    usedDaysAgo: 16,
    useCount: 63,
  },
  {
    id: "p-competitors",
    title: "Wettbewerbsanalyse",
    description: "Fünf Wettbewerber, Positionierung und Lücke.",
    content:
      "Analysiere fünf Wettbewerber von {{unternehmen}} im Markt {{markt}}.\n\nPro Wettbewerber: Positionierung, Zielgruppe, Preismodell, erkennbare Schwäche. Schließe mit der Lücke, die {{unternehmen}} besetzen kann.",
    collectionId: "c-marketing",
    tagIds: ["t-research"],
    createdDaysAgo: 293,
    modifiedDaysAgo: 21,
    usedDaysAgo: 21,
    useCount: 7,
  },

  // No variables: copying these writes to the clipboard immediately, so the
  // launcher's "close only after a successful write" rule applies literally.
  {
    id: "p-spellcheck",
    title: "Rechtschreibung und Grammatik prüfen",
    description: "Korrektur ohne Umformulierung, mit Begründung.",
    content:
      "Prüfe den folgenden Text auf Rechtschreibung, Grammatik und Zeichensetzung.\n\nKorrigiere nur Fehler, formuliere nichts um. Liste am Ende jede Änderung mit kurzer Begründung auf.",
    collectionId: "c-writing",
    tagIds: ["t-text"],
    favorite: true,
    createdDaysAgo: 96,
    modifiedDaysAgo: 7,
    usedDaysAgo: 0,
    useCount: 88,
  },
  {
    id: "p-standup",
    title: "Daily-Standup-Fragen",
    description: "Drei Fragen, keine Statusromane.",
    content:
      "Formuliere drei kurze Standup-Fragen für ein Entwicklungsteam.\n\nJede Frage zielt auf Fortschritt, Blocker oder Abhängigkeiten. Keine Statusberichte, keine Schätzungen.",
    collectionId: "c-dev",
    tagIds: ["t-meeting"],
    createdDaysAgo: 60,
    modifiedDaysAgo: 18,
    usedDaysAgo: 10,
    useCount: 6,
  },

  // Never used: present in All prompts, absent from Recents.
  {
    id: "p-changelog",
    title: "Changelog aus Commits",
    description: "Nutzerlesbare Release Notes, keine Commit-Liste.",
    content:
      "Erzeuge aus den folgenden Commits nutzerlesbare Release Notes.\n\n{{commits}}\n\nGruppiere nach Neu, Verbessert, Behoben. Keine internen Refactorings.",
    collectionId: "c-dev",
    tagIds: ["t-git"],
    createdDaysAgo: 4,
    modifiedDaysAgo: 4,
  },
  {
    id: "p-unassigned",
    title: "Straßenverkehr erklären",
    description:
      "Ohne Sammlung — prüft Umlaut- und ß-Normalisierung in der Suche.",
    content:
      "Erkläre die Vorfahrtsregeln im deutschen Straßenverkehr für {{zielgruppe}} in einfacher Sprache.",
    collectionId: null,
    tagIds: ["t-strasse"],
    createdDaysAgo: 12,
    modifiedDaysAgo: 12,
  },

  // Archived: excluded from all active views and from the launcher.
  {
    id: "p-archived-fav",
    title: "Alter Newsletter-Aufbau",
    description: "Archiviert, aber weiterhin Favorit und kopierbar.",
    content:
      "Baue einen Newsletter für {{thema}} mit Betreff, Vorschautext und drei Abschnitten.",
    collectionId: "c-marketing",
    tagIds: ["t-copy"],
    favorite: true,
    archived: true,
    createdDaysAgo: 320,
    modifiedDaysAgo: 40,
    usedDaysAgo: 38,
    useCount: 11,
  },
  {
    id: "p-archived-plain",
    title: "Jira-Ticket formulieren",
    description: "Archiviert, ersetzt durch eine Vorlage im Tool.",
    content:
      "Formuliere ein Jira-Ticket für {{aufgabe}} mit Kontext, Akzeptanzkriterien und Definition of Done.",
    collectionId: "c-dev",
    tagIds: ["t-review"],
    archived: true,
    createdDaysAgo: 300,
    modifiedDaysAgo: 55,
  },
];

const toPrompt = (spec: SeedSpec, now: number): Prompt => ({
  id: spec.id,
  title: spec.title,
  description: spec.description,
  content: spec.content,
  collectionId: spec.collectionId,
  tagIds: spec.tagIds,
  favorite: spec.favorite ?? false,
  archived: spec.archived ?? false,
  createdAt: now - spec.createdDaysAgo * DAY,
  modifiedAt: now - spec.modifiedDaysAgo * DAY,
  lastUsedAt:
    spec.usedDaysAgo === undefined ? null : now - spec.usedDaysAgo * DAY,
  useCount: spec.useCount ?? 0,
});

export const createSeedLibrary = (now: number): Library => ({
  prompts: SPECS.map((spec) => toPrompt(spec, now)),
  collections: SEED_COLLECTIONS,
  tags: SEED_TAGS,
});

/** An empty library, for driving the "genuinely empty" empty state. */
export const createEmptyLibrary = (): Library => ({
  prompts: [],
  collections: SEED_COLLECTIONS,
  tags: SEED_TAGS,
});
