import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SWRConfig } from "swr";
import { ProvidersPage } from "@/pages/ProvidersPage";
import type { Provider } from "@/types";

const {
  createProviderMock,
  deleteProviderMock,
  fetchProviderCatalogPreviewMock,
  testProviderModelRequestMock,
  toastErrorMock,
  toastSuccessMock,
  updateProviderMock,
} = vi.hoisted(() => ({
  createProviderMock: vi.fn(),
  deleteProviderMock: vi.fn(),
  fetchProviderCatalogPreviewMock: vi.fn(),
  testProviderModelRequestMock: vi.fn(),
  toastErrorMock: vi.fn(),
  toastSuccessMock: vi.fn(),
  updateProviderMock: vi.fn(),
}));

const { swrMock } = vi.hoisted(() => ({
  swrMock: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  createProvider: (...args: unknown[]) => createProviderMock(...args),
  deleteProvider: (...args: unknown[]) => deleteProviderMock(...args),
  fetchProviderCatalogPreview: (...args: unknown[]) =>
    fetchProviderCatalogPreviewMock(...args),
  fetchProviders: vi.fn(),
  testProviderModelRequest: (...args: unknown[]) =>
    testProviderModelRequestMock(...args),
  updateProvider: (...args: unknown[]) => updateProviderMock(...args),
}));

vi.mock("swr", () => ({
  SWRConfig: ({ children }: { children?: unknown }) => children,
  default: (...args: unknown[]) => swrMock(...args),
}));

vi.mock("@/hooks/usePanelDrag", () => ({
  usePanelDrag: () => ({
    isDragging: false,
    startDrag: vi.fn(),
  }),
  usePanelWidth: () => [300, vi.fn()],
}));

vi.mock("@/components/PanelResizer", () => ({
  PanelResizer: () => null,
}));

vi.mock("sonner", () => ({
  toast: {
    error: (...args: unknown[]) => toastErrorMock(...args),
    success: (...args: unknown[]) => toastSuccessMock(...args),
  },
}));

function buildProvider(
  overrides: Partial<Provider> & Pick<Provider, "id" | "name">,
): Provider {
  return {
    id: overrides.id,
    name: overrides.name,
    type: overrides.type ?? "openai_compatible",
    base_url: overrides.base_url ?? "https://api.example.com/v1",
    api_key: overrides.api_key ?? "",
    headers: overrides.headers ?? {},
    retry_429_delay_seconds: overrides.retry_429_delay_seconds ?? 0,
    models: overrides.models ?? [],
  };
}

let swrProvidersState: {
  data: Provider[];
  mutate: ReturnType<typeof vi.fn>;
};

function renderPage() {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <ProvidersPage />
    </SWRConfig>,
  );
}

describe("ProvidersPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    swrProvidersState = {
      data: [],
      mutate: vi.fn().mockResolvedValue(undefined),
    };
    swrMock.mockImplementation(() => ({
      data: swrProvidersState.data,
      isLoading: false,
      mutate: swrProvidersState.mutate,
    }));
  });

  afterEach(() => {
    cleanup();
  });

  it("loads the selected provider draft into the editor", async () => {
    swrProvidersState.data = [
      buildProvider({
        id: "provider-1",
        name: "Primary",
        base_url: "https://api.example.com/v1",
      }),
    ];

    renderPage();

    fireEvent.click(screen.getAllByRole("button", { name: /Primary/i })[0]!);

    expect(
      screen.getByRole("heading", { name: "Primary" }),
    ).toBeInTheDocument();
    expect(
      screen.getByDisplayValue("https://api.example.com/v1"),
    ).toBeInTheDocument();
  });

  it("fetches discovered models into the current provider draft", async () => {
    swrProvidersState.data = [
      buildProvider({ id: "provider-1", name: "Primary" }),
    ];
    fetchProviderCatalogPreviewMock.mockResolvedValue([
      {
        model: "gpt-5",
        source: "discovered",
        context_window_tokens: 128000,
        input_image: true,
        output_image: false,
      },
    ]);

    renderPage();

    fireEvent.click(screen.getAllByRole("button", { name: /Primary/i })[0]!);
    fireEvent.click(screen.getByRole("button", { name: "Fetch Models" }));

    expect(await screen.findByText("gpt-5")).toBeInTheDocument();
    expect(fetchProviderCatalogPreviewMock).toHaveBeenCalledWith(
      expect.objectContaining({
        provider_id: "provider-1",
        type: "openai_compatible",
      }),
    );
  });

  it("disables clearing when the current provider draft has no models", () => {
    swrProvidersState.data = [
      buildProvider({ id: "provider-1", name: "Primary" }),
    ];

    renderPage();

    fireEvent.click(screen.getAllByRole("button", { name: /Primary/i })[0]!);

    expect(
      screen.getByRole("button", { name: /Clear Models/i }),
    ).toBeDisabled();
  });

  it("clears all models from the current draft after confirmation without fetching or testing", () => {
    swrProvidersState.data = [
      buildProvider({
        id: "provider-1",
        name: "Primary",
        models: [
          {
            model: "gpt-5",
            source: "discovered",
            context_window_tokens: 128000,
            input_image: true,
            output_image: false,
          },
          {
            model: "manual-model",
            source: "manual",
            context_window_tokens: null,
            input_image: null,
            output_image: null,
          },
        ],
      }),
    ];

    renderPage();

    fireEvent.click(screen.getAllByRole("button", { name: /Primary/i })[0]!);
    fireEvent.click(screen.getByRole("button", { name: /Clear Models/i }));

    const dialog = screen.getByRole("alertdialog");
    expect(
      within(dialog).getByRole("heading", { name: "Clear all models?" }),
    ).toBeInTheDocument();

    fireEvent.click(
      within(dialog).getByRole("button", { name: "Clear Models" }),
    );

    expect(
      screen.getByText("No models in this provider draft"),
    ).toBeInTheDocument();
    expect(screen.queryByText("gpt-5")).not.toBeInTheDocument();
    expect(screen.queryByText("manual-model")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Save/i })).toBeInTheDocument();
    expect(fetchProviderCatalogPreviewMock).not.toHaveBeenCalled();
    expect(testProviderModelRequestMock).not.toHaveBeenCalled();
    expect(updateProviderMock).not.toHaveBeenCalled();
  });

  it("restores the saved model catalog when canceling after clearing", () => {
    swrProvidersState.data = [
      buildProvider({
        id: "provider-1",
        name: "Primary",
        models: [
          {
            model: "gpt-5",
            source: "discovered",
            context_window_tokens: 128000,
            input_image: true,
            output_image: false,
          },
        ],
      }),
    ];

    renderPage();

    fireEvent.click(screen.getAllByRole("button", { name: /Primary/i })[0]!);
    fireEvent.click(screen.getByRole("button", { name: /Clear Models/i }));
    fireEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "Clear Models",
      }),
    );

    expect(
      screen.getByText("No models in this provider draft"),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Cancel/i }));

    expect(screen.getByText("gpt-5")).toBeInTheDocument();
    expect(
      screen.queryByText("No models in this provider draft"),
    ).not.toBeInTheDocument();
  });

  it("persists the cleared model catalog when saving after clearing", async () => {
    swrProvidersState.data = [
      buildProvider({
        id: "provider-1",
        name: "Primary",
        models: [
          {
            model: "gpt-5",
            source: "discovered",
            context_window_tokens: 128000,
            input_image: true,
            output_image: false,
          },
        ],
      }),
    ];
    updateProviderMock.mockResolvedValue(
      buildProvider({ id: "provider-1", name: "Primary", models: [] }),
    );

    renderPage();

    fireEvent.click(screen.getAllByRole("button", { name: /Primary/i })[0]!);
    fireEvent.click(screen.getByRole("button", { name: /Clear Models/i }));
    fireEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "Clear Models",
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: /Save/i }));

    await waitFor(() =>
      expect(updateProviderMock).toHaveBeenCalledWith(
        "provider-1",
        expect.objectContaining({ models: [] }),
      ),
    );
  });

  it("adds a manual model and submits the updated catalog", async () => {
    swrProvidersState.data = [
      buildProvider({
        id: "provider-1",
        name: "Primary",
        models: [
          {
            model: "gpt-5",
            source: "discovered",
            context_window_tokens: 128000,
            input_image: true,
            output_image: false,
          },
        ],
      }),
    ];
    updateProviderMock.mockResolvedValue(
      buildProvider({
        id: "provider-1",
        name: "Primary",
        models: [
          {
            model: "gpt-5",
            source: "discovered",
            context_window_tokens: 128000,
            input_image: true,
            output_image: false,
          },
          {
            model: "manual-model",
            source: "manual",
            context_window_tokens: null,
            input_image: null,
            output_image: null,
          },
        ],
      }),
    );

    renderPage();

    fireEvent.click(screen.getAllByRole("button", { name: /Primary/i })[0]!);
    fireEvent.click(screen.getByRole("button", { name: "Add Model" }));

    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Model ID"), {
      target: { value: "manual-model" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Add Model" }));

    expect(screen.getByText("manual-model")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Save Provider" }));

    await waitFor(() =>
      expect(updateProviderMock).toHaveBeenCalledWith(
        "provider-1",
        expect.objectContaining({
          models: [
            expect.objectContaining({
              model: "gpt-5",
              source: "discovered",
            }),
            expect.objectContaining({
              model: "manual-model",
              source: "manual",
            }),
          ],
        }),
      ),
    );
  }, 10000);

  it("shows inline model test feedback for the current provider draft", async () => {
    swrProvidersState.data = [
      buildProvider({
        id: "provider-1",
        name: "Primary",
        models: [
          {
            model: "gpt-5",
            source: "discovered",
            context_window_tokens: 128000,
            input_image: true,
            output_image: false,
          },
        ],
      }),
    ];
    testProviderModelRequestMock.mockResolvedValue({
      ok: true,
      duration_ms: 321,
    });

    renderPage();

    fireEvent.click(screen.getAllByRole("button", { name: /Primary/i })[0]!);
    fireEvent.click(screen.getByRole("button", { name: "Test" }));

    expect(testProviderModelRequestMock).toHaveBeenCalledWith(
      expect.objectContaining({
        provider_id: "provider-1",
        model: "gpt-5",
      }),
    );
    expect(
      await screen.findByText("Test succeeded in 321ms"),
    ).toBeInTheDocument();
  });
});
