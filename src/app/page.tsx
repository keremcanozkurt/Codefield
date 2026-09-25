import { requestCookieJar } from "@/app/github";
import { GitHubConnection } from "@/components/github-connection";
import { connectPath, manageAccessUrl, readGitHubAppConfig, repositoryUrl } from "@/lib/github/app";
import { connectionStatus } from "@/lib/github/connection";
import { parseRepositoryUrl } from "@/lib/repository-url";

import { RepositoryForm } from "./repository-form";

export default async function Home({ searchParams }: PageProps<"/">) {
  const params = await searchParams;
  const config = readGitHubAppConfig();
  // Set after returning from GitHub, to put the repository the user was
  // trying to analyze back in the form.
  const repository = parseRepositoryUrl(first(params.repository) ?? "");

  return (
    <main className="flex flex-1 flex-col justify-center px-5 py-16 sm:px-8">
      <div className="mx-auto w-full max-w-xl">
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
          Codefield
        </h1>
        <p className="mt-3 max-w-md text-base leading-relaxed text-muted sm:text-lg">
          Turn a public GitHub repository into an interactive map of its code.
        </p>
        {config !== null && (
          <GitHubConnection
            status={connectionStatus(await requestCookieJar(), config)}
            connectHref={connectPath()}
            manageHref={manageAccessUrl(config)}
            notice={first(params.github) ?? null}
          />
        )}
      </div>

      <RepositoryForm initialUrl={repository.ok ? repositoryUrl(repository.repository) : ""} />
    </main>
  );
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
