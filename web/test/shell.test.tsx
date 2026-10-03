import { useEffect } from "react";
import { render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppProvider, useDispatch } from "@/app/AppProvider";
import { AppShell } from "@/app/AppShell";

/**
 * Shell-level coverage for seat A: the landmarks a keyboard and a screen reader depend on, the
 * hero the landing page is built around, and the two failure signals — an error in state must be
 * announced, and rendering must stay silent on the console.
 */

function ErrorDriver() {
  const dispatch = useDispatch();
  useEffect(() => {
    dispatch({ type: "error/set", error: { code: "TEST_ERROR", message: "something went wrong" } });
  }, [dispatch]);
  return <AppShell />;
}

const renderShell = () =>
  render(
    <AppProvider>
      <AppShell />
    </AppProvider>,
  );

describe("app shell", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders a skip link that targets the workbench", () => {
    renderShell();
    const skip = screen.getByRole("link", { name: /skip to the workbench/i });
    expect(skip).toHaveAttribute("href", "#workbench");
    expect(document.getElementById("workbench")).not.toBeNull();
  });

  it("exposes the page landmarks", () => {
    renderShell();
    expect(screen.getByRole("banner")).toBeInTheDocument();
    expect(screen.getByRole("main")).toBeInTheDocument();
    expect(screen.getByRole("contentinfo")).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: /sections/i })).toBeInTheDocument();
  });

  it("renders the hero heading", () => {
    renderShell();
    expect(
      screen.getByRole("heading", { level: 1, name: /sign a plan/i }),
    ).toBeInTheDocument();
    // The hero's second action is an in-page anchor, so it cannot 404 outside the served root.
    const hero = document.querySelector(".app-hero");
    expect(hero).not.toBeNull();
    const how = within(hero as HTMLElement).getByRole("link", { name: /^how it works$/i });
    expect(how).toHaveAttribute("href", "#how");
    expect(document.getElementById("how-title")).not.toBeNull();
  });

  it("keeps every footer link inside the page it is rendered on", () => {
    renderShell();
    const footer = screen.getByRole("contentinfo");
    const links = within(footer).getAllByRole("link");
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      const href = link.getAttribute("href");
      expect(href).toMatch(/^#/);
      const id = href?.slice(1);
      expect(document.getElementById(id ?? "")).not.toBeNull();
    }
  });

  it("announces the error the state carries", () => {
    render(
      <AppProvider>
        <ErrorDriver />
      </AppProvider>,
    );
    const notice = screen.getByRole("alert");
    expect(notice).toHaveTextContent("TEST_ERROR");
    expect(notice).toHaveTextContent("something went wrong");
  });

  it("renders without writing to the console", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    renderShell();
    expect(spy).not.toHaveBeenCalled();
  });
});
