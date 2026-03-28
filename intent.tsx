import { Intent, Navigation, Script } from "scripting";

import { DefaultPlaylistApp } from "./lib/defaultPlaylistApp";

function resolveIntentInput() {
  return (
    Intent.urlsParameter?.[0] ??
    Intent.textsParameter?.[0] ??
    (Intent.shortcutParameter?.type === "text"
      ? Intent.shortcutParameter.value
      : undefined)
  );
}

async function run() {
  resolveIntentInput();

  await Navigation.present({
    element: <DefaultPlaylistApp />,
  });

  Script.exit();
}

void run();
