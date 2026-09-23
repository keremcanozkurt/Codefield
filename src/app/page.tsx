import { RepositoryForm } from "./repository-form";

export default function Home() {
  return (
    <main className="flex flex-1 flex-col justify-center px-5 py-16 sm:px-8">
      <div className="mx-auto w-full max-w-xl">
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
          Codefield
        </h1>
        <p className="mt-3 max-w-md text-base leading-relaxed text-muted sm:text-lg">
          Turn a public GitHub repository into an interactive map of its code.
        </p>
      </div>

      <RepositoryForm />
    </main>
  );
}
