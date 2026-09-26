import { LANGUAGES } from "./languages/registry.ts";

export const SUPPORT_URL = "https://support.codefield.dev";
export const SUPPORT_NOTE = "Codefield is free and open source. Support its continued development.";

export const OPEN_COMMAND = "codefield .";
export const CLONE_COMMAND = "codefield clone git@example.com:team/project.git";

export type FaqEntry = {
  question: string;
  // Text in `backticks` is shown as code.
  answer: string;
};

const strong = LANGUAGES.filter((language) => language.strength === "strong").map((language) => language.name);
const conservative = LANGUAGES.filter((language) => language.strength === "conservative").map((language) => language.name);

export const FAQ: FaqEntry[] = [
  {
    question: "Does my source code leave my computer?",
    answer:
      "No. Codefield analyzes the repository on your machine and serves its interface from 127.0.0.1. It makes no network requests of its own and collects no analytics.",
  },
  {
    question: "Does Codefield upload my repository?",
    answer:
      "No. The browser only receives the graph: file paths relative to the repository, sizes, languages and relationships. Source text stays in the local Codefield process.",
  },
  {
    question: "Do I need GitHub?",
    answer:
      "No. Codefield opens any folder on your machine. To clone a repository, `codefield clone` uses your installed Git and your existing SSH or credential setup, whatever the host.",
  },
  {
    question: "Can I analyze private repositories?",
    answer:
      "Yes. Run `codefield` inside a repository that is already on your machine, or clone one with `codefield clone <remote>`: Git uses the credentials you already have, and Codefield never asks for them.",
  },
  {
    question: "Does Codefield support GitLab, Bitbucket or self-hosted Git?",
    answer: "Yes. If `git clone` reaches the repository from your terminal, `codefield clone` does too.",
  },
  {
    question: "Do I need to commit or push changes before Codefield sees them?",
    answer: "No. Codefield analyzes the files currently on disk. Use Analyze again after making changes.",
  },
  {
    question: "Does Codefield watch files automatically?",
    answer: "Not currently. Use Analyze again to read the folder again.",
  },
  {
    question: "Do I need to rebuild Codefield after changing my project?",
    answer: "No. Analyze again re-reads your project; Codefield itself never needs rebuilding.",
  },
  {
    question: "What do Graph and Structure mean?",
    answer:
      "Graph shows how the files depend on each other. Structure shows where the files and directories are in the repository. Both share the selection, search and filters.",
  },
  {
    question: "What does Impact Mode mean?",
    answer:
      "It lists the files that could be affected by changing the selected file, according to the static dependency graph. It is not a guarantee of what happens at runtime.",
  },
  {
    question: "What does Path Finder mean?",
    answer:
      "It finds the shortest directed chain of dependencies from one file to another in the static graph. A → B means A imports B.",
  },
  {
    question: "Which languages are supported?",
    answer: `${list(strong)} are resolved strongly: they name files or modules directly, so most dependencies show up. ${list(conservative)} are resolved conservatively: they mostly import namespaces or packages, so only references that map to exactly one file are kept.`,
  },
  {
    question: "Why is there no drag and drop or Choose Folder?",
    answer:
      "Codefield only reads the folder you start it with from the terminal. Keeping that choice out of the browser means no web page can ask Codefield to read other folders on your computer. To open another repository, start Codefield again from that folder.",
  },
  {
    question: "Is Codefield open source?",
    answer: "Yes, under the MIT license.",
  },
];

function list(names: string[]): string {
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}
