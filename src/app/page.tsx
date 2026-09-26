import { pageSession } from "@/app/local-session";
import { CommandLine } from "@/components/command-line";
import { HelpLinks } from "@/components/help-links";
import { ProductMark } from "@/components/product-mark";
import { describeRepository } from "@/lib/local/repository";
import { CLONE_COMMAND, OPEN_COMMAND } from "@/lib/product";

import { LocalAnalysis } from "./local-analysis";

// The page depends on the repository this process was started on, which is
// only known at run time.
export const dynamic = "force-dynamic";

export default async function Home() {
  const current = await pageSession();

  return (
    <>
      <header className="flex justify-end px-4 pt-3 sm:px-6">
        <HelpLinks />
      </header>
      <main className="flex flex-1 flex-col justify-center px-5 pt-6 pb-16 sm:px-8">
        <div className="mx-auto w-full max-w-xl">
          <h1>
            <ProductMark size="large" />
          </h1>
          <p className="mt-3 max-w-md text-base leading-relaxed text-muted sm:text-lg">
            Understand a local codebase visually.
          </p>
          <p className="mt-2 text-xs text-subtle">Your source code stays on your machine.</p>
        </div>

        {current.state === "authorized" ? (
          <LocalAnalysis repository={await describeRepository(current.session.root)} />
        ) : current.state === "unauthorized" ? (
          <div className="mx-auto mt-12 w-full max-w-xl">
            <h2 className="text-xs font-medium tracking-[0.12em] text-subtle uppercase">Open this session</h2>
            <p className="mt-2.5 text-sm leading-relaxed text-muted">
              This browser has not opened this Codefield session yet. Open the link printed in the terminal where
              Codefield is running; it contains the key for this session.
            </p>
          </div>
        ) : (
          <StartScreen />
        )}
      </main>
    </>
  );
}

function StartScreen() {
  return (
    <div className="mx-auto mt-12 grid w-full max-w-xl gap-10">
      <section>
        <h2 className="text-xs font-medium tracking-[0.12em] text-subtle uppercase">Open a repository</h2>
        <p className="mt-2.5 text-sm leading-relaxed text-muted">
          Start Codefield from the folder you want to explore. Any folder works, Git repository or not.
        </p>
        <CommandLine command={OPEN_COMMAND} />
      </section>
      <section>
        <h2 className="text-xs font-medium tracking-[0.12em] text-subtle uppercase">Clone a Git repository</h2>
        <p className="mt-2.5 text-sm leading-relaxed text-muted">
          Clones with your installed Git, SSH keys and credential helpers, then opens the clone. Codefield never asks
          for credentials.
        </p>
        <CommandLine command={CLONE_COMMAND} />
      </section>
      <p className="text-xs leading-relaxed text-subtle">
        Codefield only reads the folder it was started with, and reads the files as they are on disk: commit and push
        are not needed for changes to show. The page cannot open other folders on its own.
      </p>
    </div>
  );
}
