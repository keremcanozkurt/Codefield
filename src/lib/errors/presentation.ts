import { LANGUAGES } from "../languages/registry.ts";

// What a component shows for a failed analysis. Error copy lives here rather
// than spread across components, and only these fields cross to the browser:
// no absolute paths, system error messages or stack traces.
export type PresentedError = {
  title: string;
  message: string;
  retryable: boolean;
};

export type RepositoryErrorCode = "root_unavailable" | "not_a_directory" | "resources_exceeded" | "failed";

const COPY: Record<RepositoryErrorCode, PresentedError> = {
  root_unavailable: {
    title: "Folder unavailable",
    message: "The folder Codefield was started with could not be read. It may have been moved, deleted, or its permissions changed.",
    retryable: true,
  },
  not_a_directory: {
    title: "Not a folder",
    message: "Codefield was started with a path that is not a folder.",
    retryable: false,
  },
  resources_exceeded: {
    title: "Repository too large to analyze",
    message: "The selected source files exceed the memory Codefield allows for one analysis.",
    retryable: false,
  },
  failed: {
    title: "Analysis failed",
    message: "Codefield could not analyze this folder. The terminal running Codefield may show more.",
    retryable: true,
  },
};

export function presentRepositoryError(code: RepositoryErrorCode): PresentedError {
  return COPY[code];
}

// The browser lost its connection to the local Codefield process, usually
// because it was stopped.
export const CONNECTION_LOST: PresentedError = {
  title: "Codefield is not running",
  message: "The browser could not reach the local Codefield process. Start it again from the terminal.",
  retryable: true,
};

// A folder with no files at all.
export const EMPTY_REPOSITORY = {
  title: "Nothing to analyze",
  message: "This folder has no files to analyze.",
} as const;

export const NO_SUPPORTED_SOURCE_FILES = {
  title: "No supported source files",
  message: "No source files in a supported language were found.",
  detail: `Codefield analyzes ${listNames(LANGUAGES.map((language) => language.name))}.`,
} as const;

// Supported source files exist, but every one of them was skipped.
export const NO_READABLE_SOURCE_FILES = {
  title: "No source files could be analyzed",
  message: "Source files in supported languages were found, but none of them could be read.",
} as const;

function listNames(names: string[]): string {
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}
