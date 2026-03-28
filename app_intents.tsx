import { AppIntentManager, AppIntentProtocol, Script } from "scripting";

import { foregroundAzusa, queueExternalCommand } from "./lib/externalBridge";
import { parseSourceInput } from "./lib/sources";

async function handoffToAzusa(type: "playPause" | "next" | "previous" | "openApp") {
  queueExternalCommand({
    type,
    requestedFrom: Script.env,
  });

  await foregroundAzusa({
    externalCommand: type,
    requestedAt: Date.now(),
  });
}

export const TogglePlaybackIntent = AppIntentManager.register({
  name: "AzusaTogglePlaybackIntent",
  protocol: AppIntentProtocol.AudioPlaybackIntent,
  perform: async () => {
    await handoffToAzusa("playPause");
  },
});

export const NextTrackIntent = AppIntentManager.register({
  name: "AzusaNextTrackIntent",
  protocol: AppIntentProtocol.AudioPlaybackIntent,
  perform: async () => {
    await handoffToAzusa("next");
  },
});

export const PreviousTrackIntent = AppIntentManager.register({
  name: "AzusaPreviousTrackIntent",
  protocol: AppIntentProtocol.AudioPlaybackIntent,
  perform: async () => {
    await handoffToAzusa("previous");
  },
});

export const OpenAzusaIntent = AppIntentManager.register({
  name: "AzusaOpenIntent",
  protocol: AppIntentProtocol.AppIntent,
  perform: async () => {
    await handoffToAzusa("openApp");
  },
});

export const OpenAzusaSourceIntent = AppIntentManager.register({
  name: "AzusaOpenSourceIntent",
  protocol: AppIntentProtocol.AppIntent,
  perform: async ({ input }: { input: string }) => {
    const source = parseSourceInput(input);

    queueExternalCommand({
      type: source ? "openSource" : "openApp",
      source: source ?? undefined,
      requestedFrom: Script.env,
    });

    await foregroundAzusa({
      externalCommand: source ? "openSource" : "openApp",
      sourceInput: input,
      requestedAt: Date.now(),
    });
  },
});
