import { AppProvider } from "@/app/AppProvider";
import { AppShell } from "@/app/AppShell";

export function App() {
  return (
    <AppProvider>
      <AppShell />
    </AppProvider>
  );
}
