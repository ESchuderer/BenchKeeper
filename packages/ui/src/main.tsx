import "@mantine/core/styles.css";
import { client, exchange, subscribe } from "@cedarloom/client";
import { Alert, Container, createTheme, MantineProvider, type MantineColorsTuple, Title } from "@mantine/core";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App, type Session } from "./App.tsx";
import { t } from "./i18n.ts";

const KEY = "cedarloom.csrf";

// shortcut: the brand's evergreen (#2e5e4e) as shade 7 of a hand-made palette; replace it with the theme generated from
// the family design tokens once they are published. Shade 7 keeps text on white and white on it above 4.5:1.
const cedar: MantineColorsTuple = [
  "#eef5f2",
  "#dde9e4",
  "#b7d0c6",
  "#8fb6a7",
  "#6d9f8c",
  "#57917c",
  "#4a8571",
  "#2e5e4e",
  "#254d40",
  "#1b3a30",
];
const theme = createTheme({ primaryColor: "cedar", primaryShade: 7, colors: { cedar } });

/**
 * The URL token works once: the CSRF token it buys stays in this tab's sessionStorage, so a reload keeps the session,
 * and the token leaves the address bar and the history before anything else runs.
 */
const connect = async (): Promise<Session | null> => {
  const token = new URLSearchParams(location.hash.slice(1)).get("t");
  history.replaceState(null, "", "/");
  try {
    if (token !== null) sessionStorage.setItem(KEY, await exchange(location.origin, token));
  } catch {
    // A link used before, opened again: the session this tab already holds, if any, still works.
  }
  const csrf = sessionStorage.getItem(KEY);
  if (csrf === null) return null;
  return {
    api: client(location.origin, csrf),
    listen: (onEvent, signal) => subscribe(location.origin, csrf, onEvent, { signal }),
  };
};

const root = createRoot(document.getElementById("root") ?? document.body);
const session = await connect().catch(() => null);
root.render(
  <StrictMode>
    <MantineProvider theme={theme}>
      {session === null ? (
        <Container component="main" size="sm" py="xl">
          <Title order={1} size="h3" mb="md">
            {t("app.title")}
          </Title>
          <Alert color="red" role="alert">
            {t("session.lost")}
          </Alert>
        </Container>
      ) : (
        <App session={session} />
      )}
    </MantineProvider>
  </StrictMode>,
);
