import { Dashboard } from "./components/Dashboard";

export const dynamic = "force-dynamic";

export default function Home() {
  return (
    <main className="min-h-full bg-zinc-50 dark:bg-zinc-950">
      <Dashboard />
    </main>
  );
}
